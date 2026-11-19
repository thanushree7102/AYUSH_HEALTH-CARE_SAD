// Frontend CI check: runs on the frontend branch alone (no package.json needed).
// 1) every .js/.jsx file must parse (esbuild)  2) every local/alias import must point to a real file.
const fs = require('fs');
const path = require('path');
const cp = require('child_process');

const root = process.cwd();
const files = cp.execSync('git ls-files "*.js" "*.jsx"', { cwd: root }).toString().split('\n').filter(Boolean)
  .filter((f) => !f.startsWith('scripts/') && f !== 'vite.config.js');

// Aliases are read from vite.config.js so they never go out of date.
const cfg = fs.readFileSync(path.join(root, 'vite.config.js'), 'utf8');
const aliases = {};
for (const m of cfg.matchAll(/'(@[a-z]+)':\s*r\('([^']+)'\)/g)) aliases[m[1]] = m[2];

let esbuild;
try { esbuild = require(path.join(process.env.CI_TOOLS || '', 'node_modules', 'esbuild')); } catch { esbuild = require('esbuild'); }

const exists = (base) => ['', '.js', '.jsx', '.json', '.css', '/index.js', '/index.jsx'].some((x) => fs.existsSync(base + x) && fs.statSync(base + x).isFile());
let bad = 0;
for (const f of files) {
  const src = fs.readFileSync(f, 'utf8');
  try { esbuild.transformSync(src, { loader: 'jsx', sourcefile: f }); }
  catch (e) { bad++; console.log(`::error file=${f}::syntax error: ${e.errors?.[0]?.text || e.message}`); continue; }
  for (const m of src.matchAll(/(?:from\s+|import\s*\(\s*|import\s+)['"]([^'"]+)['"]/g)) {
    const spec = m[1];
    let target = null;
    if (spec.startsWith('.')) target = path.resolve(path.dirname(f), spec);
    else { const a = Object.keys(aliases).find((k) => spec === k || spec.startsWith(k + '/')); if (a) target = path.resolve(root, aliases[a], spec.slice(a.length + 1)); }
    if (target && !exists(target)) { bad++; console.log(`::error file=${f}::import '${spec}' does not exist`); }
  }
}
console.log(`checked ${files.length} files, ${bad} problem(s)`);
process.exit(bad ? 1 : 0);