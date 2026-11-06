---
section: seams
generatedAt: 1789458851764
model: gpt-oss:120b-cloud
---

- A foreground process must never perform fetch then process.exit; all network activity runs in a detached worker. `lib/update-check.js:2` @9f3e2e
- Every C0 control character (0x00–0x1f) is stripped from OSC payloads. `lib/update-check.js:32` @454a30
- The noticeFresh function may block only up to maxWaitMs using a CPU‑free wait, never performs foreground network, and falls back to cached data if the worker is slow. `lib/update-check.js:110` @d07952
- The open function creates the base directory, sets PRAGMA busy_timeout = 4000 and journal_mode = WAL, and applies the schema when not read‑only. `lib/db.js:72` @594b3e
- The UPSERT statement updates entries by uid, never downgrades importance, and preserves manual pins and global flags. `lib/db.js:96` @83464e
- writeDigest writes the digest atomically by writing a temporary file then renaming it, avoiding truncated files. `lib/render.js:115` @a39896
- The clean function collapses runs of spaces and hyphens and must remain byte‑identical to the original to keep UID hashes stable. `lib/transcript.js:12` @ba9741
- The commit detection regex matches every commit method and ignores failed commits, ensuring only landed commits are recorded. `lib/transcript.js:29` @ca96ea
- The sync hook always exits with status 0, never throws, and must not block Claude Code. `bin/sync.js:3` @430fe4
