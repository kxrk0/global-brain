'use strict';
// Secrets must never reach brain.db or the digest (which CLAUDE.md sends to the model).
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { tmpConfigDir, cli, copyFixtures, freshLib, test, runTests } = require('./helpers');
const { redact, hasSecret, MASK } = require('../lib/redact');

const { SECRETS, PASSWORDS } = require('./fake-secrets');

test('known token shapes are masked', () => {
  for (const [name, s] of Object.entries(SECRETS)) {
    const out = redact(`before ${s} after`);
    assert.ok(!out.includes(s), `${name} leaked: ${out}`);
    assert.ok(out.includes(MASK), name);
    assert.ok(out.startsWith('before ') && out.endsWith(' after'), `${name} context kept: ${out}`);
  }
});

test('assignments, bearer headers, URL credentials, PEM keys', () => {
  assert.strictEqual(redact('OPENAI_API_KEY=abcdef123456'), `OPENAI_API_KEY=${MASK}`);
  assert.strictEqual(redact(`DB_PASSWORD="${PASSWORDS.short}"`), `DB_PASSWORD="${MASK}"`);
  assert.strictEqual(redact('password: s3cret!x'), `password: ${MASK}`);
  assert.strictEqual(redact('client_secret = Zm9vYmFyYmF6cXV4'), `client_secret = ${MASK}`);
  assert.strictEqual(redact('Authorization: Bearer abcdef0123456789xyz'), `Authorization: Bearer ${MASK}`);
  assert.strictEqual(redact(`postgres://admin:${PASSWORDS.urlInline}@db.example.com/x`), `postgres://admin:${MASK}@db.example.com/x`);
  assert.strictEqual(redact('key: -----BEGIN RSA PRIVATE KEY-----\nMIIEow\n-----END RSA PRIVATE KEY----- done'), `key: ${MASK} done`);
});

test('ordinary prose is left alone', () => {
  for (const s of [
    'keep the token budget at 6000 and fix the auth middleware',
    'tokenBudget: 6000',
    'password reset flow for users',
    'refactor: split payment client',
    'sk-learn style pipeline', // short, not a key
    'https://github.com/kxrk0/global-brain',
    'set maxPerProject: 28',
  ]) {
    assert.strictEqual(redact(s), s);
    assert.strictEqual(hasSecret(s), false, s);
  }
});

test('legacy rows (hyphens already turned into spaces) are masked too', () => {
  const legacy = `use ANTHROPIC API KEY=${SECRETS.anthropic.replace(/-/g, ' ')} for the client`;
  assert.ok(!redact(legacy).includes(SECRETS.anthropic.slice(14, 40)), redact(legacy));
});

test('sync of a transcript full of secrets: nothing reaches brain.db or the digest', () => {
  const dir = tmpConfigDir('gb-redact');
  copyFixtures(dir);
  const r = cli(dir, 'sync', '--report');
  assert.strictEqual(r.status, 0, r.stderr);
  const raw = [
    fs.readFileSync(path.join(dir, 'global-brain', 'brain.db')).toString('latin1'),
    (() => { try { return fs.readFileSync(path.join(dir, 'global-brain', 'brain.db-wal')).toString('latin1'); } catch { return ''; } })(),
    fs.readFileSync(path.join(dir, 'global-brain.md'), 'utf8'),
  ].join('\n');
  for (const s of [SECRETS.anthropic.slice(14, 40), SECRETS.github, PASSWORDS.url, SECRETS.aws, PASSWORDS.commit]) {
    assert.ok(!raw.includes(s), `secret fragment ${s} stored`);
  }
  // the useful, non-secret part of the prompts survives
  const q = cli(dir, 'query', 'client', '--project', 'api-server').stdout;
  assert.match(q, /use ANTHROPIC_API_KEY=\[REDACTED\] for the client/);
  assert.match(raw, /\[REDACTED\]/);
});

test('remember scrubs a pasted key', () => {
  const dir = tmpConfigDir('gb-redact');
  const out = cli(dir, 'remember', `deploy key is ${SECRETS.github}`).stdout;
  assert.ok(!out.includes(SECRETS.github), out);
  assert.ok(!cli(dir, 'query', 'deploy').stdout.includes(SECRETS.github));
});

test('rows stored by an older version are scrubbed once on the next sync', () => {
  const dir = tmpConfigDir('gb-redact');
  const D = freshLib(dir, 'db.js');
  const db = D.open();
  // write raw, bypassing upsertEntry's redaction, as a 0.5.0 brain would hold it
  db.prepare("INSERT INTO entries(uid,project,type,title,body,importance,created_epoch) VALUES('old1','p','session','session 2026-01-01',?,60,?)")
    .run(`Goals: use key ${SECRETS.anthropic.replace(/-/g, ' ')} and ${SECRETS.github}`, Date.now());
  db.close();
  const r = cli(dir, 'sync', '--report');
  assert.match(r.stdout, /redacted 1/);
  const db2 = D.open(true);
  const body = db2.prepare("SELECT body FROM entries WHERE uid='old1'").get().body;
  const ver = db2.prepare("SELECT value FROM meta WHERE key='redactVersion'").get().value;
  db2.close();
  assert.ok(!body.includes(SECRETS.github) && !body.includes(SECRETS.anthropic.slice(14, 40)), body);
  assert.strictEqual(ver, '1');
  assert.doesNotMatch(cli(dir, 'sync', '--report').stdout, /redacted/, 'runs once');
});

runTests('redact');
