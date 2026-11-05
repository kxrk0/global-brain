'use strict';
// Loads node:sqlite without printing Node 22's one-time
// "ExperimentalWarning: SQLite is an experimental feature" to stderr. Only that
// exact warning is dropped, and only while the module loads; every other warning
// still reaches process.emitWarning untouched.

let mod;

function isSqliteWarning(warning, type) {
  const msg = typeof warning === 'string' ? warning : (warning && warning.message) || '';
  const kind = typeof type === 'string' ? type
    : (type && type.type) || (warning && warning.name) || '';
  return kind === 'ExperimentalWarning' && /sqlite/i.test(msg);
}

function loadSqlite() {
  if (mod) return mod;
  const original = process.emitWarning;
  process.emitWarning = function (warning, type, ...rest) {
    if (isSqliteWarning(warning, type)) return;
    return original.call(process, warning, type, ...rest);
  };
  try { mod = require('node:sqlite'); }
  finally { process.emitWarning = original; }
  return mod;
}

module.exports = { loadSqlite, isSqliteWarning };
