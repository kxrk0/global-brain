'use strict';
// Best-effort "newer version available" notice for the CLI. Fires only on manual
// CLI invocations (never the sync hook), throttled, with a short timeout, and
// fail-silent — a registry hiccup or offline machine must never disrupt a command.

const fs = require('fs');
const path = require('path');
const D = require('./db');

const PKG = '@kxrk0/global-brain';
const REGISTRY = 'https://registry.npmjs.org/@kxrk0%2Fglobal-brain';
const DEFAULT_THROTTLE_MS = 15 * 60 * 1000; // 15 minutes
const FETCH_TIMEOUT_MS = 2000;

function cacheFile() { return path.join(D.paths().base, 'update-check.json'); }
function readCache() { try { return JSON.parse(fs.readFileSync(cacheFile(), 'utf8')); } catch { return {}; } }
function writeCache(o) { try { fs.writeFileSync(cacheFile(), JSON.stringify(o)); } catch {} }

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

async function fetchLatest() {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS);
  try {
    const r = await fetch(REGISTRY, { signal: ac.signal, headers: { accept: 'application/vnd.npm.install-v1+json' } });
    if (!r.ok) return null;
    const j = await r.json();
    return (j['dist-tags'] && j['dist-tags'].latest) || null;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

// Resolves to a one-line notice if a newer version is published, else null.
// Never throws.
async function checkForUpdate(currentVersion, opts = {}) {
  try {
    if (process.env.GLOBAL_BRAIN_NO_UPDATE_CHECK === '1') return null;
    const throttle = opts.throttleMs || DEFAULT_THROTTLE_MS;
    const now = opts.now || Date.now();
    const cache = readCache();
    let latest = cache.latest;
    if (!cache.checkedAt || now - cache.checkedAt >= throttle) {
      const fetched = await fetchLatest();
      writeCache({ checkedAt: now, latest: fetched || cache.latest || null });
      if (fetched) latest = fetched;
    }
    if (latest && cmp(latest, currentVersion) > 0) {
      return `↑ global-brain ${latest} available (you have ${currentVersion}) — update: npm i -g ${PKG}@latest`;
    }
    return null;
  } catch {
    return null;
  }
}

module.exports = { checkForUpdate };
