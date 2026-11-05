'use strict';
// bin/sync.js end to end against fixture transcripts: idempotency, hook-mode
// output contract (single JSON line on stdout, exit 0, no stderr noise).
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { ROOT, tmpConfigDir, run, cli, copyFixtures, freshLib, test, runTests } = require('./helpers');

const SYNC = path.join(ROOT, 'bin', 'sync.js');

function entryCount(dir) {
  const D = freshLib(dir, 'db.js');
  const db = D.open(true);
  try {
    return {
      total: db.prepare('SELECT COUNT(*) n FROM entries').get().n,
      rows: db.prepare('SELECT uid, project, type, title, body FROM entries ORDER BY uid').all(),
    };
  } finally { db.close(); }
}

test('sync --report ingests fixtures; a second run adds nothing', () => {
  const dir = tmpConfigDir('gb-sync');
  copyFixtures(dir);
  const a = cli(dir, 'sync', '--report');
  assert.strictEqual(a.status, 0, a.stderr);
  assert.match(a.stdout, /global-brain sync: \+\d+ from 3 transcripts/);
  const first = entryCount(dir);
  assert.ok(first.total >= 6, `expected entries, got ${first.total}`);
  assert.ok(!first.rows.some((r) => r.project === 'observer-sessions'), 'observer excluded');

  const b = cli(dir, 'sync', '--report');
  assert.match(b.stdout, /\+0 from 0 transcripts/, 'unchanged files are skipped');
  assert.deepStrictEqual(entryCount(dir), first);
});

test('re-reading a changed transcript does not duplicate entries', () => {
  const dir = tmpConfigDir('gb-sync');
  const projects = copyFixtures(dir);
  cli(dir, 'sync', '--report');
  const first = entryCount(dir);
  // bump every mtime so all files are re-parsed
  const later = new Date(Date.now() + 5000);
  for (const d of fs.readdirSync(projects)) {
    for (const f of fs.readdirSync(path.join(projects, d))) fs.utimesSync(path.join(projects, d, f), later, later);
  }
  const r = cli(dir, 'sync', '--report');
  assert.match(r.stdout, /from 3 transcripts/);
  assert.deepStrictEqual(entryCount(dir), first);
});

test('hook mode prints exactly one JSON object, exit 0, empty stderr', () => {
  const dir = tmpConfigDir('gb-sync');
  copyFixtures(dir);
  const r = run(dir, SYNC);
  assert.strictEqual(r.status, 0);
  assert.deepStrictEqual(JSON.parse(r.stdout), { continue: true, suppressOutput: true });
  assert.strictEqual(r.stderr, '', `stderr must stay empty (no ExperimentalWarning): ${r.stderr}`);
});

test('hook mode still exits 0 with valid JSON when brain.db is corrupt', () => {
  const dir = tmpConfigDir('gb-sync');
  copyFixtures(dir);
  fs.mkdirSync(path.join(dir, 'global-brain'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'global-brain', 'brain.db'), 'this is not a sqlite database'.repeat(200));
  const r = run(dir, SYNC);
  assert.strictEqual(r.status, 0);
  assert.deepStrictEqual(JSON.parse(r.stdout), { continue: true, suppressOutput: true });
  assert.match(fs.readFileSync(path.join(dir, 'global-brain', 'sync.log'), 'utf8'), /FATAL/);
});

test('CLI verbs print no SQLite ExperimentalWarning', () => {
  const dir = tmpConfigDir('gb-sync');
  copyFixtures(dir);
  for (const args of [['sync', '--report'], ['stats'], ['query', 'payment'], ['doctor']]) {
    const r = cli(dir, ...args);
    assert.ok(!/ExperimentalWarning|SQLite is an experimental/i.test(r.stderr), `${args[0]}: ${r.stderr}`);
  }
});

test('user-facing CLI output is English', () => {
  const dir = tmpConfigDir('gb-sync');
  copyFixtures(dir);
  cli(dir, 'sync', '--report');
  const outs = [
    cli(dir, 'stats').stdout,
    cli(dir, 'query', 'payment').stdout,
    cli(dir, 'query', 'zzzz-nothing').stdout,
    cli(dir, 'remember', 'Prefer pnpm in every project').stdout,
    cli(dir, 'forget', '999999').stdout,
    cli(dir, 'forget').stdout,
    cli(dir, 'remember').stdout,
    fs.readFileSync(path.join(dir, 'global-brain.md'), 'utf8'),
  ];
  assert.match(outs[0], /Global Brain status/);
  assert.match(outs[1], /result/);
  assert.match(outs[2], /no matches/);
  assert.match(outs[3], /✓ saved #\d+/);
  assert.match(outs[4], /not found: 999999/);
  assert.match(outs[5], /^usage: global-brain forget/);
  assert.match(outs[6], /^usage: global-brain remember/);
  for (const o of outs) assert.ok(!/[ğĞşŞıİ]|bulunamad|kaydedildi|sonuç|oturum|Hafıza/.test(o), `Turkish text left in: ${o}`);
});

runTests('sync');
