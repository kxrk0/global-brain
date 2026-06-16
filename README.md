# global-brain

Cross-project persistent memory — a **global brain** for [Claude Code](https://claude.com/claude-code).

A local SQLite brain that auto-ingests your Claude Code transcripts (and claude-mem
observations, when present), then renders a small, bounded markdown digest that gets
`@`-imported into **every** session via `CLAUDE.md`. Decisions, conventions, and hard-won
gotchas from one project are available in all the others — without bloating context.

- **Zero runtime dependencies.** Uses Node's built-in `node:sqlite`.
- **Never blocks the harness.** The sync hook always exits 0.
- **Bounded.** Token budget + per-project caps keep the digest small.
- **Idempotent.** Re-ingesting never duplicates; manual pins/flags survive re-sync.
- **Private.** Everything stays in `~/.claude/global-brain/brain.db` on your machine.

## Requirements

- Node **>= 22.5.0** (for `node:sqlite`; Node 24+ recommended — it's stable there).
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
- adds `@global-brain.md` to `~/.claude/CLAUDE.md`
- runs one initial sync

Then restart Claude Code (or start a new session) to load the digest.

If you installed without auto-wiring (local install, CI), run it manually:

```bash
global-brain init
```

## CLI

```text
global-brain init                 wire the brain into ~/.claude
global-brain sync [--report]      ingest transcripts + claude-mem, re-render the digest
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
npm uninstall -g @kxrk0/global-brain
```

Remove the SessionStart/Stop entries from `~/.claude/settings.json`, the `@global-brain.md`
line from `~/.claude/CLAUDE.md`, and (optionally) `~/.claude/global-brain/` and
`~/.claude/skills/global-brain/`.

## License

MIT
