// homoeopathy service. Own database (homoeopathy-service/database/homoeopathy.db), own forms, own versions. Shares only the plumbing in libs/common.
try { require('dotenv').config(); } catch (e) { /* optional */ }
const buildDomainService = require('../../../libs/common/domain-service');
const T = (label, fields, o = {}) => ({ ...o, label, fields });

const parts = [
{ id: 'case-taking', ...T("Case taking", [
  {
    "name": "complaint",
    "label": "Chief complaint",
    "type": "textarea",
    "required": true
  },
  {
    "name": "mentals",
    "label": "Mental generals",
    "type": "textarea"
  },
  {
    "name": "physicalGenerals",
    "label": "Physical generals (thermal, thirst, appetite, sleep)",
    "type": "textarea"
  },
  {
    "name": "particulars",
    "label": "Particular symptoms with modalities",
    "type": "textarea"
  }
], { practitionerOnly: false }) },
{ id: 'symptoms', ...T("Symptom totality", [
  {
    "name": "characteristic",
    "label": "Characteristic symptoms",
    "type": "textarea",
    "required": true
  },
  {
    "name": "causation",
    "label": "Causation (ailments from)"
  },
  {
    "name": "miasm",
    "label": "Predominant miasm",
    "type": "select",
    "options": [
      "Psora",
      "Sycosis",
      "Syphilis",
      "Tubercular",
      "Mixed"
    ]
  }
], { practitionerOnly: false }), summary: (b) => ({ miasm: b.miasm }) },
{ id: 'diagnosis', ...T("Diagnosis & repertorisation", [
  {
    "name": "diagnosis",
    "label": "Diagnosis",
    "required": true
  },
  {
    "name": "repertoryUsed",
    "label": "Repertory used"
  },
  {
    "name": "notes",
    "label": "Notes",
    "type": "textarea"
  }
], { practitionerOnly: true }), summary: (b) => ({ diagnosis: b.diagnosis }) },
{ id: 'remedy', ...T("Remedy prescription", [
  {
    "name": "remedy",
    "label": "Remedy",
    "required": true
  },
  {
    "name": "potency",
    "label": "Potency",
    "type": "select",
    "required": true,
    "options": [
      "6C",
      "30C",
      "200C",
      "1M",
      "10M",
      "Q (mother tincture)",
      "LM"
    ]
  },
  {
    "name": "repetition",
    "label": "Repetition / dose schedule",
    "required": true
  },
  {
    "name": "advice",
    "label": "Advice and diet restrictions",
    "type": "textarea"
  }
], { practitionerOnly: true }), summary: (b) => ({ remedy: b.remedy, potency: b.potency }) },
{ id: 'follow-up', ...T("Follow-up", [
  {
    "name": "date",
    "label": "Follow-up date",
    "type": "date",
    "required": true
  },
  {
    "name": "response",
    "label": "Response to remedy",
    "type": "select",
    "required": true,
    "options": [
      "Improved",
      "Same",
      "Worse",
      "Aggravation then improvement"
    ]
  },
  {
    "name": "notes",
    "label": "Notes",
    "type": "textarea"
  }
], { practitionerOnly: false }) }
];
buildDomainService({ key: 'homoeopathy', folder: 'homoeopathy-service', dir: __dirname, parts });
