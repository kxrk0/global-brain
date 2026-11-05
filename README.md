# global-brain

Cross-project persistent memory — a **global brain** for [Claude Code](https://claude.com/claude-code).

A local SQLite brain that auto-ingests your Claude Code transcripts, then renders a
small, bounded markdown digest that gets `@`-imported into **every** session via
`CLAUDE.md`. Decisions, conventions, and hard-won gotchas from one project are
available in all the others — without bloating context.

- **Fully standalone.** Reads Claude Code's own transcripts directly — no plugins, no external services.
- **Zero runtime dependencies.** Uses Node's built-in `node:sqlite`.
- **Never blocks the harness.** The sync hook always exits 0.
- **Bounded.** Token budget + per-project caps keep the digest small.
- **Idempotent.** Re-ingesting never duplicates; manual pins/flags survive re-sync.
- **Private.** Everything stays in `~/.claude/global-brain/brain.db` on your machine.
- **Secret-aware.** Values that look like API keys, tokens or passwords are masked as `[REDACTED]`
  before they are stored, and again when the digest is rendered (the digest reaches the model via `CLAUDE.md`).
- **Clean removal.** `global-brain uninstall` puts your settings back the way they were.

## Requirements

- Node **>= 22.13.0** (first 22.x with `node:sqlite` unflagged; Node 24+ recommended).
- Claude Code installed (the brain wires into its config dir).

## Install

```bash
npm install -g @kxrk0/global-brain
```

The global install auto-runs `global-brain init`, which wires everything into your
Claude Code config dir (`~/.claude`, or `$CLAUDE_CONFIG_DIR`):

- copies the engine to `~/.claude/global-brain/`
- installs the skill at `~/.claude/skills/global-brain/SKILL.md`
- registers **SessionStart** + **Stop** sync hooks in `settings.json` (merged, not clobbered)
- sets `statusLine` in `settings.json` to global-brain's status line, which shows the
  "update available" notice and otherwise runs your previous status line unchanged. The
  previous one is saved in `~/.claude/global-brain/config.json` (`statusLineWrap`,
  `statusLineOriginal`) so `uninstall` can restore it
- adds `@global-brain.md` to `~/.claude/CLAUDE.md`
- runs one initial sync

Then restart Claude Code (or start a new session) to load the digest.

If you installed without auto-wiring (local install, CI), run it manually:

```bash
global-brain init
```

## Updating

There is no background auto-update. Update with one command — the postinstall re-wires
the engine in `~/.claude/global-brain` automatically (your `config.json` and `brain.db`
are preserved):

```bash
npm install -g @kxrk0/global-brain@latest
```

### Update notice

When a newer version is published, global-brain surfaces it automatically:

- **At session start** — the SessionStart hook emits a `systemMessage`, so Claude Code shows
  a one-line "update available" notice until you upgrade. (Claude Code controls the styling;
  hooks can't set the color.)
- **In the status line** — the bottom row shows `↑ global-brain <version>` until you update,
  then hands the row back to your own status line.
- **In the CLI** — `doctor`, `stats`, `sync`, etc. print the same notice.

The actual registry lookup runs in a **detached background worker**, throttled to once every
15 minutes — no foreground process ever blocks on the network, and the cache is read instantly.
So a brand-new release shows up at most one session later. Disable the whole thing with
`GLOBAL_BRAIN_NO_UPDATE_CHECK=1`.

## CLI

```text
global-brain init                 wire the brain into ~/.claude
global-brain uninstall            undo init, keep brain.db   [--purge] [--dry-run]
global-brain doctor               health-check the install (runtime, hooks, status line, import, db)
global-brain sync [--report]      ingest Claude Code transcripts, re-render the digest
global-brain stats                entry counts per project/type
global-brain query <terms>        search   [--project P] [--limit N]
global-brain remember <text>      add a fact
                                  [--project P --type T --title .. --body .. --global --pin]
global-brain forget <id>          delete   [--pin <id> | --unpin <id> | --global <id>]
```

`--type` is one of `decision | preference | architecture | constraint | fact | discovery`.
Use `--global`/`--pin` to surface a fact in the cross-project header.

## In Claude Code

The skill responds to `/global-brain`:

- `/global-brain` — status + available verbs
- `/global-brain sync` — refresh now
- `/global-brain <question>` — searched and answered in prose, citing entries
- `/global-brain remember <text>` — distill a durable fact into the brain
- `/global-brain forget <id>` — drop an entry

## Configuration

`~/.claude/global-brain/config.json` (created on first init, never overwritten on upgrade):

| Key | Meaning |
|-----|---------|
| `tokenBudget` | Max tokens the rendered digest may occupy |
| `maxTotalEntries` / `maxPerProject` | Hard caps on what reaches the digest |
| `minImportanceForDigest` | Importance floor for digest inclusion |
| `recencyHalfLifeDays` / `recencyBoostMax` | Recency weighting |
| `typeWeights` | Per-type base importance |
| `pruneAfterDays` | Age at which low-value entries are pruned |
| `excludeProjects` | Project names to ignore |

Override the config dir with `CLAUDE_CONFIG_DIR`.

## Uninstall

```bash
global-brain uninstall
npm uninstall -g @kxrk0/global-brain
```

`global-brain uninstall` reverses `init` and touches nothing else:

- removes the global-brain **SessionStart** and **Stop** hook entries from `settings.json`
  (your other hooks, including ones in the same hook group, stay)
- restores the status line you had before `init`, or removes `statusLine` if you had none
- removes the `@global-brain.md` line and the heading `init` added from `CLAUDE.md`
- removes the skill, the copied engine and the rendered digest
- **keeps** your memory: `~/.claude/global-brain/brain.db` and `config.json`

Options:

- `--dry-run` prints what would change and changes nothing.
- `--purge` also deletes `~/.claude/global-brain/`, **including `brain.db`**. This cannot be undone.

Your Claude Code transcripts in `~/.claude/projects/` are never modified. Run `uninstall`
before `npm uninstall`: npm does not run uninstall scripts for global packages.

## Development

```bash
npm test                # all tests, in throwaway CLAUDE_CONFIG_DIRs (never touches ~/.claude)
npm run release:check   # version pin + tests + npm tarball contents + Agensi ZIP; never publishes
npm run agensi:zip      # dist/global-brain-agensi-<version>.zip, SKILL.md at the ZIP root
```

`agensi/SKILL.md` is the thin skill published on Agensi; it installs this package with the
user's approval. It is not part of the npm package. `npm version <x>` re-pins its install
command to the new version automatically.

## License

MIT
