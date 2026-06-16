#!/usr/bin/env node
'use strict';
// statusLine command: renders the bottom status row. Fast, network-free wrapper —
// it runs the user's pre-existing status line (e.g. caveman) verbatim and flushes a
// green "update available" segment to the RIGHT edge, so global-brain's hint shows,
// pro-style, in the colored bottom row that the dim hook systemMessage can't reach.
//
// Standalone by design: with no wrapped command (config.statusLineWrap) it just
// prints its own segment (or nothing when up to date). Caveman is NOT required.
// NEVER does network and NEVER throws out — a broken status line must not break the
// prompt, so every failure degrades to "print what we can".
//
// Terminal width: Claude Code does not pass the width to status line commands, so
// right-alignment uses COLUMNS / config.statusLineWidth / a default, and clamps so
// the line never exceeds that width (which would wrap onto a second row).

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const GREEN = '\x1b[32m';
const DIM = '\x1b[2m';
const RESET = '\x1b[0m';
const DEFAULT_WIDTH = 100;

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

// Visible length ignoring ANSI SGR / OSC escape sequences, so right-alignment math
// counts glyphs, not color bytes.
function visibleLen(s) {
  return String(s).replace(/\x1b\[[0-9;]*m/g, '').replace(/\x1b\][^\x07]*\x07/g, '').length;
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

// Cache-only update segment. Green when a newer version was seen, else ''.
function updateSegment() {
  try {
    if (process.env.GLOBAL_BRAIN_NO_UPDATE_CHECK === '1') return '';
    const U = require('../lib/update-check');
    const cache = JSON.parse(fs.readFileSync(path.join(base(), 'update-check.json'), 'utf8'));
    const latest = cache && cache.latest;
    if (latest && U._cmp(latest, currentVersion()) > 0) {
      return `${GREEN}↑ global-brain ${latest}${RESET} ${DIM}· npm i -g @kxrk0/global-brain@latest${RESET}`;
    }
  } catch {}
  return '';
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

function resolveWidth() {
  const fromEnv = parseInt(process.env.COLUMNS || '', 10);
  if (Number.isFinite(fromEnv) && fromEnv > 20) return fromEnv;
  const fromCfg = parseInt(loadConfig().statusLineWidth || '', 10);
  if (Number.isFinite(fromCfg) && fromCfg > 20) return fromCfg;
  return DEFAULT_WIDTH;
}

{
  const stdin = readStdin();
  const left = wrappedOutput(stdin);
  const seg = updateSegment();

  if (!seg) { process.stdout.write(left); }
  else if (!left) { process.stdout.write(seg); }
  else {
    // Flush the segment right: pad to the resolved width, but never exceed it
    // (overflow would wrap to a second row). Minimum two-space gap as a fallback.
    const width = resolveWidth();
    const gap = width - visibleLen(left) - visibleLen(seg);
    process.stdout.write(left + ' '.repeat(Math.max(2, gap)) + seg);
  }
}
