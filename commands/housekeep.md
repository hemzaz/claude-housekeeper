---
description: Inspect Claude Code home state with read-only Housekeeper diagnostics
argument-hint: '[diagnose|plan|verify] [--safe] [--json] [--redact] [--scope=settings|plugins|registry|housekeeper|all] [--home=/path] [--max-files=N] [--config=/path]'
disable-model-invocation: true
allowed-tools: Bash(node:*), Bash(claude:*)
---

Run the Claude Housekeeper command from this plugin.

Raw slash-command arguments:
`$ARGUMENTS`

Default behavior:
- No arguments means `diagnose`.
- `diagnose` and `plan` are read-only.
- `--safe` adds a stricter posture: parses configuration only, refuses to start MCP servers, refuses to run hooks.
- `--redact` collapses the home prefix to `~` and scrubs secrets, tokens, and credentials so the output is share-safe.
- `--scope` defaults to `all`. Valid values: `settings`, `plugins`, `registry`, `housekeeper`, `all`.
- The current first wedge is read-only diagnosis of broken hooks and plugin cache drift.
- Treat output as a report, not permission to mutate.
- `clean`, `harden`, and `rollback` exist on the command surface but refuse mutation in v0.1 (per `docs/build-readiness.md` §4); they are not listed in the suggested first-line argument set.
- Run `claude-housekeeper --help` from a shell for the full flag list and examples.

Run:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/claude-housekeeper.mjs" $ARGUMENTS
```

Return the command output to the user exactly enough to preserve:
- report sections, stance summary, and issue counts
- "No files changed" statements
- stance, missing-key, protected, or blocked language
- proposed commands or rollback instructions
- failure messages
- any verification probe that failed
