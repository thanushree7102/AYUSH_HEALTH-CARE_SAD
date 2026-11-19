// Internal API of the Shared Platform: used ONLY by the other services (service token required, never reachable through the gateway).
//  - /internal/auth/resolve   : gateway -> "who is this access token?"
//  - /internal/access/check   : every service -> "may this person read/write this patient's data for this AYUSH system?"
//  - patient / doctor lookups, consent grants (WhatsApp bot), unregister, audit, event delivery
const { str } = require('../../libs/common/validate');
const { serviceOnly } = require('../../libs/common/http');
const { ROLE_OF, EVENTS, SYSTEM_NAMES } = require('../../libs/common/config');
const { clinical } = require('../../libs/common/internal');

module.exports = function install(internal, c) {
  const { db, uuid, now, rnd, uniqueCode, audit, security, getPatient, doctorByCode, userFor, liveDoctor, liveFacility, grantsOf, adminCtx, events } = c;
  internal.use(serviceOnly);

  const allergiesOf = (p) => db.prepare(`SELECT allergies a FROM patient_medical_history WHERE patient_id = ? AND allergies IS NOT NULL AND allergies != '' ORDER BY recorded_at DESC`).all(p.patient_id).map((r) => r.a).join(', ');
  const patientView = (p) => ({ patientId: p.patient_id, healthId: p.health_id, name: p.full_name, gender: p.gender, dob: p.date_of_birth, mobile: p.mobile_number, status: p.account_status, allergies: allergiesOf(p) });

  // ---------- who is this access token? ----------
  internal.post('/auth/resolve', (req, res) => {
    const t = security.verify((req.body || {}).token);
    if (!t || t.k !== 'access') return res.status(401).json({ message: 'Please sign in again.' });
    if (db.prepare('SELECT 1 FROM revoked_tokens WHERE nonce = ?').get(t.n)) return res.status(401).json({ message: 'You have been signed out. Please sign in again.' });
    const user = db.prepare('SELECT * FROM user_accounts WHERE user_id = ?').get(t.u);
    if (!user) return res.status(401).json({ message: 'Please sign in again.' });
    if (user.account_status !== 'Active') return res.status(403).json({ message: `This account is ${user.account_status.toLowerCase()}. Contact the administrator.` });
    const base = { userId: user.user_id, role: ROLE_OF[user.account_type], type: user.account_type, profileId: user.linked_profile_id, mobile: user.mobile_number, perms: [], roles: [] };
    if (user.account_type === 'Patient') {
      const p = db.prepare('SELECT * FROM patients WHERE patient_id = ?').get(user.linked_profile_id);
      if (!p || !['Active', 'Contact Verified'].includes(p.account_status)) return res.status(403).json({ message: 'This record is not active.' });
      return res.json({ ...base, code: p.health_id, name: p.full_name });
    }
    if (user.account_type === 'Doctor') {
      const d = db.prepare('SELECT * FROM doctors WHERE doctor_id = ?').get(user.linked_profile_id);
      if (!liveDoctor(d)) return res.status(403).json({ message: 'Your registration is not approved or no longer active.' });
      return res.json({ ...base, code: d.doctor_code, name: d.full_name, system: d.ayush_system });
    }
    if (user.account_type === 'Facility Representative') {
      const f = db.prepare('SELECT * FROM facilities WHERE facility_id = ?').get(user.linked_profile_id);
      if (!liveFacility(f)) return res.status(403).json({ message: 'This clinic registration is not approved or no longer active.' });
      return res.json({ ...base, code: f.facility_code, name: f.display_name || f.legal_name });
    }
    const a = adminCtx(user.user_id);
    if (!a) return res.status(403).json({ message: 'This staff account is not active.' });
    return res.json({ ...base, code: a.admin_code, name: a.full_name, perms: [...a.perms], roles: a.roles });
  });

  // ---------- consent + role check for patient data ----------
  // body: { patient: healthId | patientId, actor: identity, system?: 'Ayurveda'..., mode: 'read' | 'write' }
  internal.post('/access/check', (req, res) => {
    const { patient, actor = {}, system = null, mode = 'read' } = req.body || {};
    const p = getPatient(String(patient || ''));
    if (!p) return res.status(404).json({ allowed: false, message: 'No patient found for this ID.' });
    const out = (allowed, reason, extra = {}) => res.json({ allowed, reason, patient: patientView(p), ...extra });
    if (actor.role === 'patient') {
      if (actor.profileId === p.patient_id) return out(true, 'own record', { systems: null, actorRole: 'patient' });
      audit(null, { actor: actor.userId, action: 'ACCESS', type: 'patient', ref: p.patient_id, result: 'Denied', reason: 'another patient' });
      return out(false, 'You can only open your own record.');
    }
    if (actor.role === 'practitioner') {
      const d = doctorByCode(actor.code);
      const g = liveDoctor(d) ? grantsOf(p.patient_id).find((x) => x.code === d.doctor_code) : null;
      const denied = (why) => { audit(null, { actor: actor.userId, action: mode === 'write' ? 'WRITE_SENSITIVE' : 'VIEW_SENSITIVE', type: 'patient', ref: p.patient_id, result: 'Denied', reason: why }); return out(false, why); };
      if (!g) return denied('The patient has not shared the record with you.');
      if (system && g.systems && !g.systems.includes(system)) return denied(`The patient has not shared ${system} records with you.`);
      audit(null, { actor: actor.userId, action: mode === 'write' ? 'WRITE_SENSITIVE' : 'VIEW_SENSITIVE', type: 'patient', ref: p.patient_id, reason: system || null });
      return out(true, 'patient consent', { systems: g.systems, actorRole: 'practitioner' });
    }
    audit(null, { actor: actor.userId, action: 'ACCESS', type: 'patient', ref: p.patient_id, result: 'Denied', reason: `role ${actor.role}` });
    return out(false, 'Your role cannot open patient records.');
  });

  // ---------- patient / doctor lookups ----------
  internal.get('/patients/by-mobile/:mobile', (req, res) => {
    const p = db.prepare('SELECT * FROM patients WHERE mobile_number = ?').get(req.params.mobile);
    return p ? res.json(patientView(p)) : res.status(404).json({ message: 'No patient with this number.' });
  });
  internal.get('/patients/:ref', (req, res) => {
    const p = getPatient(req.params.ref);
    return p ? res.json(patientView(p)) : res.status(404).json({ message: 'No patient found for this ID.' });
  });
  internal.get('/patients/:ref/profile-data', (req, res) => {
    const p = getPatient(req.params.ref);
    if (!p) return res.status(404).json({ message: 'No patient found for this ID.' });
    res.json({
      ...patientView(p),
      medicalHistory: db.prepare('SELECT condition_name conditionName, allergies, current_medications currentMedications, past_surgeries pastSurgeries, family_history familyHistory, chronic_conditions chronicConditions, previous_treatments previousTreatments, recorded_at recordedAt FROM patient_medical_history WHERE patient_id = ? ORDER BY recorded_at DESC').all(p.patient_id),
      concerns: db.prepare('SELECT symptoms, duration, notes, recorded_at recordedAt FROM patient_health_concerns WHERE patient_id = ? ORDER BY recorded_at DESC').all(p.patient_id),
      sharedWith: grantsOf(p.patient_id).map((g) => g.code),
    });
  });
  internal.post('/patients/:ref/allergies', (req, res) => {
    const p = getPatient(req.params.ref);
    const a = str((req.body || {}).allergies);
    if (!p || !a) return res.status(400).json({ message: 'Patient and allergies are required.' });
    if (!allergiesOf(p).toLowerCase().includes(a.toLowerCase())) {
      db.prepare(`INSERT INTO patient_medical_history (history_id,patient_id,allergies,reported_by,recorded_at) VALUES (?,?,?, 'Patient', ?)`).run(uuid(), p.patient_id, a, now());
    }
    res.json({ allergies: allergiesOf(p) });
  });
  internal.get('/doctors', (req, res) => res.json(db.prepare(`SELECT doctor_code code, full_name name, ayush_system system FROM doctors WHERE profile_status IN ('Approved','Active') ORDER BY full_name`).all()));
  internal.get('/doctors/:code', (req, res) => {
    const d = doctorByCode(req.params.code);
    return d && liveDoctor(d) ? res.json({ code: d.doctor_code, name: d.full_name, system: d.ayush_system }) : res.status(404).json({ message: 'Doctor not found.' });
  });

  // ---------- registration through the WhatsApp bot (name + date of birth + allergies + consent, no face at first) ----------
  internal.post('/patients/register-whatsapp', async (req, res) => {
    const { name, mobile, dob, allergies } = req.body || {};
    if (!name || !/^[6-9]\d{9}$/.test(String(mobile || ''))) return res.status(400).json({ message: 'Name and a valid mobile number are required.' });
    if (db.prepare('SELECT 1 FROM patients WHERE mobile_number = ?').get(mobile)) return res.status(409).json({ message: 'This number is already registered.' });
    const pid = uuid(); const uid = uuid(); const t = now();
    const healthId = uniqueCode('91-', 'patients', 'health_id', () => `${rnd(4)}-${rnd(4)}-${rnd(4)}`);
    db.transaction(() => {
      db.prepare(`INSERT INTO patients (patient_id,health_id,full_name,date_of_birth,mobile_number,mobile_verified,account_status,created_at,updated_at) VALUES (?,?,?,?,?,1,'Active',?,?)`).run(pid, healthId, String(name).slice(0, 150), dob || null, mobile, t, t);
      db.prepare(`INSERT INTO user_accounts (user_id,mobile_number,account_type,linked_profile_id,created_at) VALUES (?,?, 'Patient', ?, ?)`).run(uid, mobile, pid, t);
      db.prepare(`INSERT INTO consent_records (consent_id,user_id,subject_profile_id,purpose,notice_version,consent_status,captured_at,capture_method) VALUES (?,?,?, 'privacy notice and terms', 'v1', 'Granted', ?, 'Mobile')`).run(uuid(), uid, pid, t);
      if (allergies) db.prepare(`INSERT INTO patient_medical_history (history_id,patient_id,allergies,reported_by,recorded_at) VALUES (?,?,?, 'Patient', ?)`).run(uuid(), pid, allergies, t);
      db.prepare(`INSERT INTO audit_logs (audit_log_id,actor_user_id,action,entity_type,entity_reference_id,timestamp,result,reason) VALUES (?,?,?,?,?,?,?,?)`).run(uuid(), uid, 'CREATE', 'patient', pid, t, 'Success', 'registered on WhatsApp');
    })();
    events.publish(EVENTS.PATIENT_CREATED, pid, { patientId: pid, healthId, mobile, name });
    await clinical.post('/internal/encounters/ensure', { patientId: pid, healthId }, { timeout: 4000 });
    res.status(201).json({ healthId, patientId: pid });
  });

  // ---------- consent grants (WhatsApp "share with a doctor" / "revoke") ----------
  internal.get('/patients/:ref/grants', (req, res) => {
    const p = getPatient(req.params.ref);
    return p ? res.json(grantsOf(p.patient_id)) : res.status(404).json({ message: 'No patient found.' });
  });
  internal.post('/patients/:ref/grants', (req, res) => {
    const p = getPatient(req.params.ref); const b = req.body || {};
    const d = doctorByCode(b.doctorCode);
    if (!p || !liveDoctor(d)) return res.status(404).json({ message: 'Patient or doctor not found.' });
    const u = userFor(p.mobile_number, 'Patient');
    const consentId = c.grantAccess(p, u && u.user_id, d, { systems: b.systems, days: b.days || null, method: 'Mobile' });
    res.status(201).json({ consentId });
  });
  internal.post('/patients/:ref/grants/revoke', (req, res) => {
    const p = getPatient(req.params.ref);
    const g = p && grantsOf(p.patient_id).find((x) => x.consentId === (req.body || {}).consentId);
    if (!g) return res.status(404).json({ message: 'Grant not found.' });
    const u = userFor(p.mobile_number, 'Patient');
    c.revokeAccess(p, u && u.user_id, g);
    res.json({ ok: true });
  });

  // ---------- unregister: delete the patient's identity data, then tell every other service to delete theirs ----------
  internal.delete('/patients/:ref', (req, res) => {
    const p = getPatient(req.params.ref);
    if (!p) return res.status(404).json({ message: 'No patient found.' });
    const u = userFor(p.mobile_number, 'Patient');
    const others = db.prepare(`SELECT COUNT(*) n FROM user_accounts WHERE mobile_number = ? AND account_type != 'Patient'`).get(p.mobile_number).n;
    const del = (sql, ...a) => { try { db.prepare(sql).run(...a); } catch (e) { e.message += ` [${sql}]`; throw e; } };
    db.transaction(() => {
      del('DELETE FROM patient_identity_references WHERE patient_id = ?', p.patient_id);
      del('DELETE FROM biometric_verifications WHERE consent_id IN (SELECT consent_id FROM consent_records WHERE subject_profile_id = ?)', p.patient_id);
      del('DELETE FROM consent_grants WHERE consent_id IN (SELECT consent_id FROM consent_records WHERE subject_profile_id = ?)', p.patient_id);
      if (!others) del('DELETE FROM face_profiles WHERE mobile_number = ?', p.mobile_number); // the face is shared by every role of this number: keep it while another role exists
      del('DELETE FROM consent_records WHERE subject_profile_id = ?', p.patient_id);
      if (u) {
        del('DELETE FROM patient_identity_references WHERE consent_id IN (SELECT consent_id FROM consent_records WHERE user_id = ?)', u.user_id);
        del('DELETE FROM biometric_verifications WHERE user_id = ?', u.user_id);
        del('DELETE FROM biometric_verifications WHERE consent_id IN (SELECT consent_id FROM consent_records WHERE user_id = ?)', u.user_id);
        if (!others) del('DELETE FROM face_profiles WHERE consent_id IN (SELECT consent_id FROM consent_records WHERE user_id = ?)', u.user_id);
        del('DELETE FROM consent_grants WHERE consent_id IN (SELECT consent_id FROM consent_records WHERE user_id = ?)', u.user_id);
        del('DELETE FROM consent_records WHERE user_id = ?', u.user_id);
        del('DELETE FROM authentication_events WHERE user_id = ?', u.user_id);
        del('DELETE FROM user_accounts WHERE user_id = ?', u.user_id);
      }
      del('DELETE FROM patients WHERE patient_id = ?', p.patient_id);
      audit(null, { action: 'PATIENT_DELETED', type: 'patient', ref: p.patient_id, reason: 'unregistered by the patient' });
      events.publish(EVENTS.PATIENT_DELETED, p.patient_id, { patientId: p.patient_id, healthId: p.health_id, mobile: p.mobile_number });
    })();
    res.json({ deleted: true });
  });

  // ---------- audit log (the platform owns it; other services report into it) ----------
  internal.post('/audit', (req, res) => {
    const b = req.body || {};
    if (!b.action) return res.status(400).json({ message: 'action is required.' });
    db.prepare(`INSERT INTO audit_logs (audit_log_id,actor_user_id,action,entity_type,entity_reference_id,timestamp,ip_reference,result,reason) VALUES (?,?,?,?,?,?,?,?,?)`)
      .run(uuid(), b.actor || null, String(b.action).slice(0, 60), b.type || null, b.ref || null, now(), b.ip || null, ['Success', 'Failure', 'Denied'].includes(b.result) ? b.result : 'Success', b.reason ? String(b.reason).slice(0, 300) : null);
    res.status(201).json({ ok: true });
  });

  // ---------- events this service listens to ----------
  internal.post('/events', events.handler(async (e) => {
    if (e.type === EVENTS.RECORD_CREATED && e.data && e.data.patientId) audit(null, { action: 'RECORD_SAVED', type: 'patient', ref: e.data.patientId, reason: `${e.data.system || ''} record` });
  }));

  internal.systemNames = SYSTEM_NAMES;
};
