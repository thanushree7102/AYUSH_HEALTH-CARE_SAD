// Single source of truth for service names, ports, roles and event names ("shared contracts").
// Every URL / port can be overridden with an environment variable, e.g. PLATFORM_URL=http://platform:5001
// or PORT_BASE=6000 (moves every service: gateway = base, platform = base+1 ...).
const HOST = process.env.SERVICE_HOST || '127.0.0.1';
const BASE = Number(process.env.PORT_BASE || 5000);

const SERVICES = {
  gateway:      { offset: 0,  title: 'API Gateway' },
  platform:     { offset: 1,  title: 'Shared Platform' },
  ayurveda:     { offset: 2,  title: 'Ayurveda Service' },
  yoga:         { offset: 3,  title: 'Yoga & Naturopathy Service' },
  unani:        { offset: 4,  title: 'Unani Service' },
  siddha:       { offset: 5,  title: 'Siddha Service' },
  homoeopathy:  { offset: 6,  title: 'Homoeopathy Service' },
  clinical:     { offset: 7,  title: 'Common Clinical Service' },
  longitudinal: { offset: 8,  title: 'Longitudinal Record Service' },
  integrations: { offset: 9,  title: 'Integrations (WhatsApp, voice, translate, notifications)' },
  bus:          { offset: 10, title: 'Event Bus' },
};
for (const [k, v] of Object.entries(SERVICES)) {
  const env = k.toUpperCase();
  v.name = k;
  v.port = Number(process.env[`${env}_PORT`] || BASE + v.offset);
  v.url = process.env[`${env}_URL`] || `http://${HOST}:${v.port}`;
}

// AYUSH domain key -> display name used in records, consents and the UI
const SYSTEMS = { ayurveda: 'Ayurveda', yoga: 'Yoga & Naturopathy', unani: 'Unani', siddha: 'Siddha', homoeopathy: 'Homoeopathy' };
const SYSTEM_NAMES = Object.values(SYSTEMS);
const DOMAIN_KEYS = Object.keys(SYSTEMS);

// account_type in the database -> role name used by the UI and in identity tokens
const ROLE_OF = { Patient: 'patient', Doctor: 'practitioner', 'Facility Representative': 'facility', Admin: 'admin' };
const ACCOUNT_TYPE = { patient: 'Patient', practitioner: 'Doctor', doctor: 'Doctor', facility: 'Facility Representative', clinic: 'Facility Representative', admin: 'Admin', auditor: 'Admin' };

const EVENTS = {
  PATIENT_CREATED: 'patient.created',
  PATIENT_DELETED: 'patient.deleted',
  CONSENT_GRANTED: 'consent.granted',
  CONSENT_WITHDRAWN: 'consent.withdrawn',
  ENCOUNTER_CREATED: 'encounter.created',
  RECORD_CREATED: 'clinical.record.created',
  ASSESSMENT_SAVED: 'clinical.assessment.saved',
  PRACTITIONER_DECIDED: 'admin.decision.made',
};

module.exports = { HOST, SERVICES, SYSTEMS, SYSTEM_NAMES, DOMAIN_KEYS, ROLE_OF, ACCOUNT_TYPE, EVENTS };
