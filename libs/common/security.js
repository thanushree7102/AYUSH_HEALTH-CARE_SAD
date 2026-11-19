// Shared security helpers: signed tokens (access, face, service and identity tokens) and encryption of face templates.
// Keys come from AYUSH_SECRET. If it is not set, one random secret is created once in data/ayush.secret (git-ignored)
// and shared by every service of this project (they all run from the same folder).
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

function loadSecret() {
  if (process.env.AYUSH_SECRET) return process.env.AYUSH_SECRET;
  const dir = process.env.DATA_ROOT || path.join(__dirname, '..', '..', 'data');
  fs.mkdirSync(dir, { recursive: true });
  const f = path.join(dir, 'ayush.secret');
  for (let i = 0; i < 20; i++) {
    try { const s = fs.readFileSync(f, 'utf8').trim(); if (s) return s; } catch (e) { /* create below */ }
    try { fs.writeFileSync(f, crypto.randomBytes(48).toString('hex'), { mode: 0o600, flag: 'wx' }); } catch (e) { /* another service won the race: read it */ }
  }
  throw new Error('could not load or create the secret key');
}
const SECRET = loadSecret();
const derive = (label) => Buffer.from(crypto.hkdfSync('sha256', SECRET, 'ayush', label, 32));
const TOKEN_KEY = derive('token');
const FACE_KEY = derive('face-template');
const b64 = (b) => Buffer.from(b).toString('base64url');

// sign({ k: 'access', ... }, ttlSeconds) -> "payload.signature"
function sign(payload, ttlSeconds) {
  const body = b64(JSON.stringify({ ...payload, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + ttlSeconds, n: crypto.randomBytes(6).toString('hex') }));
  const sig = crypto.createHmac('sha256', TOKEN_KEY).update(body).digest('base64url');
  return `${body}.${sig}`;
}
function verify(token) {
  if (typeof token !== 'string' || token.length > 4000) return null;
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  const exp = crypto.createHmac('sha256', TOKEN_KEY).update(body).digest('base64url');
  if (sig.length !== exp.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(exp))) return null;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    return p.exp > Date.now() / 1000 ? p : null;
  } catch (e) { return null; }
}

// ---- service-to-service: a short-lived token naming the calling service (never accepted from a browser: the gateway blocks /internal) ----
const serviceToken = (name) => sign({ k: 'svc', s: name }, 120);
const verifyService = (token) => { const p = verify(token); return p && p.k === 'svc' ? p : null; };

// ---- identity header: the gateway resolves the user's access token once and hands the downstream service a signed identity ----
const identityHeader = (identity) => sign({ k: 'ident', ...identity }, 90);
const readIdentity = (header) => { const p = verify(header); return p && p.k === 'ident' ? p : null; };

// Face templates (128 numbers) are AES-256-GCM encrypted before they touch the database.
function seal(arr) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', FACE_KEY, iv);
  const enc = Buffer.concat([c.update(JSON.stringify(arr), 'utf8'), c.final()]);
  return `${iv.toString('base64')}.${c.getAuthTag().toString('base64')}.${enc.toString('base64')}`;
}
function open(s) {
  const [iv, tag, enc] = String(s).split('.').map((x) => Buffer.from(x, 'base64'));
  const d = crypto.createDecipheriv('aes-256-gcm', FACE_KEY, iv);
  d.setAuthTag(tag);
  return JSON.parse(Buffer.concat([d.update(enc), d.final()]).toString('utf8'));
}

// keyed hash (stores one-time codes without keeping the code itself)
const hmac = (text) => crypto.createHmac('sha256', TOKEN_KEY).update(String(text)).digest('hex');

module.exports = { sign, verify, seal, open, hmac, serviceToken, verifyService, identityHeader, readIdentity };
