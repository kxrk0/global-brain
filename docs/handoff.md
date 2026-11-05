# Handoff — global-brain

## Where it stands (2026-11-05)

0.6.0 is released: npm `latest` = 0.6.0, `main` and tag `v0.6.0` pushed (commit c7a2b75).
Agensi listing text updated live on 2026-11-05 and the 0.6.0 ZIP resubmitted (listing v1.1,
waiting for Agensi's security scan and review; v1.0 stays live until then).

0.6.0 adds:
- English CLI output and digest header (`bin/query|remember|stats|forget.js`, `lib/render.js`,
  session titles `session YYYY-MM-DD`). Digest line format and `<!-- ENTRIES:START/END -->` unchanged.
- `global-brain uninstall [--dry-run] [--purge]` (`install/uninstall.js`): removes our hooks only,
  restores the status line (`statusLineOriginal`, else `statusLineWrap`, else removes it), strips
  the CLAUDE.md block, removes skill/engine/digest, keeps brain.db unless `--purge`.
  `init` now records `statusLineOriginal` and `installState` (which files it created) in config.json.
- `doctor` checks the status line.
- `lib/sqlite.js` drops Node 22's SQLite ExperimentalWarning (only that one).
- `lib/redact.js`: secrets masked before storage (transcript + `upsertEntry`), at render, and a
  one-time scrub of old rows on sync (`meta.redactVersion`).
- Fixed in passing: the noise filter and Co-Authored-By filter ran after `clean()` (which turns
  `-` into spaces) so `<command-name>` goals and co-author lines leaked in; cwd basename now
  splits on both separators; engines `>=22.13.0` (22.5–22.12 need `--experimental-sqlite`).
- Tests `test/*.test.js` (runner `test/run.js`), fixtures in `test/fixtures/projects/`.
- `agensi/SKILL.md` (not shipped to npm), `scripts/sync-version.js`, `scripts/build-agensi-zip.js`,
  `scripts/release-check.js`.

## Open threads

- Branch `vellum/add-dna-config-file-and-test-plan-docume` was left alone. Its last commit
  (249fb37) breaks `render.js` (`r.tags.join` on a JSON string throws, so the digest is never
  written), changes the digest format and tracks `lib/*.bak`. Do not merge it as is.
- First push was blocked by GitHub push protection (a fake Stripe key in a test). Fake
  credentials now live only in `test/fake-secrets.js`, assembled from parts at runtime; never
  commit a token-shaped literal. The release branch was squashed to one commit before its first
  push; the pre-rewrite state is kept locally as `backup/release-0.6.0-pre-rewrite` (delete
  once 0.6.0 is out).
- Untracked junk in the working tree: `nul`, `.vellum/` (from that tool). Not touched.
- Agensi v1.1 review pending. If it is rejected, the reason shows on the Agensi dashboard.

## How to resume

```bash
npm test                 # all tests, temp CLAUDE_CONFIG_DIRs only
npm run release:check    # version pin + tests + npm pack contents + dist/ Agensi ZIP; never publishes
```

Node 22 check: a verified portable Node 22 was used from the session scratchpad; any Node 22.13+
works (`<node22> test/run.js`). The ExperimentalWarning only shows on 22.x, not 24.

Release (user runs): `git push -u origin release/0.6.0`, merge to main, `npm publish`,
upload `dist/global-brain-agensi-0.6.0.zip` to Agensi.

## Working agreements

- Speak Turkish, short. No `npm publish`, `git push` or Agensi update without the user's OK
  (project-specific, overrides the global "ship without asking").
- Tests must never touch the real `~/.claude` (helpers set CLAUDE_CONFIG_DIR/HOME/USERPROFILE to temp).
