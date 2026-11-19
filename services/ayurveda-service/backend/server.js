// ayurveda service. Own database (ayurveda-service/database/ayurveda.db), own forms, own versions. Shares only the plumbing in libs/common.
try { require('dotenv').config(); } catch (e) { /* optional */ }
const buildDomainService = require('../../../libs/common/domain-service');
const T = (label, fields, o = {}) => ({ ...o, label, fields });

// Ayurveda-only: compare Prakriti (natural constitution) with Vikriti (current imbalance).
const DOSHAS = ['Vata', 'Pitta', 'Kapha'];
const doshasIn = (s) => DOSHAS.filter((d) => new RegExp(d, 'i').test(String(s || '')));
function extraRoutes({ app, open, latest }) {
  const { authenticate } = require('../../../libs/common/http');
  app.get('/consultations/:cid/prakriti-vikriti', authenticate, async (req, res) => {
    const o = await open(req, res, 'read'); if (!o) return;
    const pk = latest(req.params.cid, 'prakriti'); const vk = latest(req.params.cid, 'vikriti');
    if (!pk || !vk) return res.status(404).json({ message: 'Record both Prakriti and Vikriti first.' });
    const P = doshasIn(pk.prakriti); const V = doshasIn(vk.vikriti);
    res.json({ prakriti: pk.prakriti, vikriti: vk.vikriti, differences: [
      ...P.filter((d) => !V.includes(d)).map((d) => `${d} (Prakriti) is not currently aggravated`),
      ...V.filter((d) => !P.includes(d)).map((d) => `${d} is aggravated beyond the natural constitution`)] });
  });
}

const parts = [
{ id: 'prakriti', ...T("Prakriti", [
  {
    "name": "prakriti",
    "label": "Prakriti (constitution)",
    "type": "select",
    "required": true,
    "options": [
      "Vata",
      "Pitta",
      "Kapha",
      "Vata-Pitta",
      "Pitta-Kapha",
      "Vata-Kapha",
      "Sama (Tridosha)"
    ]
  },
  {
    "name": "notes",
    "label": "Notes",
    "type": "textarea"
  }
], { practitionerOnly: false }), summary: (b) => ({ prakriti: b.prakriti }) },
{ id: 'vikriti', ...T("Vikriti", [
  {
    "name": "vikriti",
    "label": "Current Vikriti (imbalance)",
    "type": "select",
    "required": true,
    "options": [
      "Vata",
      "Pitta",
      "Kapha",
      "Vata-Pitta",
      "Pitta-Kapha",
      "Vata-Kapha",
      "Sama (Tridosha)"
    ]
  },
  {
    "name": "symptoms",
    "label": "Related symptoms",
    "type": "textarea"
  }
], { practitionerOnly: false }), summary: (b) => ({ vikriti: b.vikriti }) },
{ id: 'dashavidha-pariksha', ...T("Dashavidha Pariksha", [
  {
    "name": "prakriti",
    "label": "Prakriti",
    "required": true
  },
  {
    "name": "vikriti",
    "label": "Vikriti",
    "required": true
  },
  {
    "name": "sara",
    "label": "Sara (tissue quality)",
    "type": "select",
    "required": true,
    "options": [
      "Pravara",
      "Madhyama",
      "Avara"
    ]
  },
  {
    "name": "samhanana",
    "label": "Samhanana (body compactness)",
    "required": true
  },
  {
    "name": "pramana",
    "label": "Pramana (body measurements)",
    "required": true
  },
  {
    "name": "satmya",
    "label": "Satmya (suitability)",
    "required": true
  },
  {
    "name": "sattva",
    "label": "Sattva (mental strength)",
    "required": true
  },
  {
    "name": "aharaShakti",
    "label": "Ahara Shakti",
    "required": true
  },
  {
    "name": "vyayamaShakti",
    "label": "Vyayama Shakti",
    "required": true
  },
  {
    "name": "vaya",
    "label": "Vaya (age group)",
    "required": true
  },
  {
    "name": "remarks",
    "label": "Remarks",
    "type": "textarea"
  }
], { practitionerOnly: false }) },
{ id: 'examination', ...T("Agni / Koshtha Examination", [
  {
    "name": "agni",
    "label": "Agni",
    "type": "select",
    "required": true,
    "options": [
      "Sama",
      "Vishama",
      "Tikshna",
      "Manda"
    ]
  },
  {
    "name": "koshtha",
    "label": "Koshtha",
    "type": "select",
    "required": true,
    "options": [
      "Mridu",
      "Madhyama",
      "Krura"
    ]
  },
  {
    "name": "relatedFindings",
    "label": "Related examination findings",
    "type": "textarea"
  }
], { practitionerOnly: false }), summary: (b) => ({ agni: b.agni, koshtha: b.koshtha, digestion: b.relatedFindings }) },
{ id: 'diagnosis', ...T("Ayurveda Diagnosis", [
  {
    "name": "diagnosis",
    "label": "Ayurveda diagnosis",
    "required": true
  },
  {
    "name": "terminologyCode",
    "label": "Terminology code (NAMASTE / ICD-11 TM, optional)"
  },
  {
    "name": "notes",
    "label": "Clinical notes",
    "type": "textarea"
  }
], { practitionerOnly: true }), summary: (b) => ({ diagnosis: b.diagnosis }) },
{ id: 'therapy', ...T("Therapy, Diet & Lifestyle Advice", [
  {
    "name": "therapies",
    "label": "Panchakarma / other therapy",
    "type": "multiselect",
    "required": true,
    "options": [
      "Snehana",
      "Swedana",
      "Vamana",
      "Virechana",
      "Basti",
      "Nasya",
      "Raktamokshana",
      "Other"
    ]
  },
  {
    "name": "therapyNotes",
    "label": "Therapy details (duration, sessions)",
    "type": "textarea"
  },
  {
    "name": "dietAdvice",
    "label": "Diet advice (Pathya-Apathya)",
    "type": "textarea",
    "required": true
  },
  {
    "name": "lifestyleAdvice",
    "label": "Lifestyle advice",
    "type": "textarea",
    "required": true
  }
], { practitionerOnly: false }), summary: (b) => ({ diet_notes: b.dietAdvice, lifestyle_notes: b.lifestyleAdvice }) }
];
buildDomainService({ key: 'ayurveda', folder: 'ayurveda-service', dir: __dirname, parts, strict: false, extraRoutes, onSave: null });
