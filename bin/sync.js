#!/usr/bin/env node
'use strict';
// Ingests Claude Code transcripts and re-renders the digest. Entry point for the
// SessionStart + Stop hooks. ALWAYS exits 0 and never throws out — a memory sync
// must never block Claude Code. `--report` prints a human summary (used by the
// /global-brain skill); otherwise emits the hook JSON. In hook mode it also folds
// a cached "update available" notice into `systemMessage` so a new version
// surfaces to the user automatically at session start (the network refresh runs
// in a detached worker — this process never does foreground network).

const path = require('path');
const fs = require('fs');

const REPORT = process.argv.includes('--report');

function done(summary, systemMessage) {
  if (REPORT) { console.log(summary || 'sync complete'); process.exit(0); }
  const out = { continue: true, suppressOutput: true };
  if (systemMessage) out.systemMessage = systemMessage;
  process.stdout.write(JSON.stringify(out));
  process.exit(0);
}

// Hook mode only: do a single-fire fresh check. noticeFresh spawns the detached
// network worker and briefly (CPU-free) waits for it to repopulate the cache, so a
// newly published version surfaces on THIS session start — no foreground network,
// no second-session lag.
function updateNotice() {
  if (REPORT) return null;
  try {
    const U = require('../lib/update-check');
    const version = require('../package.json').version;
    return U.noticeFresh(version);
  } catch { return null; }
}

{
  let db;
  try {
    const D = require('../lib/db');
    const { scoreEntry } = require('../lib/score');
    const TX = require('../lib/transcript');
    const R = require('../lib/render');

    const config = D.loadConfig();
    const P = D.paths();
    const projectsDir = config.projectsDir || P.projectsDir;
    const digestPath = config.digestPath || P.digest;

    db = D.open();
    const log = [];
    const t0 = Date.now();

    // ---- 1. transcripts (the source of truth) ----
    let txFiles = 0, txEntries = 0;
    try {
      const files = TX.listTranscripts(projectsDir);
      const budget = config.backfillMaxFilesPerRun || 80;
      for (const f of files) {
        if (txFiles >= budget) break;
        const sid = path.basename(f.path, '.jsonl');
        // cheap skip: unchanged mtime → don't even read the file
        const seenM = parseFloat(D.getMeta(db, 'txmtime:' + sid, '0')) || 0;
        if (f.mtime && Math.abs(f.mtime - seenM) < 1) continue;
        const res = TX.extractFile(f.path);
        D.setMeta(db, 'txmtime:' + sid, f.mtime || Date.now());
        txFiles++;
        if ((config.excludeProjects || []).includes(res.project)) continue;
        for (const e of res.entries) { Object.assign(e, scoreEntry(e, config)); D.upsertEntry(db, e); txEntries++; }
      }
    } catch (e) { log.push('transcript: ' + e.message); }

    // ---- 2. prune stale low-value chatter (keeps the brain lean long-term) ----
    try {
      const days = config.pruneAfterDays || 120;
      const cutoff = Date.now() - days * 864e5;
      const pruned = db.prepare(
        `DELETE FROM entries WHERE pinned=0 AND is_global=0 AND hits=0
         AND type IN ('session','topic','note') AND created_epoch < ? AND importance < 50`
      ).run(cutoff).changes;
      if (pruned) log.push('pruned ' + pruned);
    } catch (e) { log.push('prune: ' + e.message); }

    // ---- 3. render digest ----
    try { R.writeDigest(db, config, digestPath); } catch (e) { log.push('render: ' + e.message); }

    D.setMeta(db, 'lastSync', new Date(t0).toISOString());
    const c = D.counts(db);
    D.setMeta(db, 'entryCount', c.total);

    const ms = Date.now() - t0;
    const summary = `global-brain sync: +${txEntries} from ${txFiles} transcripts · ` +
      `${c.total} entries total, ${c.byProject.length} projects · ${ms}ms` +
      (log.length ? '\n  warn: ' + log.join('; ') : '');
    try { fs.appendFileSync(P.logs, new Date(t0).toISOString() + ' ' + summary.replace(/\n/g, ' ') + '\n'); } catch {}

    const notice = updateNotice();
    try { db.close(); } catch {}
    done(summary, notice);
  } catch (e) {
    try { if (db) db.close(); } catch {}
    // last-resort: never block the harness
    if (REPORT) console.log('sync error: ' + (e && e.message));
    else process.stdout.write('{"continue":true,"suppressOutput":true}');
    process.exit(0);
  }
}
