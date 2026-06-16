'use strict';
// Update-available detection. The hard constraint: a foreground process (the hook,
// the CLI) must NEVER do `fetch()` then `process.exit()` in the same flow — on
// Windows that races libuv's socket teardown and crashes the process. So all
// network lives in a detached worker; foreground code only reads a small cache
// file and, at most, sleeps while the worker repopulates it.
//
// Two foreground entry points:
//   notice(v)        — pure cache read, instant, never blocks. Used by cli/doctor.
//   noticeFresh(v)   — spawns the worker, then blocks up to maxWaitMs (CPU-free,
//                      via Atomics.wait) until the worker rewrites the cache, then
//                      reads it. Collapses the old two-session lag into one fire so
//                      a freshly published version surfaces on the very next hook.
// noticeFreshParts(v) bundles the dim inline message with an OSC 9 desktop
// notification (terminalSequence) so the hint is visible beyond the muted line.

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const D = require('./db');

const PKG = '@kxrk0/global-brain';
const DEFAULT_REGISTRY = 'https://registry.npmjs.org/@kxrk0%2Fglobal-brain';
const BG_THROTTLE_MS = 15 * 60 * 1000;   // background (cli) refresh cadence
const FRESH_THROTTLE_MS = 10 * 1000;     // dedupe rapid double-fires (SessionStart+Stop)
const FETCH_TIMEOUT_MS = 2000;
const FRESH_MAX_WAIT_MS = 1500;          // foreground block ceiling — well under the 20s hook timeout
const POLL_MS = 75;

const ESC = String.fromCharCode(0x1b);
const BEL = String.fromCharCode(0x07);
// Every C0 control char (0x00–0x1f) — stripped from OSC payloads.
const CONTROL_CHARS = new RegExp('[' + String.fromCharCode(0) + '-' + String.fromCharCode(0x1f) + ']', 'g');

function registry() { return process.env.GLOBAL_BRAIN_REGISTRY || DEFAULT_REGISTRY; }
function cacheFile() { return path.join(D.paths().base, 'update-check.json'); }
function readCache() { try { return JSON.parse(fs.readFileSync(cacheFile(), 'utf8')); } catch { return {}; } }
function writeCache(o) { try { fs.writeFileSync(cacheFile(), JSON.stringify(o)); } catch {} }
function disabled() { return process.env.GLOBAL_BRAIN_NO_UPDATE_CHECK === '1'; }

function envInt(name, fallback) {
  const v = parseInt(process.env[name] || '', 10);
  return Number.isFinite(v) && v >= 0 ? v : fallback;
}

// CPU-free synchronous sleep. Atomics.wait blocks the thread without busy-looping
// and is permitted on Node's main thread (unlike in browsers).
function sleepSync(ms) {
  try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Math.max(0, ms | 0)); } catch {}
}

// Numeric semver compare (prerelease ignored — adequate for an update hint).
function cmp(a, b) {
  const pa = String(a).split('-')[0].split('.').map((n) => parseInt(n, 10) || 0);
  const pb = String(b).split('-')[0].split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) > (pb[i] || 0)) return 1;
    if ((pa[i] || 0) < (pb[i] || 0)) return -1;
  }
  return 0;
}

function buildNotice(latest, currentVersion) {
  return `global-brain ${currentVersion} → ${latest}  ·  update: npm i -g ${PKG}@latest`;
}

// OSC 2 window/tab-title sequence: ESC ] 2 ; <text> BEL. Unlike the OSC 9 toast
// (which only surfaces when the window is unfocused and re-fires every session),
// the title is an always-visible, non-intrusive channel for the hint. Claude Code
// forwards the title OSCs (0/1/2) + BEL; we strip every control char from the
// payload so it stays inside the allowlist and can't smuggle in a 2nd sequence.
function oscTitle(text) {
  const safe = String(text).replace(CONTROL_CHARS, ' ').trim();
  return ESC + ']2;' + safe + BEL;
}

