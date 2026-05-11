# Claude Housekeeper

Safe Claude Code home inspection and guarded cleanup for broken hooks,
plugin cache drift, and protected local state.

Claude Housekeeper is a Claude Code home inspector: a plugin and local CLI
that reports drift in the parts of a Claude setup that tend to accumulate
over time. The first wedge focuses on settings hooks, plugin cache
versions, the local command and skill registry, and Housekeeper's own
operation manifests.

The product promise is simple: run one inspection command, get a report
with stance, evidence, missing keys, and boundaries, and understand what
is happening before Claude starts failing mid-session.

`diagnose`, `plan`, and `verify` are read-only. `clean --confirm --yes`
can remove one outside-grace plugin cache version after creating a
Housekeeper-owned snapshot, and `rollback <id> --confirm --yes` restores
that operation from the snapshot. `harden` is still planned and refuses
mutation.

## Command Surface

```bash
claude-housekeeper                                 # alias for diagnose
claude-housekeeper diagnose                        # read-only report
claude-housekeeper plan                            # read-only detailed findings
claude-housekeeper verify                          # Claude CLI smoketest probes
claude-housekeeper clean                           # dry-run; refuses mutation
claude-housekeeper clean --confirm                 # refuses without --yes
claude-housekeeper clean --confirm --yes \
    --target=plugin.cache_unreferenced \
    --path=<absolute path>                         # mutates a single plugin cache
                                                   # version (v0.2.0-beta.1)
claude-housekeeper harden                          # planned; refuses mutation
claude-housekeeper rollback <id> --dry-run         # shows restore plan
claude-housekeeper rollback <id> --confirm --yes   # restores from snapshot
```

Three detectors are cleanable in v0.2.0-beta.1: `plugin.cache_unreferenced`
(plugin cache versions OUTSIDE the 7-day grace window),
`housekeeper.stale_lock` (concurrency lockfile older than 30 min), and
`registry.local_command_identical` (local command byte-identical to its
plugin counterpart). Everything else routes to `refused[]` with a
structured reason — see [`docs/design/clean-design.md`](docs/design/clean-design.md)
for the full taxonomy and the "Current Checks" table below for the
per-detector status.

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
  finding: no first-wedge issues found
  evidence: settings parsed; plugin registry parsed; hook direct paths exist
  missing key: live Claude probes were not run in safe mode
  next step: none

STANCE SUMMARY
  inform   1
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

BLOCKED ACTIONS
  claim healthy
