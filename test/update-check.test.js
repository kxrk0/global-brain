'use strict';
// Self-contained, dependency-free tests for the update-available infrastructure.
// Deterministic & offline: a mock npm registry runs in a SEPARATE process (see
// mock-registry.js — it must, because the product's foreground bounded-wait blocks
// this thread, which would starve an in-process server), and a throwaway
// CLAUDE_CONFIG_DIR isolates the cache.
// Run: node test/update-check.test.js

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');

// --- isolated config dir ------------------------------------------------------
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'gb-uc-'));
const BASE = path.join(TMP, 'global-brain');
fs.mkdirSync(BASE, { recursive: true });
const latestFile = path.join(TMP, 'latest.txt');
const hitsFile = path.join(TMP, 'hits.bin');
fs.writeFileSync(hitsFile, '');

process.env.CLAUDE_CONFIG_DIR = TMP;
process.env.GLOBAL_BRAIN_FRESH_THROTTLE_MS = '0'; // always attempt a fresh fetch
process.env.GLOBAL_BRAIN_FRESH_WAIT_MS = '4000';  // generous: worker is a spawned node process
delete process.env.GLOBAL_BRAIN_NO_UPDATE_CHECK;

const cacheFile = path.join(BASE, 'update-check.json');
const readCache = () => { try { return JSON.parse(fs.readFileSync(cacheFile, 'utf8')); } catch { return {}; } };
const writeCache = (o) => fs.writeFileSync(cacheFile, JSON.stringify(o));
const clearCache = () => { try { fs.unlinkSync(cacheFile); } catch {} };
const setLatest = (v) => fs.writeFileSync(latestFile, String(v));
const hits = () => { try { return fs.statSync(hitsFile).size; } catch { return 0; } };

// require AFTER env is set so D.paths() resolves to the temp base
const U = require(path.join(ROOT, 'lib', 'update-check'));

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

// --- 1. semver compare edge cases (pure, no IO) -------------------------------
test('cmp: numeric ordering + prerelease stripped', () => {
  assert.strictEqual(U._cmp('0.4.2', '0.4.1'), 1);
  assert.strictEqual(U._cmp('0.4.1', '0.4.2'), -1);
  assert.strictEqual(U._cmp('0.4.1', '0.4.1'), 0);
  assert.strictEqual(U._cmp('1.0.0', '0.9.9'), 1);
  assert.strictEqual(U._cmp('0.4.2-beta.1', '0.4.2'), 0); // prerelease ignored
  assert.strictEqual(U._cmp('0.10.0', '0.9.0'), 1);       // not lexicographic
});

// --- 2. instant single-fire detection -----------------------------------------
test('noticeFresh: clean cache → fetches and detects on one call', () => {
  clearCache();
  setLatest('9.9.9');
  const before = hits();
  const n = U.noticeFresh('0.4.0');
  assert.ok(n, 'expected a notice');
  assert.ok(n.includes('9.9.9'), `notice should name latest: ${n}`);
  assert.ok(n.includes('0.4.0'), 'notice should name current version');
  assert.ok(hits() > before, 'the worker should have hit the registry');
});

// --- 3. no false positive when already current/ahead --------------------------
test('noticeFresh: current >= latest → null', () => {
  clearCache();
  setLatest('0.4.0');
  assert.strictEqual(U.noticeFresh('0.4.0'), null, 'equal → no notice');
  clearCache();
  setLatest('0.4.0');
  assert.strictEqual(U.noticeFresh('9.9.9'), null, 'ahead → no notice');
});

// --- 4. kill switch ------------------------------------------------------------
test('noticeFresh: GLOBAL_BRAIN_NO_UPDATE_CHECK=1 → null, no fetch', () => {
  clearCache();
  setLatest('9.9.9');
  const before = hits();
  process.env.GLOBAL_BRAIN_NO_UPDATE_CHECK = '1';
  const n = U.noticeFresh('0.4.0');
  delete process.env.GLOBAL_BRAIN_NO_UPDATE_CHECK;
  assert.strictEqual(n, null);
  assert.strictEqual(hits(), before, 'disabled path must not hit the network');
});

