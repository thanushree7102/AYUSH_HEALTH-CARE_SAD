// Common Clinical Service (port 5007): encounters (consultations), prescriptions / saved records, uploaded documents.
// Owns services/common-clinical-service/database/clinical.db. Identity + consent come from the Shared Platform
// (/internal/access/check); AYUSH forms live in the five domain services. Cross-service ids (patient_id, doctor code)
// are plain stable ids, never database foreign keys.
try { require('dotenv').config(); } catch (e) { /* optional */ }
process.env.SERVICE_NAME = 'clinical';
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const express = require('express');
const { createService, finish, listen, authenticate, serviceOnly, forbid, invalid, idem } = require('../../../libs/common/http');
const { openDb, uuid, now } = require('../../../libs/common/db');
const { str } = require('../../../libs/common/validate');
const { checkAccess, audit, integrations } = require('../../../libs/common/internal');
const { createEvents } = require('../../../libs/common/events');
const { SERVICES, SYSTEM_NAMES, EVENTS } = require('../../../libs/common/config');
const crypto = require('crypto');

const db = openDb(path.join(__dirname, '..', 'database'), 'clinical.db', 'common-clinical-service');
const STORAGE_DIR = path.resolve(process.env.CLINICAL_STORAGE_DIR || (process.env.DATA_ROOT ? path.join(process.env.DATA_ROOT, 'common-clinical-service', 'storage') : path.join(__dirname, '..', 'storage'))); // private: never served statically
fs.mkdirSync(STORAGE_DIR, { recursive: true });
const events = createEvents('clinical', db);
const ix = idem(db);

db.exec(`
CREATE TABLE IF NOT EXISTS encounters (
  encounter_id TEXT PRIMARY KEY,
  consultation_code TEXT NOT NULL UNIQUE,                 -- C-123456789, the id doctors use in the AYUSH forms
  patient_id TEXT NOT NULL,                               -- Shared Platform id (no cross-database foreign key)
  patient_health_id TEXT,
  doctor_reference_id TEXT, facility_reference_id TEXT,   -- doctor code / facility code (plain ids)
  consultation_datetime TEXT,
  consultation_mode TEXT CHECK (consultation_mode IS NULL OR consultation_mode IN ('In-person','Video','Audio','Chat')),
  reason TEXT, ayush_system TEXT, clinical_notes TEXT, follow_up_date TEXT,
  status TEXT NOT NULL DEFAULT 'Scheduled' CHECK (status IN ('Scheduled','Completed','Cancelled','No-show')),
  is_primary INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS prescriptions (
  prescription_id TEXT PRIMARY KEY,
  encounter_id TEXT NOT NULL REFERENCES encounters(encounter_id),
  patient_id TEXT NOT NULL,
  doctor_reference_id TEXT,
  prescription_details TEXT,                               -- JSON array of medicines
  instructions TEXT, issued_at TEXT,
  document_reference TEXT                                  -- private storage key, never a public path
);
CREATE TABLE IF NOT EXISTS patient_records (
  record_id INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id TEXT NOT NULL,
  prescription_id TEXT REFERENCES prescriptions(prescription_id),
  document_type TEXT, file_name TEXT, ayush_system TEXT,
  problem TEXT, diagnosis TEXT, prakriti TEXT, saved_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS patient_uploads (
  upload_id INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id TEXT NOT NULL,
  file_name TEXT, mime_type TEXT, size INTEGER CHECK (size IS NULL OR size >= 0),
  document_reference TEXT, uploaded_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_enc_patient ON encounters(patient_id);
CREATE INDEX IF NOT EXISTS ix_rx_patient ON prescriptions(patient_id);
CREATE INDEX IF NOT EXISTS ix_rec_patient ON patient_records(patient_id);
`);