```

`--home` takes a normal user home directory and resolves its `.claude`
subdirectory. Passing the `.claude` directory itself is also accepted for
fixture and test harnesses.

See [docs/compatibility-matrix.md](docs/compatibility-matrix.md) for
the tested platform matrix and
[docs/schema-stability.md](docs/schema-stability.md) for the stable
JSON fields the `--json` output guarantees.

## SessionStart Prevention Hook

Housekeeper ships an optional SessionStart hook at `hooks/session-start.mjs`
that runs `diagnose --safe --json` whenever a Claude Code session begins
and prints a one-line stderr warning if any `block` or `probe` findings are
present. It is quiet for routine `inform`/`watch`/`review` state, exits 0
in every case (it must never block session start), and times out at 5
seconds.

Per `docs/mode-doctrine.md` it must be installed by the user explicitly;
Housekeeper does not auto-install hooks. Add to your `settings.json`:

```jsonc
{
  "hooks": {
    "SessionStart": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node /absolute/path/to/claude-housekeeper/hooks/session-start.mjs"
          }
        ]
      }
    ]
  }
}
```

Set `HOUSEKEEPER_SESSION_HOOK=off` in the environment to silence the hook
without removing the configuration.

## Safety Model

Housekeeper follows these rules:

1. No direct path from observation to action.
2. Surface first, finding second, action last.
3. Every finding carries evidence and a stance.
4. Protected means protected.
5. Claude checkpointing is not Housekeeper rollback.
6. Mutation requires Housekeeper-owned rollback proof.

`diagnose`, `plan`, and `verify` never modify files. `clean --confirm --yes`
and `rollback <id> --confirm --yes` are the only mutation paths in
v0.2.0-beta.1; both require Housekeeper-owned manifests and rollback proof.
`harden` remains visible but refuses mutation.

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
registry, and Housekeeper's own operation manifest. The table below
marks each detector's cleanable status in v0.2.0.

Status legend:

- **cleanable** — `clean --confirm --yes` will act on this finding.
- **planned** — read-only today; will move to cleanable in a future
  v0.2.x patch or v0.3 phase.
- **never** — informational or judgment-laden by design; will not
  become cleanable. Surface only.

| Detector id | Status in v0.2.0 |
|---|---|
| `settings.invalid_json` | planned |
| `settings.hook_path_dangling` | planned |
| `settings.hook_command_shell_ambiguous` | planned |
| `settings.mcp_command_missing` | planned |
| `plugin.expected_orphan` | never (locked decision Q-USER-3) |
| `plugin.cache_unreferenced` | **cleanable** |
| `plugin.cache_referenced_by_hook` (v0.2.0-beta) | never (protected by hook reference) |
| `plugin.duplicate_registration` | never (which duplicate to keep is a judgment call) |
| `plugin.cache_size` | never (size is a signal, not a verdict) |
| `registry.local_skill_shadow` | planned |
| `registry.local_command_identical` | **cleanable** (v0.2.0-beta.1) |
| `registry.local_command_diverged` | never (intent-laden) |
| `registry.broken_frontmatter` | planned |
| `housekeeper.interrupted_operation` | recovery via `rollback <id>` or `rollback --abort <id>` |
| `housekeeper.config_invalid` | planned |
| `housekeeper.operations_unreadable` | never (informational) |
| `housekeeper.stale_lock` (v0.2.0-beta) | **cleanable** (v0.2.0-beta.1) |
| `home.not_found` | never (informational) |
| `home.scan_budget_hit` | never (informational) |
| `home.clean` | never (meta-detector; informational) |

Hygiene and state findings (large logs, zombie state, corrupt backups,
drift directories, file-history age) are deferred alongside the
knowledge layer.

See [`CHANGELOG.md`](CHANGELOG.md) for the full per-tag delta,
[`docs/migration-v0.1-to-v0.2.md`](docs/migration-v0.1-to-v0.2.md) for
the v0.1 → v0.2 upgrade guide, and [`docs/threat-model.md`](docs/threat-model.md)
for the single-user trust boundaries that back the mutation surface.

## Roadmap

Shipped:

- Safe out-of-band first wedge for broken hooks, plugin cache drift, and local registry shadow
- Stance-first report format with eight stances
- Surface classification on every finding (nine axes plus per-detector safe-mode limits)
- Stable JSON schema (`schemaVersion: "0.1"`) including `findings[].targetPath`
- `--safe` posture and `--redact` privacy mode
- Self-failure read-only degradation
- Optional SessionStart prevention hook (see above)
- CLI `--help` and `--version`
- GitHub Pages product site and CI matrix on Ubuntu + macOS × Node 20 + 22
- **v0.2.0-alpha.1: snapshot-backed `clean --confirm --yes` and `rollback <id> --confirm --yes`** for `plugin.cache_unreferenced` (outside-grace plugin cache versions). Includes atomic write-temp+rename+fsync snapshot protocol, per-operation budget (50 files / 10 MiB), per-detector safe-mode limits, concurrency lockfile, rollback dry-run plans, and operation manifests under `<home>/.claude/housekeeper/operations/`.
- **v0.2.0-beta.1 (Phase 9):** interrupted-operation recovery. `rollback --abort <id>` cancels a `snapshot_taken`/`planned` operation; `SessionStart` hook surfaces non-terminal manifests; legacy pre-v0.2 manifests are detected and reported; audit findings include recovery hints (`rollback <id>` or `rollback --abort <id>`).
- **v0.2.0-beta.1 (Phase 10):** broadened cleanable set with a `file-unlink` mutation kind. `housekeeper.stale_lock` and `registry.local_command_identical` join `plugin.cache_unreferenced` as cleanable detectors.

Coming:

- Local learning from false positives, protected paths, accepted plans, and rollback outcomes
- More precise settings schema checks (`settings.invalid_json`, `settings.hook_path_dangling`, `settings.mcp_command_missing`)
- `harden --confirm` (settings/hook patching) — v0.3

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
