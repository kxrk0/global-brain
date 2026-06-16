#!/usr/bin/env node
'use strict';
// Manually add a durable entry — used by the /global-brain skill when you (the
// model) distill something worth keeping, or when the user says "remember X".
//
// Quick:   node remember.js Free text fact            -> global pinned fact
// Flagged: node remember.js --project P --type decision --title "..." --body "..." [--global] [--pin] [--importance N]
const D = require('../lib/db');

const args = process.argv.slice(2);
const o = { tags: [] };
const rest = [];
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--project') o.project = args[++i];
  else if (a === '--type') o.type = args[++i];
  else if (a === '--title') o.title = args[++i];
  else if (a === '--body') o.body = args[++i];
  else if (a === '--importance') o.importance = parseInt(args[++i], 10);
  else if (a === '--tags') o.tags = String(args[++i] || '').split(',').map((s) => s.trim()).filter(Boolean);
  else if (a === '--global') o.is_global = 1;
  else if (a === '--pin') o.pinned = 1;
  else rest.push(a);
}

if (!o.title && rest.length) { o.title = rest.join(' '); }
if (!o.title) { console.log('kullanım: remember.js [--project P --type T --title "..." --body "..." --global --pin] | "serbest metin"'); process.exit(1); }

// Quick free-text form defaults to a global pinned fact.
if (!o.project) { o.project = 'global'; o.is_global = 1; o.pinned = 1; }
if (!o.type) o.type = 'fact';
if (o.importance == null) o.importance = o.pinned ? 88 : 70;
o.source = 'manual';
o.uid = 'man-' + D.sha((o.project || '') + '|' + o.title + '|' + (o.body || ''));
o.created_epoch = D.nowEpoch();

let db;
try {
  db = D.open();
  D.upsertEntry(db, o);
  const row = db.prepare('SELECT id FROM entries WHERE uid=?').get(o.uid);
  // re-render so the digest reflects it immediately
  try { const R = require('../lib/render'); const cfg = D.loadConfig(); R.writeDigest(db, cfg, D.paths().digest); } catch {}
  console.log(`✓ kaydedildi #${row ? row.id : '?'} [${o.project} · ${o.type}${o.is_global ? ' · 🌐' : ''}${o.pinned ? ' · 📌' : ''}] ${o.title}`);
} catch (e) { console.log('remember error: ' + (e && e.message)); }
finally { try { if (db) db.close(); } catch {} }
