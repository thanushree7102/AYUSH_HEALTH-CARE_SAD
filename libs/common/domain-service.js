// Builds one AYUSH domain service (Ayurveda, Yoga & Naturopathy, Unani, Siddha, Homoeopathy).
// This file is only the HTTP / storage / consent PLUMBING. Each service's server.js supplies its OWN clinical
// content (parts + fields) and runs with its OWN database; nothing is shared between domains at run time.
//   GET  /forms                              form definitions of this system (the UI renders from them)
//   GET  /consultations/:cid/:part           latest saved version
//   GET  /consultations/:cid/:part/versions  version history
//   POST /consultations/:cid/:part           save a NEW version (never overwrites; Idempotency-Key supported)
//   GET  /consultations/:cid/summary         latest of every part
const path = require('path');
const express = require('express');
const { createService, finish, listen, authenticate, serviceOnly, forbid, invalid, idem } = require('./http');
const { openDb, now } = require('./db');
const { validateFields, str } = require('./validate');
const { checkAccess, clinical, audit } = require('./internal');
const { createEvents } = require('./events');
const { SERVICES, SYSTEMS, EVENTS } = require('./config');

module.exports = function buildDomainService({ key, folder, dir, parts, strict = true, extraRoutes = null, onSave = null }) {
  process.env.SERVICE_NAME = key;
  const label = SYSTEMS[key];
  const db = openDb(path.join(dir, '..', 'database'), `${key}.db`, folder);
  const T = `${key}_parts`;
  db.exec(`
    CREATE TABLE IF NOT EXISTS ${T} (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      consultation_code TEXT NOT NULL, patient_id TEXT NOT NULL, encounter_id TEXT,
      part TEXT NOT NULL, version INTEGER NOT NULL, data TEXT NOT NULL,
      saved_by TEXT, saved_role TEXT, saved_at TEXT NOT NULL,
      UNIQUE (consultation_code, part, version)
    );
    CREATE INDEX IF NOT EXISTS ix_${key}_patient ON ${T}(patient_id);
    CREATE TABLE IF NOT EXISTS ${key}_assessments (
      assessment_id TEXT PRIMARY KEY, patient_id TEXT NOT NULL, encounter_id TEXT NOT NULL UNIQUE, consultation_code TEXT,
      summary TEXT NOT NULL DEFAULT '{}', assessed_by TEXT, assessed_at TEXT
    );
  `);
  const events = createEvents(key, db);
  const ix = idem(db);
  const partById = Object.fromEntries(parts.map((p) => [p.id, p]));

  const latest = (cid, part) => {
    const r = db.prepare(`SELECT * FROM ${T} WHERE consultation_code = ? AND part = ? ORDER BY version DESC LIMIT 1`).get(cid, part);
    return r ? { ...JSON.parse(r.data), _version: r.version, _savedAt: r.saved_at } : null;
  };
  const app = createService(key);

  app.get('/forms', authenticate, (req, res) => res.json({ system: label, key, parts: parts.map(({ id, label: l, practitionerOnly, fields, help }) => ({ id, label: l, practitionerOnly: !!practitionerOnly, fields, help: help || null })) }));

  // consultation -> patient (Common Clinical) -> consent check (Shared Platform)
  async function open(req, res, mode) {
    const r = await clinical.get(`/internal/encounters/by-code/${encodeURIComponent(req.params.cid)}`, { requestId: req.id });
    if (r.status === 503) { res.status(503).json({ message: 'Consultation service is not available right now. Please retry.' }); return null; }
    if (!r.ok) { res.status(404).json({ message: 'Consultation not found.' }); return null; }
    const a = await checkAccess(req, { patient: r.data.patientId, system: label, mode });
    if (a.unavailable) { res.status(503).json({ message: 'Identity service is not available right now. Please retry.' }); return null; }
    if (!a.allowed) { res.status(403).json({ message: a.reason || 'Not allowed.' }); return null; }
    return { enc: r.data, patient: a.patient };
  }
  const ctx = { app, db, T, label, key, latest, open, events, partById };
  if (extraRoutes) extraRoutes(ctx);

  app.get('/consultations/:cid/summary', authenticate, async (req, res) => {
    const o = await open(req, res, 'read'); if (!o) return;
    res.json(Object.fromEntries(parts.map((p) => [p.id, latest(req.params.cid, p.id)])));
  });
  app.get('/consultations/:cid/:part/versions', authenticate, async (req, res) => {
    if (!partById[req.params.part]) return res.status(404).json({ message: 'Unknown form.' });
    const o = await open(req, res, 'read'); if (!o) return;
    res.json(db.prepare(`SELECT version, saved_by savedBy, saved_role savedRole, saved_at savedAt FROM ${T} WHERE consultation_code = ? AND part = ? ORDER BY version DESC`).all(req.params.cid, req.params.part));
  });
  app.get('/consultations/:cid/:part', authenticate, async (req, res) => {
    if (!partById[req.params.part]) return res.status(404).json({ message: 'Unknown form.' });
    const o = await open(req, res, 'read'); if (!o) return;
    const d = latest(req.params.cid, req.params.part);
    return d ? res.json(d) : res.status(404).json({ message: 'Nothing saved yet.' });
  });
  app.post('/consultations/:cid/:part', authenticate, async (req, res) => {
    const { cid, part } = req.params; const def = partById[part];
    if (!def) return res.status(404).json({ message: 'Unknown form.' });
    if (def.practitionerOnly && req.user.role !== 'practitioner') return forbid(res, 'Only a practitioner can record this part.');
    const body = req.body;
    if (!body || typeof body !== 'object' || Array.isArray(body) || !Object.keys(body).length) return res.status(400).json({ message: 'Nothing to save.' });
    if (strict) { const errors = validateFields(def.fields, body); if (Object.keys(errors).length) return invalid(res, errors); }
    const o = await open(req, res, 'write'); if (!o) return;
    const k = req.get('Idempotency-Key'); const route = `${cid}/${part}`; const prev = ix.get(k, route);
    if (prev) return res.status(prev.status).json(JSON.parse(prev.response));
    const savedAt = now(); const by = req.user.role === 'practitioner' ? req.user.code : req.user.role;
    const version = db.transaction(() => {
      const last = db.prepare(`SELECT MAX(version) v FROM ${T} WHERE consultation_code = ? AND part = ?`).get(cid, part).v || 0;
      db.prepare(`INSERT INTO ${T} (consultation_code,patient_id,encounter_id,part,version,data,saved_by,saved_role,saved_at) VALUES (?,?,?,?,?,?,?,?,?)`)
        .run(cid, o.enc.patientId, o.enc.encounterId, part, last + 1, JSON.stringify(body), by, req.user.role, savedAt);
      // running summary of the key facts per consultation (one row per encounter)
      const a = db.prepare(`SELECT * FROM ${key}_assessments WHERE encounter_id = ?`).get(o.enc.encounterId);
      const sum = { ...(a ? JSON.parse(a.summary) : {}), ...(def.summary ? def.summary(body) : {}) };
      if (a) db.prepare(`UPDATE ${key}_assessments SET summary = ?, assessed_by = COALESCE(?, assessed_by), assessed_at = ? WHERE encounter_id = ?`).run(JSON.stringify(sum), req.user.role === 'practitioner' ? req.user.code : null, savedAt, o.enc.encounterId);
      else db.prepare(`INSERT INTO ${key}_assessments (assessment_id,patient_id,encounter_id,consultation_code,summary,assessed_by,assessed_at) VALUES (?,?,?,?,?,?,?)`).run(require('crypto').randomUUID(), o.enc.patientId, o.enc.encounterId, cid, JSON.stringify(sum), req.user.role === 'practitioner' ? req.user.code : null, savedAt);
      if (onSave) onSave({ db, part, body, enc: o.enc, user: req.user });
      events.publish(EVENTS.ASSESSMENT_SAVED, o.enc.patientId, {
        patientId: o.enc.patientId, healthId: o.patient.healthId, encounterId: o.enc.encounterId, consultationCode: cid, system: label, part, partLabel: def.label,
        version: last + 1, doctor: req.user.role === 'practitioner' ? req.user.code : null, savedBy: by, savedAt,
        title: `${label}: ${def.label}`, text: def.brief ? def.brief(body) : Object.values(body).filter((v) => typeof v === 'string' && v).slice(0, 2).join(' | ').slice(0, 200),
        diagnosisNote: part === 'diagnosis' ? [str(body.diagnosis), str(body.notes)].filter(Boolean).join('\n') || null : null,
      });
      return last + 1;
    })();
    audit(req, { action: 'FORM_SAVED', type: `${key}.${part}`, ref: cid });
    const out = { ok: true, consultationId: cid, version, savedAt };
    ix.set(k, route, 201, out);
    res.status(201).json(out);
  });

  // ---- internal ----
  const internal = express.Router();
  internal.use(serviceOnly);
  internal.get('/patients/:pid/assessments', (req, res) => res.json(db.prepare(`SELECT consultation_code consultationCode, summary, assessed_by assessedBy, assessed_at assessedAt FROM ${key}_assessments WHERE patient_id = ?`).all(req.params.pid).map((r) => ({ ...r, summary: JSON.parse(r.summary) }))));
  internal.delete('/patients/:pid', (req, res) => { db.prepare(`DELETE FROM ${T} WHERE patient_id = ?`).run(req.params.pid); db.prepare(`DELETE FROM ${key}_assessments WHERE patient_id = ?`).run(req.params.pid); res.json({ deleted: true }); });
  internal.post('/events', events.handler(async (e) => {
    if (e.type === EVENTS.PATIENT_DELETED) { db.prepare(`DELETE FROM ${T} WHERE patient_id = ?`).run(e.data.patientId); db.prepare(`DELETE FROM ${key}_assessments WHERE patient_id = ?`).run(e.data.patientId); }
  }));
  app.use('/internal', internal);

  finish(app, key);
  listen(app, key);
  events.subscribe(key, `${SERVICES[key].url}/internal/events`, [EVENTS.PATIENT_DELETED]);
  return ctx;
};
