# Claude Housekeeper

Claude Housekeeper is a Claude Code home inspector: a plugin and local CLI for
finding the drift that makes Claude sessions noisy, brittle, or slow.

It audits the parts of a Claude setup that tend to rot over time: plugin caches, local command and skill registries, mode state files, settings hooks, and log/cache bloat.

The product promise is simple: run one read-only command, get a report, and know
what is happening, what needs review, what needs a probe, what is protected, and
what is blocked before Claude starts failing mid-session.

The current implementation is intentionally conservative:

- `diagnose` is read-only and prints a stance-first report.
- `plan` is read-only and prints concrete findings grouped by check.
- `verify` runs the smoketest probes that can be driven from the local `claude` binary.
- `clean`, `harden`, and `rollback` are exposed but currently refuse to mutate anything until snapshot/rollback mechanics are implemented.

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
claude-housekeeper diagnose --scope=state
claude-housekeeper diagnose --scope=settings
claude-housekeeper diagnose --scope=fs
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

- Plugin cache versions not referenced by `installed_plugins.json`
- Duplicate plugin registrations across scopes
- Plugin cache size accounting
- Hook commands that point at deleted plugin cache paths
- Local skill and command shadows against plugin-provided resources
- Byte-identical versus diverged local command copies
- Missing or incomplete YAML frontmatter
- Tiny registry files
- Zombie `*-state.json` mode files
- Expired cancel-signal files
- Large replay logs and top-level logs
- Old `file-history`, `paste-cache`, `shell-snapshots`, `session-data`, and `sessions` entries
- Corrupt backup files under 32 bytes
- Manual drift directories such as `_archive`, `_old`, `_tmp`, and `_diverged`

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
