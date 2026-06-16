#!/usr/bin/env node
'use strict';
// statusLine command: renders the bottom status row. Fast, network-free.
//
// Behavior — deliberately simple (no width math, no right-alignment, which can't be
// done reliably since Claude Code doesn't pass the terminal width to status line
// commands):
//   • update available  → OUR green notice takes the whole row; the wrapped status
//                          line (e.g. caveman) is hidden until the user updates.
//   • up to date         → the wrapped status line passes through verbatim.
// So the hint is loud while it matters, then disappears on its own once updated,
// handing the row back to caveman. Standalone: with no wrapped command it just
// prints its own notice (or nothing). NEVER does network, NEVER throws out.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const GREEN = '\x1b[32m';
const DIM = '\x1b[2m';
const RESET = '\x1b[0m';

function readStdin() {
  try { return fs.readFileSync(0, 'utf8'); } catch { return ''; }
}

function base() {
  try { return require('../lib/db').paths().base; }
  catch { return path.join(process.env.CLAUDE_CONFIG_DIR || path.join(require('os').homedir(), '.claude'), 'global-brain'); }
}

function loadConfig() {
  try { return JSON.parse(fs.readFileSync(path.join(base(), 'config.json'), 'utf8')); } catch { return {}; }
}

function currentVersion() {
  try { return require('../package.json').version; } catch { return '0.0.0'; }
}

// Cache-only: the newer version if one was seen, else null. No network.
function latestUpdate() {
  try {
    if (process.env.GLOBAL_BRAIN_NO_UPDATE_CHECK === '1') return null;
    const U = require('../lib/update-check');
    const cache = JSON.parse(fs.readFileSync(path.join(base(), 'update-check.json'), 'utf8'));
    const latest = cache && cache.latest;
    if (latest && U._cmp(latest, currentVersion()) > 0) return latest;
  } catch {}
  return null;
}

// Split a command string into argv, honoring quoted segments. Spawned directly
// (no shell) so Windows backslash paths survive — routing through cmd.exe strips
// them and the wrapped command silently fails.
function parseCommand(s) {
  const out = [];
  let cur = '';
  let q = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) { if (c === q) q = null; else cur += c; }
    else if (c === '"' || c === "'") q = c;
    else if (/\s/.test(c)) { if (cur) { out.push(cur); cur = ''; } }
    else cur += c;
  }
  if (cur) out.push(cur);
  return out;
}

// Run the user's pre-existing status line (if any), feeding it the same stdin.
function wrappedOutput(stdin) {
  const cmd = loadConfig().statusLineWrap;
  if (!cmd || typeof cmd !== 'string') return '';
  try {
    const argv = parseCommand(cmd);
    if (!argv.length) return '';
    const r = spawnSync(argv[0], argv.slice(1), { input: stdin, encoding: 'utf8', windowsHide: true, timeout: 5000 });
    return (r.stdout || '').replace(/\r?\n$/, '');
  } catch { return ''; }
}

{
  const stdin = readStdin();
  const latest = latestUpdate();
  if (latest) {
    process.stdout.write(`${GREEN}↑ global-brain ${latest}${RESET} ${DIM}· npm i -g @kxrk0/global-brain@latest${RESET}`);
  } else {
    process.stdout.write(wrappedOutput(stdin));
  }
}
