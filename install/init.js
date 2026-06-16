#!/usr/bin/env node
'use strict';
// Materializes the global-brain skill into a Claude Code config dir and wires it
// up: copies the engine into ~/.claude/global-brain, installs the SKILL.md,
// registers the SessionStart + Stop sync hooks, ensures the digest @-import in
// CLAUDE.md, and runs one initial sync. Fully idempotent — safe to re-run on
// every upgrade. Never deletes brain.db or user-edited config.json.

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

const PKG_ROOT = path.resolve(__dirname, '..');
const HOME = os.homedir();
const CLAUDE_DIR = process.env.CLAUDE_CONFIG_DIR || path.join(HOME, '.claude');
const BASE = path.join(CLAUDE_DIR, 'global-brain');
const SKILL_DIR = path.join(CLAUDE_DIR, 'skills', 'global-brain');
const SETTINGS = path.join(CLAUDE_DIR, 'settings.json');
const CLAUDE_MD = path.join(CLAUDE_DIR, 'CLAUDE.md');
const DIGEST_IMPORT = '@global-brain.md';
const SYNC_PATH = path.join(BASE, 'bin', 'sync.js');
const STATUSLINE_PATH = path.join(BASE, 'bin', 'statusline.js');

const log = (m) => console.log(`global-brain init: ${m}`);

// Write through a temp file + rename so a crash mid-write can never leave a
// half-written settings.json — the rename is atomic on the same filesystem.
function writeAtomic(file, data) {
  const tmp = `${file}.gb-tmp`;
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, file);
}

function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name);
    const d = path.join(dst, e.name);
    if (e.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

function ensureEngine() {
  fs.mkdirSync(BASE, { recursive: true });
  copyDir(path.join(PKG_ROOT, 'bin'), path.join(BASE, 'bin'));
  copyDir(path.join(PKG_ROOT, 'lib'), path.join(BASE, 'lib'));
  // Stamp the version into the wired engine so `--version` / the update check
  // resolve correctly when the copied bin is invoked directly (not via the npm bin).
  try { fs.copyFileSync(path.join(PKG_ROOT, 'package.json'), path.join(BASE, 'package.json')); } catch {}
  // config.json: never clobber a user-tuned config
  const cfg = path.join(BASE, 'config.json');
  if (!fs.existsSync(cfg)) fs.copyFileSync(path.join(PKG_ROOT, 'config.json'), cfg);
  log(`engine -> ${BASE}`);
}

function ensureSkill() {
  fs.mkdirSync(SKILL_DIR, { recursive: true });
  fs.copyFileSync(path.join(PKG_ROOT, 'SKILL.md'), path.join(SKILL_DIR, 'SKILL.md'));
  log(`skill  -> ${SKILL_DIR}`);
}

function syncHookGroup() {
  return { hooks: [{ type: 'command', command: `node "${SYNC_PATH}"`, timeout: 20 }] };
}

function hookAlreadyWired(arr) {
  return (arr || []).some((g) =>
    (g.hooks || []).some((h) => typeof h.command === 'string' && h.command.includes('global-brain') && h.command.includes('sync.js')));
}

function ensureHooks() {
  let settings = {};
  if (fs.existsSync(SETTINGS)) {
    try { settings = JSON.parse(fs.readFileSync(SETTINGS, 'utf8')); }
    catch (e) { log(`WARNING: settings.json unparseable (${e.message}); skipping hook wiring`); return; }
  }
  settings.hooks = settings.hooks || {};
  let changed = false;
  for (const event of ['SessionStart', 'Stop']) {
    settings.hooks[event] = settings.hooks[event] || [];
    if (!hookAlreadyWired(settings.hooks[event])) {
      settings.hooks[event].push(syncHookGroup());
      changed = true;
    }
  }
  if (changed) {
    writeAtomic(SETTINGS, JSON.stringify(settings, null, 2) + '\n');
    log('hooks  -> SessionStart + Stop registered');
  } else {
    log('hooks  -> already registered');
  }
}

// Wire the status line so the green "update available" segment renders in the
// colored bottom row. Idempotent and non-destructive: any pre-existing status line
// (e.g. caveman) is preserved as `statusLineWrap` in config.json and re-run by our
// wrapper, so we add a segment without replacing the user's status line. Our
// wrapper needs no caveman — with no wrap it just prints its own segment.
function ensureStatusLine() {
  let settings = {};
  if (fs.existsSync(SETTINGS)) {
    try { settings = JSON.parse(fs.readFileSync(SETTINGS, 'utf8')); }
    catch (e) { log(`WARNING: settings.json unparseable (${e.message}); skipping statusline`); return; }
  }
  const cur = settings.statusLine;
  const isOurs = cur && typeof cur.command === 'string' &&
    cur.command.includes('global-brain') && cur.command.includes('statusline.js');
  if (isOurs) { log('statusline -> already wrapped'); return; }

  const wrap = cur && cur.type === 'command' && typeof cur.command === 'string' ? cur.command : '';
  const cfgPath = path.join(BASE, 'config.json');
  let cfg = {};
  try { cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8')); } catch {}
  cfg.statusLineWrap = wrap;
  writeAtomic(cfgPath, JSON.stringify(cfg, null, 2) + '\n');

  settings.statusLine = { type: 'command', command: `node "${STATUSLINE_PATH}"` };
  writeAtomic(SETTINGS, JSON.stringify(settings, null, 2) + '\n');
  log(wrap ? 'statusline -> wrapped existing + update segment' : 'statusline -> update segment');
}

function ensureDigestImport() {
  let body = '';
  if (fs.existsSync(CLAUDE_MD)) body = fs.readFileSync(CLAUDE_MD, 'utf8');
  if (body.includes(DIGEST_IMPORT)) { log('import -> already present in CLAUDE.md'); return; }
  const block = `\n# Global Brain (cross-project memory)\n\n${DIGEST_IMPORT}\n`;
  writeAtomic(CLAUDE_MD, body + block);
  log('import -> @global-brain.md added to CLAUDE.md');
}

function initialSync() {
  const r = spawnSync(process.execPath, [SYNC_PATH, '--report'], { stdio: 'inherit' });
  if (r.status !== 0) log('initial sync skipped (non-fatal)');
}

function main() {
  log(`config dir: ${CLAUDE_DIR}`);
  ensureEngine();
  ensureSkill();
  ensureHooks();
  ensureStatusLine();
  ensureDigestImport();
  initialSync();
  log('done. Restart Claude Code (or start a new session) to load the digest.');
}

try { main(); }
catch (e) { console.error(`global-brain init failed: ${e.message}`); process.exit(1); }
