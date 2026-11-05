# global-brain

Start here: read `docs/handoff.md` (current state, open threads, how to resume).

- `npm test` runs every test in throwaway `CLAUDE_CONFIG_DIR`s; never point tests at the real `~/.claude`.
- `npm run release:check` is the pre-release gate; it never publishes.
- Do not `npm publish`, `git push` or update Agensi without the user's approval.
