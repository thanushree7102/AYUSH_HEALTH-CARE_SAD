// Small validation helpers shared by every service.
const pick = (o, ...keys) => { for (const k of keys) if (o && o[k] !== undefined && o[k] !== '') return o[k]; return null; };
const str = (v) => (v === undefined || v === null ? null : String(v).trim() || null);
const arr = (v) => (v === undefined || v === null || v === '' ? [] : Array.isArray(v) ? v : [v]);
const bool = (v) => v === true || v === 'true';
const isMobile = (m) => /^[6-9]\d{9}$/.test(String(m || ''));
const isEmail = (e) => /^\S+@\S+\.\S+$/.test(String(e || '')) && String(e).length <= 254;
const isDate = (d) => /^\d{4}-\d{2}-\d{2}$/.test(String(d || '')) && !Number.isNaN(Date.parse(d));
const maskMobile = (m) => `XXXXXX${String(m).slice(-4)}`;

// Field definition: { name, label, type: text|textarea|select|multiselect|number|date, required, options, max }
// -> { field: 'message' } (empty object when valid). Unknown keys are ignored.
function validateFields(fields, body) {
  const errors = {};
  for (const f of fields) {
    const v = body[f.name];
    const empty = Array.isArray(v) ? v.length === 0 : v === undefined || v === null || String(v).trim() === '';
    if (f.required && empty) { errors[f.name] = `${f.label || f.name} is required`; continue; }
    if (empty) continue;
    if (f.type === 'select' && f.options && !f.options.includes(v)) errors[f.name] = `Choose one of the listed options for ${f.label || f.name}`;
    else if (f.type === 'multiselect' && f.options && !(Array.isArray(v) && v.every((x) => f.options.includes(x)))) errors[f.name] = `Choose only the listed options for ${f.label || f.name}`;
    else if (f.type === 'number' && !Number.isFinite(Number(v))) errors[f.name] = `${f.label || f.name} must be a number`;
    else if (f.type === 'date' && !isDate(v)) errors[f.name] = `${f.label || f.name} must be a date (YYYY-MM-DD)`;
    else if (typeof v === 'string' && v.length > (f.max || 4000)) errors[f.name] = `${f.label || f.name} is too long`;
  }
  return errors;
}

module.exports = { pick, str, arr, bool, isMobile, isEmail, isDate, maskMobile, validateFields };
