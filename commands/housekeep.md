---
description: Inspect Claude Code home state with read-only Housekeeper diagnostics
argument-hint: '[diagnose|plan|clean|verify|harden|rollback] [--json] [--scope=plugins|registry|state|settings|fs|all] [--config=/path/to/config.json] [--confirm]'
disable-model-invocation: true
allowed-tools: Bash(node:*), Bash(claude:*)
---

Run the Claude Housekeeper command from this plugin.

Raw slash-command arguments:
`$ARGUMENTS`

Default behavior:
- No arguments means `diagnose`.
- `diagnose` and `plan` are read-only.
- The current first wedge is safe diagnosis of broken hooks and plugin cache drift.
- Treat output as a report, not permission to mutate.
- `clean`, `harden`, and `rollback` must not be treated as complete unless the script reports success.

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
