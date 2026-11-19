// Shared Platform database (shared-platform/database/platform.db).
// OWNS: accounts, roles/permissions, patient identity + profile (medical history, health concerns), doctors, facilities,
// OTP/authentication events, face enrolment metadata, consent records + grants, verification cases and audit logs.
// It does NOT own encounters, prescriptions, records, uploads or any AYUSH form: those live in the Common Clinical
// Service and the five domain services. Other services refer to patients/doctors only by stable ids (no cross-database foreign keys).
//
// Conventions: UUID -> TEXT  BOOLEAN -> INTEGER 0/1  TIMESTAMP -> ISO-8601 UTC text  TIME -> 'HH:MM'
// Short public codes (health_id, doctor_code, facility_code, admin_code) sit next to the UUID keys because people use them to find records.
const path = require('path');
const { openDb, uuid, now } = require('../../libs/common/db');

const db = openDb(path.join(__dirname, '..', 'database'), 'platform.db', 'shared-platform');
const list = (...v) => v.map((x) => `'${x}'`).join(',');

// Controlled values (report sections 3-7 and 11)
const ENUM = {
  accountStatusPatient: ['Draft', 'Contact Verified', 'Active', 'Suspended', 'Closed'],
  profileStatus: ['Draft', 'Submitted', 'Under Review', 'Approved', 'Rejected', 'More Information Required', 'Active', 'Suspended', 'Expired'],
  userStatus: ['Invited', 'Active', 'Locked', 'Suspended', 'Deactivated'],
  accountType: ['Patient', 'Doctor', 'Facility Representative', 'Admin'],
  mode: ['In-person', 'Video', 'Audio', 'Chat'],
  docVerification: ['Pending', 'Verified', 'Rejected', 'Needs More Information'],
  caseStatus: ['Pending', 'Under Review', 'Approved', 'Rejected', 'More Information Required'],
  consentStatus: ['Granted', 'Declined', 'Withdrawn', 'Expired'],
};

