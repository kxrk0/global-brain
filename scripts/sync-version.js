#!/usr/bin/env node
'use strict';
// Pins the Agensi skill's install command to the package.json version:
//   npm install -g @kxrk0/global-brain@X.Y.Z
// Runs from `npm version` (lifecycle) and `npm run release:check`.
//   node scripts/sync-version.js           rewrite agensi/SKILL.md when it drifted
//   node scripts/sync-version.js --check   exit 1 on drift, write nothing

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SKILL = path.join(ROOT, 'agensi', 'SKILL.md');
const PIN = /@kxrk0\/global-brain@(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)/g;

function syncVersion({ check = false } = {}) {
  const version = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
  const body = fs.readFileSync(SKILL, 'utf8');
  const found = [...body.matchAll(PIN)].map((m) => m[1]);
  if (!found.length) throw new Error('agensi/SKILL.md has no @kxrk0/global-brain@<version> pin');
  const stale = found.filter((v) => v !== version);
  if (!stale.length) return { version, changed: false };
  if (check) return { version, changed: false, stale };
  fs.writeFileSync(SKILL, body.replace(PIN, `@kxrk0/global-brain@${version}`));
  return { version, changed: true, stale };
}

module.exports = { syncVersion };

if (require.main === module) {
  const check = process.argv.includes('--check');
  try {
    const r = syncVersion({ check });
    if (r.stale && check) {
      console.error(`agensi/SKILL.md pins ${[...new Set(r.stale)].join(', ')}, package.json is ${r.version}`);
      process.exit(1);
    }
    console.log(r.changed ? `agensi/SKILL.md -> ${r.version}` : `agensi/SKILL.md already at ${r.version}`);
  } catch (e) { console.error(`sync-version: ${e.message}`); process.exit(1); }
}
