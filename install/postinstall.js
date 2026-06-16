#!/usr/bin/env node
'use strict';
// Runs automatically after `npm install -g`. Auto-wires the brain into the
// Claude Code config dir so the package works with zero manual steps. Skipped in
// CI / local dev installs (npm sets npm_config_global=false for those) and never
// fails the install — wiring problems print guidance instead of throwing.

const { spawnSync } = require('child_process');
const path = require('path');

// Only auto-wire on a real global install. Local `npm install` (dev, CI) is a no-op.
if (process.env.GLOBAL_BRAIN_SKIP_POSTINSTALL === '1') process.exit(0);
if (process.env.CI) process.exit(0);
if (process.env.npm_config_global !== 'true') {
  console.log('global-brain: local install — run `global-brain init` to wire it into ~/.claude');
  process.exit(0);
}

const r = spawnSync(process.execPath, [path.resolve(__dirname, 'init.js')], { stdio: 'inherit' });
// Never fail the npm install over wiring; user can re-run `global-brain init`.
process.exit(0);
