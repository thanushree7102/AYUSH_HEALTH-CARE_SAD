// Every service opens ITS OWN SQLite file through this helper. No service opens another service's file:
// cross-service data goes through the internal HTTP APIs or the event bus.
//   default location : <service folder>/database/<name>.db
//   DATA_ROOT=/tmp/x : <DATA_ROOT>/<service>/<name>.db   (used by the tests so they never touch real data)
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const Database = require('better-sqlite3');

const uuid = () => crypto.randomUUID();
const now = () => new Date().toISOString();

function openDb(dir, file, serviceName) {
  const target = process.env.DATA_ROOT ? path.join(process.env.DATA_ROOT, serviceName || path.basename(path.dirname(dir))) : dir;
  fs.mkdirSync(target, { recursive: true });
  const db = new Database(path.join(target, file));
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 5000');
  db.pragma('foreign_keys = ON');
  db.dir = target;
  // tables every service needs: safe retries (idempotency), reliable event publishing (outbox) and duplicate-event protection
  db.exec(`
    CREATE TABLE IF NOT EXISTS idempotency (key TEXT NOT NULL, route TEXT NOT NULL, status INTEGER NOT NULL, response TEXT NOT NULL, PRIMARY KEY (key, route));
    CREATE TABLE IF NOT EXISTS event_outbox (
      id TEXT PRIMARY KEY, type TEXT NOT NULL, subject TEXT, data TEXT, at TEXT NOT NULL,
      sent INTEGER NOT NULL DEFAULT 0, attempts INTEGER NOT NULL DEFAULT 0, last_error TEXT
    );
    CREATE TABLE IF NOT EXISTS processed_events (id TEXT PRIMARY KEY, type TEXT, at TEXT NOT NULL);
  `);
  return db;
}

module.exports = { openDb, uuid, now };