const rnd = (n) => Array.from({ length: n }, () => crypto.randomInt(0, 10)).join('');
const newCode = () => { for (;;) { const c = `C-${rnd(9)}`; if (!db.prepare('SELECT 1 FROM encounters WHERE consultation_code=?').get(c)) return c; } };
const EXT = { 'application/pdf': '.pdf', 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' };
const disk = multer({
  storage: multer.diskStorage({ destination: (req, f, cb) => cb(null, STORAGE_DIR), filename: (req, f, cb) => cb(null, `${uuid()}${EXT[f.mimetype] || ''}`) }),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, f, cb) => (['application/pdf', 'image/jpeg', 'image/png'].includes(f.mimetype) ? cb(null, true) : cb(new multer.MulterError('LIMIT_UNEXPECTED_FILE', 'Only PDF, JPG or PNG files are allowed.'))),
});
const mem = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// ---------- data helpers ----------
function ensurePrimary(patientId, healthId) {
  let e = db.prepare('SELECT * FROM encounters WHERE patient_id = ? AND is_primary = 1').get(patientId);
  if (!e) {
    const id = uuid();
    db.prepare(`INSERT INTO encounters (encounter_id,consultation_code,patient_id,patient_health_id,status,is_primary,created_at) VALUES (?,?,?,?, 'Scheduled', 1, ?)`).run(id, newCode(), patientId, healthId || null, now());
    e = db.prepare('SELECT * FROM encounters WHERE encounter_id = ?').get(id);
  }
  return e;
}
const encView = (e) => ({ encounterId: e.encounter_id, consultationId: e.consultation_code, patientId: e.patient_id, healthId: e.patient_health_id, doctorId: e.doctor_reference_id, system: e.ayush_system, mode: e.consultation_mode, reason: e.reason, datetime: e.consultation_datetime, followUpDate: e.follow_up_date, notes: e.clinical_notes, status: e.status });

function createRecord(patientId, healthId, b) {
  const enc = ensurePrimary(patientId, healthId);
  const t = b.date ? `${b.date}T00:00:00.000Z` : now(); const rx = uuid();
  const meds = Array.isArray(b.medicines) ? b.medicines : Array.isArray(b.meds) ? b.meds : [];
  const system = SYSTEM_NAMES.includes(b.system) ? b.system : 'Ayurveda';
  const r = db.transaction(() => {
    db.prepare(`INSERT INTO prescriptions (prescription_id,encounter_id,patient_id,doctor_reference_id,prescription_details,instructions,issued_at) VALUES (?,?,?,?,?,?,?)`)
      .run(rx, enc.encounter_id, patientId, b.doctorId || null, JSON.stringify(meds), b.advice || '', t);
    return db.prepare(`INSERT INTO patient_records (patient_id,prescription_id,document_type,file_name,ayush_system,problem,diagnosis,prakriti,saved_at) VALUES (?,?,?,?,?,?,?,?,?)`)
      .run(patientId, rx, b.documentType || b.docType || null, b.fileName || null, system, b.problem || '', b.diagnosis || '', b.prakriti || '', t);
  })();
  const recordId = `R-${r.lastInsertRowid}`;
  events.publish(EVENTS.RECORD_CREATED, patientId, { patientId, healthId, recordId, encounterId: enc.encounter_id, consultationCode: enc.consultation_code, system, problem: b.problem || '', diagnosis: b.diagnosis || '', medicines: meds, savedAt: t });
  return recordId;
}
function recordsOf(patientId) {
  return db.prepare(`SELECT r.record_id, r.saved_at, r.document_type, r.file_name, r.ayush_system, r.problem, r.diagnosis, r.prakriti, x.prescription_details, x.instructions
    FROM patient_records r LEFT JOIN prescriptions x ON x.prescription_id = r.prescription_id WHERE r.patient_id = ? ORDER BY r.record_id`).all(patientId).map((r) => ({
    recordId: `R-${r.record_id}`, savedAt: r.saved_at, documentType: r.document_type, fileName: r.file_name, system: r.ayush_system, problem: r.problem, diagnosis: r.diagnosis, prakriti: r.prakriti,
    medicines: JSON.parse(r.prescription_details || '[]'), advice: r.instructions || '',
  }));
}
const uploadsOf = (patientId) => db.prepare('SELECT * FROM patient_uploads WHERE patient_id = ? ORDER BY upload_id').all(patientId)
  .map((u) => ({ uploadId: `U-${u.upload_id}`, fileName: u.file_name, documentType: u.mime_type, uploadedAt: u.uploaded_at, savedAt: u.uploaded_at }));
