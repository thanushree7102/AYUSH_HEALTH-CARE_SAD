// Regression checks for prescription OCR field mapping. No network/API key required.
const assert = require('node:assert/strict');
const { extract } = require('../integrations/whatsapp/reader');

const sample = `
AYURVEDIC PRESCRIPTION
PATIENT DETAILS
Name: Ganesh B Age: 25
DIAGNOSIS
Reported Symptoms;
cold, fever
PRESCRIPTION
Hindi Name: Atzes
English Name: Indian Ateech
Botanical Name: Acontum heterophylum Wall
Remedy: Aines powder can be
taken with warm water to
treat fever, digestive
problems, and respiratory
infections.
EMOTION ANALYSIS
Detected Emotion: Happy
Health Tip: You seem fine! Keep smiling
`;
const result = extract(sample);
assert.equal(result.system, 'ayurveda');
assert.match(result.complaint, /cold,\s*fever/i);
assert.equal(result.diagnosis, '');
assert.equal(result.findings.Prakriti, '');
assert.equal(result.medicines.length, 1);
assert.match(result.medicines[0].name, /Atees powder/i);
assert.match(result.advice, /warm water/i);
assert.doesNotMatch(JSON.stringify(result), /Pitta|Kapha|Vata/);

const homoeo = extract('HOMOEOPATHIC PRESCRIPTION\nMedicine: Arnica 30C');
assert.equal(homoeo.system, 'homoeopathy');
console.log('Reader regression checks passed.');
