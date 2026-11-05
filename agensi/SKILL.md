---
name: global-brain
description: Cross-project persistent memory for Claude Code. Use when the user asks what you know across projects, wants to recall past decisions from any project, asks to remember something globally, or invokes /global-brain. Backed by the open-source @kxrk0/global-brain CLI, which keeps a local SQLite brain and loads a bounded digest into every session.
license: MIT
---

# Global Brain

Cross-project memory for Claude Code. The source of truth is a local SQLite database at `~/.claude/global-brain/brain.db`. Nothing is sent to an external memory service.

## Setup (only if the CLI is missing)

Run `global-brain --version`. If the command is found, skip to Commands.

If it is missing, do not install anything yet. First tell the user exactly what installing will do, then ask for approval:

- Requires Node 22.13 or newer. Claude Code only.
- Installs the npm package `@kxrk0/global-brain` globally (MIT, source: https://github.com/kxrk0/global-brain).
- Its postinstall step copies the engine to `~/.claude/global-brain/` and the full skill to `~/.claude/skills/global-brain/`.
- Adds SessionStart and Stop hooks to `~/.claude/settings.json`.
- Wraps the current status line in `settings.json`, keeping the old one in `config.json` so it can be restored.
- Adds `@global-brain.md` to `~/.claude/CLAUDE.md`, so a bounded digest loads in every session.
- Reads Claude Code transcripts in `~/.claude/projects/` and stores extracted commits, topics, files and goals locally. Values that look like API keys, tokens or passwords are masked before they are stored or loaded into the digest.
- Network use: a background version check against `registry.npmjs.org`, at most every 15 minutes. Disable it with `GLOBAL_BRAIN_NO_UPDATE_CHECK=1`.

Only after the user approves, run:

```bash
npm install -g @kxrk0/global-brain@0.6.0
global-brain doctor
```

Then tell the user to restart Claude Code.

## Commands

Parse the input after `/global-brain`:

- No arguments: `global-brain stats`, then show a short status and the verbs below.
- `sync`: `global-brain sync --report`, then report what was ingested.
- A question: `global-brain query <terms> [--project P] [--limit N]`. Answer in prose, citing entry `#id` and project. If nothing matches, say so and offer a sync.
- `remember <text>`: `global-brain remember "<text>"`, or for precision `global-brain remember --project <p> --type <decision|preference|architecture|constraint|fact|discovery> --title "..." --body "..." [--global] [--pin]`.
- `forget <id>`: `global-brain forget <id>`. Confirm with the user first. Also `--pin <id>`, `--unpin <id>`, `--global <id>`.
- `doctor`: `global-brain doctor`, then report the checklist.

Keep what you save durable and useful across projects: preferences, conventions, architecture decisions and hard-won gotchas. Automatic capture already covers session chatter. Do not store secrets.

## Uninstall

Ask for approval, then run:

```bash
global-brain uninstall
npm uninstall -g @kxrk0/global-brain
```

`global-brain uninstall` removes the hooks, restores the previous status line, removes the `CLAUDE.md` import, the skill and the engine, and leaves every other setting alone. It keeps the saved memory (`~/.claude/global-brain/brain.db`). Preview it first with `global-brain uninstall --dry-run` if the user wants to see the changes.

Only if the user explicitly asks to delete their saved memory, use `global-brain uninstall --purge` instead. It permanently deletes `~/.claude/global-brain/`, including `brain.db`.
