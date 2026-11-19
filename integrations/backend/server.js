// Integrations service (port 5009): WhatsApp bot, OTP / message delivery, document reader (OCR), translation, voice, notifications.
// Owns integrations/database/integrations.db (WhatsApp chat state + drafts). It talks to other services ONLY over internal APIs.
try { require('dotenv').config(); } catch (e) { /* optional */ }
process.env.SERVICE_NAME = 'integrations';
const path = require('path');
const express = require('express');
const { createService, finish, listen, serviceOnly, authenticate } = require('../../libs/common/http');
const { openDb } = require('../../libs/common/db');
const { createEvents } = require('../../libs/common/events');
const { SERVICES, EVENTS } = require('../../libs/common/config');
const { str } = require('../../libs/common/validate');
const reader = require('../whatsapp/reader');
const voice = require('../whatsapp/voice');

process.env.PORT = process.env.PORT || String(SERVICES.gateway.port); // only used in the "open /whatsapp-link" hint
const db = openDb(path.join(__dirname, '..', 'database'), 'integrations.db', 'integrations');
const events = createEvents('integrations', db);
const app = createService('integrations', { jsonLimit: '20mb' });
const bot = require('../whatsapp/bot')(app, db);
void bot;

// ---------- public (through the gateway, signed-in users) ----------
// Text translation for "Speak & translate" (English, Hindi, Kannada). TRANSLATE_URL = LibreTranslate-compatible server, else MyMemory.
app.post('/translate', authenticate, async (req, res) => {
  const { text, source, target } = req.body || {}; const OK = ['en', 'hi', 'kn'];
  if (!OK.includes(source) || !OK.includes(target)) return res.status(400).json({ message: 'Only English, Hindi and Kannada are supported.' });
  const q = String(text || '').trim().slice(0, 450);
  if (!q) return res.status(400).json({ message: 'Type or speak something first.' });
  try {
    if (process.env.TRANSLATE_URL) {
      const r = await fetch(process.env.TRANSLATE_URL, { method: 'POST', signal: AbortSignal.timeout(8000), headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ q, source, target, format: 'text', api_key: process.env.TRANSLATE_KEY || undefined }) });
      if (!r.ok) throw new Error(`translate ${r.status}`);
      return res.json({ translated: (await r.json()).translatedText });
    }
    const r = await fetch(`https://api.mymemory.translated.net/get?q=${encodeURIComponent(q)}&langpair=${source}|${target}`, { signal: AbortSignal.timeout(8000) });
    if (!r.ok) throw new Error(`mymemory ${r.status}`);
    return res.json({ translated: (await r.json()).responseData.translatedText });
  } catch (e) {
    return res.status(502).json({ message: 'Translation is not available right now. Check the internet connection or TRANSLATE_URL.' });
  }
});

// Speech to text for a short recording: { audio: <base64>, mime, lang }
app.post('/voice/transcribe', authenticate, async (req, res) => {
  const b = req.body || {};
  if (!voice.available()) return res.status(501).json({ message: 'Speech recognition is not set up on this server.' });
  if (!b.audio) return res.status(400).json({ message: 'No audio received.' });
  try {
    const text = await voice.transcribe({ get: async () => Buffer.from(String(b.audio), 'base64'), mime: b.mime || 'audio/ogg' }, b.lang || 'en');
    return res.json({ text: text || '' });
  } catch (e) { return res.status(502).json({ message: 'Could not read the recording.' }); }
});

// Link to a real national health-data network is NOT built: honest status so the UI never pretends.
app.get('/external-healthcare/status', authenticate, (req, res) => res.json(require('../external-healthcare/status').status()));
app.get('/notifications', authenticate, (req, res) => res.json({ channels: [{ id: 'whatsapp', mode: process.env.WHATSAPP_MODE || 'mock' }], note: 'Notifications are sent to WhatsApp for patients who chatted with the bot.' }));

// ---------- internal (other services only) ----------
const internal = express.Router();
internal.use(serviceOnly);
// one-time codes and messages: { mobile, text }  -> { delivered }
internal.post('/deliver', async (req, res) => {
  const { mobile, text } = req.body || {};
  if (!/^[6-9]\d{9}$/.test(String(mobile || '')) || !str(text)) return res.status(400).json({ message: 'mobile and text are required.' });
  let delivered = false;
  try { delivered = !!(await app.locals.waDeliver(mobile, text)); } catch (e) { console.error('deliver failed', e.message); }
  res.json({ delivered });
});
// read a document with OCR / rules: { base64, mime } or { text } -> { raw, ex }
internal.post('/reader/read', async (req, res) => {
  const { base64, mime, text } = req.body || {};
  if (!base64 && !text) return res.status(400).json({ message: 'base64 or text is required.' });
  const fs = require('fs'); const os = require('os');
  const ext = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'application/pdf': '.pdf' }[mime] || '';
  const file = base64 ? path.join(os.tmpdir(), `read-${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`) : null;
  try {
    if (file) fs.writeFileSync(file, Buffer.from(base64, 'base64'));
    const out = await reader.readInput(file ? { file, mime } : { text });
    res.json({ raw: out.raw !== undefined ? out.raw : null, ex: out.ex });
  } catch (e) { console.error('reader failed', e.message); res.status(500).json({ message: 'Could not read the document.' }); }
  finally { if (file) fs.unlink(file, () => {}); }
});
// events: a record saved on the website is also sent to WhatsApp; unregister removes the chat state
internal.post('/events', events.handler(async (e) => {
  const d = e.data || {};
  if (e.type === EVENTS.RECORD_CREATED && d.patientId) {
    const meds = (d.medicines || []).slice(0, 4).map((m) => m.name).filter(Boolean).join(', ');
    await app.locals.waNotify(d.patientId, `${d.system || ''}${d.diagnosis ? ` – ${d.diagnosis}` : ''}${meds ? `\n${meds}` : ''}`.trim());
  } else if (e.type === EVENTS.PATIENT_DELETED && d.mobile) {
    app.locals.waForget(d.mobile);
    db.prepare('DELETE FROM wa_drafts WHERE patient_id = ?').run(d.patientId);
  }
}));
app.use('/internal', internal);

finish(app, 'integrations');
listen(app, 'integrations');
events.subscribe('integrations', `${SERVICES.integrations.url}/internal/events`, [EVENTS.RECORD_CREATED, EVENTS.PATIENT_DELETED]);
