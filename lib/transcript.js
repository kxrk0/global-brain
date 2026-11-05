'use strict';
// The ingestion source: Claude Code transcript .jsonl files under
// ~/.claude/projects/<encoded-cwd>/*.jsonl. These are written by the harness on
// every turn, independent of any plugin hook — so the brain fills with zero
// external dependencies. Heuristic, no LLM.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { redact } = require('./redact');

const sha = (s) => crypto.createHash('sha1').update(String(s)).digest('hex').slice(0, 10);
// Collapse runs of spaces/hyphens, then any whitespace, to a single space. NOTE:
// kept byte-identical to the original on purpose — clean() feeds uid hashes, so
// changing it would re-key every commit/topic entry and duplicate them in every
// existing brain. Cosmetic hyphen-collapse is the lesser evil.
const clean = (s) => String(s == null ? '' : s).replace(/[ -]+/g, ' ').replace(/\s+/g, ' ').trim();

const NOISE = /^(\s*)(<local-command-|<command-name>|<command-message>|Caveat:|<bash-|<user-memory|\[Request interrupted)/;
const isRealPrompt = (s) => s && s.length > 3 && !NOISE.test(s) && !s.includes('<command-name>');

function textOf(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.filter((b) => b && b.type === 'text' && b.text).map((b) => b.text).join(' ');
  }
  return '';
}

// Pull commit subjects from a tool result like "[main 160524d] feat: ...".
// Source of truth for commits: this matches EVERY commit method (-m, -F, heredoc,
// editor, amend, cherry-pick, merge) because git always prints this line — and a
// FAILED commit prints no such line, so a commit that didn't land is never recorded.
const COMMIT_OUT = /\[[^\]\n]+?\s+[0-9a-f]{7,40}\]\s+([^\n]+)/g;
function commitsFromResult(text) {
  const out = [];
  if (!text) return out;
  COMMIT_OUT.lastIndex = 0;
  let m;
  while ((m = COMMIT_OUT.exec(text))) {
    // test the raw subject: clean() turns "-" into spaces ("Co Authored By")
    if (/co-authored-by/i.test(m[1])) continue;
    const s = clean(redact(m[1]));
    if (s) out.push(s.slice(0, 140));
  }
  return out;
}

