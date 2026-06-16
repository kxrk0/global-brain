'use strict';
// Importance scoring (0..100). Type baseline + content signals. No LLM —
// deterministic heuristics so it runs inside a hook. The skill layer (model)
// can override importance for distilled entries.

const STRONG = /\b(always|never|must|must not|don't|do not|avoid|require[ds]?|invariant|deprecat|breaking|security|auth|token|credential|race|deadlock|determinis|byte-exact|parity|migration|rollback|gotcha|pitfall|important|critical)\b/i;
const DECISION = /\b(decid|chose|choose|switch(ed)? to|instead of|trade-?off|because|rationale|approach|strategy)\b/i;
const CROSS = /\b(global|all projects|every project|cross-project|workflow|convention|preference|setup|install|config|environment|toolchain)\b/i;

function scoreEntry(e, config) {
  const w = (config.typeWeights || {});
  let s = w[e.type] != null ? w[e.type] : 50;
  const hay = `${e.title} ${e.body}`;
  if (STRONG.test(hay)) s += 8;
  if (DECISION.test(hay)) s += 5;
  let global = e.is_global ? 1 : 0;
  // Auto cross-project pin only for durable, opinion-bearing types — keeps
  // session/topic/commit noise out of the pinned header.
  const ALLOW_GLOBAL = new Set(['decision', 'preference', 'architecture', 'constraint', 'fact']);
  if (CROSS.test(hay)) { s += ALLOW_GLOBAL.has(e.type) ? 4 : 2; if (ALLOW_GLOBAL.has(e.type)) global = 1; }
  // longer, substantive bodies score slightly higher; one-liners lower
  const len = (e.body || '').length;
  if (len > 120) s += 3; else if (len < 20) s -= 6;
  s = Math.max(0, Math.min(100, Math.round(s)));
  return { importance: s, is_global: global };
}

// Render-time ranking score: importance + bounded recency boost.
function rankScore(row, config, now) {
  const half = (config.recencyHalfLifeDays || 21) * 864e5;
  const boostMax = config.recencyBoostMax || 22;
  const age = Math.max(0, now - row.created_epoch);
  const recency = boostMax * Math.pow(0.5, age / half);
  return row.importance + recency + (row.pinned ? 40 : 0) + (row.is_global ? 10 : 0) + Math.min(6, (row.hits || 0));
}

module.exports = { scoreEntry, rankScore };
