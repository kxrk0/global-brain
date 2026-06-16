---
name: global-brain
description: Cross-project persistent memory ("global brain") for Claude Code. Use when the user asks what you know across projects, wants to recall past decisions/work from ANY project, asks to remember something globally, or invokes /global-brain. Backed by a local SQLite brain at ~/.claude/global-brain/brain.db that auto-ingests Claude Code transcripts (reliable) and claude-mem observations (when present), and renders a bounded digest loaded into every project via CLAUDE.md. Triggers: "/global-brain", "global hafıza", "ne biliyorsun", "hatırla (global)", "what do you know about", "recall across projects".
---

# Global Brain

A cross-project memory that survives sessions and loads in **every** project. Source of truth: `~/.claude/global-brain/brain.db` (SQLite). A bounded markdown view is rendered to `~/.claude/global-brain.md`, which `~/.claude/CLAUDE.md` `@`-imports — so the brain is already in your context at session start.

It ingests from two sources, deduped by stable uid:
1. **Transcripts** (primary, reliable) — `~/.claude/projects/*/*.jsonl`, parsed by `lib/transcript.js`. Independent of any plugin hook, so it works even when claude-mem's capture is broken.
2. **claude-mem** (bonus) — `~/.claude-mem/claude-mem.db` observations/summaries, when populated. This is the "sync with claude-mem" path.

Automatic refresh runs on **SessionStart + Stop** hooks (`bin/sync.js`).

## Base path
All scripts live under `BRAIN = C:\Users\oguz\.claude\global-brain`. Run with `node "BRAIN\bin\<script>.js"`.

## Commands

Parse the user's input after `/global-brain`:

- **(no args)** → run `node "BRAIN\bin\stats.js"`. Then show the user a short status and the available verbs. Optionally run a `sync` first if last sync looks stale.
- **`sync`** → run `node "BRAIN\bin\sync.js" --report`. Report what was ingested.
- **`<free-text question>`** → run `node "BRAIN\bin\query.js" <terms>` (add `--project X` if the user named a project, `--limit N` for more). Read the rows, then **answer the user's question in prose**, citing entry `#id` and project. Do not just dump rows — synthesize.
- **`remember <text>`** → run `node "BRAIN\bin\remember.js" "<text>"` for a global pinned fact, OR the flagged form for precision:
  `node "BRAIN\bin\remember.js" --project <p> --type <decision|preference|architecture|constraint|fact|discovery> --title "..." --body "..." [--global] [--pin]`.
  Use `--global`/`--pin` when it should appear in the cross-project header.
- **`forget <id>`** → `node "BRAIN\bin\forget.js" <id>`. Pin/flag: `--pin <id>`, `--unpin <id>`, `--global <id>`.

## Advanced — model-in-the-loop distillation (your value-add)

The hook ingestion is heuristic (no LLM): it captures commits, topics, files, goals. **You** add intelligence. When the user runs `/global-brain sync` or asks you to "learn"/"consolidate", do an enrichment pass:

1. Read the latest claude-mem observations if any: query the DB read-only, or run `node "BRAIN\bin\sync.js" --report`.
2. Look at what actually happened recently (this session, recent commits, decisions the user made).
3. For each genuinely durable, **cross-project-valuable** fact (a preference, a convention, an architectural decision, a hard-won gotcha), write it with `remember.js` using a precise `--type`, real `--project`, a crisp `--title`, a one-line `--body`, and `--global` when it applies everywhere.
4. Keep it tight — promote signal, not session chatter. The heuristic layer already has the chatter covered.

This separation is the design: **automatic coarse capture + on-demand intelligent distillation**, both feeding one brain.

## Guarantees / invariants
- `bin/sync.js` never throws out or blocks the harness — it always exits 0 (it's a hook).
- Ingestion is idempotent: re-running never duplicates (uid dedup; session digests upsert in place).
- The digest is bounded by `config.json` (`maxTotalEntries`, `maxPerProject`, `tokenBudget`) so it can't bloat context.
- claude-mem internal observer transcripts are excluded; the brain only holds real project work.
- Edits to `~/.claude/global-brain.md` are overwritten by sync — change `config.json` or use `remember`/`forget` instead.

## When the user asks "what do you know about X"
Prefer the brain over guessing: run `query.js X`, then answer from the rows. If nothing matches, say so and offer `/global-brain sync` to refresh.
