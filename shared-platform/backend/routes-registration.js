// Registration for every role. Same face step for all roles (X-Face-Token), OTP proof, then the role's own details.
// Doctors and clinics wait for admin approval. Administrators cannot be created by the public: an invite code is needed
// and Super Admin can never be self-assigned.
const { pick, str, arr, isMobile, isEmail, isDate } = require('../../libs/common/validate');
const { SYSTEM_NAMES, EVENTS } = require('../../libs/common/config');
const { clinical } = require('../../libs/common/internal');
const { idem, invalid } = require('../../libs/common/http');

const GENDERS = ['Female', 'Male', 'Non-binary', 'Prefer not to say', 'Other'];
const OWNERSHIP = ['Government', 'Private', 'Trust', 'Society', 'Other'];
const SELF_ASSIGNABLE_ROLES = ['Doctor Verification Admin', 'Facility Verification Admin', 'Patient Support Admin', 'Auditor'];

module.exports = function install(v1, c, face) {
  const { db, uuid, now, rnd, uniqueCode, today, audit, checkProof, disk, dropFile, userFor, events } = c;
  const ADMIN_INVITE = process.env.ADMIN_INVITE || 'AYUSH-ADMIN-2026';
  const ix = idem(db);
  const cleanupAndFail = (res, file, status, body) => { dropFile(file); return res.status(status).json(body); };

// Patient: only mobile + name + consent are required. Aadhaar / ABHA are optional (report section 10).
async function registerPatient(req, res) {
  const key = req.get('Idempotency-Key');
  const prev = ix.get(key, 'patients/register');
  if (prev) return res.status(prev.status).json(JSON.parse(prev.response));

  const b = req.body || {};
  const name = str(pick(b, 'name', 'fullName'));
  const mobile = str(pick(b, 'mobile', 'phone'));
  const email = str(b.email) && String(b.email).trim().toLowerCase();
  const dob = str(pick(b, 'dob', 'dateOfBirth'));
  const gender = str(b.gender);
  const pin = str(pick(b, 'pincode', 'postalCode'));
  const abha = str(b.abha) && String(b.abha).replace(/[\s-]/g, '');
  const aadhaar = str(b.aadhaar) && String(b.aadhaar).replace(/\s/g, '');
  const eName = str(b.emergencyName); const ePhone = str(b.emergencyPhone);
  const E = {};
  if (!name) E.name = 'Full name is required';
  else if (name.length > 150) E.name = 'Name is too long';
  if (!isMobile(mobile)) E.mobile = 'Enter a valid 10-digit mobile number';
  if (dob && (!isDate(dob) || dob > today() || dob < '1900-01-01')) E.dob = 'Enter a valid date of birth';
  if (gender && !GENDERS.includes(gender)) E.gender = 'Choose one of the listed options';
  if (email && !isEmail(email)) E.email = 'Enter a valid email';
  if (pin && !/^\d{6}$/.test(pin)) E.pincode = 'Pincode must be 6 digits';
  if (abha && !/^\d{14}$/.test(abha)) E.abha = 'ABHA number must be 14 digits';
  if (aadhaar && !/^[2-9]\d{11}$/.test(aadhaar)) E.aadhaar = 'Aadhaar must be 12 digits and cannot start with 0 or 1';
  if ((eName || ePhone) && !(eName && isMobile(ePhone))) E.emergencyPhone = 'Give the emergency contact a name and a valid 10-digit number';
  if (!(b.consent === true || b.consent === 'true')) E.consent = 'Please accept the privacy notice';
  if ((aadhaar || abha) && !(b.identityConsent === true || b.identityConsent === 'true')) E.identityConsent = 'Please agree to link the ID you entered';
  if (Object.keys(E).length) return invalid(res, E);

  if (db.prepare('SELECT 1 FROM patients WHERE mobile_number = ?').get(mobile)) return res.status(409).json({ message: 'This mobile number already has a record. Sign in instead.' });
  if (email && db.prepare('SELECT 1 FROM patients WHERE email = ?').get(email)) return res.status(409).json({ message: 'This email is already used by another record.' });
  if (abha && db.prepare('SELECT 1 FROM patient_identity_references WHERE abha_number = ?').get(abha)) return res.status(409).json({ message: 'This ABHA number is already linked to a record.' });

  const otp = checkProof(mobile, b.otp);
  if (!otp.ok) return res.status(otp.status).json({ message: otp.message, errors: { otp: otp.message } });

  const pid = uuid(); const uid = uuid(); const t = now();
  const healthId = uniqueCode('91-', 'patients', 'health_id', () => `${rnd(4)}-${rnd(4)}-${rnd(4)}`);
  const masked = aadhaar ? `XXXX XXXX ${aadhaar.slice(-4)}` : null;
  db.transaction(() => {
    db.prepare(`INSERT INTO patients (patient_id,health_id,full_name,date_of_birth,gender,mobile_number,mobile_verified,email,address_line,city,state,postal_code,account_status,created_at,updated_at)
                VALUES (?,?,?,?,?,?,1,?,?,?,?,?, 'Active', ?, ?)`)
      .run(pid, healthId, name, dob, gender, mobile, email, str(pick(b, 'addressLine', 'address')), str(b.city), str(b.state), pin, t, t);
    db.prepare(`INSERT INTO user_accounts (user_id,mobile_number,account_type,linked_profile_id,created_at) VALUES (?,?, 'Patient', ?, ?)`).run(uid, mobile, pid, t);
    db.prepare(`INSERT INTO consent_records (consent_id,user_id,subject_profile_id,purpose,notice_version,consent_status,captured_at,capture_method)
                VALUES (?,?,?, 'privacy notice and terms', 'v1', 'Granted', ?, 'Web')`).run(uuid(), uid, pid, t);
    if (eName) {
      db.prepare(`INSERT INTO patient_emergency_contacts (emergency_contact_id,patient_id,contact_name,relationship,phone_number,is_primary,created_at) VALUES (?,?,?,?,?,1,?)`)
        .run(uuid(), pid, eName, str(b.emergencyRelationship), ePhone, t);
    }
    if (aadhaar || abha) {
      const cid = uuid();
      db.prepare(`INSERT INTO consent_records (consent_id,user_id,subject_profile_id,purpose,notice_version,consent_status,captured_at,capture_method)
                  VALUES (?,?,?, 'identity linking', 'v1', 'Granted', ?, 'Web')`).run(cid, uid, pid, t);
      // The full Aadhaar number is never stored: only the masked form. Nothing here verifies it with UIDAI, so status stays Pending.
      db.prepare(`INSERT INTO patient_identity_references (identity_reference_id,patient_id,abha_number,identity_document_type,masked_document_number,verification_status,consent_id)
                  VALUES (?,?,?,?,?,?,?)`).run(uuid(), pid, abha, aadhaar ? 'Aadhaar' : null, masked, 'Pending', cid);
    }
    audit(req, { actor: uid, action: 'CREATE', type: 'patient', ref: pid });
  })();

  // The first consultation (encounter) belongs to the Common Clinical Service. Ask it now; if it is down, the
  // patient.created event below makes it create the encounter as soon as it is back (registration still succeeds).
  events.publish(EVENTS.PATIENT_CREATED, pid, { patientId: pid, healthId, mobile, name });
  const enc = await clinical.post('/internal/encounters/ensure', { patientId: pid, healthId }, { timeout: 4000 });
  const consultationId = enc.ok ? enc.data.consultationId : null;
  const out = { patientId: healthId, healthId, consultationId, name, maskedAadhaar: masked };
  ix.set(key, 'patients/register', 201, out);
  return res.status(201).json(out);
}
v1.post('/auth/register', face.faceGate, registerPatient);
v1.post('/patients/register', face.faceGate, registerPatient);


v1.post('/auth/register/practitioner', disk.single('certificate'), face.faceGate, (req, res) => {
  const b = req.body || {};
  const f = req.file;
  const name = str(pick(b, 'name', 'fullName'));
  const mobile = str(pick(b, 'mobile', 'phone'));
  const system = str(pick(b, 'system', 'ayushSystem')) || 'Ayurveda';
  const email = str(pick(b, 'email', 'professionalEmail')) && String(pick(b, 'email', 'professionalEmail')).trim().toLowerCase();
  const regNo = str(pick(b, 'registrationNo', 'registrationNumber', 'regNo'));
  const year = str(b.graduationYear); const exp = str(b.experience);
  const issue = str(b.issueDate); const expiry = str(b.expiryDate);
  const facCode = str(b.facilityId);
  const E = {};
  if (!name) E.name = 'Full name is required';
  if (!SYSTEM_NAMES.includes(system)) E.system = 'Choose a system of medicine';
  if (!isMobile(mobile)) E.mobile = 'Enter a valid 10-digit mobile number';
  if (email && !isEmail(email)) E.email = 'Enter a valid email';
  if (!str(b.qualification)) E.qualification = 'Qualification is required';
  if (!regNo) E.registrationNo = 'Registration number is required';
  if (!str(b.council)) E.council = 'Registering council is required';
  if (year && (!/^\d{4}$/.test(year) || +year < 1950 || +year > new Date().getFullYear())) E.graduationYear = 'Enter a valid 4-digit year';
  if (exp && (!/^\d{1,2}(\.\d)?$/.test(exp))) E.experience = 'Enter years as a number';
  if (issue && !isDate(issue)) E.issueDate = 'Enter a valid date';
  if (expiry && !isDate(expiry)) E.expiryDate = 'Enter a valid date';
  if (issue && expiry && isDate(issue) && isDate(expiry) && expiry < issue) E.expiryDate = 'Expiry cannot be before the issue date';
  if (b.pincode && !/^\d{6}$/.test(String(b.pincode))) E.pincode = 'Pincode must be 6 digits';
  if (!f) E.certificate = 'Upload your registration certificate';
  let fac = null;
  if (facCode) { fac = db.prepare('SELECT * FROM facilities WHERE facility_code = ?').get(facCode); if (!fac) E.facilityId = 'No clinic / hospital has this ID'; }
  if (Object.keys(E).length) return cleanupAndFail(res, f, 400, { message: 'Please check the highlighted fields.', errors: E });

  if (userFor(mobile, 'Doctor') || db.prepare('SELECT 1 FROM doctors WHERE mobile_number = ?').get(mobile)) return cleanupAndFail(res, f, 409, { message: 'This mobile number is already registered.' });
  if (email && db.prepare('SELECT 1 FROM doctors WHERE professional_email = ?').get(email)) return cleanupAndFail(res, f, 409, { message: 'This email is already registered.' });
  const otp = checkProof(mobile, b.otp);
  if (!otp.ok) return cleanupAndFail(res, f, otp.status, { message: otp.message, errors: { otp: otp.message } });

  const did = uuid(); const uid = uuid(); const t = now();
  const code = uniqueCode('DR-', 'doctors', 'doctor_code', () => `${rnd(4)}-${rnd(4)}`);
  const specs = [...new Set(String(b.specializations || '').split(',').map((s) => s.trim()).filter(Boolean))];
  db.transaction(() => {
    db.prepare(`INSERT INTO user_accounts (user_id,mobile_number,account_type,linked_profile_id,created_at) VALUES (?,?, 'Doctor', ?, ?)`).run(uid, mobile, did, t);
    db.prepare(`INSERT INTO doctors (doctor_id,doctor_code,full_name,mobile_number,professional_email,address_line,city,state,ayush_system,experience_years,languages,profile_status,created_at,updated_at)
                VALUES (?,?,?,?,?,?,?,?,?,?,?, 'Submitted', ?, ?)`)
      .run(did, code, name, mobile, email, str(b.addressLine), str(b.city), str(b.state), system, exp ? Number(exp) : null, str(b.languages), t, t);
    db.prepare(`INSERT INTO doctor_qualifications (qualification_id,doctor_id,degree_name,institution_name,university_name,graduation_year,certificate_reference) VALUES (?,?,?,?,?,?,?)`)
      .run(uuid(), did, str(b.qualification), str(b.institution), str(b.university), year ? +year : null, f.filename);
    db.prepare(`INSERT INTO doctor_registrations (registration_id,doctor_id,registration_number,council_authority,registration_category,issue_date,expiry_date) VALUES (?,?,?,?,?,?,?)`)
      .run(uuid(), did, regNo, str(b.council), system, issue, expiry);
    specs.forEach((s) => db.prepare(`INSERT INTO doctor_specializations (doctor_specialization_id,doctor_id,specialization_name) VALUES (?,?,?)`).run(uuid(), did, s));
    if (fac) db.prepare(`INSERT INTO facility_doctors (facility_doctor_id,facility_id,doctor_reference_id,association_type,association_status) VALUES (?,?,?, 'Other','Pending')`).run(uuid(), fac.facility_id, did);
    db.prepare(`INSERT INTO verification_cases (verification_case_id,subject_type,subject_reference_id,verification_type,status,submitted_at) VALUES (?, 'DOCTOR', ?, 'Professional registration', 'Pending', ?)`).run(uuid(), did, t);
    audit(req, { actor: uid, action: 'CREATE', type: 'doctor', ref: did });
  })();
  return res.status(201).json({ id: code, doctorId: code, status: 'Submitted', needsApproval: true, idLabel: 'Doctor ID', message: 'Submitted for admin verification.' });
});

v1.post('/auth/register/facility', disk.single('certificate'), face.faceGate, (req, res) => {
  const b = req.body || {};
  const f = req.file;
  const name = str(pick(b, 'name', 'facilityName'));
  const mobile = str(pick(b, 'mobile', 'phone'));
  const email = str(b.email) && String(b.email).trim().toLowerCase();
  const systems = arr(b.systems).filter((s) => SYSTEM_NAMES.includes(s));
  const year = str(b.establishmentYear);
  const issue = str(b.issueDate); const expiry = str(b.expiryDate);
  const regNo = str(pick(b, 'licenceNo', 'registrationNo', 'registrationNumber'));
  const E = {};
  if (!name) E.name = 'Facility name is required';
  if (!isMobile(mobile)) E.mobile = 'Enter a valid 10-digit mobile number';
  if (email && !isEmail(email)) E.email = 'Enter a valid email';
  if (!str(b.facilityType)) E.facilityType = 'Choose a facility type';
  if (b.ownershipType && !OWNERSHIP.includes(b.ownershipType)) E.ownershipType = 'Choose one of the listed options';
  if (year && (!/^\d{4}$/.test(year) || +year < 1800 || +year > new Date().getFullYear())) E.establishmentYear = 'Enter a valid 4-digit year';
  if (!systems.length) E.systems = 'Choose at least one system';
  if (!regNo) E.licenceNo = 'Licence / registration number is required';
  if (!str(pick(b, 'address', 'addressLine'))) E.address = 'Address is required';
  if (b.pincode && !/^\d{6}$/.test(String(b.pincode))) E.pincode = 'Pincode must be 6 digits';
  if (issue && !isDate(issue)) E.issueDate = 'Enter a valid date';
  if (expiry && !isDate(expiry)) E.expiryDate = 'Enter a valid date';
  if (issue && expiry && isDate(issue) && isDate(expiry) && expiry < issue) E.expiryDate = 'Expiry cannot be before the issue date';
  if (!f) E.certificate = 'Upload the licence document';
  if (Object.keys(E).length) return cleanupAndFail(res, f, 400, { message: 'Please check the highlighted fields.', errors: E });

  if (userFor(mobile, 'Facility Representative')) return cleanupAndFail(res, f, 409, { message: 'This mobile number is already registered.' });
  const otp = checkProof(mobile, b.otp);
  if (!otp.ok) return cleanupAndFail(res, f, otp.status, { message: otp.message, errors: { otp: otp.message } });

  const fid = uuid(); const uid = uuid(); const t = now();
  const code = uniqueCode('F-', 'facilities', 'facility_code', () => rnd(4));
  db.transaction(() => {
    db.prepare(`INSERT INTO user_accounts (user_id,mobile_number,account_type,linked_profile_id,created_at) VALUES (?,?, 'Facility Representative', ?, ?)`).run(uid, mobile, fid, t);
    db.prepare(`INSERT INTO facilities (facility_id,facility_code,legal_name,display_name,facility_type,ownership_type,establishment_year,description,official_phone,official_email,website,facility_status,created_at,updated_at)
                VALUES (?,?,?,?,?,?,?,?,?,?,?, 'Submitted', ?, ?)`)
      .run(fid, code, name, str(b.displayName) || name, str(b.facilityType), str(b.ownershipType), year ? +year : null, str(b.description), mobile, email, str(b.website), t, t);
    db.prepare(`INSERT INTO facility_addresses (facility_address_id,facility_id,address_line,city,district,state,postal_code,is_primary) VALUES (?,?,?,?,?,?,?,1)`)
      .run(uuid(), fid, str(pick(b, 'address', 'addressLine')), str(b.city), str(b.district), str(b.state), str(b.pincode));
    db.prepare(`INSERT INTO facility_registrations (facility_registration_id,facility_id,registration_number,registration_authority,registration_type,issue_date,expiry_date,document_reference)
                VALUES (?,?,?,?,?,?,?,?)`).run(uuid(), fid, regNo, str(b.authority), str(b.registrationType), issue, expiry, f.filename);
    systems.forEach((s) => db.prepare(`INSERT INTO facility_services (facility_service_id,facility_id,ayush_system,service_name) VALUES (?,?,?,?)`).run(uuid(), fid, s, `${s} consultation`));
    arr(b.infrastructure).forEach((i) => db.prepare(`INSERT INTO facility_infrastructure (infrastructure_id,facility_id,item_type,is_available) VALUES (?,?,?,1)`).run(uuid(), fid, String(i)));
    db.prepare(`INSERT INTO verification_cases (verification_case_id,subject_type,subject_reference_id,verification_type,status,submitted_at) VALUES (?, 'FACILITY', ?, 'Facility licence', 'Pending', ?)`).run(uuid(), fid, t);
    audit(req, { actor: uid, action: 'CREATE', type: 'facility', ref: fid });
  })();
  return res.status(201).json({ id: code, facilityId: code, status: 'Submitted', needsApproval: true, idLabel: 'Facility ID (share it with your doctors)', message: 'Submitted for admin verification.' });
});

v1.post('/auth/register/admin', face.faceGate, (req, res) => {
  const b = req.body || {};
  if (pick(b, 'inviteCode', 'invite', 'code') !== ADMIN_INVITE) return res.status(403).json({ message: 'Invalid admin invite code.', errors: { inviteCode: 'Invalid invite code' } });
  const name = str(pick(b, 'name', 'fullName'));
  const mobile = str(pick(b, 'mobile', 'phone'));
  const email = str(b.email) && String(b.email).trim().toLowerCase();
  const roleName = str(pick(b, 'adminType', 'role')) || 'Auditor';
  const E = {};
  if (!name) E.name = 'Full name is required';
  if (!isMobile(mobile)) E.mobile = 'Enter a valid 10-digit mobile number';
  if (!isEmail(email)) E.email = 'Enter your official email';
  const roleRow = db.prepare('SELECT role_id FROM roles WHERE role_name = ?').get(roleName);
  if (!roleRow || !SELF_ASSIGNABLE_ROLES.includes(roleName)) E.adminType = 'Choose one of the staff roles (Super Admin cannot be self-assigned)';
  if (Object.keys(E).length) return invalid(res, E);
  if (userFor(mobile, 'Admin')) return res.status(409).json({ message: 'This mobile number is already registered.' });
  if (db.prepare('SELECT 1 FROM admin_profiles WHERE official_email = ?').get(email)) return res.status(409).json({ message: 'This email is already registered.' });
  const otp = checkProof(mobile, b.otp);
  if (!otp.ok) return res.status(otp.status).json({ message: otp.message, errors: { otp: otp.message } });

  const uid = uuid(); const aid = uuid(); const t = now();
  const code = uniqueCode('A-', 'admin_profiles', 'admin_code', () => rnd(4));
  db.transaction(() => {
    db.prepare(`INSERT INTO user_accounts (user_id,mobile_number,account_type,linked_profile_id,created_at) VALUES (?,?, 'Admin', ?, ?)`).run(uid, mobile, aid, t);
    db.prepare(`INSERT INTO admin_profiles (admin_id,admin_code,user_id,full_name,official_email,work_phone,department,designation,activation_date) VALUES (?,?,?,?,?,?,?,?,?)`)
      .run(aid, code, uid, name, email, mobile, str(b.department), str(b.designation), t.slice(0, 10));
    db.prepare(`INSERT INTO user_role_assignments (user_role_id,user_id,role_id,assigned_at) VALUES (?,?,?,?)`).run(uuid(), uid, roleRow.role_id, t);
    audit(req, { actor: uid, action: 'CREATE', type: 'admin', ref: aid, reason: `role ${roleName}` });
  })();
  return res.status(201).json({ id: code, adminId: code, role: roleName, status: 'created', message: 'Staff account created.', idLabel: 'Admin ID' });
});
};
