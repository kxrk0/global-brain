'use strict';
// init / uninstall / doctor round trips in a throwaway CLAUDE_CONFIG_DIR. The bar:
// after `init` then `uninstall`, every file the user had is back to what it was.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { tmpConfigDir, cli, copyFixtures, test, runTests } = require('./helpers');

const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const ls = (d) => { try { return fs.readdirSync(d).sort(); } catch { return null; } };

const USER_SETTINGS = {
  model: 'opus',
  permissions: { allow: ['Bash(git status)'] },
  statusLine: { type: 'command', command: 'node "C:/tools/caveman.js"', padding: 1 },
  hooks: {
    Stop: [{ hooks: [{ type: 'command', command: 'echo user-stop-hook' }] }],
    PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'echo pre' }] }],
  },
  env: { FOO: 'bar' },
};
const USER_CLAUDE_MD = '# My rules\n\nBe brief.\nNo trailing newline here';

function seedUser(dir) {
  fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify(USER_SETTINGS, null, 2));
  fs.writeFileSync(path.join(dir, 'CLAUDE.md'), USER_CLAUDE_MD);
  copyFixtures(dir);
}

function ourHooks(settings) {
  const n = {};
  for (const [ev, groups] of Object.entries(settings.hooks || {})) {
    n[ev] = groups.flatMap((g) => g.hooks || []).filter((h) => /global-brain/.test(h.command) && /sync\.js/.test(h.command)).length;
  }
  return n;
}

test('init wires hooks, status line, import, skill; re-running stays idempotent', () => {
  const dir = tmpConfigDir('gb-inst');
  seedUser(dir);
  for (let i = 0; i < 2; i++) assert.strictEqual(cli(dir, 'init').status, 0);
  const s = readJson(path.join(dir, 'settings.json'));
  assert.deepStrictEqual(ourHooks(s), { Stop: 1, PreToolUse: 0, SessionStart: 1 });
  assert.match(s.statusLine.command, /global-brain.*statusline\.js/);
  assert.strictEqual(s.model, 'opus');
  assert.deepStrictEqual(s.env, { FOO: 'bar' });
  const cfg = readJson(path.join(dir, 'global-brain', 'config.json'));
  assert.strictEqual(cfg.statusLineWrap, USER_SETTINGS.statusLine.command);
  assert.deepStrictEqual(cfg.statusLineOriginal, USER_SETTINGS.statusLine);
  const md = fs.readFileSync(path.join(dir, 'CLAUDE.md'), 'utf8');
  assert.strictEqual(md.split('@global-brain.md').length, 2, 'import added once');
  assert.ok(fs.existsSync(path.join(dir, 'skills', 'global-brain', 'SKILL.md')));
  assert.ok(fs.existsSync(path.join(dir, 'global-brain', 'brain.db')));
  assert.ok(fs.readFileSync(path.join(dir, 'global-brain.md'), 'utf8').includes('<!-- ENTRIES:START -->'));
});

test('doctor passes after init and checks the status line', () => {
  const dir = tmpConfigDir('gb-inst');
  seedUser(dir);
  cli(dir, 'init');
  const r = cli(dir, 'doctor');
  assert.strictEqual(r.status, 0, r.stdout);
  assert.match(r.stdout, /PASS.*Status line \(settings\.json\) — update segment wired, wrapping: node "C:\/tools\/caveman\.js"/);

  // someone replaces the status line → warn, not fail
  const sp = path.join(dir, 'settings.json');
  const s = readJson(sp); s.statusLine = { type: 'command', command: 'echo other' };
  fs.writeFileSync(sp, JSON.stringify(s));
  assert.match(cli(dir, 'doctor').stdout, /WARN.*Status line.*another status line is set/);

  delete s.statusLine; fs.writeFileSync(sp, JSON.stringify(s));
  assert.match(cli(dir, 'doctor').stdout, /WARN.*Status line.*not wired/);

  // our status line pointing at a deleted engine → fail
  cli(dir, 'init');
  fs.rmSync(path.join(dir, 'global-brain', 'bin', 'statusline.js'));
  const bad = cli(dir, 'doctor');
  assert.strictEqual(bad.status, 1);
  assert.match(bad.stdout, /FAIL.*Status line.*points at missing/);
});

