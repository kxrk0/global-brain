#!/usr/bin/env node
'use strict';
// `global-brain uninstall` — undoes what `global-brain init` wired into the
// Claude Code config dir, and nothing else:
//   • removes the global-brain SessionStart + Stop hook entries from settings.json
//   • restores the status line init wrapped (from config.json), or removes ours
//   • removes the @global-brain.md import (and the heading init added) from CLAUDE.md
//   • removes the installed skill, the copied engine and the rendered digest
// Every other setting, hook, CLAUDE.md line and file is left exactly as it is.
// The brain itself (brain.db, config.json, sync.log) is KEPT unless --purge is given.
//
//   global-brain uninstall             unwire, keep the brain data
//   global-brain uninstall --purge     also delete ~/.claude/global-brain/ (brain.db included)
//   global-brain uninstall --dry-run   print what would change, change nothing

const fs = require('fs');
const path = require('path');
const os = require('os');

const HOME = os.homedir();
const CLAUDE_DIR = process.env.CLAUDE_CONFIG_DIR || path.join(HOME, '.claude');
const BASE = path.join(CLAUDE_DIR, 'global-brain');
const SKILL_DIR = path.join(CLAUDE_DIR, 'skills', 'global-brain');
const SETTINGS = path.join(CLAUDE_DIR, 'settings.json');
const CLAUDE_MD = path.join(CLAUDE_DIR, 'CLAUDE.md');
const CONFIG = path.join(BASE, 'config.json');
const DIGEST_IMPORT = '@global-brain.md';
const DIGEST_HEADING = '# Global Brain (cross-project memory)';
const ENTRIES_MARK = '<!-- ENTRIES:START -->';

const args = process.argv.slice(2);
const PURGE = args.includes('--purge') || args.includes('--delete-data');
const DRY = args.includes('--dry-run');
const unknown = args.filter((a) => !['--purge', '--delete-data', '--dry-run'].includes(a));
if (unknown.length) {
  console.error(`global-brain uninstall: unknown option ${unknown.join(' ')}`);
  console.error('usage: global-brain uninstall [--purge] [--dry-run]');
  process.exit(1);
}

const log = (m) => console.log(`global-brain uninstall: ${DRY ? '[dry-run] ' : ''}${m}`);

function writeAtomic(file, data) {
  const tmp = `${file}.gb-tmp`;
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, file);
}

function readJson(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; }
}

const isOurHook = (h) => h && typeof h.command === 'string' &&
  h.command.includes('global-brain') && h.command.includes('sync.js');
const isOurStatusLine = (s) => s && typeof s.command === 'string' &&
  s.command.includes('global-brain') && s.command.includes('statusline.js');

const config = readJson(CONFIG) || {};
const installState = config.installState || {};

// ---- settings.json: hooks + status line -------------------------------------
function unwireSettings() {
  if (!fs.existsSync(SETTINGS)) { log('settings.json not found — nothing to unwire'); return; }
  let settings;
  try { settings = JSON.parse(fs.readFileSync(SETTINGS, 'utf8')); }
  catch (e) {
    log(`WARNING: settings.json unparseable (${e.message}); left untouched — remove the global-brain hooks and statusLine by hand`);
    process.exitCode = 1;
    return;
  }
  let changed = false;

  // hooks: drop only our command entries; drop a group/event/hooks object only
  // when our removal is what emptied it.
  if (settings.hooks && typeof settings.hooks === 'object') {
    let removed = 0;
    for (const event of Object.keys(settings.hooks)) {
      const groups = settings.hooks[event];
      if (!Array.isArray(groups)) continue;
      let eventTouched = false;
      const kept = [];
      for (const g of groups) {
        if (!g || !Array.isArray(g.hooks) || !g.hooks.some(isOurHook)) { kept.push(g); continue; }
        const rest = g.hooks.filter((h) => !isOurHook(h));
        removed += g.hooks.length - rest.length;
        eventTouched = true;
        if (rest.length) kept.push(Object.assign({}, g, { hooks: rest }));
      }
      if (!eventTouched) continue;
      if (kept.length) settings.hooks[event] = kept;
      else delete settings.hooks[event];
    }
    if (removed) {
      changed = true;
      if (!Object.keys(settings.hooks).length) delete settings.hooks;
      log(`hooks  -> removed ${removed} global-brain hook entr${removed === 1 ? 'y' : 'ies'}`);
    } else {
      log('hooks  -> none registered');
    }
  } else {
    log('hooks  -> none registered');
  }

  // status line: restore what init wrapped. 0.6.0+ keeps the whole original
  // object; older installs only kept the command string (statusLineWrap).
  if (isOurStatusLine(settings.statusLine)) {
    const orig = config.statusLineOriginal;
    const wrap = typeof config.statusLineWrap === 'string' ? config.statusLineWrap.trim() : '';
    if (orig && typeof orig === 'object') {
      settings.statusLine = orig;
      log(`statusline -> restored previous status line${orig.command ? ` (${orig.command})` : ''}`);
    } else if (wrap) {
      settings.statusLine = { type: 'command', command: config.statusLineWrap };
      log(`statusline -> restored previous status line (${config.statusLineWrap})`);
    } else {
      delete settings.statusLine;
      log('statusline -> removed (there was none before global-brain)');
    }
    changed = true;
  } else if (settings.statusLine) {
    log('statusline -> not ours, left as is');
  } else {
    log('statusline -> none set');
  }

  if (!changed) return;
  if (installState.settingsCreated && !Object.keys(settings).length) {
    if (!DRY) fs.unlinkSync(SETTINGS);
    log('settings.json -> removed (global-brain created it and it is now empty)');
    return;
  }
  if (!DRY) writeAtomic(SETTINGS, JSON.stringify(settings, null, 2) + '\n');
}

