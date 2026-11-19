// unani service. Own database (unani-service/database/unani.db), own forms, own versions. Shares only the plumbing in libs/common.
try { require('dotenv').config(); } catch (e) { /* optional */ }
const buildDomainService = require('../../../libs/common/domain-service');
const T = (label, fields, o = {}) => ({ ...o, label, fields });

const parts = [
{ id: 'case-taking', ...T("Case taking (Ahwal)", [
  {
    "name": "complaint",
    "label": "Chief complaint",
    "type": "textarea",
    "required": true
  },
  {
    "name": "duration",
    "label": "Duration"
  },
  {
    "name": "history",
    "label": "History of illness",
    "type": "textarea"
  },
  {
    "name": "habits",
    "label": "Habits (Asbab-e-Sitta Zaruriya)",
    "type": "textarea"
  }
], { practitionerOnly: false }) },
{ id: 'mizaj', ...T("Mizaj (temperament) assessment", [
  {
    "name": "mizaj",
    "label": "Mizaj",
    "type": "select",
    "required": true,
    "options": [
      "Damvi (Sanguine)",
      "Safravi (Bilious)",
      "Balghami (Phlegmatic)",
      "Saudavi (Melancholic)",
      "Mutadil (Balanced)"
    ]
  },
  {
    "name": "akhlat",
    "label": "Dominant Akhlat (humour)",
    "type": "select",
    "options": [
      "Dam",
      "Safra",
      "Balgham",
      "Sauda"
    ]
  },
  {
    "name": "pulse",
    "label": "Nabz (pulse) findings",
    "type": "textarea"
  },
  {
    "name": "notes",
    "label": "Notes",
    "type": "textarea"
  }
], { practitionerOnly: false }), summary: (b) => ({ mizaj: b.mizaj }) },
{ id: 'diagnosis', ...T("Diagnosis (Tashkhees)", [
  {
    "name": "diagnosis",
    "label": "Unani diagnosis",
    "required": true
  },
  {
    "name": "notes",
    "label": "Clinical notes",
    "type": "textarea"
  }
], { practitionerOnly: true }), summary: (b) => ({ diagnosis: b.diagnosis }) },
{ id: 'regimen', ...T("Treatment (Ilaj)", [
  {
    "name": "modes",
    "label": "Mode of treatment",
    "type": "multiselect",
    "required": true,
    "options": [
      "Ilaj bil Tadbeer (regimenal)",
      "Ilaj bil Ghiza (dietotherapy)",
      "Ilaj bil Dawa (pharmacotherapy)",
      "Jarahat (surgery)"
    ]
  },
  {
    "name": "regimen",
    "label": "Regimenal therapy",
    "type": "textarea"
  },
  {
    "name": "diet",
    "label": "Dietotherapy",
    "type": "textarea"
  },
  {
    "name": "medicines",
    "label": "Medicines (Adviya)",
    "type": "textarea"
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
buildDomainService({ key: 'unani', folder: 'unani-service', dir: __dirname, parts });
