'use strict';
// lib/transcript.js: parsing fake Claude Code transcripts into entry drafts.
const assert = require('assert');
const path = require('path');
const { FIXTURES, test, runTests } = require('./helpers');
const TX = require('../lib/transcript');

const P = path.join(FIXTURES, 'projects');
const demo = path.join(P, 'C--work-demo-app', 'aaaa1111-demo.jsonl');
const observer = path.join(P, 'C--work-observer-sessions', 'cccc3333-observer.jsonl');

test('project comes from the Windows cwd basename', () => {
  const r = TX.extractFile(demo);
  assert.strictEqual(r.project, 'demo-app');
  assert.strictEqual(r.sessionId, 'aaaa1111-demo');
});

test('landed commits only, deduplicated across echoes', () => {
  const r = TX.extractFile(demo);
  const commits = r.entries.filter((e) => e.type === 'commit').map((e) => e.title).sort();
  assert.deepStrictEqual(commits, ['feat: retry payment calls with backoff', 'refactor: split payment client']);
  assert.ok(!commits.some((c) => /fails/.test(c)), 'a failed commit must not be recorded');
});

test('ai-title topics are captured', () => {
  const r = TX.extractFile(demo);
  const topics = r.entries.filter((e) => e.type === 'topic').map((e) => e.title);
  assert.deepStrictEqual(topics, ['Payment client retry with backoff', 'Idempotency keys for POST retries']);
});

test('one session entry with goals, touched files and commit count (English title)', () => {
  const r = TX.extractFile(demo);
  const s = r.entries.filter((e) => e.type === 'session');
  assert.strictEqual(s.length, 1);
  assert.strictEqual(s[0].uid, 'tx-session-aaaa1111-demo');
  assert.strictEqual(s[0].title, 'session 2026-10-01');
  assert.match(s[0].body, /Goals: add retry with exponential backoff/);
  assert.match(s[0].body, /Touched: payment\.ts, retry\.ts/);
  assert.match(s[0].body, /Commits: 2/);
  assert.ok(!/Caveat|command-name|clear/.test(s[0].body), 'meta and command noise must be skipped');
});

test('uids are stable across re-parses (idempotent ingest)', () => {
  const a = TX.extractFile(demo).entries.map((e) => e.uid);
  const b = TX.extractFile(demo).entries.map((e) => e.uid);
  assert.deepStrictEqual(a, b);
  assert.strictEqual(new Set(a).size, a.length, 'uids are unique within a file');
});

test('observer transcripts are excluded', () => {
  const r = TX.extractFile(observer);
  assert.strictEqual(r.entries.length, 0);
});

test('missing file yields no entries instead of throwing', () => {
  const r = TX.extractFile(path.join(P, 'nope.jsonl'));
  assert.deepStrictEqual(r.entries, []);
});

test('listTranscripts finds every .jsonl across projects', () => {
  const files = TX.listTranscripts(P).map((f) => path.basename(f.path)).sort();
  assert.deepStrictEqual(files, ['aaaa1111-demo.jsonl', 'cccc3333-observer.jsonl']);
});

test('commitsFromResult: matches git output, ignores co-authored lines', () => {
  assert.deepStrictEqual(TX.commitsFromResult('[main abc1234] fix: x\n[dev 1234567890] feat: y'), ['fix: x', 'feat: y']);
  assert.deepStrictEqual(TX.commitsFromResult('no commit here'), []);
  assert.deepStrictEqual(TX.commitsFromResult('[main abc1234] Co-Authored-By: someone'), []);
});

runTests('transcript');
