'use strict';
// Shared test helpers. Every test works inside a throwaway CLAUDE_CONFIG_DIR under
// the OS temp dir; HOME/USERPROFILE point there too, so nothing can reach the
// real ~/.claude even if a code path ignored CLAUDE_CONFIG_DIR.

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const FIXTURES = path.join(__dirname, 'fixtures');
const CLI = path.join(ROOT, 'bin', 'cli.js');
const REAL_CLAUDE = path.join(os.homedir(), '.claude');

const made = [];

function tmpConfigDir(tag = 'gb') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `${tag}-`));
  const rel = path.relative(os.tmpdir(), dir);
  assert.ok(rel && !rel.startsWith('..') && !path.isAbsolute(rel), `refusing non-temp config dir ${dir}`);
  assert.notStrictEqual(path.resolve(dir), path.resolve(REAL_CLAUDE));
  made.push(dir);
  return dir;
}

function envFor(dir, extra = {}) {
  const env = Object.assign({}, process.env, {
    CLAUDE_CONFIG_DIR: dir,
    HOME: dir,
    USERPROFILE: dir,
    GLOBAL_BRAIN_NO_UPDATE_CHECK: '1',
  }, extra);
  delete env.GLOBAL_BRAIN_REGISTRY;
  return env;
}

// Run a node script (or the CLI) with the temp config dir. Returns {status, stdout, stderr}.
function run(dir, script, args = [], extraEnv = {}) {
  const r = spawnSync(process.execPath, [script, ...args], {
    env: envFor(dir, extraEnv), encoding: 'utf8', timeout: 60000, windowsHide: true,
  });
  return { status: r.status, stdout: r.stdout || '', stderr: r.stderr || '' };
}
const cli = (dir, ...args) => run(dir, CLI, args);

function copyFixtures(dir) {
  const src = path.join(FIXTURES, 'projects');
  const dst = path.join(dir, 'projects');
  fs.cpSync(src, dst, { recursive: true });
  // generated, never committed: see fake-secrets.js
  const sdir = path.join(dst, 'C--work-api-server');
  fs.mkdirSync(sdir, { recursive: true });
  fs.writeFileSync(path.join(sdir, 'bbbb2222-secrets.jsonl'), require('./fake-secrets').secretsTranscript());
  return dst;
}

// Load a lib module fresh against a given config dir (lib/db.js resolves its
// paths at require time).
function freshLib(dir, name) {
  process.env.CLAUDE_CONFIG_DIR = dir;
  for (const k of Object.keys(require.cache)) if (k.startsWith(path.join(ROOT, 'lib'))) delete require.cache[k];
  return require(path.join(ROOT, 'lib', name));
}

function cleanup() {
  for (const d of made) { try { fs.rmSync(d, { recursive: true, force: true }); } catch {} }
}

// Minimal runner: test(name, fn) then await runTests(). Exits 1 on any failure.
const tests = [];
const test = (name, fn) => tests.push([name, fn]);
async function runTests(label) {
  let failed = 0;
  for (const [name, fn] of tests) {
    try { await fn(); console.log(`  ok   ${name}`); }
    catch (e) { failed++; console.log(`  FAIL ${name}\n       ${(e && e.stack) || e}`); }
  }
  cleanup();
  console.log(`${label}: ${tests.length - failed}/${tests.length} passed`);
  process.exit(failed ? 1 : 0);
}

module.exports = {
  ROOT, FIXTURES, CLI, tmpConfigDir, envFor, run, cli, copyFixtures, freshLib, test, runTests,
};
