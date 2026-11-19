// Event Bus (port 5010): durable publish/subscribe over HTTP.
//  - services POST /publish {id,type,source,subject,data}; the bus stores the event, then delivers it to every
//    subscriber whose type list matches ("clinical.record.created", "clinical.*", "*")
//  - subscribers register with POST /subscribe {name,url,types}; subscriptions are persisted
//  - delivery is at-least-once with exponential back-off; subscribers de-duplicate on the event id
//  - only services (service token) may publish / subscribe / read
try { require('dotenv').config(); } catch (e) { /* optional */ }
process.env.SERVICE_NAME = 'bus';
const path = require('path');
const { createService, finish, listen, serviceOnly } = require('../../libs/common/http');
const { openDb } = require('../../libs/common/db');
const security = require('../../libs/common/security');

const db = openDb(path.join(__dirname, '..', 'database'), 'event-bus.db', 'event-bus');
db.exec(`
  CREATE TABLE IF NOT EXISTS events (id TEXT PRIMARY KEY, type TEXT NOT NULL, source TEXT, subject TEXT, data TEXT, at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS subscriptions (name TEXT PRIMARY KEY, url TEXT NOT NULL, types TEXT NOT NULL, updated_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS deliveries (
    event_id TEXT NOT NULL, subscriber TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','delivered','failed')),
    attempts INTEGER NOT NULL DEFAULT 0, next_at INTEGER NOT NULL DEFAULT 0, last_error TEXT, delivered_at TEXT,
    PRIMARY KEY (event_id, subscriber)
  );
`);
const BACKOFF = [500, 1000, 2000, 5000, 15000, 30000, 60000, 120000, 300000];
const MAX_ATTEMPTS = 30;
const matches = (types, t) => types.some((x) => x === '*' || x === t || (x.endsWith('.*') && t.startsWith(x.slice(0, -1))));

const app = createService('bus');
app.post('/publish', serviceOnly, (req, res) => {
  const e = req.body || {};
  if (!e.id || !e.type) return res.status(400).json({ message: 'id and type are required.' });
  const at = new Date().toISOString();
  const fresh = db.transaction(() => {
    const r = db.prepare('INSERT OR IGNORE INTO events (id,type,source,subject,data,at) VALUES (?,?,?,?,?,?)').run(e.id, e.type, e.source || req.service, e.subject == null ? null : String(e.subject), JSON.stringify(e.data || {}), at);
    if (!r.changes) return false; // already stored: a retried publish
    for (const s of db.prepare('SELECT * FROM subscriptions').all()) {
      if (matches(JSON.parse(s.types), e.type) && s.name !== (e.source || req.service)) db.prepare('INSERT OR IGNORE INTO deliveries (event_id,subscriber) VALUES (?,?)').run(e.id, s.name);
    }
    return true;
  })();
  setImmediate(deliver);
  return res.status(fresh ? 201 : 200).json({ ok: true, duplicate: !fresh });
});

app.post('/subscribe', serviceOnly, (req, res) => {
  const { name, url, types } = req.body || {};
  if (!name || !/^https?:\/\//.test(url || '') || !Array.isArray(types) || !types.length) return res.status(400).json({ message: 'name, url and types[] are required.' });
  db.prepare('INSERT INTO subscriptions (name,url,types,updated_at) VALUES (?,?,?,?) ON CONFLICT(name) DO UPDATE SET url=excluded.url, types=excluded.types, updated_at=excluded.updated_at')
    .run(name, url, JSON.stringify(types), new Date().toISOString());
  return res.json({ ok: true });
});

app.get('/subscriptions', serviceOnly, (req, res) => res.json(db.prepare('SELECT name,url,types FROM subscriptions').all().map((s) => ({ ...s, types: JSON.parse(s.types) }))));
app.get('/events', serviceOnly, (req, res) => res.json(db.prepare('SELECT id,type,source,subject,at FROM events ORDER BY at DESC LIMIT ?').all(Math.min(+req.query.limit || 50, 500))));
app.get('/deliveries', serviceOnly, (req, res) => res.json(db.prepare('SELECT * FROM deliveries WHERE (? IS NULL OR status = ?) ORDER BY rowid DESC LIMIT 200').all(req.query.status || null, req.query.status || null)));
app.get('/stats', serviceOnly, (req, res) => res.json(db.prepare('SELECT status, COUNT(*) n FROM deliveries GROUP BY status').all()));

let busy = false;
async function deliver() {
  if (busy) return;
  busy = true;
  try {
    const due = db.prepare(`SELECT d.event_id, d.subscriber, d.attempts, e.id, e.type, e.source, e.subject, e.data, s.url
      FROM deliveries d JOIN events e ON e.id = d.event_id JOIN subscriptions s ON s.name = d.subscriber
      WHERE d.status = 'pending' AND d.next_at <= ? ORDER BY e.at LIMIT 100`).all(Date.now());
    // events for the same subscriber are delivered in order, one after another; different subscribers in parallel
    const bySub = {};
    due.forEach((d) => { (bySub[d.subscriber] = bySub[d.subscriber] || []).push(d); });
    await Promise.all(Object.values(bySub).map(async (list) => {
      for (const d of list) {
        try {
          const r = await fetch(d.url, {
            method: 'POST', signal: AbortSignal.timeout(8000),
            headers: { 'Content-Type': 'application/json', 'X-Service-Token': security.serviceToken('bus') },
            body: JSON.stringify({ id: d.id, type: d.type, source: d.source, subject: d.subject, data: JSON.parse(d.data || '{}') }),
          });
          if (!r.ok) throw new Error(`subscriber answered ${r.status}`);
          db.prepare(`UPDATE deliveries SET status='delivered', delivered_at=?, attempts=attempts+1 WHERE event_id=? AND subscriber=?`).run(new Date().toISOString(), d.event_id, d.subscriber);
        } catch (err) {
          const attempts = d.attempts + 1;
          db.prepare(`UPDATE deliveries SET attempts=?, next_at=?, last_error=?, status=? WHERE event_id=? AND subscriber=?`)
            .run(attempts, Date.now() + BACKOFF[Math.min(attempts - 1, BACKOFF.length - 1)], String(err.message).slice(0, 200), attempts >= MAX_ATTEMPTS ? 'failed' : 'pending', d.event_id, d.subscriber);
          break; // keep order: do not skip ahead past a failing event for this subscriber
        }
      }
    }));
  } finally { busy = false; }
}
setInterval(deliver, 500).unref();

finish(app, 'bus');
listen(app, 'bus');