// --- 5. offline / unreachable registry → graceful fallback, bounded wait ------
test('noticeFresh: registry down → falls back to cached, never throws, bounded', () => {
  writeCache({ checkedAt: 1, latest: '5.0.0' }); // stale but usable fallback
  const saved = process.env.GLOBAL_BRAIN_REGISTRY;
  process.env.GLOBAL_BRAIN_REGISTRY = 'http://127.0.0.1:1/pkg'; // ECONNREFUSED
  const t0 = Date.now();
  const n = U.noticeFresh('0.4.0');
  const elapsed = Date.now() - t0;
  process.env.GLOBAL_BRAIN_REGISTRY = saved;
  assert.ok(n && n.includes('5.0.0'), `should fall back to cached latest: ${n}`);
  assert.ok(elapsed <= 4000 + 1500, `must stay bounded by maxWait, took ${elapsed}ms`);
});

// --- 6. throttle dedupe: fresh cache → no spawn, returns fast ------------------
test('noticeFresh: within throttle → skips network, reads existing cache', () => {
  const saved = process.env.GLOBAL_BRAIN_FRESH_THROTTLE_MS;
  process.env.GLOBAL_BRAIN_FRESH_THROTTLE_MS = '600000'; // 10 min
  writeCache({ checkedAt: Date.now(), latest: '7.0.0' });
  const before = hits();
  const t0 = Date.now();
  const n = U.noticeFresh('0.4.0');
  const elapsed = Date.now() - t0;
  process.env.GLOBAL_BRAIN_FRESH_THROTTLE_MS = saved;
  assert.ok(n && n.includes('7.0.0'), 'serves cached notice');
  assert.strictEqual(hits(), before, 'throttled path must not hit the network');
  assert.ok(elapsed < 300, `should return promptly, took ${elapsed}ms`);
});

// --- 7. message format + OSC 9 bundle -----------------------------------------
const ESC = String.fromCharCode(0x1b);
const BEL = String.fromCharCode(0x07);

test('noticeFreshParts: bundles arrow message + allowlisted OSC 2 tab title', () => {
  clearCache();
  setLatest('9.9.9');
  const p = U.noticeFreshParts('0.4.0');
  assert.ok(p, 'expected parts');
  assert.ok(p.message.includes('0.4.0') && p.message.includes('9.9.9') && p.message.includes('→'),
    `inline message should be the arrow form: ${p.message}`);
  assert.ok(p.terminalSequence.startsWith(ESC + ']2;'), 'must be an OSC 2 title sequence');
  assert.ok(p.terminalSequence.endsWith(BEL), 'OSC must terminate with BEL');
  assert.ok(p.terminalSequence.includes('9.9.9'), 'title should name the new version');
});

test('noticeFreshParts: null when up to date', () => {
  clearCache();
  setLatest('0.4.0');
  assert.strictEqual(U.noticeFreshParts('0.4.0'), null);
});

test('oscTitle: strips control chars so the payload cannot inject a 2nd sequence', () => {
  const evil = `hi${ESC}]777;pwn${BEL}\nthere`;
  const seq = U.oscTitle(evil);
  // exactly one framing ESC and one framing BEL — payload controls neutralized
  assert.strictEqual(seq.split(ESC).length - 1, 1, 'only the framing ESC may remain');
  assert.strictEqual(seq.split(BEL).length - 1, 1, 'only the framing BEL may remain');
  // The injected `]777;` is now inert text (no ESC to arm it); visible text kept.
  assert.ok(seq.includes('pwn') && seq.includes('there'), 'visible text preserved');
});

// --- 8. end-to-end: the real hook (bin/sync.js) emits message + terminalSequence
test('bin/sync.js hook: valid JSON, systemMessage + terminalSequence, exit 0', () => {
  clearCache();
  setLatest('9.9.9');
  const env = { ...process.env, GLOBAL_BRAIN_FRESH_THROTTLE_MS: '0', GLOBAL_BRAIN_FRESH_WAIT_MS: '4000' };
  const r = spawnSync(process.execPath, [path.join(ROOT, 'bin', 'sync.js')], { env, encoding: 'utf8' });
  assert.strictEqual(r.status, 0, `hook must exit 0 (stderr: ${r.stderr})`);
  assert.strictEqual((r.stderr || '').trim(), '', 'hook must not write to stderr');
  let out;
  assert.doesNotThrow(() => { out = JSON.parse(r.stdout); }, `hook stdout must be JSON: ${r.stdout}`);
  assert.strictEqual(out.continue, true);
  assert.ok(out.systemMessage && out.systemMessage.includes('9.9.9'), `expected notice in systemMessage: ${r.stdout}`);
  assert.ok(out.terminalSequence && out.terminalSequence.startsWith(ESC + ']2;'), 'expected OSC 2 terminalSequence');
});

