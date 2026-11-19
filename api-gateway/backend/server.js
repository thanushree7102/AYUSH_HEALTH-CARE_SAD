// API Gateway (port 5000): the ONLY entry point the browser talks to.
//  - routes /v1/* (and /api/*) to the right service (route table below)
//  - verifies the signed access token (signature, expiry, revoked / suspended accounts) before a protected route is forwarded,
//    then gives the downstream service a signed X-Identity header; the browser never supplies identity
//  - request id on every call, rate limiting, CORS, consistent JSON errors when a service is down
//  - never forwards /internal/*, and removes client-supplied identity headers (X-Role, X-Doctor-Id, X-Admin-Id, X-Identity ...)
//  - when `npm run build` has been run it also serves the React app (one-port mode)
try { require('dotenv').config(); } catch (e) { /* optional */ }
process.env.SERVICE_NAME = 'gateway';
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const cors = require('cors');
const { createProxyMiddleware } = require('http-proxy-middleware');
const security = require('../../libs/common/security');
const { SERVICES, HOST } = require('../../libs/common/config');
const { platform } = require('../../libs/common/internal');

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 'loopback');
app.use(cors({
  origin: (process.env.CORS_ORIGIN || 'http://localhost:5173,http://127.0.0.1:5173').split(','),
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id', 'X-Correlation-Id', 'Idempotency-Key', 'X-Face-Token'],
  exposedHeaders: ['X-Request-Id'],
}));
app.use((req, res, next) => { req.id = crypto.randomUUID(); res.set('X-Request-Id', req.id); next(); });

// ---------- rate limiting (per client address, in memory) ----------
const buckets = new Map();
const limited = (key, max, windowMs) => {
  const t = Date.now(); let b = buckets.get(key);
  if (!b || b.reset < t) { b = { n: 0, reset: t + windowMs }; buckets.set(key, b); }
  b.n += 1;
  return b.n > max;
};
setInterval(() => { const t = Date.now(); for (const [k, v] of buckets) if (v.reset < t) buckets.delete(k); }, 60000).unref();
const GENERAL_LIMIT = Number(process.env.RATE_LIMIT || 3000); // requests / minute / address
const SENSITIVE_LIMIT = Number(process.env.RATE_LIMIT_AUTH || 120); // OTP / login / face / register per minute

// ---------- route table: [methods, path regex, service, rewrite(path), access] ----------
// access: 'public' = no token needed (registration, OTP, face, demo Aadhaar) | 'user' = a valid access token is required
const routes = [];
const add = (methods, re, service, access, rewrite = (p) => p) => routes.push({ methods, re, service, access, rewrite });
const ANY = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];
// Shared Platform
add(['POST'], /^\/auth\/(otp\/send|otp\/confirm|login|register|register\/practitioner|register\/facility|register\/admin)$/, 'platform', 'public');
add(['POST'], /^\/patients\/register$/, 'platform', 'public');
add(['POST'], /^\/face\/(status|enroll|verify)$/, 'platform', 'public');
add(['GET'], /^\/aadhaar\/demo$/, 'platform', 'public');
add(['POST'], /^\/aadhaar\/fetch$/, 'platform', 'public');
add(['POST'], /^\/abha\/validate$/, 'platform', 'public');
add(['POST'], /^\/auth\/(logout|refresh)$/, 'platform', 'user');
add(['GET'], /^\/me$/, 'platform', 'user');
add(ANY, /^\/doctors(\/.*)?$/, 'platform', 'user');
add(['GET'], /^\/facilities\/[^/]+\/practitioners$/, 'platform', 'user');
add(ANY, /^\/patients\/[^/]+\/(profile|medical-history|health-concerns|consents)$/, 'platform', 'user');
add(ANY, /^\/admin\/.*$/, 'platform', 'user');
// Longitudinal record (timeline + consent-aware patient summary)
add(['GET'], /^\/patients\/[^/]+\/(summary|timeline)$/, 'longitudinal', 'user');
add(ANY, /^\/longitudinal(\/.*)?$/, 'longitudinal', 'user', (p) => p.replace(/^\/longitudinal/, '') || '/');
// Common clinical service
add(ANY, /^\/records(\/.*)?$/, 'clinical', 'user');
add(ANY, /^\/patients\/[^/]+\/(prescriptions|uploads|records)$/, 'clinical', 'user');
add(ANY, /^\/clinical(\/.*)?$/, 'clinical', 'user', (p) => p.replace(/^\/clinical/, '') || '/');
// AYUSH domain services
for (const k of ['ayurveda', 'yoga', 'unani', 'siddha', 'homoeopathy']) add(ANY, new RegExp(`^/${k}(/.*)?$`), k, 'user', (p) => p.replace(new RegExp(`^/${k}`), '') || '/');
add(ANY, /^\/consultations\/.*$/, 'ayurveda', 'user'); // older frontend calls /v1/consultations/... directly
// Integrations
add(['GET'], /^\/whatsapp\/qr$/, 'integrations', 'public');
add(['POST'], /^\/translate$/, 'integrations', 'user');
add(['POST'], /^\/voice\/transcribe$/, 'integrations', 'user');
add(['GET'], /^\/external-healthcare\/status$/, 'integrations', 'user');
add(ANY, /^\/notifications(\/.*)?$/, 'integrations', 'user');

