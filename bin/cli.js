#!/usr/bin/env node
'use strict';
// Unified CLI for global-brain. Dispatches to the verb scripts so the published
// package exposes a single `global-brain <verb>` entry point on PATH.

const path = require('path');
const { spawnSync } = require('child_process');
const { checkSqlite } = require('../lib/preflight');

const VERBS = {
  init: '../install/init.js',
  doctor: 'doctor.js',
  sync: 'sync.js',
  query: 'query.js',
  remember: 'remember.js',
  forget: 'forget.js',
  stats: 'stats.js',
};

// Verbs that touch the SQLite brain. `init`/`doctor` run regardless so they can
// repair or report a broken runtime.
const NEEDS_SQLITE = new Set(['sync', 'query', 'remember', 'forget', 'stats']);

function usage() {
  console.log(`global-brain — cross-project persistent memory for Claude Code

Usage:
  global-brain init                 wire the brain into ~/.claude (hooks + skill + digest import)
  global-brain doctor               health-check the install (runtime, hooks, import, db)
  global-brain sync [--report]      ingest Claude Code transcripts, re-render the digest
  global-brain stats                show entry counts per project/type
  global-brain query <terms>        search the brain   [--project P] [--limit N]
  global-brain remember <text>      add a fact         [--project P --type T --title .. --body .. --global --pin]
  global-brain forget <id>          delete an entry    [--pin <id> | --unpin <id> | --global <id>]

Data lives at ~/.claude/global-brain/brain.db (override base with CLAUDE_CONFIG_DIR).`);
}

function version() {
  try { console.log(require('../package.json').version); }
  catch { console.log('unknown'); }
}

const [verb, ...rest] = process.argv.slice(2);

if (!verb || verb === '-h' || verb === '--help' || verb === 'help') {
  usage();
  process.exit(0);
}
if (verb === '-v' || verb === '--version' || verb === 'version') {
  version();
  process.exit(0);
}

const target = VERBS[verb];
if (!target) {
  console.error(`global-brain: unknown command "${verb}"\n`);
  usage();
  process.exit(1);
}

if (NEEDS_SQLITE.has(verb)) {
  const sq = checkSqlite();
  if (!sq.ok) {
    console.error(`global-brain: ${sq.reason}`);
    process.exit(1);
  }
}

const script = path.resolve(__dirname, target);
const r = spawnSync(process.execPath, [script, ...rest], { stdio: 'inherit' });
process.exit(r.status == null ? 1 : r.status);
