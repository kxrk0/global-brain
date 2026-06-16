'use strict';
// Bonus ingestion source: claude-mem's own DB. When claude-mem's LLM extraction
// works, its observations/summaries are richer than our transcript heuristics —
// we sync them in. When it's empty (current Windows hook issue), this is a
// silent no-op and the brain still fills from transcripts. Read-only; never
// writes to claude-mem.

const fs = require('fs');

function safeJSON(s) { try { const a = JSON.parse(s); return Array.isArray(a) ? a : null; } catch { return null; } }
const clean = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();

function extract(cmDbPath, since) {
  const out = { entries: [], maxObsId: since.obsId || 0, maxSumId: since.sumId || 0 };
  if (!fs.existsSync(cmDbPath)) return out;
  let DatabaseSync;
  try { ({ DatabaseSync } = require('node:sqlite')); } catch { return out; }
  let db;
  try {
    db = new DatabaseSync(cmDbPath, { readOnly: true });
    db.exec('PRAGMA busy_timeout = 2000');
  } catch { return out; }

  try {
    const obs = db.prepare(
      `SELECT id,project,type,title,subtitle,facts,narrative,text,created_at,created_at_epoch
       FROM observations WHERE id > ? AND project IS NOT NULL AND project != ''
       ORDER BY id ASC LIMIT 500`
    ).all(out.maxObsId);
    for (const o of obs) {
      let detail = '';
      const f = safeJSON(o.facts);
      if (f && f.length) detail = f.map(clean).filter(Boolean).slice(0, 3).join('; ');
      detail = detail || clean(o.subtitle) || clean(o.narrative) || clean(o.text);
      out.entries.push({
        uid: `cm-obs-${o.id}`, project: o.project, type: clean(o.type) || 'note',
        title: clean(o.title) || detail.slice(0, 80), body: detail,
        source: 'claude-mem', source_ref: `obs:${o.id}`,
        created_at: o.created_at, created_epoch: o.created_at_epoch || 0,
      });
      if (o.id > out.maxObsId) out.maxObsId = o.id;
    }
  } catch {}

  try {
    const sums = db.prepare(
      `SELECT id,project,request,learned,completed,next_steps,created_at,created_at_epoch
       FROM session_summaries WHERE id > ? AND project IS NOT NULL AND project != ''
       ORDER BY id ASC LIMIT 300`
    ).all(out.maxSumId);
    for (const s of sums) {
      const learned = clean(s.learned);
      const body = [learned, clean(s.completed)].filter(Boolean).join(' · ');
      out.entries.push({
        uid: `cm-sum-${s.id}`, project: s.project, type: 'discovery',
        title: clean(s.request).slice(0, 120) || 'session summary',
        body: body || clean(s.next_steps),
        source: 'claude-mem', source_ref: `sum:${s.id}`,
        created_at: s.created_at, created_epoch: s.created_at_epoch || 0,
      });
      if (s.id > out.maxSumId) out.maxSumId = s.id;
    }
  } catch {}

  try { db.close(); } catch {}
  return out;
}

module.exports = { extract };
