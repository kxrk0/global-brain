'use strict';
// Runtime capability checks. The engine relies on Node's built-in node:sqlite
// (stable in Node 24, unflagged from 22.13). On older runtimes the require throws a
// cryptic MODULE_NOT_FOUND — this turns that into one actionable line.

function checkSqlite() {
  try {
    require('./sqlite').loadSqlite();
    return { ok: true };
  } catch {
    return {
      ok: false,
      reason: `node:sqlite is unavailable. global-brain needs Node >= 22.13 (Node 24+ recommended); you have ${process.version}. Upgrade Node, then re-run.`,
    };
  }
}

module.exports = { checkSqlite };
