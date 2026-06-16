'use strict';
// Standalone mock npm registry for the update-check tests. Runs in its OWN process
// so the test's foreground Atomics.wait (the product's bounded wait) can't starve
// it — the real registry is always external, this models that. Serves whatever
// version the `latest` file currently holds; appends a byte to the `hits` file per
// request so the test can assert whether a fetch happened. Prints `PORT <n>`.

const http = require('http');
const fs = require('fs');

const latestFile = process.argv[2];
const hitsFile = process.argv[3];

const server = http.createServer((req, res) => {
  try { fs.appendFileSync(hitsFile, '.'); } catch {}
  let latest = '0.0.0';
  try { latest = fs.readFileSync(latestFile, 'utf8').trim(); } catch {}
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify({ 'dist-tags': { latest } }));
});

server.listen(0, '127.0.0.1', () => {
  process.stdout.write(`PORT ${server.address().port}\n`);
});
