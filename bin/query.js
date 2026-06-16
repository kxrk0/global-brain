#!/usr/bin/env node
'use strict';
// Search the brain. Usage: node query.js [--project P] [--limit N] <terms...>
const D = require('../lib/db');

const args = process.argv.slice(2);
let project = null, limit = 15;
const terms = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--project') project = args[++i];
  else if (args[i] === '--limit') limit = parseInt(args[++i], 10) || 15;
  else terms.push(args[i]);
}
const q = terms.join(' ');

let db;
try {
  db = D.open();
  const rows = D.search(db, q, { project, limit });
  if (!rows.length) { console.log(`(eşleşme yok: "${q}")`); process.exit(0); }
  console.log(`${rows.length} sonuç — "${q}"${project ? ' @' + project : ''}:\n`);
  for (const r of rows) {
    const day = r.created_epoch ? new Date(r.created_epoch).toISOString().slice(0, 10) : '?';
    const flags = (r.pinned ? '📌' : '') + (r.is_global ? '🌐' : '');
    console.log(`#${r.id} [${r.project} · ${r.type} · ${day}] ${flags} ${r.title}`);
    if (r.body) console.log(`    ${r.body}`);
    console.log(`    (imp ${r.importance} · ${r.source})`);
  }
} catch (e) { console.log('query error: ' + (e && e.message)); }
finally { try { if (db) db.close(); } catch {} }