test('uninstall restores the user\'s settings and CLAUDE.md exactly, keeps brain.db', () => {
  const dir = tmpConfigDir('gb-inst');
  seedUser(dir);
  assert.strictEqual(cli(dir, 'init').status, 0);
  const r = cli(dir, 'uninstall');
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  assert.deepStrictEqual(readJson(path.join(dir, 'settings.json')), USER_SETTINGS);
  assert.strictEqual(fs.readFileSync(path.join(dir, 'CLAUDE.md'), 'utf8'), USER_CLAUDE_MD);
  assert.ok(!fs.existsSync(path.join(dir, 'global-brain.md')), 'digest removed');
  assert.ok(!fs.existsSync(path.join(dir, 'skills', 'global-brain')), 'skill removed');
  assert.ok(fs.existsSync(path.join(dir, 'skills')) === false, 'skills/ created by init is removed when empty');
  const left = ls(path.join(dir, 'global-brain'));
  for (const gone of ['bin', 'lib', 'package.json']) assert.ok(!left.includes(gone), `${gone} should be removed`);
  assert.ok(left.includes('brain.db') && left.includes('config.json'), 'brain.db + config.json kept by default');
  const cfg = readJson(path.join(dir, 'global-brain', 'config.json'));
  assert.ok(!('statusLineWrap' in cfg) && !('installState' in cfg), 'wiring snapshot cleared');
  assert.strictEqual(cfg.tokenBudget, 6000, 'tuning keys kept');
  assert.match(r.stdout, /npm uninstall -g @kxrk0\/global-brain/);
});

test('uninstall on a fresh dir removes the files init created', () => {
  const dir = tmpConfigDir('gb-inst');
  cli(dir, 'init');
  assert.ok(fs.existsSync(path.join(dir, 'settings.json')));
  cli(dir, 'uninstall');
  assert.deepStrictEqual(ls(dir), ['global-brain']);
});

test('--purge deletes the brain folder, nothing else', () => {
  const dir = tmpConfigDir('gb-inst');
  seedUser(dir);
  cli(dir, 'init');
  const r = cli(dir, 'uninstall', '--purge');
  assert.strictEqual(r.status, 0);
  assert.ok(!fs.existsSync(path.join(dir, 'global-brain')));
  assert.deepStrictEqual(readJson(path.join(dir, 'settings.json')), USER_SETTINGS);
  assert.ok(fs.existsSync(path.join(dir, 'projects')), 'transcripts are never touched');
});

test('--dry-run changes nothing; a second uninstall is a no-op', () => {
  const dir = tmpConfigDir('gb-inst');
  seedUser(dir);
  cli(dir, 'init');
  const before = fs.readFileSync(path.join(dir, 'settings.json'), 'utf8');
  const md = fs.readFileSync(path.join(dir, 'CLAUDE.md'), 'utf8');
  const d = cli(dir, 'uninstall', '--dry-run');
  assert.strictEqual(d.status, 0);
  assert.match(d.stdout, /\[dry-run\]/);
  assert.strictEqual(fs.readFileSync(path.join(dir, 'settings.json'), 'utf8'), before);
  assert.strictEqual(fs.readFileSync(path.join(dir, 'CLAUDE.md'), 'utf8'), md);
  assert.ok(fs.existsSync(path.join(dir, 'global-brain', 'bin', 'sync.js')));
  cli(dir, 'uninstall');
  const again = cli(dir, 'uninstall');
  assert.strictEqual(again.status, 0);
  assert.deepStrictEqual(readJson(path.join(dir, 'settings.json')), USER_SETTINGS);
});

