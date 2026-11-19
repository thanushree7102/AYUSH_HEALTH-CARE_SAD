// yoga service. Own database (yoga-naturopathy-service/database/yoga.db), own forms, own versions. Shares only the plumbing in libs/common.
try { require('dotenv').config(); } catch (e) { /* optional */ }
const buildDomainService = require('../../../libs/common/domain-service');
const T = (label, fields, o = {}) => ({ ...o, label, fields });

const parts = [
{ id: 'assessment', ...T("Yoga & Naturopathy Assessment", [
  {
    "name": "physicalState",
    "label": "Physical condition",
    "type": "select",
    "required": true,
    "options": [
      "Good",
      "Fair",
      "Weak"
    ]
  },
  {
    "name": "flexibility",
    "label": "Flexibility",
    "type": "select",
    "options": [
      "Low",
      "Average",
      "High"
    ]
  },
  {
    "name": "stressLevel",
    "label": "Stress level",
    "type": "select",
    "required": true,
    "options": [
      "Low",
      "Moderate",
      "High"
    ]
  },
  {
    "name": "breathingPattern",
    "label": "Breathing pattern",
    "type": "textarea"
  },
  {
    "name": "medicalLimits",
    "label": "Medical limits for practice (e.g. back, BP, pregnancy)",
    "type": "textarea"
  }
], { practitionerOnly: false }), summary: (b) => ({ stress: b.stressLevel, physicalState: b.physicalState }) },
{ id: 'lifestyle', ...T("Lifestyle & Diet", [
  {
    "name": "diet",
    "label": "Usual diet",
    "type": "select",
    "required": true,
    "options": [
      "Vegetarian",
      "Vegan",
      "Mixed"
    ]
  },
  {
    "name": "sleepHours",
    "label": "Sleep (hours per night)",
    "type": "number"
  },
  {
    "name": "activity",
    "label": "Daily physical activity",
    "type": "select",
    "options": [
      "Sedentary",
      "Light",
      "Moderate",
      "Active"
    ]
  },
  {
    "name": "notes",
    "label": "Notes",
    "type": "textarea"
  }
], { practitionerOnly: false }) },
{ id: 'practice-plan', ...T("Yoga Practice Plan", [
  {
    "name": "asanas",
    "label": "Asanas",
    "type": "textarea",
    "required": true
  },
  {
    "name": "pranayama",
    "label": "Pranayama",
    "type": "textarea"
  },
  {
    "name": "kriyas",
    "label": "Shat-kriyas / cleansing practices",
    "type": "textarea"
  },
  {
    "name": "meditation",
    "label": "Meditation / relaxation",
    "type": "textarea"
  },
  {
    "name": "durationMinutes",
    "label": "Daily duration (minutes)",
    "type": "number",
    "required": true
  }
], { practitionerOnly: false }), summary: (b) => ({ plan: b.asanas }) },
{ id: 'naturopathy', ...T("Naturopathy Therapies", [
  {
    "name": "therapies",
    "label": "Therapies",
    "type": "multiselect",
    "required": true,
    "options": [
      "Hydrotherapy",
      "Mud therapy",
      "Massage",
      "Fasting",
      "Diet therapy",
      "Chromotherapy",
      "Magneto therapy"
    ]
  },
  {
    "name": "sessions",
    "label": "Number of sessions",
    "type": "number"
  },
  {
    "name": "notes",
    "label": "Therapy notes",
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
    "label": "Progress since last visit",
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
buildDomainService({ key: 'yoga', folder: 'yoga-naturopathy-service', dir: __dirname, parts });
