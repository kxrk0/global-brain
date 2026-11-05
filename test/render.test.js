'use strict';
// lib/render.js: digest format and every bound (entry caps, per-project cap,
// token budget, line length) holds.
const assert = require('assert');
const { tmpConfigDir, freshLib, test, runTests } = require('./helpers');

const START = '<!-- ENTRIES:START -->';
const END = '<!-- ENTRIES:END -->';

function seeded(n = { projects: 4, per: 20 }) {
  const dir = tmpConfigDir('gb-render');
  const D = freshLib(dir, 'db.js');
  const R = freshLib(dir, 'render.js');
  const D2 = require('../lib/db'); // same instance freshLib loaded
  const db = D2.open();
  const now = Date.now();
  let k = 0;
  for (let p = 0; p < n.projects; p++) {
    for (let i = 0; i < n.per; i++) {
      D2.upsertEntry(db, {
        uid: `t-${p}-${i}`, project: `proj${p}`, type: i % 2 ? 'decision' : 'commit',
        title: `entry ${p}-${i} ` + 'x'.repeat(40), body: 'body text '.repeat(10),
        importance: 60 + (i % 30), created_epoch: now - (k++) * 3600e3,
      });
    }
  }
  D2.upsertEntry(db, { uid: 'pin-1', project: 'global', type: 'preference', title: 'Pinned preference', body: 'always on top', importance: 90, pinned: 1, is_global: 1 });
  return { D: D || D2, R, db };
}

const entryLines = (txt) => {
  const body = txt.slice(txt.indexOf(START), txt.indexOf(END));
  return body.split('\n').filter((l) => l.startsWith('- ['));
};

test('format: English header, markers once, pinned section, line shape', () => {
  const { R, db } = seeded();
  const txt = R.renderString(db, { tokenBudget: 6000, maxTotalEntries: 280, maxPerProject: 28 });
  db.close();
  assert.ok(txt.startsWith('# Global Brain (auto-generated from Claude Code transcripts)'));
  assert.strictEqual(txt.split(START).length, 2);
  assert.strictEqual(txt.split(END).length, 2);
  assert.ok(txt.indexOf(START) < txt.indexOf(END));
  assert.match(txt, /## 📌 Cross-project \/ pinned\n- \[global · preference · \d{4}-\d\d-\d\d\] Pinned preference — always on top/);
  for (const l of entryLines(txt)) assert.match(l, /^- \[[^\]]+ · [a-z]+ · \d{4}-\d\d-\d\d\] /);
  assert.match(txt, /<!-- \d+ entries · \d+ total in brain · rendered .+ -->$/);
});

test('maxTotalEntries caps the number of lines', () => {
  const { R, db } = seeded();
  const txt = R.renderString(db, { tokenBudget: 100000, maxTotalEntries: 7, maxPerProject: 28 });
  db.close();
  assert.strictEqual(entryLines(txt).length, 7);
});

test('maxPerProject caps each project section', () => {
  const { R, db } = seeded();
  const txt = R.renderString(db, { tokenBudget: 100000, maxTotalEntries: 1000, maxPerProject: 3 });
  db.close();
  const counts = {};
  for (const l of entryLines(txt)) { const p = l.match(/^- \[([^ ]+) ·/)[1]; counts[p] = (counts[p] || 0) + 1; }
  for (const [p, c] of Object.entries(counts)) if (p !== 'global') assert.ok(c <= 3, `${p} has ${c}`);
  assert.strictEqual(Object.keys(counts).filter((p) => p !== 'global').length, 4);
});

test('tokenBudget bounds the entry block (one line of overshoot at most)', () => {
  const { R, db } = seeded();
  const budget = 300; // tokens ≈ 1200 chars
  const txt = R.renderString(db, { tokenBudget: budget, maxTotalEntries: 1000, maxPerProject: 28 });
  db.close();
  const chars = entryLines(txt).reduce((a, l) => a + l.length + 1, 0);
  assert.ok(chars <= budget * 4 + 321, `entry block ${chars} chars over budget`);
  assert.ok(entryLines(txt).length < 81, 'budget must cut the list');
});

test('lines are truncated at 320 chars', () => {
  const dir = tmpConfigDir('gb-render');
  const D = freshLib(dir, 'db.js');
  const R = require('../lib/render');
  const db = D.open();
  D.upsertEntry(db, { uid: 'long', project: 'p', type: 'decision', title: 'T'.repeat(190), body: 'b'.repeat(590), importance: 90 });
  const txt = R.renderString(db, {});
  db.close();
  const l = entryLines(txt)[0];
  assert.strictEqual(l.length, 320);
  assert.ok(l.endsWith('...'));
});

test('entries below minImportanceForDigest are left out', () => {
  const dir = tmpConfigDir('gb-render');
  const D = freshLib(dir, 'db.js');
  const R = require('../lib/render');
  const db = D.open();
  D.upsertEntry(db, { uid: 'lo', project: 'p', type: 'note', title: 'low value', importance: 10 });
  D.upsertEntry(db, { uid: 'hi', project: 'p', type: 'decision', title: 'high value', importance: 80 });
  const txt = R.renderString(db, { minImportanceForDigest: 38 });
  db.close();
  assert.ok(txt.includes('high value'));
  assert.ok(!txt.includes('low value'));
});

test('writeDigest writes atomically and leaves no temp file', () => {
  const dir = tmpConfigDir('gb-render');
  const fs = require('fs');
  const path = require('path');
  const D = freshLib(dir, 'db.js');
  const R = require('../lib/render');
  const db = D.open();
  D.upsertEntry(db, { uid: 'a', project: 'p', type: 'decision', title: 'x', importance: 80 });
  const out = path.join(dir, 'global-brain.md');
  R.writeDigest(db, {}, out);
  db.close();
  assert.ok(fs.readFileSync(out, 'utf8').includes(START));
  assert.deepStrictEqual(fs.readdirSync(dir).filter((f) => f.includes('.tmp-')), []);
});

runTests('render');
