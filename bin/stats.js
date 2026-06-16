#!/usr/bin/env node
'use strict';
// Brain status. Usage: node stats.js
const fs = require('fs');
const D = require('../lib/db');

let db;
try {
  const P = D.paths();
  db = D.open();
  const c = D.counts(db);
  const lastSync = D.getMeta(db, 'lastSync', '(hiç)');
  let dbSize = 0; try { dbSize = fs.statSync(P.db).size; } catch {}
  let digestSize = 0; try { digestSize = fs.statSync(P.digest).size; } catch {}

  console.log('🧠 Global Brain durumu');
  console.log(`  toplam entry : ${c.total}`);
  console.log(`  proje sayısı : ${c.byProject.length}`);
  console.log(`  son sync     : ${lastSync}`);
  console.log(`  brain.db     : ${(dbSize / 1024).toFixed(1)} KB`);
  console.log(`  digest.md    : ${(digestSize / 1024).toFixed(1)} KB`);
  console.log('\n  Projeler:');
  for (const p of c.byProject.slice(0, 12)) console.log(`    ${p.n.toString().padStart(4)}  ${p.project}`);
  console.log('\n  Tipler:');
  for (const t of c.byType) console.log(`    ${t.n.toString().padStart(4)}  ${t.type}`);

  const pins = db.prepare('SELECT COUNT(*) n FROM entries WHERE pinned=1 OR is_global=1').get().n;
  console.log(`\n  cross-project/pinned: ${pins}`);
} catch (e) { console.log('stats error: ' + (e && e.message)); }
finally { try { if (db) db.close(); } catch {} }
