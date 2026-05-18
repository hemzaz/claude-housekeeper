---
description: Inspect Claude Code home state and run guarded Housekeeper cleanup/rollback
argument-hint: '[diagnose|plan|verify|clean|harden|rollback|learn|prune] [--safe] [--json] [--redact] [--scope=settings|plugins|registry|housekeeper|all] [--home=/path] [--max-files=N] [--config=/path] [clean: --batch=N --stream] [rollback: <op_id> | --stream=<stream_id>] [learn: --prune --older-than=N | --mark-false-positive <op_id>]'
disable-model-invocation: true
allowed-tools: Bash(node:*), Bash(claude:*)
---

Run the Claude Housekeeper command from this plugin.

Raw slash-command arguments:
`$ARGUMENTS`

Default behavior:
- No arguments means `diagnose`.
- `diagnose`, `plan`, and `verify` are read-only.
- `--safe` adds a stricter posture: parses configuration only, refuses to start MCP servers, refuses to run hooks.
- `--redact` collapses the home prefix to `~` and scrubs secrets, tokens, and credentials so the output is share-safe.
- `--scope` defaults to `all`. Valid values: `settings`, `plugins`, `registry`, `housekeeper`, `all`.
- `clean --confirm --yes --target=plugin.cache_unreferenced --path=<absolute path>` can remove one outside-grace plugin cache version after snapshotting it.
- `rollback <id> --confirm --yes` restores a Housekeeper operation from its snapshot.
- `rollback --stream=<stream_id> --confirm --yes` restores all chunks of a stream operation in reverse order.
- `clean --batch=N --stream --confirm --yes` runs a large batch as fixed 50-item chunks; halts on first failure without auto-rollback.
- Treat diagnostic output as a report, not permission to mutate.
- `harden` exists on the command surface but still refuses mutation.
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
