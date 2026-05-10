# Safe Mode

Safe mode is an out-of-band recovery posture for broken Claude homes.

It exists because Housekeeper cannot rely on Claude plugin loading when Claude plugin loading may be the thing that is broken.

## Purpose

Safe mode answers:

> What can we know without trusting the Claude loader, running hooks, starting MCP servers, or executing plugin code?

Safe mode is not cleanup.

Safe mode is not verification.

Safe mode is triage.

## Entry Point

Safe mode must be available outside Claude Code.

Preferred:

```bash
claude-housekeeper diagnose --safe
```

Allowed:

- standalone package binary
- local script from a cloned repo

Not sufficient:

- slash command only
- plugin command only
- anything requiring Claude session startup

## Hard Rules

Safe mode must not:

- invoke `claude` except possibly `claude --version` in a separate explicitly labeled live probe
- run hooks
- start MCP servers
- execute skill shell injection
- execute plugin binaries
- execute project scripts
- contact networks
- read secret-bearing file contents
- traverse unbounded directories
- mutate files

Safe mode may:

- parse JSON structure
- list metadata
- check direct path existence
- count bounded files
- inspect known-safe registry files
- report malformed config
- report missing direct paths
- report sector boundaries

## Minimum Viable Safe Scan

Inputs:

- Claude home root
- optional project root
- scan budget
- privacy mode

Checks:

1. Locate Claude home.
2. Parse `~/.claude/settings.json` if present.
3. Parse project `.claude/settings.json` and `.claude/settings.local.json` if scoped.
4. Parse `~/.claude/plugins/installed_plugins.json` if present.
5. Parse `.mcp.json` and MCP entries in `~/.claude.json` structurally, without starting servers.
6. Extract hook command strings, without executing them.
7. Check direct absolute paths in hook commands for existence.
8. List enabled plugin records and referenced install paths.
9. Identify missing install paths.
10. Identify obvious local command/skill shadows if scan budget allows.
11. Report interrupted Housekeeper operations if any.

Output:

- primary issue if one is obvious
- stance summary
- no-files-changed statement
- what was skipped due to safety or budget
- next recommended command

## Scan Budgets

Defaults should be conservative:

- max wall time: 1s for quick safe scan
- max files visited: fixed budget
- max bytes read per JSON file
- max bytes read per log: zero by default
- symlink traversal: off by default
- network mounts: skip by default when detectable

If budget is exceeded:

- return partial results
- mark scan as degraded
- show which budget was hit
- suggest manual full scan

## Privacy Mode

Privacy mode should:

- redact home path prefix
- redact usernames
- redact internal hostnames when possible
- avoid full command lines if they contain env-like tokens
- show structure and basename where enough
- never print secret values

## Live Probe Separation

Safe mode may suggest live probes but must not run them by default.

Live probes:

- `claude --version`
- `/doctor`
- `/status`
- `/context`
- `/skills`
- `/hooks`
- `/mcp`
- `/permissions`
- `claude --debug hooks`
- `claude --debug mcp`
- `claude plugin list`
- `claude -p ...`
- MCP status checks

These may load state, use credentials, write logs, or trigger lifecycle behavior.

Therefore they belong in a separate phase:

```text
safe scan -> user consent -> live probes
```

## Door/Key Boundary

Safe mode produces structural keys, not loader keys.

Allowed conclusions:

- settings file does not parse
- known settings file exists
- hook command contains a directly missing absolute path
- plugin cache contains old version directories
- old plugin version may be inside Claude's documented orphan grace period
- MCP config contains relative paths that may be cwd-sensitive
- scan was partial because a budget or boundary was hit

Disallowed conclusions:

- Claude definitely loaded this object
- Claude definitely ignored this object
- this cache is unused
- this MCP server is healthy
- this repair worked

Those require live loader or behavioral keys.

## Safe Mode Success

Safe mode succeeds when it produces a trustworthy report, even if the report says:

- config invalid
- scan degraded
- loader semantics unknown
- live probe required
- mutation blocked

Blocked with evidence is a valid success.