// ---- CLAUDE.md: the import line and init's heading -------------------------
function stripImport(body) {
  // Exact block init appends — removing it restores the file byte for byte.
  for (const nl of ['\n', '\r\n']) {
    const block = `${nl}${DIGEST_HEADING}${nl}${nl}${DIGEST_IMPORT}${nl}`;
    if (body.includes(block)) return body.replace(block, '');
  }
  // Fallback for a hand-edited block: drop every import line, and the heading
  // only when the next non-blank line is the import we removed.
  const lines = body.split(/(?<=\n)/);
  const isImport = (l) => l.trim() === DIGEST_IMPORT;
  const drop = new Set();
  lines.forEach((l, i) => {
    if (isImport(l)) drop.add(i);
    if (l.trim() === DIGEST_HEADING) {
      let j = i + 1;
      while (j < lines.length && !lines[j].trim()) j++;
      if (j < lines.length && isImport(lines[j])) {
        drop.add(i);
        for (let k = i + 1; k < j; k++) drop.add(k); // blank lines inside the block
      }
    }
  });
  return lines.filter((_, i) => !drop.has(i)).join('');
}

function unwireClaudeMd() {
  if (!fs.existsSync(CLAUDE_MD)) { log('CLAUDE.md not found — nothing to remove'); return; }
  const body = fs.readFileSync(CLAUDE_MD, 'utf8');
  if (!body.includes(DIGEST_IMPORT)) { log('import -> not present in CLAUDE.md'); return; }
  const next = stripImport(body);
  if (installState.claudeMdCreated && !next.trim()) {
    if (!DRY) fs.unlinkSync(CLAUDE_MD);
    log('import -> removed; CLAUDE.md deleted (global-brain created it and it is now empty)');
    return;
  }
  if (!DRY) writeAtomic(CLAUDE_MD, next);
  log('import -> @global-brain.md removed from CLAUDE.md');
}

// ---- files ------------------------------------------------------------------
function rm(p, label) {
  if (!fs.existsSync(p)) return false;
  if (!DRY) fs.rmSync(p, { recursive: true, force: true });
  if (label) log(label);
  return true;
}

function removeDigest() {
  const digests = new Set([path.join(CLAUDE_DIR, 'global-brain.md')]);
  if (typeof config.digestPath === 'string' && config.digestPath) digests.add(config.digestPath);
  for (const d of digests) {
    let txt = '';
    try { txt = fs.readFileSync(d, 'utf8'); } catch { continue; }
    // Only delete a file global-brain rendered (carries our entries marker).
    if (txt.includes(ENTRIES_MARK)) rm(d, `digest -> removed ${d}`);
    else log(`digest -> ${d} does not look like a global-brain digest, left as is`);
  }
}

function removeSkill() {
  const skill = path.join(SKILL_DIR, 'SKILL.md');
  if (!fs.existsSync(SKILL_DIR)) { log('skill  -> not installed'); return; }
  rm(skill);
  let left = [];
  try { left = fs.readdirSync(SKILL_DIR); } catch {}
  if (!left.length || DRY) rm(SKILL_DIR);
  log(`skill  -> removed ${SKILL_DIR}${left.length && !DRY ? ' (other files in it were kept)' : ''}`);
  // the parent skills/ folder too, if init created it and nothing else lives there
  const parent = path.dirname(SKILL_DIR);
  let siblings = ['?'];
  try { siblings = fs.readdirSync(parent); } catch {}
  if (installState.skillsDirCreated && !siblings.length) rm(parent);
}

function removeEngine() {
  if (!fs.existsSync(BASE)) { log('engine -> not installed'); return; }
  if (PURGE) {
    rm(BASE, `data   -> deleted ${BASE} (brain.db included)`);
    return;
  }
  for (const p of ['bin', 'lib', 'package.json', 'update-check.json']) rm(path.join(BASE, p));
  log(`engine -> removed from ${BASE}`);
  // Forget the wiring snapshot so a later `init` records a fresh one; the user's
  // tuning keys in config.json stay.
  const cfg = readJson(CONFIG);
  if (cfg && ['installState', 'statusLineOriginal', 'statusLineWrap'].some((k) => k in cfg)) {
    delete cfg.installState; delete cfg.statusLineOriginal; delete cfg.statusLineWrap;
    if (!DRY) writeAtomic(CONFIG, JSON.stringify(cfg, null, 2) + '\n');
  }
  log(`data   -> kept ${path.join(BASE, 'brain.db')} and config.json (delete with --purge)`);
}

function main() {
  log(`config dir: ${CLAUDE_DIR}`);
  unwireSettings();
  unwireClaudeMd();
  removeDigest();
  removeSkill();
  removeEngine();
  log('done. Restart Claude Code. To remove the CLI itself: npm uninstall -g @kxrk0/global-brain');
}

try { main(); }
catch (e) { console.error(`global-brain uninstall failed: ${e.message}`); process.exit(1); }
