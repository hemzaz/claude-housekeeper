# Claude Housekeeper

Read-only Claude Code home inspection for broken hooks, plugin cache drift,
and protected local state.

Claude Housekeeper is a Claude Code home inspector: a plugin and local CLI
that reports drift in the parts of a Claude setup that tend to accumulate
over time. The first wedge focuses on settings hooks, plugin cache
versions, the local command and skill registry, and Housekeeper's own
operation manifests.

The product promise is simple: run one read-only command, get a report
with stance, evidence, missing keys, and boundaries, and understand what
is happening before Claude starts failing mid-session.

No files changed. `diagnose`, `plan`, and `verify` are read-only.
`clean`, `harden`, and `rollback` are visible so the command surface is
stable, but they refuse mutation in v0.1 until snapshot and rollback
mechanics are implemented.

## Command Surface

```bash
claude-housekeeper                 # alias for diagnose
claude-housekeeper diagnose        # read-only report
claude-housekeeper plan            # read-only detailed findings
claude-housekeeper verify          # Claude CLI smoketest probes
claude-housekeeper clean --confirm # planned; currently refuses mutation
claude-housekeeper harden          # planned; currently refuses mutation
claude-housekeeper rollback <id>   # planned; currently refuses mutation
```

Scopes:

```bash
claude-housekeeper diagnose --scope=plugins
claude-housekeeper diagnose --scope=registry
claude-housekeeper diagnose --scope=settings
claude-housekeeper diagnose --scope=housekeeper
claude-housekeeper diagnose --scope=all
claude-housekeeper plan --config=~/.claude/housekeeper/config.json
```

## Usage

From the repository:

```bash
node scripts/claude-housekeeper.mjs diagnose
node scripts/claude-housekeeper.mjs plan
node scripts/claude-housekeeper.mjs diagnose --json
node scripts/claude-housekeeper.mjs verify
```

As a Claude plugin command after installation:

```text
/claude-housekeeper:housekeep diagnose
/claude-housekeeper:housekeep plan --scope=registry
/claude-housekeeper:housekeep verify
```

The design target is a single `claude housekeep` entrypoint if Claude Code exposes native CLI extension hooks. Until then, the plugin slash command and `claude-housekeeper` package bin are the supported surfaces.

## Recovery: when Claude itself is broken

The plugin surface is convenience. The standalone CLI is recovery. If
Claude Code plugin loading is broken, run Housekeeper without depending
on it:

```bash
# Local checkout
node ./scripts/claude-housekeeper.mjs diagnose --safe

# Or via the package runner (after publish)
npx claude-housekeeper diagnose --safe
```

`--safe` adds a stricter posture on top of read-only diagnose: it
parses configuration only, refuses to start MCP servers, refuses to
run hooks, and skips traversal under sector-boundary paths beyond
metadata.

## Example output

Running `diagnose` against the bundled `clean-home` fixture produces:

```text
$ node scripts/claude-housekeeper.mjs diagnose --safe --scope=settings --home=fixtures/synthetic-homes/clean-home/home/
HOUSEKEEPER REPORT
No files changed.

PRIMARY
  stance: inform
  finding: no findings
  evidence: none
  missing key: none
  next step: none

STANCE SUMMARY
  inform   0
  watch    0
  review   0
  probe    0
  protect  0
  prepare  0
  repair   0
  block    0

BOUNDARIES
  protected: 0
  sector-boundary: 0
  secret-adjacent skipped: 0

SCAN
  mode: safe
  degraded: no
  skipped: live Claude probes
```

`--home` takes a normal user home directory and resolves its `.claude`
subdirectory. Passing the `.claude` directory itself is also accepted for
fixture and test harnesses.

See [docs/compatibility-matrix.md](docs/compatibility-matrix.md) for
the tested platform matrix and
[docs/schema-stability.md](docs/schema-stability.md) for the stable
JSON fields the `--json` output guarantees.

## Safety Model

Housekeeper follows these rules:

1. No direct path from observation to action.
2. Surface first, finding second, action last.
3. Every finding carries evidence and a stance.
4. Protected means protected.
5. Claude checkpointing is not Housekeeper rollback.
6. Mutation requires Housekeeper-owned rollback proof.

Version `0.1.0` is read-only by design. `diagnose`, `plan`, and `verify` never modify files. `clean`, `harden`, and `rollback` are visible so the command surface is stable, but they currently refuse to mutate anything.

Future action planning will use stance vocabulary:

- `inform`: orient the user without implying action.
- `watch`: keep visible until a freshness or retention key changes.
- `review`: ask the user to resolve intent or ownership.
- `probe`: request a live Claude key before stronger claims.
- `protect`: report the finding but make action impossible.
- `prepare`: draft a reversible plan, without applying it.
- `repair`: propose a targeted fix with backup and verification requirements.
- `block`: stop because scope, policy, safety, or rollback proof is missing.

## Do-Not-Touch Rules

Housekeeper treats user protection rules as a hard boundary. A protected finding is still reported, but its risk becomes `protected`, it becomes non-actionable, and future cleanup code must skip it.

Default config locations:

```text
~/.claude/housekeeper/config.json
~/.claude/housekeeper.json
```

Example:

```json
{
  "doNotTouch": [
    {
      "path": "commands/net-cables.md",
      "reason": "hand-maintained local command"
    },
    {
      "path": "skills/jewelry-box/**",
      "reason": "private local skill experiments"
    },
    {
      "check": "fs.old_short_lived_cache",
      "path": "sessions/**",
      "reason": "keep resumable sessions"
    }
  ]
}
```

Rule fields:

- `path`: absolute path or path relative to `~/.claude`; exact files and directories are supported.
- `check`: optional check id such as `registry.local_command_diverged`.
- `reason`: human-readable explanation shown in `plan`.

Pattern support is deliberately small: exact paths, directories, `dir/*`, and `dir/**`.

## Current Checks

The v0.1 first wedge covers settings parse, hook path analysis, plugin
registry parse, plugin cache version map, the local command/skill
registry, and Housekeeper's own operation manifest. Detector ids:

- `settings.invalid_json`
- `settings.hook_path_dangling`
- `settings.hook_command_shell_ambiguous`
- `settings.mcp_command_missing`
- `plugin.expected_orphan`
- `plugin.cache_unreferenced`
- `plugin.duplicate_registration`
- `plugin.cache_size`
- `registry.local_command_shadow`
- `registry.local_skill_shadow`
- `registry.local_command_identical`
- `registry.local_command_diverged`
- `registry.broken_frontmatter`
- `housekeeper.interrupted_operation`

Hygiene and state findings (large logs, zombie state, corrupt backups,
drift directories, file-history age) are deferred to v0.2 alongside the
knowledge layer.

## Roadmap

- Safe out-of-band first wedge for broken hooks and plugin cache drift
- Stance-first report format
- Surface classification in every finding
- Snapshot-backed `clean` with one-line rollback output
- `rollback <id>` restore flow
- SessionStart prevention hook for collisions, stale hooks, corrupt backups, and zombie state
- Local learning from false positives, protected paths, accepted plans, and rollback outcomes
- More precise settings schema checks
- A non-interactive subagent dispatch smoketest
- GitHub Pages product site and CI publishing

## Known Limitations

- The frontmatter parser is intentionally minimal and may reject complex YAML.
- Shell hook path detection is conservative and can miss paths hidden behind environment expansion or wrapper scripts.
- State-file zombie checks use timestamps only; future versions should also verify live process/session evidence.
- Directory size accounting is useful for diagnosis but is not itself a cleanup recommendation.

## Development

```bash
npm test
npm run lint
npm run format
```
