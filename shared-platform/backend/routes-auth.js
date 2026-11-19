// OTP, login, session (refresh / logout) and "my details".
const { isMobile, bool } = require('../../libs/common/validate');
const { ACCOUNT_TYPE, ROLE_OF } = require('../../libs/common/config');
const { authenticate } = require('../../libs/common/http');
const { integrations } = require('../../libs/common/internal');
const security = require('../../libs/common/security');

const OTP_SHOW = process.env.OTP_SHOW !== '0'; // demo: show the OTP on screen when it could not be sent on WhatsApp. Set 0 in production.

module.exports = function install(v1, c, face) {
  const { db, now, audit, checkOtp, otpStore, userFor, liveDoctor, adminCtx, issueAccessToken, ACCESS_TTL, SESSION_MAX } = c;
  const sec = security;

  // Sends a NEW random code to this number: on WhatsApp when the bot is linked and the number has WhatsApp
  // (asked from the Integrations service), always printed in this service's terminal, and shown on screen in demo mode
  // (OTP_SHOW=0 hides it). To use SMS: add a provider call here, next to the WhatsApp delivery.
  v1.post('/auth/otp/send', async (req, res) => {
    const mobile = String((req.body || {}).mobile || '');
    if (!isMobile(mobile)) return res.status(400).json({ message: 'Enter a valid 10-digit mobile number.' });
    const r = otpStore.issue(mobile);
    if (!r.ok) return res.status(429).json({ message: r.message, wait: r.wait });
    // A person who registered through the WhatsApp bot gets the code on WhatsApp ONLY (never shown on the website screen).
    const waOnly = !!db.prepare(`SELECT 1 FROM user_accounts u JOIN audit_logs a ON a.actor_user_id = u.user_id WHERE u.mobile_number = ? AND a.reason = 'registered on WhatsApp' LIMIT 1`).get(mobile);
    let via = 'screen';
    const d = await integrations.post('/internal/deliver', { mobile, text: `Your AYUSH verification code is *${r.code}*. It is valid for 5 minutes. Do not share it with anyone.` }, { timeout: 7000, requestId: req.id });
    if (d.ok && d.data && d.data.delivered) via = 'whatsapp';
    if (via !== 'whatsapp') console.log(`[OTP] +91 ${mobile}  ->  ${r.code}   (valid 5 minutes)`);
    audit(req, { action: 'OTP_SENT', type: 'user', reason: via });
    return res.json({ sent: true, via, expiresIn: r.expiresIn, resendIn: r.resendIn, ...(OTP_SHOW && !waOnly ? { demoOtp: r.code } : {}) });
  });

  // Registration after a face scan: checks the code once; the steps that follow need no second code.
  v1.post('/auth/otp/confirm', (req, res) => {
    const { mobile, otp } = req.body || {};
    if (!isMobile(mobile)) return res.status(400).json({ message: 'Enter a valid 10-digit mobile number.' });
    const o = checkOtp(mobile, otp);
    if (!o.ok) return res.status(o.status).json({ message: o.message });
    return res.json({ ok: true });
  });

  // Logout: the token is remembered as revoked until it would have expired anyway; the gateway checks this on every call.
  v1.post('/auth/logout', authenticate, (req, res) => {
    const t = sec.verify((req.get('Authorization') || '').replace(/^Bearer /, ''));
    if (t) db.prepare('INSERT OR IGNORE INTO revoked_tokens (nonce,user_id,revoked_at,expires_at) VALUES (?,?,?,?)').run(t.n, t.u, now(), t.exp);
    audit(req, { action: 'LOGOUT', type: 'user', ref: req.user.userId });
    return res.json({ ok: true });
  });
  // Refresh: swap a still-valid token for a new one (the session itself ends SESSION_MAX_HOURS after sign-in).
  v1.post('/auth/refresh', authenticate, (req, res) => {
    const t = sec.verify((req.get('Authorization') || '').replace(/^Bearer /, ''));
    if (!t || t.k !== 'access') return res.status(401).json({ message: 'Please sign in again.' });
    if (Date.now() / 1000 - t.s0 > SESSION_MAX) return res.status(401).json({ message: 'Your session has ended. Please sign in again.' });
    const user = db.prepare('SELECT * FROM user_accounts WHERE user_id = ?').get(t.u);
    if (!user || user.account_status !== 'Active') return res.status(403).json({ message: 'This account is not active.' });
    db.prepare('INSERT OR IGNORE INTO revoked_tokens (nonce,user_id,revoked_at,expires_at) VALUES (?,?,?,?)').run(t.n, t.u, now(), t.exp);
    return res.json({ token: issueAccessToken(user, t.s0), expiresIn: ACCESS_TTL });
  });

// ================= login =================
v1.post('/auth/login', (req, res) => {
  const { mobile, otp, faceToken } = req.body || {};
  const want = String((req.body || {}).role || 'patient').toLowerCase();
  const type = ACCOUNT_TYPE[want];
  if (!type) return res.status(400).json({ message: 'Unknown role.' });
  if (!isMobile(mobile)) return res.status(400).json({ message: 'Enter a valid 10-digit mobile number.' });
  const user = userFor(mobile, type);
  // Face sign-in = face scan AND a fresh OTP sent to this number. (OTP alone is the fallback when there is no camera / face.)
  const byFace = !!faceToken && face.peekFaceLogin(faceToken, mobile);
  if (faceToken && !byFace) return res.status(401).json({ message: 'The face check expired. Please scan your face again.' });
  let o;
  if (byFace && !otp && user && Date.now() - Date.parse(user.created_at) < 120000 && otpStore.useProof(mobile)) o = { ok: true }; // account created a moment ago: the OTP was just entered
  else o = checkOtp(mobile, otp, user ? user.user_id : null);
  if (!o.ok) { audit(req, { actor: user && user.user_id, action: 'LOGIN', type: 'user', result: 'Failure', reason: faceToken ? 'face + otp' : 'otp' }); return res.status(o.status).json({ message: o.message }); }
  if (byFace) face.consumeFaceLogin(faceToken, mobile);
  const fail = (status, message) => { audit(req, { actor: user && user.user_id, action: 'LOGIN', type: 'user', ref: user && user.user_id, result: 'Denied', reason: message }); return res.status(status).json({ message }); };
  if (!user) return fail(404, 'No account found for this number and role.');
  if (user.account_status !== 'Active') return fail(403, `This account is ${user.account_status.toLowerCase()}. Contact the administrator.`);

  const statusMsg = (s, kind) => {
    if (['Submitted', 'Under Review', 'Draft'].includes(s)) return 'Your registration is waiting for admin approval.';
    if (s === 'More Information Required') {
      const c = db.prepare(`SELECT decision_reason r FROM verification_cases WHERE subject_reference_id = ? AND subject_type = ? ORDER BY submitted_at DESC LIMIT 1`).get(user.linked_profile_id, kind);
      return `The administrator needs more information: ${c && c.r ? c.r : 'please contact the administrator.'}`;
    }
    if (s === 'Rejected') return 'Your registration was rejected. Contact the administrator.';
    if (s === 'Suspended' || s === 'Expired') return `Your registration is ${s.toLowerCase()}. Contact the administrator.`;
    return null;
  };
  let out;
  if (type === 'Patient') {
    const p = db.prepare('SELECT * FROM patients WHERE patient_id = ?').get(user.linked_profile_id);
    if (!p || !['Active', 'Contact Verified'].includes(p.account_status)) return fail(403, 'This record is not active.');
    out = { role: 'patient', name: p.full_name, healthId: p.health_id };
  } else if (type === 'Doctor') {
    const d = db.prepare('SELECT * FROM doctors WHERE doctor_id = ?').get(user.linked_profile_id);
    if (!liveDoctor(d)) return fail(403, statusMsg(d && d.profile_status, 'DOCTOR') || 'Not allowed.');
    out = { role: 'practitioner', name: d.full_name, doctorId: d.doctor_code, system: d.ayush_system };
  } else if (type === 'Facility Representative') {
    const f = db.prepare('SELECT * FROM facilities WHERE facility_id = ?').get(user.linked_profile_id);
    if (!f || !['Approved', 'Active'].includes(f.facility_status)) return fail(403, statusMsg(f && f.facility_status, 'FACILITY') || 'Not allowed.');
    out = { role: 'facility', name: f.display_name || f.legal_name, facilityId: f.facility_code };
  } else {
    const a = db.prepare('SELECT * FROM admin_profiles WHERE admin_id = ?').get(user.linked_profile_id);
    if (!a || a.admin_status !== 'Active') return fail(403, 'This staff account is not active.');
    const c = adminCtx(user.user_id);
    out = { role: 'admin', name: a.full_name, adminId: a.admin_code, adminType: c.roles[0] || 'Admin', permissions: [...c.perms] };
  }
  db.prepare('UPDATE user_accounts SET last_login_at = ? WHERE user_id = ?').run(now(), user.user_id);
  audit(req, { actor: user.user_id, action: 'LOGIN', type: 'user', ref: user.user_id, reason: byFace ? 'face + otp' : 'otp' });
  return res.json({ ...out, mobile, method: byFace ? 'face + otp' : 'otp', faceRegistered: !!face.profileFor(mobile), token: issueAccessToken(user), expiresIn: ACCESS_TTL });
});

// ================= my details (any role) =================
// Face or OTP sign-in returns a signed token; this returns what is stored for that person.
v1.get('/me', authenticate, (req, res) => {
  const user = db.prepare('SELECT * FROM user_accounts WHERE user_id = ?').get(req.user.userId);
  if (!user || user.account_status !== 'Active') return res.status(403).json({ message: 'This account is not active.' });
  const base = { role: face.ROLE_OF[user.account_type], mobile: user.mobile_number, faceRegistered: !!face.profileFor(user.mobile_number), lastLogin: user.last_login_at, otherRoles: db.prepare('SELECT account_type t FROM user_accounts WHERE mobile_number = ? AND user_id != ?').all(user.mobile_number, user.user_id).map((r) => face.ROLE_OF[r.t]) };
  audit(req, { actor: user.user_id, action: 'VIEW', type: 'own details', ref: user.user_id });
  if (user.account_type === 'Patient') {
    const p = db.prepare('SELECT * FROM patients WHERE patient_id = ?').get(user.linked_profile_id);
    return res.json({ ...base, name: p.full_name, code: p.health_id, codeLabel: 'Health Record ID', details: {
      'Date of birth': p.date_of_birth, Gender: p.gender, Email: p.email, Address: p.address_line, City: p.city, State: p.state, Pincode: p.postal_code,
      'Aadhaar (masked)': (db.prepare('SELECT masked_document_number m FROM patient_identity_references WHERE patient_id = ?').get(p.patient_id) || {}).m,
      'ABHA number': (db.prepare('SELECT abha_number a FROM patient_identity_references WHERE patient_id = ?').get(p.patient_id) || {}).a,
      'Emergency contact': (db.prepare('SELECT contact_name || \' (\' || phone_number || \')\' c FROM patient_emergency_contacts WHERE patient_id = ? LIMIT 1').get(p.patient_id) || {}).c,
      'Records saved': (db.prepare("SELECT COUNT(*) c FROM audit_logs WHERE action='RECORD_SAVED' AND entity_reference_id = ?").get(p.patient_id) || {}).c || 0,
    } });
  }
  if (user.account_type === 'Doctor') {
    const d = db.prepare('SELECT * FROM doctors WHERE doctor_id = ?').get(user.linked_profile_id);
    const reg = db.prepare('SELECT * FROM doctor_registrations WHERE doctor_id = ?').get(d.doctor_id) || {};
    const q = db.prepare('SELECT degree_name FROM doctor_qualifications WHERE doctor_id = ?').all(d.doctor_id).map((x) => x.degree_name).join(', ');
    return res.json({ ...base, name: d.full_name, code: d.doctor_code, codeLabel: 'Doctor ID', details: {
      'System of medicine': d.ayush_system, Qualification: q, 'Council registration': reg.registration_number, Council: reg.council_authority, Status: d.profile_status,
      Email: d.professional_email, City: d.city, State: d.state, Languages: d.languages, 'Experience (years)': d.experience_years } });
  }
  if (user.account_type === 'Facility Representative') {
    const f = db.prepare('SELECT * FROM facilities WHERE facility_id = ?').get(user.linked_profile_id);
    const a = db.prepare('SELECT * FROM facility_addresses WHERE facility_id = ?').get(f.facility_id) || {};
    const reg = db.prepare('SELECT * FROM facility_registrations WHERE facility_id = ?').get(f.facility_id) || {};
    return res.json({ ...base, name: f.display_name || f.legal_name, code: f.facility_code, codeLabel: 'Facility ID', details: {
      'Legal name': f.legal_name, Type: f.facility_type, Ownership: f.ownership_type, Licence: reg.registration_number, Status: f.facility_status,
      Address: a.address_line, City: a.city, State: a.state, Email: f.official_email, Phone: f.official_phone,
      Systems: db.prepare('SELECT DISTINCT ayush_system s FROM facility_services WHERE facility_id = ?').all(f.facility_id).map((x) => x.s).join(', ') } });
  }
  const a = db.prepare('SELECT * FROM admin_profiles WHERE admin_id = ?').get(user.linked_profile_id);
  return res.json({ ...base, name: a.full_name, code: a.admin_code, codeLabel: 'Admin ID', details: {
    Role: db.prepare('SELECT r.role_name n FROM user_role_assignments x JOIN roles r ON r.role_id = x.role_id WHERE x.user_id = ?').all(user.user_id).map((x) => x.n).join(', '),
    Designation: a.designation, Department: a.department, 'Official email': a.official_email } });
});


};
