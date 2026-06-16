---
name: global-brain
description: Cross-project persistent memory ("global brain") for Claude Code. Use when the user asks what you know across projects, wants to recall past decisions/work from ANY project, asks to remember something globally, or invokes /global-brain. Backed by a local SQLite brain at ~/.claude/global-brain/brain.db that auto-ingests Claude Code transcripts and renders a bounded digest loaded into every project via CLAUDE.md. Triggers: "/global-brain", "global hafıza", "ne biliyorsun", "hatırla (global)", "what do you know about", "recall across projects".
---

# Global Brain

A cross-project memory that survives sessions and loads in **every** project. Source of truth: `~/.claude/global-brain/brain.db` (SQLite). A bounded markdown view is rendered to `~/.claude/global-brain.md`, which `~/.claude/CLAUDE.md` `@`-imports — so the brain is already in your context at session start.

It ingests **one source**: Claude Code's own transcripts (`~/.claude/projects/*/*.jsonl`), parsed by `lib/transcript.js`, deduped by stable uid. No plugins, no external services — fully standalone. Automatic refresh runs on **SessionStart + Stop** hooks (`bin/sync.js`).

## How to run it

Prefer the `global-brain` CLI (installed on PATH):

- `global-brain stats` — entry counts per project/type
- `global-brain doctor` — health-check the install (runtime, hooks, digest import, db)
- `global-brain sync --report` — ingest now, report what was added
- `global-brain query <terms> [--project P] [--limit N]` — search
- `global-brain remember ...` — add a fact (see below)
- `global-brain forget <id>` — delete an entry

If the CLI isn't on PATH, the engine also lives at `~/.claude/global-brain/` — run `node "~/.claude/global-brain/bin/<script>.js"` directly.

## Commands

Parse the user's input after `/global-brain`:

- **(no args)** → `global-brain stats`. Show a short status + the available verbs. Run a `sync` first if last sync looks stale.
- **`sync`** → `global-brain sync --report`. Report what was ingested.
- **`<free-text question>`** → `global-brain query <terms>` (add `--project X` if the user named a project, `--limit N` for more). Read the rows, then **answer in prose**, citing entry `#id` and project. Don't dump rows — synthesize.
- **`remember <text>`** → `global-brain remember "<text>"` for a global pinned fact, OR the flagged form for precision:
  `global-brain remember --project <p> --type <decision|preference|architecture|constraint|fact|discovery> --title "..." --body "..." [--global] [--pin]`.
  Use `--global`/`--pin` when it should appear in the cross-project header.
- **`forget <id>`** → `global-brain forget <id>`. Pin/flag: `--pin <id>`, `--unpin <id>`, `--global <id>`.
- **`doctor`** → `global-brain doctor`. Report the health checklist.

## Advanced — model-in-the-loop distillation (your value-add)

The hook ingestion is heuristic (no LLM): it captures commits, topics, files, goals. **You** add intelligence. When the user runs `/global-brain sync` or asks you to "learn"/"consolidate", do an enrichment pass:

1. Look at what actually happened recently (this session, recent commits, decisions the user made). `global-brain sync --report` first to fold in the latest transcripts.
2. For each genuinely durable, **cross-project-valuable** fact (a preference, a convention, an architectural decision, a hard-won gotcha), write it with `global-brain remember` using a precise `--type`, real `--project`, a crisp `--title`, a one-line `--body`, and `--global` when it applies everywhere.
3. Keep it tight — promote signal, not session chatter. The heuristic layer already has the chatter covered.

This separation is the design: **automatic coarse capture + on-demand intelligent distillation**, both feeding one brain.

## Guarantees / invariants
- `bin/sync.js` never throws out or blocks the harness — it always exits 0 (it's a hook).
- Ingestion is idempotent: re-running never duplicates (uid dedup; session digests upsert in place).
- The digest is bounded by `config.json` (`maxTotalEntries`, `maxPerProject`, `tokenBudget`) so it can't bloat context.
- Internal observer/agent-memory transcripts are excluded; the brain only holds real project work.
- Edits to `~/.claude/global-brain.md` are overwritten by sync — change `config.json` or use `remember`/`forget` instead.

## When the user asks "what do you know about X"
Prefer the brain over guessing: run `global-brain query X`, then answer from the rows. If nothing matches, say so and offer `/global-brain sync` to refresh.
