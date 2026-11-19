// Longitudinal Record Service (port 5008): one patient timeline across all AYUSH systems + the consent-aware patient summary.
// Owns longitudinal.db: a READ MODEL built only from events (records, assessments, encounters). It never writes clinical data.
// Every read asks the Shared Platform whether this person may see this patient, and which AYUSH systems the patient allowed;
// entries from other systems are left out (not even counted), so a doctor cannot see what the patient did not share.
try { require('dotenv').config(); } catch (e) { /* optional */ }
process.env.SERVICE_NAME = 'longitudinal';
const path = require('path');
const express = require('express');
const { createService, finish, listen, authenticate, serviceOnly } = require('../../libs/common/http');
const { openDb, uuid } = require('../../libs/common/db');
const { checkAccess, platform, clinical } = require('../../libs/common/internal');
const { createEvents } = require('../../libs/common/events');
const { SERVICES, EVENTS } = require('../../libs/common/config');

const db = openDb(path.join(__dirname, '..', 'database'), 'longitudinal.db', 'longitudinal-record-service');
db.exec(`
CREATE TABLE IF NOT EXISTS timeline_entries (
  entry_id TEXT PRIMARY KEY, patient_id TEXT NOT NULL,
  source_service TEXT NOT NULL, source_ref TEXT NOT NULL,          -- which service/record the entry came from (UNIQUE: events are applied once)
  kind TEXT NOT NULL CHECK (kind IN ('record','assessment','encounter')),
  ayush_system TEXT, consultation_code TEXT, title TEXT NOT NULL, summary TEXT, occurred_at TEXT NOT NULL,
  UNIQUE (source_service, source_ref)
);
CREATE INDEX IF NOT EXISTS ix_tl_patient ON timeline_entries(patient_id, occurred_at);
`);
const events = createEvents('longitudinal', db);
const put = db.prepare(`INSERT OR IGNORE INTO timeline_entries (entry_id,patient_id,source_service,source_ref,kind,ayush_system,consultation_code,title,summary,occurred_at) VALUES (?,?,?,?,?,?,?,?,?,?)`);

const app = createService('longitudinal');
const resolveRef = async (ref, req) => {
  if (!/^C-\d+$/.test(String(ref))) return ref;
  const r = await clinical.get(`/internal/encounters/by-code/${ref}`, { requestId: req.id });
  return r.ok ? r.data.patientId : ref;
};
async function guard(req, res, ref) {
  const a = await checkAccess(req, { patient: await resolveRef(ref, req), mode: 'read' });
  if (a.unavailable) { res.status(503).json({ message: 'Identity service is not available right now. Please retry.' }); return null; }
  if (!a.allowed) { res.status(a.status === 404 ? 404 : 403).json({ message: a.reason || 'Not allowed.' }); return null; }
  return a;
}
const visible = (a, system) => !a.systems || !system || a.systems.includes(system);

app.get('/patients/:id/timeline', authenticate, async (req, res) => {
  const a = await guard(req, res, req.params.id); if (!a) return;
  const { system, from, to } = req.query;
  const rows = db.prepare('SELECT * FROM timeline_entries WHERE patient_id = ? ORDER BY occurred_at DESC').all(a.patient.patientId)
    .filter((r) => visible(a, r.ayush_system) && (!system || r.ayush_system === system) && (!from || r.occurred_at >= from) && (!to || r.occurred_at <= `${to}~`));
  res.json({ patientId: a.patient.healthId, items: rows.map((r) => ({ id: r.entry_id, kind: r.kind, system: r.ayush_system, consultationId: r.consultation_code, title: r.title, summary: r.summary, occurredAt: r.occurred_at })), restricted: !!a.systems });
});

// Same shape the website always used, now assembled from the owning services.
app.get('/patients/:id/summary', authenticate, async (req, res) => {
  const a = await guard(req, res, req.params.id); if (!a) return;
  const [pd, cl] = await Promise.all([platform.get(`/internal/patients/${a.patient.patientId}/profile-data`, { requestId: req.id }), clinical.get(`/internal/patients/${a.patient.patientId}/records`, { requestId: req.id })]);
  if (!pd.ok) return res.status(pd.status === 404 ? 404 : 503).json({ message: pd.data && pd.data.message });
  const c = cl.ok ? cl.data : { consultationId: null, records: [], uploads: [] }; // clinical data missing = say so, don't fail the whole summary
  res.json({
    name: pd.data.name, healthId: pd.data.healthId, consultationId: c.consultationId, gender: pd.data.gender, dob: pd.data.dob,
    records: c.records.filter((r) => visible(a, r.system)), uploads: a.systems ? [] : c.uploads,
    medicalHistory: pd.data.medicalHistory, concerns: pd.data.concerns, lastExtracted: null,
    sharedWith: req.user.role === 'patient' ? pd.data.sharedWith : [], restricted: !!a.systems, clinicalAvailable: cl.ok,
  });
});

const internal = express.Router();
internal.use(serviceOnly);
internal.delete('/patients/:pid', (req, res) => { db.prepare('DELETE FROM timeline_entries WHERE patient_id = ?').run(req.params.pid); res.json({ deleted: true }); });
internal.post('/events', events.handler(async (e) => {
  const d = e.data || {};
  if (e.type === EVENTS.RECORD_CREATED) put.run(uuid(), d.patientId, 'clinical', `record:${d.recordId}`, 'record', d.system, d.consultationCode, `${d.system} record`, [d.problem, d.diagnosis].filter(Boolean).join(' | '), d.savedAt);
  else if (e.type === EVENTS.ASSESSMENT_SAVED) put.run(uuid(), d.patientId, d.system, `${d.consultationCode}:${d.part}:${d.version}`, 'assessment', d.system, d.consultationCode, d.title, d.text || '', d.savedAt);
  else if (e.type === EVENTS.ENCOUNTER_CREATED) put.run(uuid(), d.patientId, 'clinical', `encounter:${d.encounterId}`, 'encounter', d.system, d.consultationCode, 'Consultation started', d.reason || '', d.at);
  else if (e.type === EVENTS.PATIENT_DELETED) db.prepare('DELETE FROM timeline_entries WHERE patient_id = ?').run(d.patientId);
}));
app.use('/internal', internal);

finish(app, 'longitudinal');
listen(app, 'longitudinal');
events.subscribe('longitudinal', `${SERVICES.longitudinal.url}/internal/events`, [EVENTS.RECORD_CREATED, EVENTS.ASSESSMENT_SAVED, EVENTS.ENCOUNTER_CREATED, EVENTS.PATIENT_DELETED]);