const purge = (patientId) => db.transaction(() => {
  for (const f of db.prepare('SELECT document_reference r FROM patient_uploads WHERE patient_id = ?').all(patientId)) { try { fs.unlinkSync(path.join(STORAGE_DIR, path.basename(f.r))); } catch (e) { /* already gone */ } }
  db.prepare('DELETE FROM patient_records WHERE patient_id = ?').run(patientId);
  db.prepare('DELETE FROM prescriptions WHERE patient_id = ?').run(patientId);
  db.prepare('DELETE FROM patient_uploads WHERE patient_id = ?').run(patientId);
  db.prepare('DELETE FROM encounters WHERE patient_id = ?').run(patientId);
})();

// Ask the Shared Platform; send the right HTTP answer when access is refused.
async function guard(req, res, patient, system, mode) {
  const a = await checkAccess(req, { patient, system, mode });
  if (a.unavailable) { res.status(503).json({ message: 'Identity service is not available right now. Please retry.' }); return null; }
  if (!a.allowed) { res.status(a.status === 404 ? 404 : 403).json({ message: a.reason || 'Not allowed.' }); return null; }
  return a;
}
const resolveRef = (ref) => { const m = /^C-\d+$/.test(String(ref)) && db.prepare('SELECT patient_id FROM encounters WHERE consultation_code = ?').get(ref); return m ? m.patient_id : ref; };

const app = createService('clinical', { jsonLimit: '20mb' });

// ================= encounters =================
app.post('/encounters', authenticate, async (req, res) => {
  const b = req.body || {};
  const system = str(b.ayushSystem) || null;
  if (system && !SYSTEM_NAMES.includes(system)) return invalid(res, { ayushSystem: 'Choose a valid AYUSH system' });
  if (b.mode && !['In-person', 'Video', 'Audio', 'Chat'].includes(b.mode)) return invalid(res, { mode: 'Choose a valid mode' });
  const a = await guard(req, res, resolveRef(b.patientId), system, 'write'); if (!a) return;
  const key = req.get('Idempotency-Key'); const prev = ix.get(key, 'encounters');
  if (prev) return res.status(prev.status).json(JSON.parse(prev.response));
  const p = a.patient; const id = uuid(); const code = newCode();
  ensurePrimary(p.patientId, p.healthId);
  db.prepare(`INSERT INTO encounters (encounter_id,consultation_code,patient_id,patient_health_id,doctor_reference_id,consultation_datetime,consultation_mode,reason,ayush_system,follow_up_date,status,created_at)
              VALUES (?,?,?,?,?,?,?,?,?,?, 'Scheduled', ?)`).run(id, code, p.patientId, p.healthId, req.user.role === 'practitioner' ? req.user.code : null, str(b.datetime) || now(), b.mode || null, str(b.reason), system, str(b.followUpDate), now());
  events.publish(EVENTS.ENCOUNTER_CREATED, p.patientId, { patientId: p.patientId, encounterId: id, consultationCode: code, system, reason: str(b.reason), doctor: req.user.role === 'practitioner' ? req.user.code : null, at: now() });
  const out = { encounterId: id, consultationId: code, status: 'Scheduled' };
  ix.set(key, 'encounters', 201, out);
  res.status(201).json(out);
});
app.get('/encounters', authenticate, async (req, res) => {
  const ref = resolveRef(req.query.patient);
  const a = await guard(req, res, ref, null, 'read'); if (!a) return;
  const list = db.prepare('SELECT * FROM encounters WHERE patient_id = ? ORDER BY created_at').all(a.patient.patientId)
    .filter((e) => !a.systems || !e.ayush_system || a.systems.includes(e.ayush_system)).map(encView);
  res.json(list);
});
app.get('/encounters/:code', authenticate, async (req, res) => {
  const e = db.prepare('SELECT * FROM encounters WHERE consultation_code = ?').get(req.params.code);
  if (!e) return res.status(404).json({ message: 'Consultation not found.' });
  const a = await guard(req, res, e.patient_id, e.ayush_system, 'read'); if (!a) return;
  res.json(encView(e));
});
app.patch('/encounters/:code', authenticate, async (req, res) => {
  if (req.user.role !== 'practitioner') return forbid(res, 'Only a practitioner can update a consultation.');
  const e = db.prepare('SELECT * FROM encounters WHERE consultation_code = ?').get(req.params.code);
  if (!e) return res.status(404).json({ message: 'Consultation not found.' });
  const a = await guard(req, res, e.patient_id, e.ayush_system, 'write'); if (!a) return;
  const b = req.body || {};
  if (b.status && !['Scheduled', 'Completed', 'Cancelled', 'No-show'].includes(b.status)) return invalid(res, { status: 'Choose a valid status' });
  db.prepare('UPDATE encounters SET status = COALESCE(?, status), clinical_notes = COALESCE(?, clinical_notes), follow_up_date = COALESCE(?, follow_up_date), doctor_reference_id = ? WHERE encounter_id = ?')
    .run(b.status || null, str(b.notes), str(b.followUpDate), req.user.code, e.encounter_id);
  audit(req, { action: 'ENCOUNTER_UPDATED', type: 'encounter', ref: e.encounter_id, reason: b.status || null });
  res.json(encView(db.prepare('SELECT * FROM encounters WHERE encounter_id = ?').get(e.encounter_id)));
});