db.exec(`

-- ===================== Patient identity & profile =====================
CREATE TABLE IF NOT EXISTS patients (
  patient_id      TEXT PRIMARY KEY,
  health_id       TEXT NOT NULL UNIQUE,                       -- extension: public Health Record ID 91-xxxx-xxxx-xxxx
  full_name       TEXT NOT NULL CHECK (length(full_name) BETWEEN 1 AND 150),
  date_of_birth   TEXT CHECK (date_of_birth IS NULL OR date_of_birth GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  gender          TEXT CHECK (gender IS NULL OR length(gender) <= 30),
  mobile_number   TEXT NOT NULL UNIQUE CHECK (length(mobile_number) <= 20),
  mobile_verified INTEGER NOT NULL DEFAULT 0 CHECK (mobile_verified IN (0,1)),
  email           TEXT UNIQUE CHECK (email IS NULL OR length(email) <= 254),
  address_line    TEXT CHECK (address_line IS NULL OR length(address_line) <= 255),
  city            TEXT, state TEXT,
  postal_code     TEXT CHECK (postal_code IS NULL OR length(postal_code) <= 12),
  account_status  TEXT NOT NULL DEFAULT 'Draft' CHECK (account_status IN (${list(...ENUM.accountStatusPatient)})),
  created_at      TEXT NOT NULL,
  updated_at      TEXT
);

CREATE TABLE IF NOT EXISTS patient_emergency_contacts (
  emergency_contact_id TEXT PRIMARY KEY,
  patient_id    TEXT NOT NULL REFERENCES patients(patient_id) ON DELETE CASCADE,
  contact_name  TEXT NOT NULL CHECK (length(contact_name) <= 150),
  relationship  TEXT CHECK (relationship IS NULL OR length(relationship) <= 50),
  phone_number  TEXT NOT NULL CHECK (length(phone_number) <= 20),
  is_primary    INTEGER NOT NULL DEFAULT 0 CHECK (is_primary IN (0,1)),
  created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS patient_identity_references (
  identity_reference_id  TEXT PRIMARY KEY,
  patient_id             TEXT NOT NULL REFERENCES patients(patient_id) ON DELETE CASCADE,
  abha_number            TEXT UNIQUE CHECK (abha_number IS NULL OR length(abha_number) <= 14),
  identity_document_type TEXT CHECK (identity_document_type IS NULL OR identity_document_type IN ('Aadhaar','Passport','Voter ID','Driving Licence','Other')),
  masked_document_number TEXT CHECK (masked_document_number IS NULL OR length(masked_document_number) <= 50),
  verification_status    TEXT NOT NULL DEFAULT 'Not Submitted' CHECK (verification_status IN ('Not Submitted','Pending','Verified','Rejected')),
  verification_reference TEXT,
  verified_at            TEXT,
  consent_id             TEXT REFERENCES consent_records(consent_id)
);

CREATE TABLE IF NOT EXISTS patient_medical_history (
  history_id TEXT PRIMARY KEY,
  patient_id TEXT NOT NULL REFERENCES patients(patient_id) ON DELETE CASCADE,
  condition_name TEXT CHECK (condition_name IS NULL OR length(condition_name) <= 200),
  allergies TEXT, current_medications TEXT, past_surgeries TEXT, family_history TEXT,
  chronic_conditions TEXT, previous_treatments TEXT,
  reported_by TEXT NOT NULL DEFAULT 'Patient' CHECK (reported_by IN ('Patient','Guardian','Clinician')),
  recorded_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS patient_health_concerns (
  concern_id TEXT PRIMARY KEY,
  patient_id TEXT NOT NULL REFERENCES patients(patient_id) ON DELETE CASCADE,
  symptoms TEXT, duration TEXT CHECK (duration IS NULL OR length(duration) <= 100), notes TEXT,
  recorded_at TEXT NOT NULL,
  encounter_id TEXT                                            -- plain id owned by the Common Clinical Service (no cross-database FK)
);






-- ===================== 4. Doctor service =====================
CREATE TABLE IF NOT EXISTS doctors (
  doctor_id TEXT PRIMARY KEY,
  doctor_code TEXT NOT NULL UNIQUE,                           -- extension: DR-1234-5678, what patients/clinics see
  full_name TEXT NOT NULL CHECK (length(full_name) <= 150),
  profile_photo_reference TEXT,
  mobile_number TEXT NOT NULL UNIQUE CHECK (length(mobile_number) <= 20),
  professional_email TEXT UNIQUE CHECK (professional_email IS NULL OR length(professional_email) <= 254),
  address_line TEXT, city TEXT, state TEXT,
  ayush_system TEXT NOT NULL CHECK (ayush_system IN ('Ayurveda','Yoga & Naturopathy','Unani','Siddha','Homoeopathy','Other')),
  experience_years REAL CHECK (experience_years IS NULL OR experience_years >= 0),
  languages TEXT,
  profile_status TEXT NOT NULL DEFAULT 'Draft' CHECK (profile_status IN (${list(...ENUM.profileStatus)})),
  created_at TEXT NOT NULL, updated_at TEXT
);

CREATE TABLE IF NOT EXISTS doctor_qualifications (
  qualification_id TEXT PRIMARY KEY,
  doctor_id TEXT NOT NULL REFERENCES doctors(doctor_id) ON DELETE CASCADE,
  degree_name TEXT, institution_name TEXT, university_name TEXT,
  graduation_year INTEGER CHECK (graduation_year IS NULL OR graduation_year BETWEEN 1950 AND 2100),
  certificate_reference TEXT,
  verification_status TEXT NOT NULL DEFAULT 'Pending' CHECK (verification_status IN ('Pending','Verified','Rejected'))
);

CREATE TABLE IF NOT EXISTS doctor_registrations (
  registration_id TEXT PRIMARY KEY,
  doctor_id TEXT NOT NULL REFERENCES doctors(doctor_id) ON DELETE CASCADE,
  registration_number TEXT, council_authority TEXT, registration_category TEXT,
  issue_date TEXT, expiry_date TEXT,
  verification_status TEXT NOT NULL DEFAULT 'Pending' CHECK (verification_status IN (${list(...ENUM.docVerification)})),
  verified_by_admin_id TEXT REFERENCES admin_profiles(admin_id),
  verified_at TEXT,
  CHECK (expiry_date IS NULL OR issue_date IS NULL OR expiry_date >= issue_date)
);

CREATE TABLE IF NOT EXISTS doctor_specializations (
  doctor_specialization_id TEXT PRIMARY KEY,
  doctor_id TEXT NOT NULL REFERENCES doctors(doctor_id) ON DELETE CASCADE,
  specialization_name TEXT NOT NULL, certificate_reference TEXT,
  verification_status TEXT NOT NULL DEFAULT 'Pending' CHECK (verification_status IN ('Pending','Verified','Not Required','Rejected'))
);

CREATE TABLE IF NOT EXISTS doctor_availability (
  availability_id TEXT PRIMARY KEY,
  doctor_id TEXT NOT NULL REFERENCES doctors(doctor_id) ON DELETE CASCADE,
  day_of_week TEXT NOT NULL CHECK (day_of_week IN ('Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday')),
  start_time TEXT NOT NULL, end_time TEXT NOT NULL,
  consultation_mode TEXT CHECK (consultation_mode IS NULL OR consultation_mode IN (${list(...ENUM.mode)})),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  CHECK (end_time > start_time)
);

-- ===================== 5. Clinic / hospital service =====================
CREATE TABLE IF NOT EXISTS facilities (
  facility_id TEXT PRIMARY KEY,
  facility_code TEXT NOT NULL UNIQUE,                         -- extension: F-1234, the Facility ID doctors enter
  legal_name TEXT NOT NULL CHECK (length(legal_name) <= 200),
  display_name TEXT,
  facility_type TEXT CHECK (facility_type IS NULL OR length(facility_type) <= 40),
  ownership_type TEXT CHECK (ownership_type IS NULL OR ownership_type IN ('Government','Private','Trust','Society','Other')),
  establishment_year INTEGER CHECK (establishment_year IS NULL OR establishment_year BETWEEN 1800 AND 2100),
  description TEXT, logo_reference TEXT,
  official_phone TEXT NOT NULL CHECK (length(official_phone) <= 20),
  official_email TEXT, website TEXT,
  facility_status TEXT NOT NULL DEFAULT 'Draft' CHECK (facility_status IN (${list(...ENUM.profileStatus)})),
  created_at TEXT NOT NULL, updated_at TEXT
);

CREATE TABLE IF NOT EXISTS facility_addresses (
  facility_address_id TEXT PRIMARY KEY,
  facility_id TEXT NOT NULL REFERENCES facilities(facility_id) ON DELETE CASCADE,
  address_line TEXT, city TEXT, district TEXT, state TEXT, postal_code TEXT,
  latitude REAL CHECK (latitude IS NULL OR latitude BETWEEN -90 AND 90),
  longitude REAL CHECK (longitude IS NULL OR longitude BETWEEN -180 AND 180),
  is_primary INTEGER NOT NULL DEFAULT 1 CHECK (is_primary IN (0,1))
);

CREATE TABLE IF NOT EXISTS facility_registrations (
  facility_registration_id TEXT PRIMARY KEY,
  facility_id TEXT NOT NULL REFERENCES facilities(facility_id) ON DELETE CASCADE,
  registration_number TEXT, registration_authority TEXT, registration_type TEXT,
  issue_date TEXT, expiry_date TEXT, document_reference TEXT,
  verification_status TEXT NOT NULL DEFAULT 'Pending' CHECK (verification_status IN (${list(...ENUM.docVerification)})),
  CHECK (expiry_date IS NULL OR issue_date IS NULL OR expiry_date >= issue_date)
);

CREATE TABLE IF NOT EXISTS facility_services (
  facility_service_id TEXT PRIMARY KEY,
  facility_id TEXT NOT NULL REFERENCES facilities(facility_id) ON DELETE CASCADE,
  ayush_system TEXT NOT NULL, service_name TEXT, description TEXT,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1))
);

CREATE TABLE IF NOT EXISTS facility_doctors (
  facility_doctor_id TEXT PRIMARY KEY,
  facility_id TEXT NOT NULL REFERENCES facilities(facility_id) ON DELETE CASCADE,
  doctor_reference_id TEXT NOT NULL REFERENCES doctors(doctor_id) ON DELETE CASCADE,
  association_type TEXT CHECK (association_type IS NULL OR association_type IN ('Employee','Visiting','Consultant','Partner','Other')),
  start_date TEXT, end_date TEXT,
  association_status TEXT NOT NULL DEFAULT 'Pending' CHECK (association_status IN ('Pending','Active','Ended','Rejected')),
  UNIQUE (facility_id, doctor_reference_id)
);

CREATE TABLE IF NOT EXISTS facility_infrastructure (
  infrastructure_id TEXT PRIMARY KEY,
  facility_id TEXT NOT NULL REFERENCES facilities(facility_id) ON DELETE CASCADE,
  item_type TEXT NOT NULL,
  quantity INTEGER CHECK (quantity IS NULL OR quantity >= 0),
  availability_notes TEXT,
  is_available INTEGER NOT NULL DEFAULT 1 CHECK (is_available IN (0,1))
);

-- ===================== 6. Authentication & access control =====================
CREATE TABLE IF NOT EXISTS user_accounts (
  user_id TEXT PRIMARY KEY,
  login_email TEXT UNIQUE,                                     -- nullable: this app signs in with mobile OTP
  mobile_number TEXT CHECK (mobile_number IS NULL OR length(mobile_number) <= 20),
  password_hash TEXT,                                          -- nullable: OTP / passkey-only accounts
  account_type TEXT NOT NULL CHECK (account_type IN (${list(...ENUM.accountType)})),
  linked_profile_id TEXT,                                      -- patients / doctors / facilities / admin_profiles id, by account_type
  account_status TEXT NOT NULL DEFAULT 'Active' CHECK (account_status IN (${list(...ENUM.userStatus)})),
  mfa_enabled INTEGER NOT NULL DEFAULT 0 CHECK (mfa_enabled IN (0,1)),
  last_login_at TEXT,
  created_at TEXT NOT NULL
);
-- A person may hold several roles with one mobile number, so uniqueness is per (mobile, account type).
CREATE UNIQUE INDEX IF NOT EXISTS ux_user_mobile_type ON user_accounts (mobile_number, account_type) WHERE mobile_number IS NOT NULL;

CREATE TABLE IF NOT EXISTS admin_profiles (
  admin_id TEXT PRIMARY KEY,
  admin_code TEXT NOT NULL UNIQUE,                             -- extension: A-1234
  user_id TEXT NOT NULL UNIQUE REFERENCES user_accounts(user_id),
  full_name TEXT NOT NULL, official_email TEXT UNIQUE, work_phone TEXT,
  department TEXT, designation TEXT, activation_date TEXT,
  admin_status TEXT NOT NULL DEFAULT 'Active' CHECK (admin_status IN (${list(...ENUM.userStatus)}))
);

CREATE TABLE IF NOT EXISTS roles (
  role_id TEXT PRIMARY KEY, role_name TEXT NOT NULL UNIQUE, description TEXT
);
CREATE TABLE IF NOT EXISTS permissions (
  permission_id TEXT PRIMARY KEY, permission_code TEXT NOT NULL UNIQUE, description TEXT
);
CREATE TABLE IF NOT EXISTS user_role_assignments (
  user_role_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES user_accounts(user_id) ON DELETE CASCADE,
  role_id TEXT NOT NULL REFERENCES roles(role_id),
  assigned_by_user_id TEXT, assigned_at TEXT, expires_at TEXT,
  UNIQUE (user_id, role_id)
);
CREATE TABLE IF NOT EXISTS role_permissions (
  role_permission_id TEXT PRIMARY KEY,
  role_id TEXT NOT NULL REFERENCES roles(role_id) ON DELETE CASCADE,
  permission_id TEXT NOT NULL REFERENCES permissions(permission_id) ON DELETE CASCADE,
  scope TEXT,
  UNIQUE (role_id, permission_id)
);

-- ===================== 7. Identity, OTP, biometric, consent =====================
CREATE TABLE IF NOT EXISTS authentication_events (
  auth_event_id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES user_accounts(user_id),
  method TEXT NOT NULL, destination_masked TEXT,
  event_status TEXT NOT NULL CHECK (event_status IN ('Initiated','Successful','Failed','Expired','Locked')),
  provider_reference TEXT,
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  created_at TEXT NOT NULL, expires_at TEXT
);

-- Result and metadata only. Never store raw face / fingerprint / iris data here (report section 10).
CREATE TABLE IF NOT EXISTS biometric_verifications (
  biometric_verification_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES user_accounts(user_id),
  biometric_type TEXT NOT NULL CHECK (biometric_type IN ('FACE','FINGERPRINT','IRIS')),
  purpose TEXT, provider_or_device_reference TEXT, transaction_id TEXT,
  verification_status TEXT NOT NULL DEFAULT 'Pending' CHECK (verification_status IN ('Pending','Passed','Failed','Review Required','Cancelled')),
  failure_code TEXT,
  consent_id TEXT REFERENCES consent_records(consent_id),
  verified_at TEXT, retention_until TEXT
);

CREATE TABLE IF NOT EXISTS consent_records (
  consent_id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES user_accounts(user_id),
  subject_profile_id TEXT,
  purpose TEXT NOT NULL, notice_version TEXT,
  consent_status TEXT NOT NULL CHECK (consent_status IN (${list(...ENUM.consentStatus)})),
  captured_at TEXT NOT NULL, withdrawn_at TEXT,
  capture_method TEXT CHECK (capture_method IS NULL OR capture_method IN ('Web','Mobile','Assisted','Paper/other'))
);

-- extension: which doctor a health-data-sharing consent was given to (the report's table has no grantee column)
CREATE TABLE IF NOT EXISTS consent_grants (
  consent_id TEXT PRIMARY KEY REFERENCES consent_records(consent_id) ON DELETE CASCADE,
  doctor_id TEXT NOT NULL REFERENCES doctors(doctor_id),
  expires_at TEXT,
  systems TEXT                                                 -- JSON array of AYUSH systems the grant covers; NULL = all systems
);

CREATE TABLE IF NOT EXISTS verification_cases (
  verification_case_id TEXT PRIMARY KEY,
  subject_type TEXT NOT NULL CHECK (subject_type IN ('DOCTOR','FACILITY','IDENTITY','BIOMETRIC')),
  subject_reference_id TEXT NOT NULL,
  verification_type TEXT,
  status TEXT NOT NULL DEFAULT 'Pending' CHECK (status IN (${list(...ENUM.caseStatus)})),
  assigned_admin_id TEXT REFERENCES admin_profiles(admin_id),
  decision_reason TEXT,
  submitted_at TEXT NOT NULL, decided_at TEXT
);

CREATE TABLE IF NOT EXISTS audit_logs (
  audit_log_id TEXT PRIMARY KEY,
  actor_user_id TEXT,
  action TEXT NOT NULL, entity_type TEXT, entity_reference_id TEXT,
  timestamp TEXT NOT NULL, ip_reference TEXT,
  result TEXT NOT NULL CHECK (result IN ('Success','Failure','Denied')),
  reason TEXT                                                  -- never put passwords, OTPs, tokens or biometric data here
);


CREATE INDEX IF NOT EXISTS ix_concern_patient ON patient_health_concerns(patient_id);
CREATE INDEX IF NOT EXISTS ix_history_patient ON patient_medical_history(patient_id);
CREATE INDEX IF NOT EXISTS ix_consent_subject ON consent_records(subject_profile_id, consent_status);
CREATE INDEX IF NOT EXISTS ix_case_status ON verification_cases(status, subject_type);
CREATE INDEX IF NOT EXISTS ix_audit_time ON audit_logs(timestamp);
CREATE INDEX IF NOT EXISTS ix_auth_user ON authentication_events(user_id, created_at);
CREATE INDEX IF NOT EXISTS ix_fdoc_doctor ON facility_doctors(doctor_reference_id);
`);


