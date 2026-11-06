---
section: decisions
generatedAt: 1789458862009
model: gpt-oss:120b-cloud
---

- The code enforces that a foreground process must never call fetch then process.exit in the same flow to avoid a Windows socket teardown race. `lib/update-check.js:2` @9f3e2e
- The implementation provides a CPU‑free synchronous sleep using Atomics.wait because it blocks the thread without busy‑looping and is allowed on Node’s main thread. `lib/update-check.js:46` @1800ef
- The detached worker refresh function fetches the latest version and rewrites the cache without calling process.exit so the connection can close naturally. `lib/update-check.js:151` @561cc0
- The open function executes the database schema only when the database is opened in read/write mode, not in read‑only mode. `lib/db.js:79` @754883
- The upsert statement updates entries in place, never lowers importance, and preserves manual pin and global flags across re‑ingestion. `lib/db.js:96` @83464e
- Only entry types listed in ALLOW_GLOBAL may have the global flag set when a global tag is present. `lib/score.js:27` @ef2433
- The sync script always exits with status 0 and never throws, ensuring the memory sync never blocks Claude Code. `bin/sync.js:4` @ed44a3
- The status line command hides the wrapped status line when an update is available and shows a green notice instead. `bin/statusline.js:5` @f4a29b
- Legacy commit‑subject extraction is retained for callers but is no longer used for ingestion because command text records intent instead of landed commits. `lib/transcript.js:46` @b37fdb
- The SQLite DatabaseSync module is required lazily the first time it is needed to avoid unnecessary loading. `lib/db.js:42` @65d695
- The update‑check module defines two foreground entry points, notice for cache reads and noticeFresh for spawning a worker and blocking up to a maximum wait. `lib/update-check.js:8` @55add4