// Synchronous, cache-only. Returns a user-facing notice if a newer version was
// seen, else null. Safe in any foreground process — no network, never throws.
function notice(currentVersion) {
  try {
    if (disabled()) return null;
    const c = readCache();
    if (c.latest && cmp(c.latest, currentVersion) > 0) return buildNotice(c.latest, currentVersion);
    return null;
  } catch { return null; }
}

function spawnWorker() {
  try {
    const child = spawn(process.execPath, [path.join(__dirname, 'refresh-worker.js')], {
      detached: true, stdio: 'ignore', windowsHide: true,
    });
    child.unref();
  } catch {}
}

// Fire-and-forget background refresh (cli path): if the cache is stale, spawn a
// worker. Returns immediately; never blocks, never throws.
function refresh(opts = {}) {
  try {
    if (disabled()) return;
    const throttle = opts.throttleMs != null ? opts.throttleMs : BG_THROTTLE_MS;
    const c = readCache();
    if (c.checkedAt && Date.now() - c.checkedAt < throttle) return;
    writeCache({ checkedAt: Date.now(), latest: c.latest || null });
    spawnWorker();
  } catch {}
}

// Foreground, single-fire fresh check. Spawns the worker, then blocks (CPU-free)
// up to maxWaitMs until the worker rewrites the cache, then returns a cache-based
// notice. No foreground network → no Windows exit race. Degrades gracefully: if
// the worker is slow/offline, the wait times out and we fall back to whatever the
// cache already held (or null), and the worker still finishes for next time.
function noticeFresh(currentVersion, opts = {}) {
  try {
    if (disabled()) return null;
    const maxWaitMs = opts.maxWaitMs != null ? opts.maxWaitMs : envInt('GLOBAL_BRAIN_FRESH_WAIT_MS', FRESH_MAX_WAIT_MS);
    const throttle = opts.throttleMs != null ? opts.throttleMs : envInt('GLOBAL_BRAIN_FRESH_THROTTLE_MS', FRESH_THROTTLE_MS);
    const before = readCache();
    const baseAt = before.checkedAt || 0;

    // Skip the network round-trip if we checked very recently (rapid re-fire).
    if (!baseAt || Date.now() - baseAt >= throttle) {
      spawnWorker();
      const deadline = Date.now() + maxWaitMs;
      // Wait until the worker writes a newer cache (checkedAt strictly advances).
      while (Date.now() < deadline) {
        if ((readCache().checkedAt || 0) > baseAt) break;
        sleepSync(POLL_MS);
      }
    }
    return notice(currentVersion);
  } catch {
    try { return notice(currentVersion); } catch { return null; }
  }
}

// Hook helper: run the fresh check, and if an update is available, bundle the dim
// inline message with an OSC 2 tab-title update so the hint also shows in the
// terminal title (no "says:" prefix, no every-session toast). Returns null when up
// to date.
function noticeFreshParts(currentVersion, opts = {}) {
  const message = noticeFresh(currentVersion, opts);
  if (!message) return null;
  const latest = (readCache().latest) || '';
  const terminalSequence = oscTitle(`global-brain ${latest} available — npm i -g ${PKG}@latest`);
  return { message, terminalSequence };
}

// Run by the detached worker only: fetch latest, rewrite the cache, return. No
// process.exit — `connection: close` frees the socket so the loop drains naturally.
async function refreshNow() {
  let latest = null;
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), envInt('GLOBAL_BRAIN_FETCH_TIMEOUT_MS', FETCH_TIMEOUT_MS));
  try {
    const r = await fetch(registry(), { signal: ac.signal, headers: { accept: 'application/vnd.npm.install-v1+json', connection: 'close' } });
    if (r.ok) { const j = await r.json(); latest = (j['dist-tags'] && j['dist-tags'].latest) || null; }
  } catch {} finally { clearTimeout(t); }
  const c = readCache();
  writeCache({ checkedAt: Date.now(), latest: latest || c.latest || null });
  return latest;
}

module.exports = { notice, noticeFresh, noticeFreshParts, refresh, refreshNow, oscTitle, _cmp: cmp };
