// Helpers shared by the Shared Platform's route files.
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const db = require('./db');
const security = require('../../libs/common/security');
const otpStore = require('./otp');
const { createEvents } = require('../../libs/common/events');
const { maskMobile } = require('../../libs/common/validate');

const { uuid, now } = db;
const OTP_MAX_FAILS = 5;
const OTP_LOCK_MINUTES = 15;
const ACCESS_TTL = Number(process.env.ACCESS_TOKEN_MINUTES || 60) * 60;
const SESSION_MAX = Number(process.env.SESSION_MAX_HOURS || 12) * 3600;
const STORAGE_DIR = path.resolve(process.env.PLATFORM_STORAGE_DIR || (process.env.DATA_ROOT ? path.join(process.env.DATA_ROOT, 'shared-platform', 'storage') : path.join(__dirname, '..', 'storage'))); // private: never served statically
fs.mkdirSync(STORAGE_DIR, { recursive: true });

const events = createEvents('platform', db);
const rnd = (n) => Array.from({ length: n }, () => crypto.randomInt(0, 10)).join('');
const uniqueCode = (prefix, table, col, gen) => { for (;;) { const c = `${prefix}${gen()}`; if (!db.prepare(`SELECT 1 FROM ${table} WHERE ${col}=?`).get(c)) return c; } };
const today = () => now().slice(0, 10);

// ---------- audit + authentication events ----------
function audit(req, { actor = null, action, type = null, ref = null, result = 'Success', reason = null }) {
  db.prepare(`INSERT INTO audit_logs (audit_log_id,actor_user_id,action,entity_type,entity_reference_id,timestamp,ip_reference,result,reason)
              VALUES (?,?,?,?,?,?,?,?,?)`).run(uuid(), actor || (req && req.user && req.user.userId) || null, action, type, ref, now(), req && req.ip ? req.ip : null, result, reason);
}

// OTP check. Every attempt is recorded in authentication_events; 5 wrong tries lock the number for 15 minutes.
function checkOtp(mobile, otp, userId = null) {
  const dest = maskMobile(mobile);
  const since = new Date(Date.now() - OTP_LOCK_MINUTES * 60000).toISOString();
  const lastOk = db.prepare(`SELECT MAX(created_at) t FROM authentication_events WHERE destination_masked=? AND event_status='Successful'`).get(dest).t || '';
  const fails = db.prepare(`SELECT COUNT(*) c FROM authentication_events WHERE destination_masked=? AND event_status='Failed' AND created_at > ? AND created_at > ?`).get(dest, since, lastOk).c;
  const event = (status, attempts) => db.prepare(`INSERT INTO authentication_events (auth_event_id,user_id,method,destination_masked,event_status,attempt_count,created_at,expires_at)
    VALUES (?,?,?,?,?,?,?,?)`).run(uuid(), userId, 'SMS_OTP', dest, status, attempts, now(), null);
  if (fails >= OTP_MAX_FAILS) { event('Locked', fails); return { ok: false, status: 429, message: `Too many wrong OTPs. Try again in ${OTP_LOCK_MINUTES} minutes.` }; }
  if (!otpStore.verify(mobile, otp)) {
    event('Failed', fails + 1);
    return { ok: false, status: 401, message: "That OTP isn't right or has expired. Ask for a new one." };
  }
  event('Successful', fails);
  otpStore.prove(mobile);
  return { ok: true };
}
// Registration steps after the OTP was entered once: accept the proof (no second code), or a live code if none yet.
const checkProof = (mobile, otp, userId = null) => (otpStore.isProven(mobile) ? { ok: true } : checkOtp(mobile, otp, userId));

