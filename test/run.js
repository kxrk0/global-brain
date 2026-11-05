'use strict';
// Runs every test/*.test.js in its own process (each one sets its own env) with
// the same Node binary that runs this file. Exit 1 if any file fails.
//   node test/run.js            all files
//   node test/run.js redact     only files whose name contains "redact"
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const filter = process.argv[2] || '';
const files = fs.readdirSync(__dirname).filter((f) => f.endsWith('.test.js') && f.includes(filter)).sort();
let failed = 0;
console.log(`node ${process.version}`);
for (const f of files) {
  console.log(`\n# ${f}`);
  const r = spawnSync(process.execPath, [path.join(__dirname, f)], { stdio: 'inherit', timeout: 300000 });
  if (r.status !== 0) failed++;
}
console.log(`\n${files.length - failed}/${files.length} test files passed`);
process.exit(failed ? 1 : 0);