// ================= records / uploads =================
// Reads a prescription / report photo and returns a DRAFT the patient checks before saving (the reader lives in Integrations).
app.post('/records/extract', authenticate, mem.single('file'), async (req, res) => {
  if (!['patient', 'practitioner'].includes(req.user.role)) return forbid(res);
  if (!req.file) return res.status(400).json({ message: 'No file received.' });
  if (!['application/pdf', 'image/jpeg', 'image/png'].includes(req.file.mimetype)) return res.status(400).json({ message: 'Only JPG, PNG or PDF files are allowed.' });
  const r = await integrations.post('/internal/reader/read', { mime: req.file.mimetype, base64: req.file.buffer.toString('base64') }, { timeout: 90000, requestId: req.id });
  if (!r.ok) return res.status(r.status === 503 ? 503 : 500).json({ message: r.status === 503 ? 'The document reader is not available right now.' : 'Could not read the file.' });
  const ex = r.data.ex; const raw = r.data.raw || '';
  const ai = ex._engine === 'AI vision';
  const prak = ['vata', 'pitta', 'kapha'].filter((x) => new RegExp(`\\b${x}\\b`, 'i').test((ex.findings && ex.findings.Prakriti) || raw)).map((x) => x[0].toUpperCase() + x.slice(1)).join('-');
  const sys = { ayurveda: 'Ayurveda', yoga: 'Yoga & Naturopathy', unani: 'Unani', siddha: 'Siddha', homoeopathy: 'Homoeopathy' }[ex.system] || 'Ayurveda';
  let note = ai ? '' : 'Read with the offline English OCR reader. Handwriting and Hindi may be missed. AI vision is not configured on this server; add ANTHROPIC_API_KEY to .env to enable it. Please verify every field before saving.';
  if (!ai && ex._note && /PDF/.test(ex._note)) note = ex._note;
  res.json({
    documentType: (req.body && req.body.documentType) || 'Prescription', system: sys, problem: ex.complaint || '', diagnosis: ex.diagnosis || '', prakriti: prak,
    medicines: (ex.medicines || []).map((m) => ({ name: m.name || '', dose: m.dose || '', timing: m.freq || (m.extra && m.extra.Kala) || '', duration: m.duration || '' })), advice: ex.advice || '', readWithAi: ai, note,
  });
});

app.post('/records', authenticate, async (req, res) => {
  const b = req.body || {};
  const system = SYSTEM_NAMES.includes(b.system) ? b.system : 'Ayurveda';
  const a = await guard(req, res, resolveRef(b.healthId), system, 'write'); if (!a) return;
  const key = req.get('Idempotency-Key'); const prev = ix.get(key, 'records');
  if (prev) return res.status(prev.status).json(JSON.parse(prev.response));
  const recordId = createRecord(a.patient.patientId, a.patient.healthId, { ...b, system, doctorId: req.user.role === 'practitioner' ? req.user.code : null });
  const out = { recordId };
  ix.set(key, 'records', 201, out);
  res.status(201).json(out);
});
app.get('/patients/:id/records', authenticate, async (req, res) => {
  const a = await guard(req, res, resolveRef(req.params.id), null, 'read'); if (!a) return;
  res.json({ records: recordsOf(a.patient.patientId).filter((r) => !a.systems || a.systems.includes(r.system)), uploads: uploadsOf(a.patient.patientId) });
});
app.post('/patients/:id/prescriptions', authenticate, disk.single('file'), async (req, res) => {
  const drop = () => { if (req.file) fs.unlink(req.file.path, () => {}); };
  const a = await guard(req, res, resolveRef(req.params.id), null, 'write'); if (!a) return drop();
  if (!req.file) return res.status(400).json({ message: 'No file received.' });
  const r = db.prepare('INSERT INTO patient_uploads (patient_id,file_name,mime_type,size,document_reference,uploaded_at) VALUES (?,?,?,?,?,?)')
    .run(a.patient.patientId, req.file.originalname, req.file.mimetype, req.file.size, req.file.filename, now());
  res.status(201).json({ uploadId: `U-${r.lastInsertRowid}`, fileName: req.file.originalname });
});

