#!/usr/bin/env node
'use strict';
// Pre-release gate. Never publishes, pushes or tags — it only tells you whether
// the tree is ready, and builds the Agensi ZIP.
//   1. pin agensi/SKILL.md to the package.json version
//   2. run the full test suite
//   3. inspect the npm tarball contents (npm pack --dry-run)
//   4. build dist/global-brain-agensi-<version>.zip and verify it
//   node scripts/release-check.js       (npm run release:check)

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { syncVersion } = require('./sync-version');
const { buildAgensiZip } = require('./build-agensi-zip');

const ROOT = path.resolve(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
let failed = false;
const step = (ok, label, detail) => {
  if (!ok) failed = true;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
};

console.log(`release check for ${pkg.name}@${pkg.version} (node ${process.version})\n`);

// 1. version pin
try {
  const r = syncVersion();
  step(true, 'agensi/SKILL.md version', r.changed ? `updated to ${r.version} (commit it)` : r.version);
} catch (e) { step(false, 'agensi/SKILL.md version', e.message); }

// 2. tests
const t = spawnSync(process.execPath, [path.join(ROOT, 'test', 'run.js')], { cwd: ROOT, encoding: 'utf8', timeout: 600000 });
const summary = ((t.stdout || '').trim().split('\n').pop() || '').trim();
step(t.status === 0, 'tests', summary);
if (t.status !== 0) process.stdout.write(t.stdout + (t.stderr || ''));

// 3. npm tarball contents
const p = spawnSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], { cwd: ROOT, encoding: 'utf8', shell: true });
try {
  const files = JSON.parse(p.stdout)[0].files.map((f) => f.path.replace(/\\/g, '/'));
  const must = ['bin/cli.js', 'bin/sync.js', 'install/init.js', 'install/uninstall.js', 'lib/redact.js', 'lib/sqlite.js', 'SKILL.md', 'config.json', 'README.md', 'LICENSE', 'package.json'];
  const missing = must.filter((f) => !files.includes(f));
  const banned = files.filter((f) => /^(agensi|test|scripts|dist|docs|\.vellum)\/|\.bak$|\.zip$|brain\.db/.test(f));
  step(!missing.length && !banned.length, 'npm package contents',
    missing.length ? `missing ${missing.join(', ')}` : banned.length ? `must not ship ${banned.join(', ')}` : `${files.length} files, agensi/ excluded`);
} catch (e) { step(false, 'npm package contents', `npm pack --dry-run failed: ${e.message} ${p.stderr || ''}`); }

// 4. Agensi ZIP
try {
  const z = buildAgensiZip();
  step(true, 'Agensi ZIP', `${path.relative(ROOT, z.out)} (${z.bytes} bytes, SKILL.md at root)`);
} catch (e) { step(false, 'Agensi ZIP', e.message); }

console.log(failed
  ? '\nNot ready. Fix the failures above.'
  : `\nReady. Nothing was published. Next (manual):\n  git push -u origin HEAD\n  npm publish\n  upload dist/global-brain-agensi-${pkg.version}.zip to Agensi`);
process.exit(failed ? 1 : 0);