test('0.5.0 install (no statusLineOriginal): restores from statusLineWrap, or removes when empty', () => {
  for (const wrap of ['node "C:/old/status.js"', '']) {
    const dir = tmpConfigDir('gb-inst');
    const base = path.join(dir, 'global-brain');
    fs.mkdirSync(path.join(base, 'bin'), { recursive: true });
    fs.writeFileSync(path.join(base, 'config.json'), JSON.stringify({ tokenBudget: 6000, statusLineWrap: wrap }));
    const sync = path.join(base, 'bin', 'sync.js');
    fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({
      theme: 'dark',
      hooks: { SessionStart: [{ hooks: [{ type: 'command', command: `node "${sync}"`, timeout: 20 }] }],
        Stop: [{ hooks: [{ type: 'command', command: `node "${sync}"`, timeout: 20 }] }] },
      statusLine: { type: 'command', command: `node "${path.join(base, 'bin', 'statusline.js')}"` },
    }));
    fs.writeFileSync(path.join(dir, 'CLAUDE.md'), 'keep me\n\n# Global Brain (cross-project memory)\n\n@global-brain.md\n');
    assert.strictEqual(cli(dir, 'uninstall').status, 0);
    const s = readJson(path.join(dir, 'settings.json'));
    if (wrap) assert.deepStrictEqual(s, { theme: 'dark', statusLine: { type: 'command', command: wrap } });
    else assert.deepStrictEqual(s, { theme: 'dark' });
    assert.strictEqual(fs.readFileSync(path.join(dir, 'CLAUDE.md'), 'utf8'), 'keep me\n');
  }
});

test('hand-edited CLAUDE.md: only the import line and its heading go', () => {
  const dir = tmpConfigDir('gb-inst');
  cli(dir, 'init');
  const p = path.join(dir, 'CLAUDE.md');
  fs.writeFileSync(p, '# Mine\r\n\r\n# Global Brain (cross-project memory)\r\n@global-brain.md\r\n\r\n## After\r\ntext with @global-brain.md inline stays\r\n');
  cli(dir, 'uninstall');
  assert.strictEqual(fs.readFileSync(p, 'utf8'), '# Mine\r\n\r\n\r\n## After\r\ntext with @global-brain.md inline stays\r\n');
});

test('unparseable settings.json is left untouched and reported', () => {
  const dir = tmpConfigDir('gb-inst');
  cli(dir, 'init');
  const p = path.join(dir, 'settings.json');
  fs.writeFileSync(p, '{ broken json');
  const r = cli(dir, 'uninstall');
  assert.strictEqual(r.status, 1);
  assert.match(r.stdout, /settings\.json unparseable/);
  assert.strictEqual(fs.readFileSync(p, 'utf8'), '{ broken json');
});

test('a hook group shared with the user keeps the user\'s command', () => {
  const dir = tmpConfigDir('gb-inst');
  cli(dir, 'init');
  const p = path.join(dir, 'settings.json');
  const s = readJson(p);
  s.hooks.Stop[0].hooks.push({ type: 'command', command: 'echo mine-in-same-group' });
  fs.writeFileSync(p, JSON.stringify(s));
  cli(dir, 'uninstall');
  const after = readJson(p);
  assert.deepStrictEqual(after.hooks, { Stop: [{ hooks: [{ type: 'command', command: 'echo mine-in-same-group' }] }] });
});

test('unknown uninstall option is rejected without changes', () => {
  const dir = tmpConfigDir('gb-inst');
  cli(dir, 'init');
  const before = fs.readFileSync(path.join(dir, 'settings.json'), 'utf8');
  const r = cli(dir, 'uninstall', '--purg');
  assert.strictEqual(r.status, 1);
  assert.strictEqual(fs.readFileSync(path.join(dir, 'settings.json'), 'utf8'), before);
});

runTests('install');