const proxies = {};
const proxyFor = (service) => proxies[service] || (proxies[service] = createProxyMiddleware({
  target: SERVICES[service].url, changeOrigin: false, proxyTimeout: 60000,
  pathRewrite: (p, req) => req._rewritten,
  on: {
    error: (err, req, res) => {
      if (res.headersSent || !res.writeHead) return;
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ message: `${SERVICES[service].title} is not available right now. Please retry in a moment.`, service, requestId: req.id }));
    },
  },
}));

const STRIP = ['x-role', 'x-doctor-id', 'x-admin-id', 'x-facility-id', 'x-identity', 'x-service-token', 'x-user-id'];
const sendErr = (res, status, message, extra = {}) => res.status(status).json({ message, requestId: res.get('X-Request-Id'), ...extra });

// the browser sends a Bearer access token; the Shared Platform checks it (signature, expiry, logout, suspended account) and returns who it is
async function identify(req) {
  const token = (req.get('Authorization') || '').replace(/^Bearer /, '');
  const p = security.verify(token);
  if (!p || p.k !== 'access') return { status: 401, message: 'Please sign in again.' };
  const r = await platform.post('/internal/auth/resolve', { token }, { requestId: req.id, timeout: 5000 });
  if (r.status === 503) return { status: 503, message: 'Sign-in service is not available right now. Please retry.' };
  if (!r.ok) return { status: r.status === 403 ? 403 : 401, message: (r.data && r.data.message) || 'Please sign in again.' };
  return { identity: r.data };
}

app.get('/health', (req, res) => res.json({ service: 'gateway', title: SERVICES.gateway.title, ok: true, time: new Date().toISOString() }));
app.get(['/v1/health', '/api/health'], async (req, res) => { // every service in one call
  const out = {};
  await Promise.all(Object.values(SERVICES).map(async (s) => {
    try { const r = await fetch(`${s.url}/health`, { signal: AbortSignal.timeout(2500) }); out[s.name] = { ok: r.ok, port: s.port, title: s.title }; }
    catch (e) { out[s.name] = { ok: false, port: s.port, title: s.title }; }
  }));
  res.json({ ok: Object.values(out).every((x) => x.ok), services: out });
});

// WhatsApp webhooks / mock sit at the root (no /v1)
app.all(['/whatsapp', '/whatsapp-mock', '/whatsapp-link'], (req, res, next) => {
  req._rewritten = req.originalUrl; return proxyFor('integrations')(req, res, next);
});

app.use(async (req, res, next) => {
  const m = req.path.match(/^\/(?:v1|api)(\/.*)?$/);
  if (!m) return next();
  const p = m[1] || '/';
  if (/^\/internal(\/|$)/.test(p)) return sendErr(res, 404, 'Not found.');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  if (limited(`g:${req.ip}`, GENERAL_LIMIT, 60000)) return sendErr(res, 429, 'Too many requests. Please slow down.');
  const route = routes.find((r) => r.methods.includes(req.method) && r.re.test(p));
  if (!route) return sendErr(res, 404, 'Not found.');
  if (route.access === 'public' && /^\/(auth|face|patients\/register)/.test(p) && limited(`a:${req.ip}`, SENSITIVE_LIMIT, 60000)) return sendErr(res, 429, 'Too many attempts. Please wait a minute.');
  STRIP.forEach((h) => delete req.headers[h]);
  if (route.access === 'user') {
    const id = await identify(req);
    if (!id.identity) return sendErr(res, id.status, id.message);
    req.headers['x-identity'] = security.identityHeader(id.identity);
  }
  req.headers['x-request-id'] = req.id;
  const qs = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
  req._rewritten = route.rewrite(p) + qs;
  return proxyFor(route.service)(req, res, next);
});

// One-port mode: after `npm run build` the gateway also serves the React app.
const DIST = path.join(__dirname, '..', '..', 'dist');
if (fs.existsSync(path.join(DIST, 'index.html'))) {
  app.use(express.static(DIST));
  app.get(/^\/(?!v1\/|api\/|whatsapp).*/, (req, res) => res.sendFile(path.join(DIST, 'index.html')));
}
app.use((req, res) => sendErr(res, 404, 'Not found.'));
app.use((err, req, res, next) => { console.error('[gateway]', err); sendErr(res, 500, 'Server error.'); }); // eslint-disable-line no-unused-vars

app.listen(SERVICES.gateway.port, HOST, () => console.log(`[gateway] ${SERVICES.gateway.title} listening on ${SERVICES.gateway.port}`));