// ---------- private file storage (document_reference values) ----------
const EXT = { 'application/pdf': '.pdf', 'image/jpeg': '.jpg', 'image/png': '.png' };
const fileFilter = (req, file, cb) => (EXT[file.mimetype] ? cb(null, true) : cb(new multer.MulterError('LIMIT_UNEXPECTED_FILE', 'Only PDF, JPG or PNG files are allowed.')));
const disk = multer({
  storage: multer.diskStorage({ destination: (req, file, cb) => cb(null, STORAGE_DIR), filename: (req, file, cb) => cb(null, `${uuid()}${EXT[file.mimetype] || ''}`) }),
  limits: { fileSize: 10 * 1024 * 1024 }, fileFilter,
});
const dropFile = (f) => { if (f) fs.unlink(f.path, () => {}); };

// ---------- lookups ----------
const getPatient = (ref) => db.prepare('SELECT * FROM patients WHERE health_id = ? OR patient_id = ?').get(ref, ref);
const doctorByCode = (code) => db.prepare('SELECT * FROM doctors WHERE doctor_code = ?').get(code);
const userFor = (mobile, type) => db.prepare('SELECT * FROM user_accounts WHERE mobile_number = ? AND account_type = ?').get(mobile, type);
const liveDoctor = (d) => !!d && ['Approved', 'Active'].includes(d.profile_status);
const liveFacility = (f) => !!f && ['Approved', 'Active'].includes(f.facility_status);

// Active "health-data sharing" grants of a patient. systems = null means every AYUSH system.
const grantsOf = (patientId) => db.prepare(`SELECT cr.consent_id consentId, d.doctor_id doctorId, d.doctor_code code, d.full_name name, g.expires_at exp, g.systems
    FROM consent_records cr JOIN consent_grants g ON g.consent_id = cr.consent_id JOIN doctors d ON d.doctor_id = g.doctor_id
    WHERE cr.subject_profile_id = ? AND cr.purpose = 'health-data sharing' AND cr.consent_status = 'Granted' AND (g.expires_at IS NULL OR g.expires_at > ?)`)
  .all(patientId, now()).map((r) => ({ ...r, systems: r.systems ? JSON.parse(r.systems) : null }));

// ---------- admin access (roles -> permissions), always read from the database ----------
function adminCtx(userId) {
  if (!userId) return null;
  const a = db.prepare(`SELECT ap.*, ua.account_status FROM admin_profiles ap JOIN user_accounts ua ON ua.user_id = ap.user_id WHERE ap.user_id = ?`).get(userId);
  if (!a || a.admin_status !== 'Active' || a.account_status !== 'Active') return null;
  const perms = db.prepare(`SELECT DISTINCT p.permission_code c FROM user_role_assignments ura
      JOIN role_permissions rp ON rp.role_id = ura.role_id JOIN permissions p ON p.permission_id = rp.permission_id
      WHERE ura.user_id = ? AND (ura.expires_at IS NULL OR ura.expires_at > ?)`).all(a.user_id, now()).map((r) => r.c);
  const roles = db.prepare(`SELECT r.role_name n FROM user_role_assignments ura JOIN roles r ON r.role_id = ura.role_id WHERE ura.user_id = ?`).all(a.user_id).map((r) => r.n);
  return { ...a, perms: new Set(perms), roles };
}
const need = (perm) => (req, res, next) => {
  const c = req.user && req.user.role === 'admin' ? adminCtx(req.user.userId) : null;
  if (!c || !c.perms.has(perm)) {
    audit(req, { actor: c && c.user_id, action: 'ACCESS', type: 'permission', reason: perm, result: 'Denied' });
    return res.status(403).json({ message: 'You do not have permission for this.' });
  }
  req.admin = c; return next();
};

// ---------- access tokens ----------
const issueAccessToken = (user, sessionStart = Math.floor(Date.now() / 1000)) =>
  security.sign({ k: 'access', u: user.user_id, t: user.account_type, m: user.mobile_number, s0: sessionStart }, ACCESS_TTL);

module.exports = {
  db, uuid, now, rnd, uniqueCode, today, audit, checkOtp, checkProof, otpStore, events, security,
  STORAGE_DIR, disk, dropFile, EXT, getPatient, doctorByCode, userFor, liveDoctor, liveFacility, grantsOf, adminCtx, need,
  issueAccessToken, ACCESS_TTL, SESSION_MAX,
};
