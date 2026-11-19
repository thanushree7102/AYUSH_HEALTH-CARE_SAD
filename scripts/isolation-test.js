// Proves the service boundaries: (1) static: only db.js / each service's own server opens a database, nobody requires another service's
// code, (2) runtime: every service creates exactly its own .db file and no table of one service exists in another.
const fs = require('fs'); const os = require('os'); const path = require('path'); const { spawn } = require('child_process');
const Database = require('better-sqlite3');
const { ROOT, PROCESSES } = require('./services');
let fail = 0; const ok = (c, m) => { console.log(`${c ? '✓' : '✗'} ${m}`); if (!c) fail++; };
const files = []; const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).forEach((e) => { if (['node_modules', 'dist', 'src', 'frontend', 'public', 'data', 'database', 'storage', 'docs', 'scripts', '.git'].includes(e.name)) return; const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (e.name.endsWith('.js')) files.push(p); });
walk(ROOT);
const owner = (f) => { const r = path.relative(ROOT, f).split(path.sep); return r[0] === 'services' ? r[1] : r[0] === 'libs' ? 'libs' : r[0]; };
let cross = 0; let dbOpen = 0;
for (const f of files) {
  const src = fs.readFileSync(f, 'utf8'); const o = owner(f);
  for (const m of src.matchAll(/require\((['"`])(\.[^'"`]+)\1\)/g)) {
    const target = path.resolve(path.dirname(f), m[2]);
    const t = owner(target + '.js');
    if (t !== o && t !== 'libs' && !(o === 'integrations' && t === 'integrations')) { cross++; console.log('  cross-service require:', path.relative(ROOT, f), '->', m[2]); }
  }
  if (/new Database\(/.test(src) && !f.endsWith(path.join('libs', 'common', 'db.js'))) { dbOpen++; console.log('  opens a database directly:', path.relative(ROOT, f)); }
}
ok(cross === 0, 'no service requires code of another service (only libs/common)');
ok(dbOpen === 0, 'databases are only opened through libs/common/db.js (openDb, one file per service)');
const dbSrc = files.filter((f) => /openDb\(/.test(fs.readFileSync(f, 'utf8')) && !f.endsWith('db.js')).length;
ok(dbSrc >= 4, `${dbSrc} code paths call openDb (one file per service; the 5 AYUSH services share the builder, each with its own file)`);

(async () => {
  const DATA_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'ayush-iso-')); const PORT_BASE = 5900 + Math.floor(Math.random() * 20) * 20;
  const env = { ...process.env, DATA_ROOT, PORT_BASE: String(PORT_BASE), OTP_CODE: '123456', AYUSH_SECRET: 'iso' };
  const kids = PROCESSES.map(([, f]) => spawn(process.execPath, [f], { cwd: ROOT, env, stdio: 'ignore' }));
  await new Promise((r) => setTimeout(r, 7000));
  kids.forEach((k) => k.kill());
  await new Promise((r) => setTimeout(r, 800));
  const dbs = {};
  for (const d of fs.readdirSync(DATA_ROOT)) for (const f of fs.readdirSync(path.join(DATA_ROOT, d))) if (f.endsWith('.db')) {
    const db = new Database(path.join(DATA_ROOT, d, f), { readonly: true });
    dbs[`${d}/${f}`] = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name).filter((n) => !['idempotency', 'event_outbox', 'processed_events', 'sqlite_sequence'].includes(n));
    db.close();
  }
  console.log('  databases:', Object.keys(dbs).join(', '));
  ok(Object.keys(dbs).length >= 8, `each service created its own database file (${Object.keys(dbs).length})`);
  const seen = {}; let dup = 0;
  for (const [k, tables] of Object.entries(dbs)) for (const t of tables) { if (seen[t]) { dup++; console.log(`  table "${t}" exists in both ${seen[t]} and ${k}`); } else seen[t] = k; }
  ok(dup === 0, 'no table name is shared between two service databases (no shared schema)');
  const plat = dbs['shared-platform/platform.db'] || [];
  ok(plat.length && !plat.some((t) => ['encounters', 'prescriptions', 'patient_records', 'ayurveda_parts'].includes(t)), 'Shared Platform database holds no clinical tables');
  const clin = Object.entries(dbs).find(([k]) => /clinical/.test(k));
  ok(clin && !clin[1].some((t) => ['patients', 'user_accounts', 'doctors', 'consent_records'].includes(t)), 'Clinical database holds no identity / consent tables (only patient ids)');
  try { fs.rmSync(DATA_ROOT, { recursive: true, force: true }); } catch (e) { /* ignore */ }
  console.log(fail ? `\n${fail} failed` : '\nall isolation checks passed'); process.exit(fail ? 1 : 0);
})();
