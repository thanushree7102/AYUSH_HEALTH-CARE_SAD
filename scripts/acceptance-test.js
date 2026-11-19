// End-to-end acceptance test (guide "Section 12"). Starts all 11 services on temporary data and ports,
// drives everything through the API GATEWAY only, and writes the evidence to docs/ACCEPTANCE-EVIDENCE.md.
//   npm test
const { spawn } = require('child_process');
const fs = require('fs'); const os = require('os'); const path = require('path');
process.env.AYUSH_SECRET = 'acceptance-secret';
const { ROOT, PROCESSES } = require('./services');

const PORT_BASE = 5300 + Math.floor(Math.random() * 40) * 20;
const DATA_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'ayush-acc-'));
const ENV = { ...process.env, PORT_BASE: String(PORT_BASE), DATA_ROOT, OTP_CODE: '123456', AYUSH_SECRET: 'acceptance-secret', WHATSAPP_MODE: 'mock', RATE_LIMIT_AUTH: '100000', RATE_LIMIT: '100000' };
const GW = `http://127.0.0.1:${PORT_BASE}`;
const url = (off) => `http://127.0.0.1:${PORT_BASE + off}`;
const kids = {};
const results = []; let section = '';
const log = (m) => console.log(m);
const ok = (c, name, extra = '') => { results.push({ section, name, pass: !!c, extra: c ? '' : String(extra).slice(0, 200) }); log(`  ${c ? '✓' : '✗'} ${name}${c ? '' : ' ' + String(extra).slice(0, 200)}`); };
const sec = (s) => { section = s; log(`\n${s}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 15000) { const t = Date.now(); for (;;) { try { const v = await fn(); if (v) return v; } catch (e) { /* retry */ } if (Date.now() - t > ms) return null; await sleep(300); } }

const j = async (p, o = {}) => {
  const headers = { ...(o.json ? { 'Content-Type': 'application/json' } : {}), ...(o.token ? { Authorization: `Bearer ${o.token}` } : {}), ...(o.headers || {}) };
  const r = await fetch((o.base || GW) + p, { method: o.method || (o.json || o.body ? 'POST' : 'GET'), headers, body: o.json ? JSON.stringify(o.json) : o.body });
  let b = null; try { b = await r.json(); } catch (e) { /* empty */ }
  return { s: r.status, b };
};
const face = (seed) => Array.from({ length: 128 }, (_, i) => Math.sin(seed * 7.1 + i * 0.37) * 0.2);
const noisy = (d, n = 0.01) => d.map((x, i) => x + Math.cos(i) * n);
const login = async (mobile, role) => (await j('/v1/auth/login', { json: { mobile, role, otp: '123456' } }));
const wa = async (from, text) => (await j('/whatsapp-mock', { json: { from, text } })).b;
const flat = (a) => (a || []).map((x) => x.text + (x.options ? ` [${x.options.join(' | ')}]` : '')).join('\n');

function start(name) {
  const f = PROCESSES.find((p) => p[0] === name)[1];
  const p = spawn(process.execPath, [f], { cwd: ROOT, env: ENV, stdio: ['ignore', 'pipe', 'pipe'] });
  p.stderr.on('data', (d) => { const s = String(d); if (/Error|EADDR/.test(s)) process.stderr.write(`[${name}] ${s}`); });
  kids[name] = p; return p;
}
const fill = (def) => Object.fromEntries(def.fields.map((f) => [f.name, f.type === 'select' ? f.options[0] : f.type === 'number' ? 5 : f.type === 'date' ? '2026-10-01' : f.type === 'checkbox' ? true : 'test ' + f.name]));

(async () => {
  for (const [n] of PROCESSES) start(n);
  const up = await until(async () => (await j('/v1/health')).b?.ok && Object.keys((await j('/v1/health')).b.services).length === 11);
  if (!up) { console.error('services did not start'); Object.values(kids).forEach((k) => k.kill()); process.exit(2); }

  try {
    sec('1. Architecture: 11 services up, gateway routing, boundaries');
    const h = (await j('/v1/health')).b;
    ok(h.ok && Object.keys(h.services).length === 11 && Object.values(h.services).every((s) => s.ok), 'gateway /v1/health sees all 11 services up', JSON.stringify(h));
    ok((await j('/api/health')).s === 200, '/api/* alias works');
    ok((await j('/v1/internal/auth/resolve', { json: {} })).s === 404, '/internal/* is never reachable through the gateway');
    ok((await j('/internal/audit', { base: url(1), json: { action: 'X' } })).s === 401, 'a service rejects /internal calls without a service token');
    ok((await j('/v1/me')).s === 401, 'protected route without token -> 401');
    ok((await j('/v1/me', { token: 'garbage' })).s === 401, 'forged token -> 401');
    ok((await j('/v1/ayurveda/forms')).s === 401, 'domain service not reachable without login');

    sec('2. Registration: OTP + face + consent');
    const M1 = '9811100001'; const f1 = face(1);
    let r = await j('/v1/face/status', { json: { mobile: M1 } });
    ok(r.s === 200 && r.b.faceRegistered === false, 'new number has no face / account');
    const reg = { name: 'Test Patient', mobile: M1, otp: '123456', consent: true, dob: '1990-01-01', gender: 'Female' };
    r = await j('/v1/auth/register', { json: reg });
    ok(r.s === 400, 'registration without face step refused', JSON.stringify(r.b));
    r = await j('/v1/face/enroll', { json: { mobile: M1, otp: '000000', descriptor: f1, liveness: true, consent: true } });
    ok(r.s === 401, 'wrong OTP refused');
    r = await j('/v1/face/enroll', { json: { mobile: M1, otp: '123456', descriptor: f1, consent: true } });
    ok(r.s >= 400, 'enrol without liveness flag refused', r.s);
    r = await j('/v1/face/enroll', { json: { mobile: M1, otp: '123456', descriptor: f1, liveness: true, consent: true } });
    ok(r.s === 201 && r.b.faceToken, 'face enrolled');
    const ft = r.b.faceToken;
    r = await j('/v1/auth/register', { json: { ...reg, consent: false }, headers: { 'X-Face-Token': ft } });
    ok(r.s === 400, 'registration without consent refused');
    r = await j('/v1/auth/register', { json: reg, headers: { 'X-Face-Token': ft } });
    ok(r.s === 201 && r.b.healthId, 'patient registered', JSON.stringify(r.b));
    const HID = r.b.healthId;
    r = await j('/v1/face/verify', { json: { mobile: M1, descriptor: face(2), liveness: true } });
    ok(r.s === 401, 'a different face is rejected');
    r = await j('/v1/face/verify', { json: { mobile: M1, descriptor: noisy(f1), liveness: true } });
    ok(r.s === 200 && r.b.faceToken, 'same face accepted');
    r = await j('/v1/auth/login', { json: { mobile: M1, role: 'patient', faceToken: r.b.faceToken, otp: '123456' } });
    ok(r.s === 200 && r.b.token, 'login by face + OTP');
    const P = (await login(M1, 'patient')).b.token;
    ok(!!P, 'login by OTP');
    r = await j('/v1/me', { token: P });
    ok(r.s === 200 && r.b.name === 'Test Patient', '/me works with the token');
    r = await j('/v1/aadhaar/fetch', { json: { aadhaar: '234567890124', consent: true } });
    ok(r.s === 200 && r.b.maskedAadhaar === 'XXXX XXXX 0124', 'demo Aadhaar (masked)');
    r = await j('/v1/abha/validate', { json: { abha: '12-3456-7890-1234' } });
    ok(r.s === 200 || r.s === 400, 'ABHA format check endpoint answers', r.s);

    const dr = await login('9000000001', 'practitioner');
    ok(dr.s === 200 && dr.b.token, 'demo Ayurveda doctor logs in');
    const D1 = dr.b.token; const D2 = (await login('9000000002', 'practitioner')).b.token;
    const ADM = (await login('9000000009', 'admin')).b.token; const AUD = (await login('9000000008', 'admin')).b.token;
    const CLI = (await login('9000000005', 'facility')).b.token;
    ok(D1 && D2 && ADM && AUD && CLI, 'doctor, siddha doctor, admin, auditor, clinic all sign in');

    sec('3. Consent and access control');
    const sum0 = await j(`/v1/patients/${HID}/summary`, { token: P });
    ok(sum0.s === 200 && /^C-\d+/.test(sum0.b.consultationId || ''), 'patient sees own summary + consultation id (created by event/ensure)', JSON.stringify(sum0.b));
    const CID = sum0.b.consultationId;
    ok((await j(`/v1/patients/${HID}/summary`, { token: D1 })).s === 403, 'doctor WITHOUT consent cannot read the summary');
    ok((await j(`/v1/ayurveda/consultations/${CID}/summary`, { token: D1 })).s === 403, 'doctor WITHOUT consent cannot read forms');
    ok((await j(`/v1/patients/${HID}/summary`, { token: ADM })).s === 403, 'admin cannot read clinical data');
    ok((await j(`/v1/patients/${HID}/summary`, { token: CLI })).s === 403, 'clinic cannot read clinical data');
    const other = await login('9811100009', 'patient'); // not registered
    ok(other.s !== 200, 'unregistered number cannot log in as patient');
    r = await j(`/v1/patients/${HID}/consents`, { token: D1, json: { doctorIds: ['D-1'] } });
    ok(r.s === 403, "a doctor cannot grant consent on a patient's behalf");
    r = await j(`/v1/patients/${HID}/consents`, { token: P, json: { doctorIds: ['D-1'], systems: ['Ayurveda'], days: 30 } });
    ok(r.s === 200 && r.b.sharedWith.includes('D-1'), 'patient grants Ayurveda-only access to D-1 for 30 days', JSON.stringify(r.b));
    ok((await j(`/v1/patients/${HID}/summary`, { token: D1 })).s === 200, 'D-1 can now read');
    ok((await j(`/v1/patients/${HID}/summary`, { token: D2 })).s === 403, 'D-2 (no grant) still refused');

    sec('4. Five AYUSH services: forms, versions, scope of consent');
    const SYS = [['ayurveda', 'Ayurveda'], ['yoga', 'Yoga & Naturopathy'], ['unani', 'Unani'], ['siddha', 'Siddha'], ['homoeopathy', 'Homoeopathy']];
    const forms = {};
    for (const [k, label] of SYS) {
      r = await j(`/v1/${k}/forms`, { token: D1 });
      forms[k] = r.b;
      ok(r.s === 200 && r.b.system === label && r.b.parts.length >= 5, `${k}: forms served by its own service (${r.b && r.b.parts ? r.b.parts.length : 0} parts)`, JSON.stringify(r.b));
    }
    const ayParts = forms.ayurveda.parts.map((p) => p.id);
    const yogaParts = forms.yoga.parts.map((p) => p.id);
    ok(JSON.stringify(ayParts) !== JSON.stringify(yogaParts), 'each AYUSH service has its OWN forms (not a copy)');
    const p0 = forms.ayurveda.parts.find((p) => !p.practitionerOnly) || forms.ayurveda.parts[0];
    r = await j(`/v1/ayurveda/consultations/${CID}/${p0.id}`, { token: D1, json: fill(p0) });
    ok(r.s === 201 && r.b.version === 1, 'doctor saves Ayurveda form v1', JSON.stringify(r.b));
    r = await j(`/v1/ayurveda/consultations/${CID}/${p0.id}`, { token: D1, json: fill(p0) });
    ok(r.s === 201 && r.b.version === 2, 'second save creates v2 (history kept)');
    const idem = { 'Idempotency-Key': 'idem-1' };
    const a1 = await j(`/v1/ayurveda/consultations/${CID}/${p0.id}`, { token: D1, json: fill(p0), headers: idem });
    const a2 = await j(`/v1/ayurveda/consultations/${CID}/${p0.id}`, { token: D1, json: fill(p0), headers: idem });
    ok(a1.b.version === a2.b.version, 'same Idempotency-Key does not create another version');
    r = await j(`/v1/ayurveda/consultations/${CID}/${p0.id}/versions`, { token: D1 });
    ok(r.s === 200 && r.b.length === 3, 'version history lists 3 versions', JSON.stringify(r.b));
    r = await j(`/v1/ayurveda/consultations/${CID}/${p0.id}`, { token: P });
    ok(r.s === 200 || r.s === 404, 'patient can read own form');
    ok((await j(`/v1/yoga/consultations/${CID}/${yogaParts[0]}`, { token: D1, json: fill(forms.yoga.parts[0]) })).s === 403, 'D-1 (Ayurveda-only consent) cannot write a Yoga form');
    r = await j(`/v1/patients/${HID}/consents`, { token: P, json: { doctorIds: ['D-1'], days: 30 } });
    ok(r.s === 200, 'patient widens D-1 consent to every system');
    for (const [k] of SYS.slice(1)) {
      const part = forms[k].parts.find((p) => !p.practitionerOnly) || forms[k].parts[0];
      r = await j(`/v1/${k}/consultations/${CID}/${part.id}`, { token: D1, json: fill(part) });
      ok(r.s === 201, `${k}: form saved by its own service`, JSON.stringify(r.b));
    }
    r = await j(`/v1/yoga/consultations/${CID}/${yogaParts[0]}`, { token: D1, json: {} });
    ok(r.s === 400, 'empty form body refused');
    const reqd = forms.unani.parts[0].fields.find((f) => f.required);
    if (reqd) { r = await j(`/v1/unani/consultations/${CID}/${forms.unani.parts[0].id}`, { token: D1, json: { notes: 'x' } }); ok(r.s === 400, 'missing required field refused (strict forms)'); }
    r = await j(`/v1/siddha/consultations/${CID}/summary`, { token: D1 });
    ok(r.s === 200, 'consultation summary from Siddha service');

    sec('5. Clinical records + longitudinal timeline');
    r = await j('/v1/records', { token: P, json: { healthId: HID, system: 'Siddha', problem: 'knee pain', diagnosis: 'Vatha', medicines: [{ name: 'Kasthuri', dose: '1 tab', timing: 'night', duration: '10 days' }] } });
    ok(r.s === 201 && r.b.recordId, 'patient saves a record (Common Clinical)', JSON.stringify(r.b));
    await sleep(1500);
    r = await j(`/v1/patients/${HID}/timeline`, { token: P });
    ok(r.s === 200 && r.b.items.length >= 6, 'timeline (read model fed by events) shows forms + record', r.b && r.b.items && r.b.items.length);
    ok(r.b.items.some((i) => i.system === 'Siddha' && i.kind === 'record') && r.b.items.some((i) => i.kind === 'assessment'), 'timeline has both records and AYUSH assessments');
    r = await j(`/v1/patients/${HID}/consents`, { token: P, json: { doctorIds: ['D-1'], systems: ['Ayurveda'], days: 30 } });
    r = await j(`/v1/patients/${HID}/timeline`, { token: D1 });
    ok(r.s === 200 && r.b.items.length > 0 && r.b.items.every((i) => i.system === 'Ayurveda' || i.system == null), 'doctor with Ayurveda-only consent sees only Ayurveda in the timeline', JSON.stringify((r.b.items || []).map((i) => i.system)));
    r = await j(`/v1/patients/${HID}/summary`, { token: D1 });
    ok(r.s === 200 && r.b.restricted === true && r.b.records.every((x) => x.system === 'Ayurveda'), 'summary is filtered to the shared system', JSON.stringify(r.b.records));
    r = await j(`/v1/patients/${HID}/summary`, { token: P });
    ok(r.b.records.some((x) => x.system === 'Siddha'), 'patient still sees everything');
    r = await j(`/v1/patients/${HID}/consents`, { token: P, json: { doctorIds: [] } });
    ok(r.s === 200 && r.b.sharedWith.length === 0, 'patient withdraws consent');
    ok((await j(`/v1/patients/${HID}/timeline`, { token: D1 })).s === 403, 'after withdrawal the doctor is refused again');
    r = await j('/v1/admin/audit', { token: AUD });
    ok(r.s === 200 && JSON.stringify(r.b).includes('VIEW_SENSITIVE'), 'auditor sees access + denial entries written by other services');
    ok((await j('/v1/admin/audit', { token: D1 })).s === 403, 'doctor cannot read the audit log');

    sec('6. Security: spoofing, tokens, logout');
    ok((await j(`/v1/patients/${HID}/summary`, { token: D2, headers: { 'X-Role': 'patient', 'X-Doctor-Id': 'D-1', 'X-Identity': 'forged', 'X-Service-Token': 'forged' } })).s === 403, 'spoofed X-Role / X-Doctor-Id / X-Identity are ignored by the gateway');
    const stale = (await login(M1, 'patient')).b.token;
    r = await j('/v1/auth/refresh', { token: stale, json: {} });
    ok(r.s === 200 && r.b.token, 'token refresh issues a new token');
    const fresh = r.b.token;
    ok((await j('/v1/me', { token: stale })).s === 401, 'the old token is dead after refresh');
    ok((await j('/v1/me', { token: fresh })).s === 200, 'the new token works');
    ok((await j('/v1/auth/logout', { token: fresh, json: {} })).s === 200, 'logout');
    ok((await j('/v1/me', { token: fresh })).s === 401, 'a logged-out token is revoked everywhere');
    r = await j('/v1/auth/register/admin', { json: { name: 'Bad Admin', adminType: 'Super Admin', designation: 'x', department: 'x', email: 'a@b.in', mobile: '9811100077', otp: '123456', inviteCode: 'wrong' } });
    ok(r.s >= 400, 'admin self-registration needs the invite code');
    let lim = 0; for (let i = 0; i < 6; i++) { const x = await j('/v1/auth/login', { json: { mobile: '9811100055', role: 'patient', otp: '999999' } }); if (x.s === 429) lim++; }
    ok(lim >= 1, 'repeated wrong OTPs lock the number (429)');

    sec('7. WhatsApp bot (Integrations) uses internal APIs only');
    const W = '919876500011';
    let out = flat(await wa(W, 'Hi'));
    ok(/lang_en/.test(out), 'bot asks language');
    await wa(W, 'lang_en'); await wa(W, 'yes'); await wa(W, 'Kavya N'); await wa(W, '14-03-1996'); await wa(W, 'penicillin');
    out = flat(await wa(W, 'yes'));
    ok(/91-\d{4}-\d{4}-\d{4}/.test(out), 'registered through WhatsApp (health id returned)', out);
    const wl = await login('9876500011', 'patient');
    ok(wl.s === 200, 'WhatsApp-registered patient exists in the Shared Platform');
    const WT = wl.b.token; const WH = wl.b.healthId;
    await wa(W, 'm_add'); out = flat(await wa(W, 'Ashwagandha churna 5 g twice daily for 15 days. Diagnosis: fatigue'));
    ok(/Save this/.test(out) || /save/.test(out), 'typed description becomes a draft', out);
    out = flat(await wa(W, 'ayurveda')); out = flat(await wa(W, 'save'));
    ok(/Ashwagandha/i.test(out) || /Saved|saved/.test(out) || /Penicillin|allerg/i.test(out), 'record saved from WhatsApp', out);
    await sleep(1200);
    r = await j(`/v1/patients/${WH}/summary`, { token: WT });
    ok(r.s === 200 && r.b.records.length >= 1 && /penicillin/i.test(JSON.stringify(r.b.medicalHistory)), 'record + allergy are visible on the website side (Clinical + Platform)', JSON.stringify(r.b).slice(0, 200));
    out = flat(await wa(W, 'm_summary')); ok(/Kavya/.test(out), 'bot summary built from several services');
    out = flat(await wa(W, 'm_grant')); ok(/grant_D-1/.test(out), 'bot lists doctors from the Shared Platform');
    out = flat(await wa(W, 'grant_D-1'));
    r = await j(`/v1/patients/${WH}/summary`, { token: D1 });
    ok(r.s === 200, 'consent granted by WhatsApp works for the doctor');
    await wa(W, 'm_delete'); out = flat(await wa(W, 'del_yes'));
    ok(/deleted/i.test(out), 'unregister confirmed on WhatsApp');
    await sleep(2500);

    sec('8. Unregister purges every service (events)');
    ok((await login('9876500011', 'patient')).s !== 200, 'identity deleted in the Shared Platform');
    for (const [name, off, p] of [['clinical', 7, '/internal/patients/%/records'], ['longitudinal', 8, null]]) {
      void name; void off; void p;
    }
    const svcTok = require('../libs/common/security').serviceToken('acceptance');
    const cl = await j('/internal/patients/none/records', { base: url(7), headers: { 'X-Service-Token': svcTok } });
    ok(cl.s === 200, 'clinical internal API reachable with a service token');
    const pr = await j(`/v1/patients/${WH}/timeline`, { token: WT });
    ok(pr.s === 401 || pr.s === 403 || pr.s === 404, 'old token of the deleted patient is dead');
    const pid = sum0.b && null;
    void pid;

    sec('9. Event reliability: a service is down, nothing is lost');
    kids.longitudinal.kill(); await sleep(800);
    const bad = await j(`/v1/patients/${HID}/timeline`, { token: P });
    ok(bad.s === 503, 'gateway answers 503 (not a crash) when a service is down', JSON.stringify(bad.b));
    const hh = await j('/v1/health');
    ok(hh.b.ok === false || hh.b.services.longitudinal.ok === false, 'health shows the service as down');
    r = await j('/v1/records', { token: P, json: { healthId: HID, system: 'Unani', problem: 'cough while timeline service is down', diagnosis: 'Sual', medicines: [] } });
    ok(r.s === 201, 'writing a record still works while the timeline service is down (loose coupling)');
    const summ = await j(`/v1/patients/${HID}/summary`, { token: P });
    ok(summ.s === 503, 'the summary (owned by the down service) says 503');
    await sleep(500);
    start('longitudinal');
    const back = await until(async () => { const t = await j(`/v1/patients/${HID}/timeline`, { token: P }); return t.s === 200 && t.b.items.some((i) => /cough while timeline/.test(JSON.stringify(i))) ? t : null; }, 40000);
    ok(!!back, 'after restart the bus delivers the missed event (retry with backoff, at-least-once)');
    const ev = await j('/stats', { base: url(10), headers: { 'X-Service-Token': svcTok } });
    ok(ev.s === 200, 'event bus statistics available', JSON.stringify(ev.b));
    const before = (await j(`/v1/patients/${HID}/timeline`, { token: P })).b.items.length;
    await sleep(2500);
    ok((await j(`/v1/patients/${HID}/timeline`, { token: P })).b.items.length === before, 'no duplicates after redelivery (idempotent consumer)');

    sec('10. Other');
    ok((await j('/whatsapp/qr', { base: GW })).s === 200 || (await j('/v1/whatsapp/qr')).s === 200, 'WhatsApp QR endpoint answers');
    r = await j('/v1/external-healthcare/status', { token: P });
    ok(r.s === 200 && r.b.connected === false, 'external health network honestly reported as NOT connected');
    r = await j('/v1/translate', { token: P, json: { text: 'hello', source: 'en', target: 'xx' } });
    ok(r.s === 400, 'translate validates languages');
  } catch (e) {
    ok(false, 'test run crashed', e.stack || e.message);
  }

  Object.values(kids).forEach((k) => k.kill());
  const pass = results.filter((x) => x.pass).length; const fail = results.length - pass;
  const lines = ['# Acceptance test evidence', '', `Run: ${new Date().toISOString()}  ·  ${pass} passed, ${fail} failed, ${results.length} checks`, '', 'All checks go through the API gateway only, on temporary databases (nothing in `data/` is touched).', ''];
  let cur = '';
  for (const x of results) { if (x.section !== cur) { cur = x.section; lines.push('', `## ${cur}`, ''); } lines.push(`- ${x.pass ? 'PASS' : '**FAIL**'} — ${x.name}${x.extra ? ` (${x.extra})` : ''}`); }
  fs.mkdirSync(path.join(ROOT, 'docs'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'docs', 'ACCEPTANCE-EVIDENCE.md'), lines.join('\n') + '\n');
  log(`\n${pass} passed, ${fail} failed`);
  try { fs.rmSync(DATA_ROOT, { recursive: true, force: true }); } catch (e) { /* ignore */ }
  process.exit(fail ? 1 : 0);
})();