// ================= internal (other services only) =================
const internal = express.Router();
internal.use(serviceOnly);
internal.post('/encounters/ensure', (req, res) => {
  const { patientId, healthId } = req.body || {};
  if (!patientId) return res.status(400).json({ message: 'patientId is required.' });
  const e = ensurePrimary(patientId, healthId);
  res.json({ encounterId: e.encounter_id, consultationId: e.consultation_code });
});
internal.get('/encounters/by-code/:code', (req, res) => {
  const e = db.prepare('SELECT * FROM encounters WHERE consultation_code = ?').get(req.params.code);
  return e ? res.json(encView(e)) : res.status(404).json({ message: 'Consultation not found.' });
});
internal.get('/patients/:pid/records', (req, res) => {
  const e = db.prepare('SELECT consultation_code c FROM encounters WHERE patient_id = ? AND is_primary = 1').get(req.params.pid);
  res.json({ consultationId: e ? e.c : null, records: recordsOf(req.params.pid), uploads: uploadsOf(req.params.pid) });
});
internal.post('/records', (req, res) => {
  const { patientId, healthId, record } = req.body || {};
  if (!patientId || !record) return res.status(400).json({ message: 'patientId and record are required.' });
  res.status(201).json({ recordId: createRecord(patientId, healthId, record) });
});
internal.post('/uploads', (req, res) => {
  const { patientId, fileName, mime, base64 } = req.body || {};
  if (!patientId || !EXT[mime] || !base64) return res.status(400).json({ message: 'patientId, mime and base64 are required.' });
  const buf = Buffer.from(base64, 'base64'); const file = `${uuid()}${EXT[mime]}`;
  fs.writeFileSync(path.join(STORAGE_DIR, file), buf);
  const r = db.prepare('INSERT INTO patient_uploads (patient_id,file_name,mime_type,size,document_reference,uploaded_at) VALUES (?,?,?,?,?,?)').run(patientId, fileName || `upload${EXT[mime]}`, mime, buf.length, file, now());
  res.status(201).json({ uploadId: r.lastInsertRowid });
});
internal.get('/patients/:pid/uploads/count', (req, res) => res.json({ n: db.prepare('SELECT COUNT(*) n FROM patient_uploads WHERE patient_id = ?').get(req.params.pid).n }));
internal.delete('/patients/:pid', (req, res) => { purge(req.params.pid); res.json({ deleted: true }); });
internal.post('/events', events.handler(async (e) => {
  const d = e.data || {};
  if (e.type === EVENTS.PATIENT_CREATED) ensurePrimary(d.patientId, d.healthId);
  else if (e.type === EVENTS.PATIENT_DELETED) purge(d.patientId);
  else if (e.type === EVENTS.ASSESSMENT_SAVED && d.consultationCode) { // the doctor who saved a form and the diagnosis note appear on the encounter
    db.prepare('UPDATE encounters SET doctor_reference_id = COALESCE(?, doctor_reference_id), ayush_system = COALESCE(ayush_system, ?), clinical_notes = COALESCE(?, clinical_notes) WHERE consultation_code = ?')
      .run(d.doctor || null, d.system || null, d.diagnosisNote || null, d.consultationCode);
  }
}));
app.use('/internal', internal);

finish(app, 'clinical');
listen(app, 'clinical');
events.subscribe('clinical', `${SERVICES.clinical.url}/internal/events`, [EVENTS.PATIENT_CREATED, EVENTS.PATIENT_DELETED, EVENTS.ASSESSMENT_SAVED]);
