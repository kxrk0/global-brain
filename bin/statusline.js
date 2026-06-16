#!/usr/bin/env node
'use strict';
// statusLine command: renders the bottom status row. It is a thin, fast, network-
// free wrapper — it appends a green "update available" segment to whatever status
// line the user already had (e.g. caveman), so global-brain's hint shows in the
// colored bottom row that the dim hook systemMessage can't reach.
//
// Standalone by design: if no wrapped command is configured (config.statusLineWrap),
// it simply prints its own segment (or nothing when up to date). Caveman is NOT
// required. It NEVER does network and NEVER throws out — a broken status line must
// not break the prompt, so every failure degrades to "print what we can".

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const GREEN = '\x1b[32m';
const DIM = '\x1b[2m';
const RESET = '\x1b[0m';

// Read everything Claude Code piped to us (status JSON). Synchronous; '' on any
// hiccup. We forward it verbatim to the wrapped command so it sees the same input.
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

// Cache-only update segment. Green when a newer version was seen, else ''.
function updateSegment() {
  try {
    if (process.env.GLOBAL_BRAIN_NO_UPDATE_CHECK === '1') return '';
    const U = require('../lib/update-check');
    const cache = JSON.parse(fs.readFileSync(path.join(base(), 'update-check.json'), 'utf8'));
    const latest = cache && cache.latest;
    if (latest && U._cmp(latest, currentVersion()) > 0) {
      return `${GREEN}↑ global-brain ${latest}${RESET} ${DIM}npm i -g @kxrk0/global-brain@latest${RESET}`;
    }
  } catch {}
  return '';
}

// Run the user's pre-existing status line (if any), feeding it the same stdin.
function wrappedOutput(stdin) {
  const cmd = loadConfig().statusLineWrap;
  if (!cmd || typeof cmd !== 'string') return '';
  try {
    const r = spawnSync(cmd, { input: stdin, shell: true, encoding: 'utf8', windowsHide: true, timeout: 5000 });
    return (r.stdout || '').replace(/\r?\n$/, '');
  } catch { return ''; }
}

{
  const stdin = readStdin();
  const left = wrappedOutput(stdin);
  const seg = updateSegment();
  const sep = left && seg ? '  ' : '';
  process.stdout.write(left + sep + seg);
}
