// Service-to-service HTTP client. Every call carries a short-lived signed service token; the receiving service
// accepts /internal/* only with it. Calls never throw: they return { ok, status, data } (503 when the service is down).
const security = require('./security');
const { SERVICES } = require('./config');

async function call(service, method, path, { body, identity, timeout = 8000, requestId } = {}) {
  const s = SERVICES[service];
  const headers = { 'X-Service-Token': security.serviceToken(process.env.SERVICE_NAME || 'unknown') };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (identity) headers['X-Identity'] = security.identityHeader(identity);
  if (requestId) headers['X-Request-Id'] = requestId;
  try {
    const r = await fetch(s.url + path, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(timeout) });
    let data = null;
    try { data = await r.json(); } catch (e) { /* empty body */ }
    return { ok: r.ok, status: r.status, data };
  } catch (e) {
    return { ok: false, status: 503, data: { message: `${s.title} is not reachable right now.` } };
  }
}
const client = (service) => ({
  get: (path, o) => call(service, 'GET', path, o),
  post: (path, body, o) => call(service, 'POST', path, { ...o, body: body === undefined ? {} : body }),
  put: (path, body, o) => call(service, 'PUT', path, { ...o, body: body === undefined ? {} : body }),
  del: (path, o) => call(service, 'DELETE', path, o),
});

const platform = client('platform');
const clinical = client('clinical');
const longitudinal = client('longitudinal');
const integrations = client('integrations');
const svc = client;

// "May this person read/write this patient's data for this AYUSH system?" Identity and consent live in the Shared Platform,
// so every other service asks it. -> { allowed, reason, patient, systems } (never throws)
async function checkAccess(req, { patient, system = null, mode = 'read' }) {
  const r = await platform.post('/internal/access/check', { patient, actor: req.user, system, mode }, { requestId: req.id });
  if (r.status === 503) return { allowed: false, unavailable: true, reason: r.data.message };
  return r.ok ? r.data : { allowed: false, status: r.status, reason: (r.data && r.data.message) || 'Not allowed.' };
}
// Audit log is owned by the Shared Platform. Fire and forget: a failed audit call never breaks the request.
function audit(req, { action, type = null, ref = null, result = 'Success', reason = null, actor = null }) {
  return platform.post('/internal/audit', { actor: actor || (req && req.user && req.user.userId) || null, action, type, ref, result, reason, ip: req && req.ip }, { requestId: req && req.id }).catch(() => {});
}

module.exports = { call, client, svc, platform, clinical, longitudinal, integrations, checkAccess, audit };