// --- 9. hook stays fully silent when up to date -------------------------------
test('bin/sync.js hook: no message and no terminalSequence when current is latest', () => {
  clearCache();
  setLatest(require(path.join(ROOT, 'package.json')).version);
  const env = { ...process.env, GLOBAL_BRAIN_FRESH_THROTTLE_MS: '0', GLOBAL_BRAIN_FRESH_WAIT_MS: '4000' };
  const r = spawnSync(process.execPath, [path.join(ROOT, 'bin', 'sync.js')], { env, encoding: 'utf8' });
  assert.strictEqual(r.status, 0);
  const out = JSON.parse(r.stdout);
  assert.ok(!out.systemMessage, `should be silent: ${r.stdout}`);
  assert.ok(!out.terminalSequence, 'no toast when up to date');
});

// --- 10. statusline wrapper ---------------------------------------------------
const configFile = path.join(BASE, 'config.json');
const writeConfig = (o) => fs.writeFileSync(configFile, JSON.stringify(o));
const runStatusline = () => spawnSync(process.execPath, [path.join(ROOT, 'bin', 'statusline.js')],
  { env: process.env, input: '{"model":{"id":"x"}}', encoding: 'utf8' });

test('statusline: green segment when an update is cached, empty when current', () => {
  const cur = require(path.join(ROOT, 'package.json')).version;
  writeConfig({});
  writeCache({ checkedAt: 1, latest: '99.0.0' });
  let r = runStatusline();
  assert.strictEqual(r.status, 0, `exit 0 (stderr: ${r.stderr})`);
  assert.ok(r.stdout.includes('99.0.0'), `should name newer version: ${JSON.stringify(r.stdout)}`);
  assert.ok(r.stdout.includes('\x1b[32m'), 'segment must be green');

  writeCache({ checkedAt: 1, latest: cur });
  r = runStatusline();
  assert.strictEqual(r.stdout, '', `silent when up to date: ${JSON.stringify(r.stdout)}`);
});

test('statusline: composes a wrapped status line + appends our segment', () => {
  writeConfig({ statusLineWrap: 'echo WRAPPED_LINE' });
  writeCache({ checkedAt: 1, latest: '99.0.0' });
  const r = runStatusline();
  assert.strictEqual(r.status, 0);
  assert.ok(r.stdout.includes('WRAPPED_LINE'), 'keeps the wrapped status line');
  assert.ok(r.stdout.includes('99.0.0'), 'appends our update segment');
  assert.ok(r.stdout.indexOf('WRAPPED_LINE') < r.stdout.indexOf('99.0.0'), 'wrapped first, segment after');
});

test('statusline: no wrap configured → segment only, never errors', () => {
  writeConfig({});
  writeCache({ checkedAt: 1, latest: '99.0.0' });
  const r = runStatusline();
  assert.strictEqual(r.status, 0, `exit 0 (stderr: ${r.stderr})`);
  assert.ok(r.stdout.includes('99.0.0'));
});

// --- runner -------------------------------------------------------------------
(async () => {
  setLatest('0.0.0');
  // Start the mock registry in its own process; read the port it prints.
  const mock = spawn(process.execPath, [path.join(__dirname, 'mock-registry.js'), latestFile, hitsFile], {
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  const port = await new Promise((res, rej) => {
    let buf = '';
    const to = setTimeout(() => rej(new Error('mock registry did not start')), 5000);
    mock.stdout.on('data', (d) => {
      buf += d;
      const m = buf.match(/PORT (\d+)/);
      if (m) { clearTimeout(to); res(parseInt(m[1], 10)); }
    });
  });
  process.env.GLOBAL_BRAIN_REGISTRY = `http://127.0.0.1:${port}/pkg`;

  let pass = 0, fail = 0;
  for (const [name, fn] of tests) {
    try { await fn(); console.log(`  ok  ${name}`); pass++; }
    catch (e) { console.log(`FAIL  ${name}\n      ${e.message}`); fail++; }
  }
  mock.kill();
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch {}
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
