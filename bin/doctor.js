#!/usr/bin/env node
'use strict';
// `global-brain doctor` — health check for the installed brain. Verifies the
// runtime, that the engine + skill are in place, that the SessionStart/Stop hooks,
// status line and digest @-import are wired, and that the database is readable. Prints a
// checklist; exits 1 only on a hard failure (so it's CI-friendly).

const fs = require('fs');
const path = require('path');
const os = require('os');
const { checkSqlite } = require('../lib/preflight');
const U = require('../lib/update-check');

const HOME = os.homedir();
const CLAUDE_DIR = process.env.CLAUDE_CONFIG_DIR || path.join(HOME, '.claude');
const BASE = path.join(CLAUDE_DIR, 'global-brain');
const SETTINGS = path.join(CLAUDE_DIR, 'settings.json');
const CLAUDE_MD = path.join(CLAUDE_DIR, 'CLAUDE.md');
const SKILL = path.join(CLAUDE_DIR, 'skills', 'global-brain', 'SKILL.md');
const SYNC = path.join(BASE, 'bin', 'sync.js');

const G = (s) => `\x1b[32m${s}\x1b[0m`;
const Y = (s) => `\x1b[33m${s}\x1b[0m`;
const R = (s) => `\x1b[31m${s}\x1b[0m`;
let hardFail = false;
const line = (status, label, detail) => {
  const mark = status === 'pass' ? G('PASS') : status === 'warn' ? Y('WARN') : R('FAIL');
  if (status === 'fail') hardFail = true;
  console.log(`  [${mark}] ${label}${detail ? ` — ${detail}` : ''}`);
};

function readJson(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; }
}

function hookWired(settings, event) {
  const arr = (settings && settings.hooks && settings.hooks[event]) || [];
  return arr.some((g) => (g.hooks || []).some((h) =>
    typeof h.command === 'string' && h.command.includes('global-brain') && h.command.includes('sync.js')));
}

console.log(`\nglobal-brain doctor — config dir: ${CLAUDE_DIR}\n`);

// 1. runtime
const sq = checkSqlite();
line(sq.ok ? 'pass' : 'fail', `Node runtime (${process.version})`, sq.ok ? 'node:sqlite OK' : sq.reason);

// 2. engine files
line(fs.existsSync(SYNC) ? 'pass' : 'fail', 'Engine installed', fs.existsSync(SYNC) ? BASE : `missing — run \`global-brain init\``);

// 3. skill
line(fs.existsSync(SKILL) ? 'pass' : 'warn', 'Skill (SKILL.md)', fs.existsSync(SKILL) ? null : 'not found — /global-brain command unavailable');

// 4. hooks
const settings = readJson(SETTINGS);
if (!settings) {
  line(fs.existsSync(SETTINGS) ? 'fail' : 'warn', 'Hooks (settings.json)', fs.existsSync(SETTINGS) ? 'settings.json unparseable' : 'settings.json missing');
} else {
  const ss = hookWired(settings, 'SessionStart');
  const st = hookWired(settings, 'Stop');
  line(ss && st ? 'pass' : 'fail', 'Hooks (SessionStart + Stop)',
    ss && st ? 'auto-sync wired' : `missing ${[!ss && 'SessionStart', !st && 'Stop'].filter(Boolean).join(' + ')} — run \`global-brain init\``);
}

// 5. status line (carries the "update available" segment; wraps the user's own)
if (settings) {
  const sl = settings.statusLine;
  const ours = sl && typeof sl.command === 'string' &&
    sl.command.includes('global-brain') && sl.command.includes('statusline.js');
  if (ours) {
    const m = sl.command.match(/"([^"]*statusline\.js)"/) || sl.command.match(/(\S*statusline\.js)/);
    const script = m ? m[1] : null;
    let wrap = '';
    try { wrap = (JSON.parse(fs.readFileSync(path.join(BASE, 'config.json'), 'utf8')).statusLineWrap || '').trim(); } catch {}
    if (script && !fs.existsSync(script)) {
      line('fail', 'Status line (settings.json)', `points at missing ${script} — run \`global-brain init\``);
    } else {
      line('pass', 'Status line (settings.json)', wrap ? `update segment wired, wrapping: ${wrap}` : 'update segment wired');
    }
  } else if (sl) {
    line('warn', 'Status line (settings.json)', 'another status line is set — run `global-brain init` to wrap it with the update segment');
  } else {
    line('warn', 'Status line (settings.json)', 'not wired — update notice won\'t show in the status row; run `global-brain init`');
  }
}

// 6. digest import
let mdHas = false;
try { mdHas = fs.readFileSync(CLAUDE_MD, 'utf8').includes('@global-brain.md'); } catch {}
line(mdHas ? 'pass' : 'warn', 'Digest import (CLAUDE.md)', mdHas ? '@global-brain.md present' : 'not imported — digest won\'t load into sessions');

// 7. database
if (sq.ok) {
  try {
    const D = require('../lib/db');
    const db = D.open(true);
    const c = D.counts(db);
    const last = D.getMeta(db, 'lastSync', null);
    db.close();
    line('pass', 'Database (brain.db)', `${c.total} entries across ${c.byProject.length} project(s)${last ? `, last sync ${last}` : ''}`);
  } catch (e) {
    line('warn', 'Database (brain.db)', `not initialized yet — run \`global-brain sync\` (${e.message})`);
  }
}

console.log(hardFail
  ? `\n${R('Some checks failed.')} Run \`global-brain init\` to (re)wire, then restart Claude Code.\n`
  : `\n${G('All good.')} The brain is wired and healthy.\n`);

try {
  let version = 'unknown';
  try { version = require('../package.json').version; } catch {}
  U.refresh();
  const n = U.notice(version);
  if (n) console.log(`  ${Y('↑ ' + n)}\n`);
} catch {}

process.exit(hardFail ? 1 : 0);