// ---------- reference data: roles, permissions (report section 6) ----------
const PERMS = {
  'patient.view': 'View patient profiles (support)',
  'doctor.verify': 'Review and decide doctor registrations',
  'facility.approve': 'Review and decide facility registrations',
  'document.view': 'Open verification documents',
  'user.suspend': 'Suspend or reactivate accounts',
  'audit.view': 'View the audit log',
  'role.manage': 'Create admins and assign roles',
};
const ROLES = {
  'Super Admin': ['Full platform administration', Object.keys(PERMS)],
  'Doctor Verification Admin': ['Verifies doctor registrations', ['doctor.verify', 'document.view', 'audit.view']],
  'Facility Verification Admin': ['Verifies clinic / hospital registrations', ['facility.approve', 'document.view', 'audit.view']],
  'Patient Support Admin': ['Helps patients with account problems', ['patient.view', 'user.suspend']],
  'Auditor': ['Read-only access to the audit log', ['audit.view']],
};
db.transaction(() => {
  const pid = {};
  Object.entries(PERMS).forEach(([code, d]) => {
    db.prepare('INSERT OR IGNORE INTO permissions (permission_id,permission_code,description) VALUES (?,?,?)').run(uuid(), code, d);
    pid[code] = db.prepare('SELECT permission_id id FROM permissions WHERE permission_code=?').get(code).id;
  });
  Object.entries(ROLES).forEach(([name, [d, codes]]) => {
    db.prepare('INSERT OR IGNORE INTO roles (role_id,role_name,description) VALUES (?,?,?)').run(uuid(), name, d);
    const rid = db.prepare('SELECT role_id id FROM roles WHERE role_name=?').get(name).id;
    codes.forEach((c) => db.prepare('INSERT OR IGNORE INTO role_permissions (role_permission_id,role_id,permission_id) VALUES (?,?,?)').run(uuid(), rid, pid[c]));
  });
})();


module.exports = db;
module.exports.uuid = uuid;
module.exports.now = now;
module.exports.ENUM = ENUM;

// tokens that were logged out before they expired (the gateway asks the platform on every protected call)
db.exec(`CREATE TABLE IF NOT EXISTS revoked_tokens (nonce TEXT PRIMARY KEY, user_id TEXT, revoked_at TEXT NOT NULL, expires_at INTEGER NOT NULL)`);
