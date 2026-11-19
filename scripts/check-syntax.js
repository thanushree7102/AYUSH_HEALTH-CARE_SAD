// node --check on every backend file (fast sanity check without starting anything).
const { execFileSync } = require('child_process');
const fs = require('fs'); const path = require('path');
const ROOT = path.resolve(__dirname, '..'); let n = 0, bad = 0;
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).forEach((e) => {
  if (['node_modules', 'dist', 'src', 'frontend', 'public', '.git', 'data', 'database', 'storage'].includes(e.name)) return;
  const p = path.join(d, e.name);
  if (e.isDirectory()) walk(p);
  else if (e.name.endsWith('.js')) { n++; try { execFileSync(process.execPath, ['--check', p], { stdio: 'pipe' }); } catch (err) { bad++; console.log('SYNTAX ERROR', path.relative(ROOT, p), String(err.stderr).split('\n')[0]); } }
});
walk(ROOT); console.log(`${n} files checked, ${bad} with errors`); process.exit(bad ? 1 : 0);
