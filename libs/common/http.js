// Common Express setup for every service: request id, JSON body, consistent errors, /health, identity + service auth.
// Error body everywhere: { message, errors?, requestId }
const express = require('express');
const crypto = require('crypto');
const multer = require('multer');
const security = require('./security');
const { SERVICES, HOST } = require('./config');

function createService(name, { json = true, jsonLimit = '2mb' } = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 'loopback');
  app.use((req, res, next) => {
    req.id = req.get('X-Request-Id') || crypto.randomUUID();
    res.set('X-Request-Id', req.id);
    next();
  });
  if (json) app.use(express.json({ limit: jsonLimit, verify: (req, res, buf) => { req.rawBody = buf; } }));
  app.get('/health', (req, res) => res.json({ service: name, title: SERVICES[name] && SERVICES[name].title, ok: true, time: new Date().toISOString() }));
  return app;
}

// 404 + error handler. Call LAST, after all routes.
function finish(app, name) {
  app.use((req, res) => res.status(404).json({ message: 'Not found.', requestId: req.id }));
  app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
    if (err.type === 'entity.parse.failed') return res.status(400).json({ message: 'Invalid JSON.', requestId: req.id });
    if (err instanceof multer.MulterError) {
      if (req.file) require('fs').unlink(req.file.path, () => {});
      const msg = err.code === 'LIMIT_FILE_SIZE' ? 'File is larger than 10 MB.' : err.code === 'LIMIT_UNEXPECTED_FILE' ? (err.field || 'Only PDF, JPG or PNG files are allowed.') : err.message;
      return res.status(400).json({ message: msg, requestId: req.id });
    }
    console.error(`[${name}] ${req.id}`, err);
    return res.status(500).json({ message: 'Server error.', requestId: req.id });
  });
}

function listen(app, name) {
  const s = SERVICES[name];
  return app.listen(s.port, HOST, () => console.log(`[${name}] ${s.title} listening on ${s.port}`));
}

const forbid = (res, msg = 'Forbidden') => res.status(403).json({ message: msg });
const invalid = (res, errors, message = 'Please check the highlighted fields.') => res.status(400).json({ message, errors });

// Identity comes ONLY from the signed X-Identity header that the gateway adds after it verified the user's access token.
// X-Role / X-Doctor-Id / X-Admin-Id sent by a browser are never read anywhere.
function authenticate(req, res, next) {
  const p = security.readIdentity(req.get('X-Identity'));
  if (!p) return res.status(401).json({ message: 'Please sign in again.', requestId: req.id });
  req.user = p;
  return next();
}
const requireRole = (...roles) => (req, res, next) => (req.user && roles.includes(req.user.role) ? next() : forbid(res, `Only ${roles.join(' / ')} can do this.`));

// Internal endpoints (/internal/*): callable only by another service holding a signed service token.
function serviceOnly(req, res, next) {
  const p = security.verifyService(req.get('X-Service-Token'));
  if (!p) return res.status(401).json({ message: 'Service authentication required.', requestId: req.id });
  req.service = p.s;
  return next();
}

// Idempotency-Key support (safe retries): a repeated key returns the first answer and creates nothing new.
function idem(db) {
  const g = db.prepare('SELECT * FROM idempotency WHERE key=? AND route=?');
  const s = db.prepare('INSERT OR REPLACE INTO idempotency VALUES (?,?,?,?)');
  return {
    get: (key, route) => (key ? g.get(key, route) : null),
    set: (key, route, status, out) => { if (key) s.run(key, route, status, JSON.stringify(out)); },
  };
}

module.exports = { createService, finish, listen, forbid, invalid, authenticate, requireRole, serviceOnly, idem };
