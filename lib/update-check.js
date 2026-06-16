'use strict';
// Update-available detection, split so no foreground process ever does network +
// process.exit in the same flow (that races libuv on Windows). Readers (CLI,
// doctor, the sync hook) only read a tiny cache file — instant, never throws. A
// detached worker does the actual registry fetch and rewrites the cache for next
// time, exiting naturally (connection: close frees the socket, so no forced exit).

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const D = require('./db');

const PKG = '@kxrk0/global-brain';
const REGISTRY = 'https://registry.npmjs.org/@kxrk0%2Fglobal-brain';
const DEFAULT_THROTTLE_MS = 15 * 60 * 1000; // 15 minutes
const FETCH_TIMEOUT_MS = 2000;

function cacheFile() { return path.join(D.paths().base, 'update-check.json'); }
function readCache() { try { return JSON.parse(fs.readFileSync(cacheFile(), 'utf8')); } catch { return {}; } }
function writeCache(o) { try { fs.writeFileSync(cacheFile(), JSON.stringify(o)); } catch {} }
function disabled() { return process.env.GLOBAL_BRAIN_NO_UPDATE_CHECK === '1'; }

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

// Synchronous, cache-only. Returns a user-facing notice if a newer version was
// seen, else null. Safe in any foreground process — no network, never throws.
function notice(currentVersion) {
  try {
    if (disabled()) return null;
    const c = readCache();
    if (c.latest && cmp(c.latest, currentVersion) > 0) {
      return `global-brain ${c.latest} is available (you have ${currentVersion}). Update: npm i -g ${PKG}@latest`;
    }
    return null;
  } catch { return null; }
}

// Fire-and-forget: if the cache is stale, spawn a detached worker to refresh it.
// Returns immediately; never blocks, never throws.
function refresh(opts = {}) {
  try {
    if (disabled()) return;
    const throttle = opts.throttleMs || DEFAULT_THROTTLE_MS;
    const now = Date.now();
    const c = readCache();
    if (c.checkedAt && now - c.checkedAt < throttle) return;
    // Claim the window up front so concurrent callers don't each spawn a worker.
    writeCache({ checkedAt: now, latest: c.latest || null });
    const child = spawn(process.execPath, [path.join(__dirname, 'refresh-worker.js')], {
      detached: true, stdio: 'ignore', windowsHide: true,
    });
    child.unref();
  } catch {}
}

// Run by the detached worker only: fetch latest, rewrite the cache, return.
// No process.exit — `connection: close` frees the socket so the loop drains.
async function refreshNow() {
  let latest = null;
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS);
  try {
    const r = await fetch(REGISTRY, { signal: ac.signal, headers: { accept: 'application/vnd.npm.install-v1+json', connection: 'close' } });
    if (r.ok) { const j = await r.json(); latest = (j['dist-tags'] && j['dist-tags'].latest) || null; }
  } catch {} finally { clearTimeout(t); }
  const c = readCache();
  writeCache({ checkedAt: Date.now(), latest: latest || c.latest || null });
}

module.exports = { notice, refresh, refreshNow };