// Legacy: extract a commit subject from the shell command string. Kept for
// callers/tests, but NO LONGER used for ingestion — command text records intent,
// not a landed commit (a failed `git commit -m "x"` would be a false positive).
function commitSubject(cmd) {
  if (!/git\s+commit/i.test(cmd)) return null;
  let m = cmd.match(/-m\s+(["'])([\s\S]*?)\1/); // -m "subject..." / '...'
  let subj = m ? m[2] : null;
  if (!subj) { m = cmd.match(/@'([\s\S]*?)'@/); subj = m ? m[1] : null; } // PS here-string
  if (!subj) { m = cmd.match(/<<-?'?\w+'?\s*\n([\s\S]*?)\n/); subj = m ? m[1] : null; } // heredoc
  if (!subj) return null;
  subj = clean(subj.split('\n')[0]);
  if (!subj || /co-authored-by/i.test(subj)) return null;
  return subj.slice(0, 140);
}

// Parse one transcript file into entry drafts (pre-scoring).
function extractFile(filePath) {
  let lines;
  try { lines = fs.readFileSync(filePath, 'utf8').split('\n'); } catch { return { entries: [], lineCount: 0 }; }
  const sessionId = path.basename(filePath, '.jsonl');

  let project = 'unknown';
  let startEpoch = 0, endEpoch = 0, cursor = 0;
  const goals = [];
  const titles = []; // {title, epoch}
  const files = new Set();
  const commits = []; // {subject, epoch}
  let toolCount = 0;

  for (const raw of lines) {
    if (!raw) continue;
    let o; try { o = JSON.parse(raw); } catch { continue; }
    const ts = o.timestamp ? Date.parse(o.timestamp) : 0;
    if (ts) { cursor = ts; if (!startEpoch) startEpoch = ts; endEpoch = ts; }
    // Split on both separators so a Windows cwd resolves the same on any OS.
    if (o.cwd) project = String(o.cwd).replace(/[\\/]+$/, '').split(/[\\/]/).pop() || project;

    if (o.type === 'ai-title' && o.aiTitle) {
      const t = clean(redact(o.aiTitle));
      if (t && t.length > 2) titles.push({ title: t, epoch: cursor });
    } else if (o.type === 'user' && o.message) {
      const content = o.message.content;
      // a) real user prompt → goal (skip meta + giant pastes)
      if (!o.isMeta) {
        // Noise check and redaction both run on the RAW text: clean() turns "-"
        // into spaces, which hides "<command-name>" from the noise filter and
        // breaks the token shapes the redactor looks for.
        const raw = textOf(content);
        const txt = clean(redact(raw));
        if (isRealPrompt(raw.trim()) && isRealPrompt(txt) && txt.length <= 280) goals.push(txt.slice(0, 200));
      }
      // b) tool results → landed commits (any commit method)
      if (Array.isArray(content)) {
        for (const b of content) {
          if (b && b.type === 'tool_result') {
            const rt = typeof b.content === 'string' ? b.content : textOf(b.content);
            for (const s of commitsFromResult(rt)) commits.push({ subject: s, epoch: cursor });
          }
        }
      }
    } else if (o.type === 'assistant' && o.message && Array.isArray(o.message.content)) {
      for (const b of o.message.content) {
        if (!b || b.type !== 'tool_use') continue;
        toolCount++;
        const inp = b.input || {};
        if ((b.name === 'Edit' || b.name === 'Write' || b.name === 'NotebookEdit') && inp.file_path) {
          files.add(path.basename(String(inp.file_path)));
        }
        // Commit detection lives in the tool_result pass above (accurate: only
        // commits that actually landed), not the command string (intent only).
      }
    }
  }

  // Skip internal observer/agent-memory transcripts — not real project work.
  if (/observer|claude-?mem/i.test(project)) return { entries: [], lineCount: lines.length, project, sessionId };

  // Dedup commits by subject — the same commit may echo in multiple outputs
  // (commit + a later `git show`/log). Keeps the "Commits: N" count honest.
  const seenCommit = new Set();
  let commitsU = [];
  for (const c of commits) {
    const k = c.subject.toLowerCase();
    if (seenCommit.has(k)) continue;
    seenCommit.add(k);
    commitsU.push(c);
  }
  // Drop terminal line-wrap fragments: a subject ending in a dangling operator
  // that is a prefix of a longer captured subject (one [hash] line split by the
  // console width into two captures). Real subjects don't end mid-operator, so
  // genuinely distinct commits are never merged.
  const DANGLING = /[+\-·,(/]\s*$/;
  commitsU = commitsU.filter((c) =>
    !(DANGLING.test(c.subject) && commitsU.some((o) => o !== c && o.subject.startsWith(c.subject))));

  const entries = [];
  const day = startEpoch ? new Date(startEpoch).toISOString().slice(0, 10) : '';

  // 1. Commits — strongest durable signal of what shipped.
  for (const c of commitsU) {
    entries.push({
      uid: `tx-commit-${sha(project + '|' + c.subject)}`,
      project, type: 'commit', title: c.subject, body: '',
      source: 'transcript', source_ref: sessionId,
      created_epoch: c.epoch || startEpoch,
      tags: ['commit'],
    });
  }

  // 2. AI titles — distilled per-exchange topics (harness-generated).
  for (const t of titles) {
    entries.push({
      uid: `tx-title-${sha(project + '|' + t.title)}`,
      project, type: 'topic', title: t.title, body: '',
      source: 'transcript', source_ref: sessionId,
      created_epoch: t.epoch || startEpoch,
      tags: ['topic'],
    });
  }

  // 3. Session digest — goals + files touched, one evolving entry per session.
  if (goals.length || files.size || commitsU.length) {
    const uniqGoals = [...new Set(goals.map((g) => g.slice(0, 90)))];
    const fileList = [...files].slice(0, 12);
    const bodyParts = [];
    if (uniqGoals.length) bodyParts.push('Goals: ' + uniqGoals.slice(0, 3).join(' | '));
    if (fileList.length) bodyParts.push('Touched: ' + fileList.join(', '));
    if (commitsU.length) bodyParts.push('Commits: ' + commitsU.length);
    entries.push({
      uid: `tx-session-${sessionId}`,
      project, type: 'session',
      title: `session ${day}`,
      body: bodyParts.join(' · '),
      source: 'transcript', source_ref: sessionId,
      created_epoch: startEpoch || endEpoch,
      tags: ['session'],
    });
  }

  return { entries, lineCount: lines.length, project, sessionId };
}

// List all transcript files across every project, newest first.
function listTranscripts(projectsDir) {
  const out = [];
  let dirs;
  try { dirs = fs.readdirSync(projectsDir, { withFileTypes: true }); } catch { return out; }
  for (const d of dirs) {
    if (!d.isDirectory()) continue;
    const dir = path.join(projectsDir, d.name);
    let files; try { files = fs.readdirSync(dir); } catch { continue; }
    for (const f of files) {
      if (!f.endsWith('.jsonl')) continue;
      const fp = path.join(dir, f);
      let mtime = 0; try { mtime = fs.statSync(fp).mtimeMs; } catch {}
      out.push({ path: fp, mtime });
    }
  }
  out.sort((a, b) => b.mtime - a.mtime);
  return out;
}

module.exports = { extractFile, listTranscripts, commitSubject, commitsFromResult };
