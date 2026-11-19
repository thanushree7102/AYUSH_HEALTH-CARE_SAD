// siddha service. Own database (siddha-service/database/siddha.db), own forms, own versions. Shares only the plumbing in libs/common.
try { require('dotenv').config(); } catch (e) { /* optional */ }
const buildDomainService = require('../../../libs/common/domain-service');
const T = (label, fields, o = {}) => ({ ...o, label, fields });

const parts = [
{ id: 'examination', ...T("Envagai Thervu (eight-fold examination)", [
  {
    "name": "naadi",
    "label": "Naadi (pulse)",
    "type": "textarea"
  },
  {
    "name": "sparisam",
    "label": "Sparisam (touch)",
    "type": "textarea"
  },
  {
    "name": "naa",
    "label": "Naa (tongue)",
    "type": "textarea"
  },
  {
    "name": "niram",
    "label": "Niram (colour)",
    "type": "textarea"
  },
  {
    "name": "mozhi",
    "label": "Mozhi (voice)",
    "type": "textarea"
  },
  {
    "name": "vizhi",
    "label": "Vizhi (eyes)",
    "type": "textarea"
  },
  {
    "name": "malam",
    "label": "Malam (stool)",
    "type": "textarea"
  },
  {
    "name": "moothiram",
    "label": "Moothiram (urine)",
    "type": "textarea"
  },
  {
    "name": "chiefComplaint",
    "label": "Chief complaint",
    "type": "textarea",
    "required": true
  }
], { practitionerOnly: false }), summary: (b) => ({ naadi: b.naadi }) },
{ id: 'mukkutram', ...T("Mukkutram (Vatham / Pitham / Kabam)", [
  {
    "name": "dominant",
    "label": "Dominant humour",
    "type": "select",
    "required": true,
    "options": [
      "Vatham",
      "Pitham",
      "Kabam",
      "Vatham-Pitham",
      "Pitham-Kabam",
      "Vatham-Kabam"
    ]
  },
  {
    "name": "thathu",
    "label": "Udal Thathukkal (seven tissues) observations",
    "type": "textarea"
  },
  {
    "name": "notes",
    "label": "Notes",
    "type": "textarea"
  }
], { practitionerOnly: false }), summary: (b) => ({ dominantHumour: b.dominant }) },
{ id: 'diagnosis', ...T("Diagnosis (Noi Naadal)", [
  {
    "name": "diagnosis",
    "label": "Siddha diagnosis",
    "required": true
  },
  {
    "name": "notes",
    "label": "Clinical notes",
    "type": "textarea"
  }
], { practitionerOnly: true }), summary: (b) => ({ diagnosis: b.diagnosis }) },
{ id: 'treatment-plan', ...T("Treatment plan", [
  {
    "name": "internal",
    "label": "Internal medicines (Ul Marunthu)",
    "type": "textarea",
    "required": true
  },
  {
    "name": "external",
    "label": "External therapies (Pura Maruthuvam, Varmam)",
    "type": "textarea"
  },
  {
    "name": "pathiyam",
    "label": "Pathiyam (diet and conduct)",
    "type": "textarea",
    "required": true
  },
  {
    "name": "duration",
    "label": "Duration"
  }
], { practitionerOnly: true }) },
{ id: 'follow-up', ...T("Follow-up", [
  {
    "name": "date",
    "label": "Follow-up date",
    "type": "date",
    "required": true
  },
  {
    "name": "progress",
    "label": "Progress",
    "type": "select",
    "required": true,
    "options": [
      "Improved",
      "Same",
      "Worse"
    ]
  },
  {
    "name": "notes",
    "label": "Notes",
    "type": "textarea"
  }
], { practitionerOnly: false }) }
];
buildDomainService({ key: 'siddha', folder: 'siddha-service', dir: __dirname, parts });
