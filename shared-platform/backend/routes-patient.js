// Doctors / facilities lists, doctor availability, the patient's own profile (medical history, health concerns) and
// sharing consent. Identity comes from req.user (signed token resolved by the gateway).
const { str, arr } = require('../../libs/common/validate');
const { authenticate, forbid, invalid } = require('../../libs/common/http');
const { EVENTS, SYSTEM_NAMES } = require('../../libs/common/config');

module.exports = function install(v1, c) {
  const { db, uuid, now, audit, getPatient, doctorByCode, liveDoctor, grantsOf, events } = c;

  // ----- consent core (used by the web API here and by the WhatsApp bot through /internal) -----
  function grantAccess(patient, userId, doctor, { systems = null, days = null, method = 'Web' } = {}) {
    const t = now(); const cid = uuid();
    const sys = Array.isArray(systems) && systems.length ? [...new Set(systems.filter((s) => SYSTEM_NAMES.includes(s)))] : null;
    db.transaction(() => {
      const old = grantsOf(patient.patient_id).find((g) => g.code === doctor.doctor_code);
      if (old) db.prepare(`UPDATE consent_records SET consent_status='Withdrawn', withdrawn_at=? WHERE consent_id=?`).run(t, old.consentId);
      db.prepare(`INSERT INTO consent_records (consent_id,user_id,subject_profile_id,purpose,notice_version,consent_status,captured_at,capture_method)
                  VALUES (?,?,?, 'health-data sharing', 'v1', 'Granted', ?, ?)`).run(cid, userId, patient.patient_id, t, method);
      db.prepare('INSERT INTO consent_grants (consent_id,doctor_id,expires_at,systems) VALUES (?,?,?,?)')
        .run(cid, doctor.doctor_id, days ? new Date(Date.now() + days * 864e5).toISOString() : null, sys ? JSON.stringify(sys) : null);
      audit(null, { actor: userId, action: 'CONSENT_GRANTED', type: 'doctor', ref: doctor.doctor_id, reason: sys ? `systems: ${sys.join(', ')}` : 'all systems' });
      events.publish(EVENTS.CONSENT_GRANTED, patient.patient_id, { patientId: patient.patient_id, doctorCode: doctor.doctor_code, systems: sys });
    })();
    return cid;
  }
  function revokeAccess(patient, userId, grant) {
    db.transaction(() => {
      db.prepare(`UPDATE consent_records SET consent_status='Withdrawn', withdrawn_at=? WHERE consent_id=? AND subject_profile_id=?`).run(now(), grant.consentId, patient.patient_id);
      audit(null, { actor: userId, action: 'CONSENT_WITHDRAWN', type: 'doctor', ref: grant.doctorId });
      events.publish(EVENTS.CONSENT_WITHDRAWN, patient.patient_id, { patientId: patient.patient_id, doctorCode: grant.code });
    })();
  }
  c.grantAccess = grantAccess; c.revokeAccess = revokeAccess;

// ================= doctors / facilities =================
v1.get('/doctors', authenticate, (req, res) => {
  res.json(db.prepare(`SELECT doctor_code id, full_name name, ayush_system system, profile_status status FROM doctors WHERE profile_status IN ('Approved','Active') ORDER BY full_name`).all());
});

v1.get('/facilities/:id/practitioners', authenticate, (req, res) => {
  if (!((req.user.role === 'facility' && req.user.code === req.params.id) || req.user.role === 'admin')) return forbid(res, 'Only this clinic can see its practitioners.');
  const f = db.prepare('SELECT facility_id FROM facilities WHERE facility_code = ?').get(req.params.id);
  if (!f) return res.status(404).json({ message: 'Facility not found.' });
  res.json(db.prepare(`SELECT d.doctor_code id, d.full_name name, d.ayush_system system, d.profile_status status, fd.association_status association
                       FROM facility_doctors fd JOIN doctors d ON d.doctor_id = fd.doctor_reference_id WHERE fd.facility_id = ? ORDER BY d.full_name`).all(f.facility_id));
});

// Doctor weekly availability (report 4.5)
const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
v1.get('/doctors/:id/availability', authenticate, (req, res) => {
  const d = doctorByCode(req.params.id);
  if (!d) return res.status(404).json({ message: 'Doctor not found.' });
  res.json(db.prepare('SELECT day_of_week dayOfWeek, start_time startTime, end_time endTime, consultation_mode mode, is_active isActive FROM doctor_availability WHERE doctor_id = ?').all(d.doctor_id));
});
v1.put('/doctors/:id/availability', authenticate, (req, res) => {
  const d = doctorByCode(req.params.id);
  if (!d) return res.status(404).json({ message: 'Doctor not found.' });
  if (req.user.role !== 'practitioner' || req.user.code !== d.doctor_code) return forbid(res, 'Only this doctor can change availability.');
  const slots = Array.isArray(req.body && req.body.slots) ? req.body.slots : [];
  const modes = ['In-person', 'Video', 'Audio', 'Chat'];
  for (const s of slots) {
    if (!DAYS.includes(s.dayOfWeek) || !/^\d{2}:\d{2}$/.test(s.startTime || '') || !/^\d{2}:\d{2}$/.test(s.endTime || '') || s.endTime <= s.startTime || (s.mode && !modes.includes(s.mode)))
      return res.status(400).json({ message: 'Each slot needs a weekday, a start time and a later end time.' });
  }
  db.transaction(() => {
    db.prepare('DELETE FROM doctor_availability WHERE doctor_id = ?').run(d.doctor_id);
    slots.forEach((s) => db.prepare('INSERT INTO doctor_availability (availability_id,doctor_id,day_of_week,start_time,end_time,consultation_mode) VALUES (?,?,?,?,?,?)')
      .run(uuid(), d.doctor_id, s.dayOfWeek, s.startTime, s.endTime, s.mode || null));
  })();
  res.json({ saved: slots.length });
});

// Patient profile: medical history and health concerns (report 3.4, 3.5)
// Only the signed-in patient (identity from the verified token, never from a header) can read or change their own profile.
const ownPatient = (req, res) => {
  const p = getPatient(req.params.id);
  if (!p) { res.status(404).json({ message: 'No record found for this ID.' }); return null; }
  if (req.user.role !== 'patient' || req.user.profileId !== p.patient_id) { audit(req, { action: 'PROFILE_ACCESS', type: 'patient', ref: p.patient_id, result: 'Denied' }); forbid(res, 'You can only open your own profile.'); return null; }
  return p;
};
v1.get('/patients/:id/profile', authenticate, (req, res) => {
  const p = ownPatient(req, res); if (!p) return;
  res.json({
    name: p.full_name, healthId: p.health_id, dob: p.date_of_birth, gender: p.gender, email: p.email, city: p.city, state: p.state,
    emergencyContacts: db.prepare('SELECT contact_name name, relationship, phone_number phone, is_primary isPrimary FROM patient_emergency_contacts WHERE patient_id = ?').all(p.patient_id),
    identity: db.prepare('SELECT abha_number abha, identity_document_type documentType, masked_document_number masked, verification_status status FROM patient_identity_references WHERE patient_id = ?').all(p.patient_id),
    medicalHistory: db.prepare('SELECT history_id id, condition_name conditionName, allergies, current_medications currentMedications, past_surgeries pastSurgeries, family_history familyHistory, chronic_conditions chronicConditions, previous_treatments previousTreatments, reported_by reportedBy, recorded_at recordedAt FROM patient_medical_history WHERE patient_id = ? ORDER BY recorded_at DESC').all(p.patient_id),
    concerns: db.prepare('SELECT concern_id id, symptoms, duration, notes, recorded_at recordedAt FROM patient_health_concerns WHERE patient_id = ? ORDER BY recorded_at DESC').all(p.patient_id),
  });
});
v1.post('/patients/:id/medical-history', authenticate, (req, res) => {
  const p = ownPatient(req, res); if (!p) return;
  const b = req.body || {};
  const cols = ['conditionName', 'allergies', 'currentMedications', 'pastSurgeries', 'familyHistory', 'chronicConditions', 'previousTreatments'];
  if (!cols.some((c) => str(b[c]))) return invalid(res, { conditionName: 'Fill in at least one field' });
  if (str(b.conditionName) && str(b.conditionName).length > 200) return invalid(res, { conditionName: 'Keep this under 200 characters' });
  const id = uuid();
  db.prepare(`INSERT INTO patient_medical_history (history_id,patient_id,condition_name,allergies,current_medications,past_surgeries,family_history,chronic_conditions,previous_treatments,reported_by,recorded_at)
              VALUES (?,?,?,?,?,?,?,?,?, 'Patient', ?)`).run(id, p.patient_id, ...cols.map((c) => str(b[c])), now());
  audit(req, { action: 'CREATE', type: 'patient_medical_history', ref: id });
  res.status(201).json({ id });
});
v1.post('/patients/:id/health-concerns', authenticate, (req, res) => {
  const p = ownPatient(req, res); if (!p) return;
  const b = req.body || {};
  if (!str(b.symptoms)) return invalid(res, { symptoms: 'Describe the symptoms' });
  if (str(b.duration) && str(b.duration).length > 100) return invalid(res, { duration: 'Keep this under 100 characters' });
  const id = uuid();
  db.prepare(`INSERT INTO patient_health_concerns (concern_id,patient_id,symptoms,duration,notes,recorded_at,encounter_id) VALUES (?,?,?,?,?,?,?)`)
    .run(id, p.patient_id, str(b.symptoms), str(b.duration), str(b.notes), now(), null);
  res.status(201).json({ id });
});


  // ----- sharing consent: the patient decides which doctors may see the record (and, optionally, which AYUSH systems / for how long) -----
  const patientUser = (p) => db.prepare(`SELECT user_id FROM user_accounts WHERE linked_profile_id = ? AND account_type = 'Patient'`).get(p.patient_id);
  v1.get('/patients/:id/consents', authenticate, (req, res) => {
    const p = ownPatient(req, res); if (!p) return;
    res.json(grantsOf(p.patient_id).map((g) => ({ doctorId: g.code, name: g.name, systems: g.systems, expiresAt: g.exp })));
  });
  v1.post('/patients/:id/consents', authenticate, (req, res) => {
    const p = ownPatient(req, res); if (!p) return;
    const b = req.body || {};
    const ids = [...new Set(arr(b.doctorIds))];
    const valid = ids.filter((code) => liveDoctor(doctorByCode(code)));
    const days = b.days ? Math.min(Math.max(parseInt(b.days, 10) || 0, 1), 365) : null;
    const current = grantsOf(p.patient_id);
    const u = patientUser(p);
    current.filter((g) => !valid.includes(g.code)).forEach((g) => revokeAccess(p, u && u.user_id, g));
    const rescope = b.systems !== undefined || b.days !== undefined; // a new scope or duration replaces the existing grant
    valid.filter((code) => rescope || !current.some((g) => g.code === code)).forEach((code) => grantAccess(p, u && u.user_id, doctorByCode(code), { systems: b.systems, days }));
    res.json({ sharedWith: grantsOf(p.patient_id).map((g) => g.code) });
  });
};
