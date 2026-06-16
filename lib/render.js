'use strict';
// Projects the brain DB into a bounded markdown digest that CLAUDE.md @-imports,
// so it loads in every project. Bounded by entry caps + a rough token budget so
// it never bloats context. Pinned/global entries float to a cross-project header.

const fs = require('fs');
const { rankScore } = require('./score');

const START = '<!-- ENTRIES:START -->';
const END = '<!-- ENTRIES:END -->';
const fmtDay = (e) => (e ? new Date(e).toISOString().slice(0, 10) : '????-??-??');

function line(r) {
  const d = r.body ? ` — ${r.body}` : '';
  let s = `- [${r.project} · ${r.type} · ${fmtDay(r.created_epoch)}] ${r.title}${d}`;
  return s.length > 320 ? s.slice(0, 317) + '...' : s;
}

function renderString(db, config) {
  const now = Date.now();
  const all = db.prepare('SELECT * FROM entries').all();
  for (const r of all) r._rank = rankScore(r, config, now);

  const minImp = config.minImportanceForDigest || 38;
  const maxPer = config.maxPerProject || 28;
  const maxTotal = config.maxTotalEntries || 280;
  const budgetChars = (config.tokenBudget || 6000) * 4;

  const pinned = all.filter((r) => r.pinned || r.is_global).sort((a, b) => b._rank - a._rank).slice(0, 40);
  const pinnedIds = new Set(pinned.map((r) => r.id));

  // group remaining by project
  const byProj = new Map();
  for (const r of all) {
    if (pinnedIds.has(r.id)) continue;
    if (r.importance < minImp && !r.pinned) continue;
    if (!byProj.has(r.project)) byProj.set(r.project, []);
    byProj.get(r.project).push(r);
  }
  // order projects by most-recent activity
  const projOrder = [...byProj.entries()].map(([p, rows]) => ({
    p, rows, recent: Math.max(...rows.map((r) => r.created_epoch)),
  })).sort((a, b) => b.recent - a.recent);

  const out = [];
  out.push('# Global Hafıza (otomatik — Claude Code transcript + claude-mem senkron)');
  out.push('');
  out.push('Proje-etiketli, her projede yüklenir (`@global-brain.md`). Beyin DB:');
  out.push('`~/.claude/global-brain/brain.db`. Sorgu: `/global-brain <soru>`.');
  out.push('**Elle düzenleme** — sync hook üzerine yazar.');
  out.push('');
  out.push(START);

  let count = 0, chars = 0;
  const emit = (s) => { out.push(s); chars += s.length + 1; count++; };

  if (pinned.length) {
    out.push('## 📌 Cross-project / pinned');
    for (const r of pinned) {
      if (count >= maxTotal || chars >= budgetChars) break;
      emit(line(r));
    }
    out.push('');
  }

  for (const { p, rows } of projOrder) {
    if (count >= maxTotal || chars >= budgetChars) break;
    rows.sort((a, b) => b._rank - a._rank);
    const top = rows.slice(0, maxPer);
    out.push(`## ${p}`);
    for (const r of top) {
      if (count >= maxTotal || chars >= budgetChars) break;
      emit(line(r));
    }
    out.push('');
  }

  out.push(END);
  out.push('');
  out.push(`<!-- ${count} entries · ${all.length} total in brain · rendered ${new Date(now).toISOString()} -->`);
  return out.join('\n');
}

function writeDigest(db, config, outPath) {
  const txt = renderString(db, config);
  fs.writeFileSync(outPath, txt);
  return txt;
}

module.exports = { renderString, writeDigest };
