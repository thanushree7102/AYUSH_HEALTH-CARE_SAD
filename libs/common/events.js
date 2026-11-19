// Event publishing / consuming for a service (talks to the Event Bus on port +10).
//  publish():   the event is first written to the service's OWN outbox table (same database), then sent to the bus
//               in the background and retried until the bus accepts it. So an event is never lost if the bus is down.
//  subscribe(): registers this service's /internal/events endpoint with the bus for some event types (retries until the bus is up).
//  handler():   Express handler that de-duplicates by event id (bus delivery is at-least-once).
const crypto = require('crypto');
const security = require('./security');
const { SERVICES } = require('./config');

function createEvents(source, db) {
  const BUS = SERVICES.bus.url;
  let flushing = false;
  const insert = db.prepare('INSERT INTO event_outbox (id,type,subject,data,at) VALUES (?,?,?,?,?)');

  function publish(type, subject, data = {}) {
    const id = crypto.randomUUID();
    insert.run(id, type, subject == null ? null : String(subject), JSON.stringify(data), new Date().toISOString());
    setImmediate(flush);
    return id;
  }

  async function flush() {
    if (flushing) return;
    flushing = true;
    try {
      const rows = db.prepare('SELECT * FROM event_outbox WHERE sent = 0 AND attempts < 40 ORDER BY at LIMIT 50').all();
      for (const e of rows) {
        try {
          const r = await fetch(`${BUS}/publish`, {
            method: 'POST', signal: AbortSignal.timeout(5000),
            headers: { 'Content-Type': 'application/json', 'X-Service-Token': security.serviceToken(source) },
            body: JSON.stringify({ id: e.id, type: e.type, source, subject: e.subject, data: JSON.parse(e.data || '{}') }),
          });
          if (!r.ok) throw new Error(`bus answered ${r.status}`);
          db.prepare('UPDATE event_outbox SET sent = 1 WHERE id = ?').run(e.id);
        } catch (err) {
          db.prepare('UPDATE event_outbox SET attempts = attempts + 1, last_error = ? WHERE id = ?').run(String(err.message).slice(0, 200), e.id);
          break; // bus unreachable: stop this round, try again later (keeps order)
        }
      }
    } finally { flushing = false; }
  }
  const timer = setInterval(flush, 2000); timer.unref();

  async function subscribe(name, url, types) {
    for (let i = 0; i < 60; i++) {
      try {
        const r = await fetch(`${BUS}/subscribe`, {
          method: 'POST', signal: AbortSignal.timeout(4000),
          headers: { 'Content-Type': 'application/json', 'X-Service-Token': security.serviceToken(source) },
          body: JSON.stringify({ name, url, types }),
        });
        if (r.ok) return true;
      } catch (e) { /* bus not up yet */ }
      await new Promise((res) => setTimeout(res, 1000));
    }
    console.error(`[${source}] could not register with the event bus`);
    return false;
  }

  const handler = (fn) => async (req, res) => {
    const e = req.body || {};
    if (!e.id || !e.type) return res.status(400).json({ message: 'Invalid event.' });
    if (db.prepare('SELECT 1 FROM processed_events WHERE id = ?').get(e.id)) return res.json({ ok: true, duplicate: true });
    try {
      await fn(e);
      db.prepare('INSERT OR IGNORE INTO processed_events (id,type,at) VALUES (?,?,?)').run(e.id, e.type, new Date().toISOString());
      return res.json({ ok: true });
    } catch (err) {
      console.error(`[${source}] event ${e.type} failed:`, err.message);
      return res.status(500).json({ message: 'Event handling failed; the bus will retry.' });
    }
  };

  return { publish, flush, subscribe, handler };
}

module.exports = { createEvents };
