#!/usr/bin/env node
'use strict';
// Remove an entry, or pin/unpin/flag one.
//   node forget.js <id|uid>            -> delete
//   node forget.js --pin <id>          -> pin (keeps it in the digest forever)
//   node forget.js --unpin <id>
//   node forget.js --global <id>       -> mark cross-project
const D = require('../lib/db');

const args = process.argv.slice(2);
let db;
try {
  db = D.open();
  const R = require('../lib/render'); const cfg = D.loadConfig();
  const rerender = () => { try { R.writeDigest(db, cfg, D.paths().digest); } catch {} };

  const notFound = (id) => `not found: ${id}`;
  if (args[0] === '--pin') { const n = D.setFlag(db, args[1], 'pinned', 1); rerender(); console.log(n ? `📌 pinned #${args[1]}` : notFound(args[1])); }
  else if (args[0] === '--unpin') { const n = D.setFlag(db, args[1], 'pinned', 0); rerender(); console.log(n ? `unpinned #${args[1]}` : notFound(args[1])); }
  else if (args[0] === '--global') { const n = D.setFlag(db, args[1], 'is_global', 1); rerender(); console.log(n ? `🌐 marked global #${args[1]}` : notFound(args[1])); }
  else if (args[0]) { const n = D.deleteEntry(db, args[0]); rerender(); console.log(n ? `🗑 deleted (${n})` : notFound(args[0])); }
  else console.log('usage: global-brain forget <id|uid> | --pin <id> | --unpin <id> | --global <id>');
} catch (e) { console.log('forget error: ' + (e && e.message)); }
finally { try { if (db) db.close(); } catch {} }
