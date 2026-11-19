// Starts every service as its own process (bus first, gateway last). Ctrl+C stops all of them.
//   node scripts/dev-all.js               services + Vite frontend (npm run dev)
//   node scripts/dev-all.js --no-frontend services only (npm start; the gateway serves dist/ if you ran npm run build)
const { spawn } = require('child_process');
const { ROOT, PROCESSES } = require('./services');
const kids = [];
const colors = [36, 32, 33, 35, 34, 31, 96, 92, 93, 95, 94, 91];
const run = (name, cmd, args, i) => {
  const p = spawn(cmd, args, { cwd: ROOT, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
  const tag = `\x1b[${colors[i % colors.length]}m[${name}]\x1b[0m `;
  const out = (d) => String(d).split('\n').filter(Boolean).forEach((l) => console.log(tag + l));
  p.stdout.on('data', out); p.stderr.on('data', out);
  p.on('exit', (c) => console.log(`${tag}exited (${c})`));
  kids.push(p);
};
PROCESSES.forEach(([n, f], i) => run(n, process.execPath, [f], i));
if (!process.argv.includes('--no-frontend')) {
  // find Vite's launcher without relying on a deep import (newer Vite versions do not export 'vite/bin/vite.js')
  const path = require('path');
  const viteBin = path.join(path.dirname(require.resolve('vite/package.json')), 'bin', 'vite.js');
  run('frontend', process.execPath, [viteBin, '--host', '0.0.0.0'], 11);
}
const stop = () => { kids.forEach((k) => k.kill()); process.exit(0); };
process.on('SIGINT', stop); process.on('SIGTERM', stop);
