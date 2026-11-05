'use strict';
// Secret redaction. Transcripts hold whatever the user pasted (prompts, commit
// subjects, titles), and the digest built from the brain is @-imported into
// CLAUDE.md, i.e. sent to the model in every session. So anything that looks like
// a credential is replaced with [REDACTED] before it is stored, and again when the
// digest is rendered (covers rows written by older versions).
//
// Patterns aim at well-known token shapes plus explicit "name = value" secrets.
// False positives cost a word of context; false negatives leak a key, so the
// generic rules lean wide.

const MASK = '[REDACTED]';

const PATTERNS = [
  // PEM private key blocks (whole block, or a lone header if the text was cut)
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(-----END [A-Z ]*PRIVATE KEY-----|$)/g,
  // Anthropic / OpenAI style keys: sk-ant-..., sk-proj-..., sk-...
  /\bsk-(?:ant-|proj-|svcacct-|admin-)?[A-Za-z0-9_-]{16,}/g,
  // Stripe
  /\b(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]{16,}/g,
  /\bwhsec_[A-Za-z0-9]{16,}/g,
  // GitHub
  /\bgh[pousr]_[A-Za-z0-9]{30,}/g,
  /\bgithub_pat_[A-Za-z0-9_]{40,}/g,
  // GitLab
  /\bglpat-[A-Za-z0-9_-]{20,}/g,
  // npm
  /\bnpm_[A-Za-z0-9]{30,}/g,
  // Slack
  /\bxox[abposr]-[A-Za-z0-9-]{10,}/g,
  /https:\/\/hooks\.slack\.com\/services\/[A-Za-z0-9/_-]+/g,
  // AWS access key ids
  /\b(?:AKIA|ASIA|AGPA|AIDA|AROA|ANPA)[0-9A-Z]{16}\b/g,
  // Google API keys
  /\bAIza[0-9A-Za-z_-]{35}\b/g,
  // Hugging Face, Groq, Replicate, Perplexity, xAI
  /\bhf_[A-Za-z0-9]{30,}/g,
  /\bgsk_[A-Za-z0-9]{30,}/g,
  /\br8_[A-Za-z0-9]{30,}/g,
  /\bpplx-[A-Za-z0-9]{30,}/g,
  /\bxai-[A-Za-z0-9]{30,}/g,
  // SendGrid
  /\bSG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}/g,
  // JSON Web Tokens
  /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g,
];

// Rows written before 0.6.0 went through transcript clean(), which turns the
// characters from space to "-" (so "-", "+", "/" ...) into spaces. A key like
// sk-ant-api03-AbC... is stored as "sk ant api03 AbC ...". These catch that
// mangled shape so old rows are scrubbed too.
const LEGACY = [
  /\bsk (?:(?:ant|proj|svcacct|admin) )?(?:api\d\d )?[A-Za-z0-9_]{12,}(?: (?=[A-Za-z0-9_]*\d)[A-Za-z0-9_]{4,})*/g,
  /\bglpat [A-Za-z0-9_]{12,}(?: (?=[A-Za-z0-9_]*\d)[A-Za-z0-9_]{4,})*/g,
  /\bBEGIN [A-Z ]*PRIVATE KEY[\s\S]*/g,
];

// "Authorization: Bearer xxx", "Bearer xxx"
const BEARER = /\b(Bearer|Basic|Token)\s+[A-Za-z0-9._~+/=-]{16,}/gi;
// scheme://user:password@host
const URL_CREDS = /\b([a-z][a-z0-9+.-]*:\/\/[^\s:/@]+):[^\s@/]+@/gi;
// password=..., api_key: "...", SECRET_TOKEN=..., client-secret ...
const ASSIGN = /\b([A-Za-z0-9_.-]*(?:pass(?:word|wd|phrase)?|pwd|secret|token|api[_-]?key|apikey|access[_-]?key|private[_-]?key|client[_-]?secret|auth|credential)s?[A-Za-z0-9_.-]*)(\s*[:=]\s*)(["']?)([^\s"',;]{6,})\3/gi;

function looksLikeValue(v) {
  // Plain words after "token" etc. ("token budget", "password reset") are not
  // secrets. A value counts when it has a digit, or mixes cases/symbols, or is long.
  if (v === MASK) return false;
  if (/^\[?REDACTED\]?$/i.test(v)) return false;
  if (/\d/.test(v)) return true;
  if (/[A-Z]/.test(v) && /[a-z]/.test(v) && v.length >= 12) return true;
  if (/[_\-+/=]/.test(v) && v.length >= 12) return true;
  return v.length >= 24;
}

function redact(input) {
  if (input == null) return input;
  let s = String(input);
  if (!s) return s;
  for (const re of PATTERNS) s = s.replace(re, MASK);
  for (const re of LEGACY) s = s.replace(re, MASK);
  s = s.replace(BEARER, (m, kind) => `${kind} ${MASK}`);
  s = s.replace(URL_CREDS, (m, head) => `${head}:${MASK}@`);
  s = s.replace(ASSIGN, (m, name, sep, q, val) => (looksLikeValue(val) ? `${name}${sep}${q}${MASK}${q}` : m));
  return s;
}

function hasSecret(input) {
  return input != null && redact(input) !== String(input);
}

// Bump when the patterns change so existing brains get re-scrubbed once.
const SCRUB_VERSION = '1';

// Rewrite stored rows whose title/body still hold something redact() masks.
// Runs once per SCRUB_VERSION (tracked in the meta table); returns rows changed.
function scrubRows(db) {
  const getMeta = db.prepare('SELECT value FROM meta WHERE key=?');
  const done = getMeta.get('redactVersion');
  if (done && done.value === SCRUB_VERSION) return 0;
  const rows = db.prepare('SELECT id, title, body FROM entries').all();
  const upd = db.prepare('UPDATE entries SET title=?, body=? WHERE id=?');
  let n = 0;
  db.exec('BEGIN');
  try {
    for (const r of rows) {
      const t = redact(r.title || '');
      const b = redact(r.body || '');
      if (t !== r.title || b !== r.body) { upd.run(t, b, r.id); n++; }
    }
    db.prepare('INSERT INTO meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value')
      .run('redactVersion', SCRUB_VERSION);
    db.exec('COMMIT');
  } catch (e) { try { db.exec('ROLLBACK'); } catch {} throw e; }
  return n;
}

module.exports = { redact, hasSecret, scrubRows, MASK, SCRUB_VERSION };
