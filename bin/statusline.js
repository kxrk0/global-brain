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
const tty = require('tty');
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

// Cache-only: the newer version if one was seen, else null. No formatting.
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

// Real terminal width — Claude Code doesn't pass it, so query the console directly
// (works even though our stdout is a pipe). On Windows that's the \\.\CONOUT$
// device; on POSIX, /dev/tty. Falls back to COLUMNS / config / a default. This is
// what makes the layout responsive: it re-reads on every render, so resizing the
// terminal re-flushes the segment to the new edge.
function consoleWidth() {
  const dev = process.platform === 'win32'
    ? String.fromCharCode(92, 92, 46, 92) + 'CONOUT$' // \\.\CONOUT$
    : '/dev/tty';
  let fd;
  try {
    fd = fs.openSync(dev, process.platform === 'win32' ? 'r+' : 'r');
    const cols = new tty.WriteStream(fd).columns;
    if (Number.isFinite(cols) && cols > 20) return cols;
  } catch {} finally { if (fd != null) { try { fs.closeSync(fd); } catch {} } }
  return null;
}

function resolveWidth() {
  // COLUMNS first: terminals (notably VS Code's integrated terminal) export the
  // true visible width here, and it's authoritative. \\.\CONOUT$ under-reports in
  // VS Code's ConPTY (returns the 120-col buffer, not the panel width), so it's
  // only a fallback for terminals that don't set COLUMNS (e.g. plain Windows
  // Terminal). An explicit config.statusLineWidth overrides everything.
  const fromCfg = parseInt(loadConfig().statusLineWidth || '', 10);
  if (Number.isFinite(fromCfg) && fromCfg > 20) return fromCfg;
  const fromEnv = parseInt(process.env.COLUMNS || '', 10);
  if (Number.isFinite(fromEnv) && fromEnv > 20) return fromEnv;
  if (process.stdout.isTTY && process.stdout.columns > 20) return process.stdout.columns;
  const real = consoleWidth();
  if (real) return real;
  return DEFAULT_WIDTH;
}

{
  const stdin = readStdin();
  const left = wrappedOutput(stdin);
  const latest = latestUpdate();

  if (!latest) { process.stdout.write(left); }
  else {
    // Two verbosity tiers so the line stays responsive: prefer the full hint, fall
    // back to the compact one when the terminal is too narrow to fit it flush-right.
    const full = `${GREEN}↑ global-brain ${latest}${RESET} ${DIM}· npm i -g @kxrk0/global-brain@latest${RESET}`;
    const compact = `${GREEN}↑ global-brain ${latest}${RESET}`;
    // Leave a 1-col margin so the last glyph never lands on the wrap column.
    const width = resolveWidth() - 1;
    const lenLeft = visibleLen(left);

    const placeRight = (seg) => {
      const gap = width - lenLeft - visibleLen(seg);
      return gap >= (left ? 2 : 0) ? left + ' '.repeat(Math.max(0, gap)) + seg : null;
    };

    const out = placeRight(full) || placeRight(compact) ||
      // Too narrow even for the compact segment flush-right: append it after the
      // wrapped line with a single gap and let the terminal clip if it must.
      (left ? `${left} ${compact}` : compact);
    process.stdout.write(out);
  }
}
