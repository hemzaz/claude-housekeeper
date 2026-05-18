# Claude Housekeeper

[![CI](https://github.com/hemzaz/claude-housekeeper/actions/workflows/ci.yml/badge.svg)](https://github.com/hemzaz/claude-housekeeper/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![npm version](https://img.shields.io/npm/v/claude-housekeeper.svg)](https://www.npmjs.com/package/claude-housekeeper)

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
removes outside-grace plugin cache versions, stale concurrency locks, or
duplicate local commands after creating a Housekeeper-owned snapshot;
`clean --batch=<n>` aggregates multiple `file-unlink` operations under
one manifest (v0.3.0); `clean --batch=N --stream` chunks a large batch
into per-chunk snapshot + apply + verify cycles (v0.4.0). `harden --confirm --yes` rewrites
`settings.json` under the same snapshot contract to remove dangling
hook paths, missing MCP commands, or to rewrite an MCP command path
(v0.3.0 / v0.4.0). `learn` surfaces what Housekeeper has observed from
past operations (v0.4.0). `prune` audits plugins that are candidate
stale past the grace window (v0.4.0). `rollback <id> --confirm --yes` restores any operation
from its snapshot.

## Command Surface

```bash
claude-housekeeper                                 # alias for diagnose
claude-housekeeper diagnose                        # read-only report
claude-housekeeper plan                            # read-only detailed findings
claude-housekeeper verify                          # Claude CLI smoketest probes
claude-housekeeper learn                           # learning summary (v0.4.0)
claude-housekeeper learn --json                    # machine-readable summary
claude-housekeeper learn --prune --older-than=30   # prune entries older than N days
claude-housekeeper learn \
    --mark-false-positive <op_id>                  # mark a refusal as false positive
claude-housekeeper prune                           # audit plugins not referenced past
                                                   # grace window (v0.4.0, audit only)
claude-housekeeper clean                           # dry-run; refuses mutation
claude-housekeeper clean --confirm                 # refuses without --yes
claude-housekeeper clean --confirm --yes \
    --target=plugin.cache_unreferenced \
    --path=<absolute path>                         # mutates a single plugin cache
                                                   # version (v0.2.0-beta.1)
claude-housekeeper clean --confirm --yes --batch=<n> \
    --target=<id> --path=<path> \
    --target=<id> --path=<path>                    # aggregates N file-unlink ops
                                                   # under one manifest (v0.3.0)
claude-housekeeper clean --confirm --yes \
    --batch=<n> --stream \
    --target=<id> --path=<path> [...]              # streams large batch in chunks;
                                                   # requires --batch=N > 50 (v0.4.0)
claude-housekeeper harden                          # dry-run plan view (v0.3.0)
claude-housekeeper harden --confirm --yes \
    --target=settings.hook_path_dangling \
    --path=<absolute settings.json path>           # rewrites settings.json under
                                                   # snapshot (v0.3.0)
claude-housekeeper harden --confirm --yes \
    --mcp-command-rewrite=<old>=<new>              # rewrites MCP server command
                                                   # path in settings.json (v0.4.0)
claude-housekeeper rollback <id> --dry-run         # shows restore plan
claude-housekeeper rollback <id> --confirm --yes   # restores from snapshot
```

Three detectors are cleanable in v0.2.0: `plugin.cache_unreferenced`
(plugin cache versions OUTSIDE the 7-day grace window),
`housekeeper.stale_lock` (concurrency lockfile older than 30 min), and
`registry.local_command_identical` (local command byte-identical to its
plugin counterpart). Three more become **hardenable** in v0.3.0:
`settings.hook_path_dangling`, `settings.mcp_command_missing`, and
`settings.invalid_json` (the last surfaces with a `harden` next-step but
refuses on invocation per Q1 — see
[`docs/migration-v0.2-to-v0.3.md`](docs/migration-v0.2-to-v0.3.md)).
Four new detectors land in v0.4.0: `plugin.unused_past_grace` (surfaced
by `prune`), `registry.command_dangling`, `hooks.config_dangling`, and
`registry.skills_entry_dangling` (the last three are hardenable via
`json-rewrite`). Everything else routes to `refused[]` with a structured
reason — see [`docs/design/clean-design.md`](docs/design/clean-design.md)
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
the tested platform matrix,
[docs/schema-stability.md](docs/schema-stability.md) for the stable
JSON fields the `--json` output guarantees, and
[docs/versioning-policy.md](docs/versioning-policy.md) for what counts
as a breaking change.

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

`diagnose`, `plan`, and `verify` never modify files. `clean --confirm --yes`,
`harden --confirm --yes`, and `rollback <id> --confirm --yes` are the only
mutation paths in v0.3.0; all three require Housekeeper-owned manifests
and rollback proof. `harden` further requires a `hardenable: true`
detector and a successful `settings-rewrite.preApply` (idempotency,
strict JSON, no JSONC comments).

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

| Detector id | Status in v0.2.0 | Hardenable in v0.3.0 | v0.4.0 |
|---|---|---|---|
| `settings.invalid_json` | planned | **candidate** (surfaces `settings-shape-unknown` refusal — design §2.1) | — |
| `settings.hook_path_dangling` | planned | **hardenable** (T-300) | — |
| `settings.hook_command_shell_ambiguous` | planned | no | — |
| `settings.mcp_command_missing` | planned | **hardenable** (T-301) | — |
| `plugin.expected_orphan` | never (locked decision Q-USER-3) | no | — |
| `plugin.cache_unreferenced` | **cleanable** | no | — |
| `plugin.cache_referenced_by_hook` (v0.2.0-beta) | never (protected by hook reference) | no | — |
| `plugin.duplicate_registration` | never (which duplicate to keep is a judgment call) | no | — |
| `plugin.cache_size` | never (size is a signal, not a verdict) | no | — |
| `plugin.unused_past_grace` | — | — | **new** — audit via `prune`; uninstall mutation in v0.4.1 |
| `registry.local_skill_shadow` | planned | no | — |
| `registry.local_command_identical` | **cleanable** (v0.2.0-beta.1) | no | — |
| `registry.local_command_diverged` | never (intent-laden) | no | — |
| `registry.broken_frontmatter` | planned | no | — |
| `registry.command_dangling` | — | — | **new** — **hardenable** via `json-rewrite` (T-401) |
| `registry.skills_entry_dangling` | — | — | **new** — **hardenable** via `json-rewrite` (T-403) |
| `hooks.config_dangling` | — | — | **new** — **hardenable** via `json-rewrite` (T-402) |
| `housekeeper.interrupted_operation` | recovery via `rollback <id>` or `rollback --abort <id>` | no | — |
| `housekeeper.config_invalid` | planned | no | — |
| `housekeeper.operations_unreadable` | never (informational) | no | — |
| `housekeeper.stale_lock` (v0.2.0-beta) | **cleanable** (v0.2.0-beta.1) | no | — |
| `home.not_found` | never (informational) | no | — |
| `home.scan_budget_hit` | never (informational) | no | — |
| `home.clean` | never (meta-detector; informational) | no | — |

Hygiene and state findings (large logs, zombie state, corrupt backups,
drift directories, file-history age) are deferred alongside the
knowledge layer.

See [`CHANGELOG.md`](CHANGELOG.md) for the full per-tag delta,
[`docs/migration-v0.1-to-v0.2.md`](docs/migration-v0.1-to-v0.2.md) and
[`docs/migration-v0.2-to-v0.3.md`](docs/migration-v0.2-to-v0.3.md) for
the upgrade guides, and [`docs/threat-model.md`](docs/threat-model.md)
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
- **v0.3.0:** `harden --confirm --yes` for guarded `settings.json` rewrite through a new `settings-rewrite` mutation kind. Three settings detectors (`settings.hook_path_dangling`, `settings.mcp_command_missing`, `settings.invalid_json`) promoted to **hardenable**. `clean --batch=<n>` aggregates multiple `file-unlink` operations under one manifest (manifest-atomic, no auto-rollback). Two-phase JSONC detection splits `settings.jsonc_detected` from `settings.invalid_json`. CI version-pin check. See the [v0.2 → v0.3 migration guide](docs/migration-v0.2-to-v0.3.md).
- **v0.4.0-beta.1:** On-disk learning loop (`learn`, `prune` subcommands; `refusals.jsonl`, `applied.jsonl`, `rollbacks.jsonl`, `state.json` under `learning/`). `lock.history` JSONL. `harden --mcp-command-rewrite=<old>=<new>` for MCP command path rewrite. `clean --batch=N --stream` for chunked streaming of large batches. Four new detectors: `plugin.unused_past_grace`, `registry.command_dangling`, `hooks.config_dangling`, `registry.skills_entry_dangling`. `json-rewrite` canonical mutation kind; `settings-rewrite` kept as back-compat alias. JSONC-aware rewrite: comments survive `harden` round-trips. Pre-commit forbidden-language hook. See the [v0.3 → v0.4 migration guide](docs/migration-v0.3-to-v0.4.md).

Coming:

- **v0.4.1:** Plugin uninstall mutation wired to `plugin.unused_past_grace` after the audit window validates the heuristic.
- **v0.5:** Suggestion engine (proactive `nextStep` recommendations based on learning history); `--stream` resume across invocations.
- Cross-kind batches that include `settings-rewrite` (deferred per C6 ruling)

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

### Runtime dependency (v0.4)

v0.4 introduces one runtime dependency: `jsonc-parser` (Microsoft, MIT licence,
zero transitive dependencies). It is used by
`MUTATION_REGISTRY["json-rewrite"].preApply` and `.apply` to perform
comment-preserving JSONC rewrites via `modify()` + `applyEdits()`, so that
`settings.json` files containing `//` line comments or `/* */` block comments
are hardened without silently discarding the user's comments
(`docs/design/v0.4-design.md §3.5`, platform memo §4.4). All other modules
remain pure Node.js built-ins with no external dependencies.

### Pre-commit hook

A forbidden-language check runs automatically before each commit. The hook
(`scripts/pre-commit-check.mjs`) scans staged files for the 13 hard-banned
phrases and contextual rules defined in `test/forbidden-language.test.mjs`,
failing the commit with the file name, line number, and matched phrase — the
same surface CI emits. It is activated automatically when you run `npm install`
(the `prepare` script runs `git config core.hooksPath .husky`), so no manual
setup is needed for new contributors.

### Soak runner

Before tagging a GA release (per `notes/RELEASE-READINESS-v0.2.0.md §5`),
run `scripts/soak.sh` nightly for 5–7 nights against a real Claude home.
The script is read-only — it never invokes `clean`, `rollback`, or
`harden` — and writes one dated directory per night into
`.omc/research/soak-YYYYMMDD/`.

```bash
# Default: against ~/.claude
scripts/soak.sh

# Against a specific home
scripts/soak.sh /path/to/.claude
CLAUDE_HOME=/path/to/.claude scripts/soak.sh
```

The script PASSes when no stop conditions trigger (`filesChanged: true`
in any read-only output, schemaVersion drift, malformed op id, empty
refusal message) and exits 2 if any do.

## FAQ

**Why does `clean` refuse my obvious orphan plugin?**
Claude Code itself removes orphaned plugin cache versions about seven days
after they fall out of the registry (see
[`docs/loader-semantics.md`](docs/loader-semantics.md) §2 + §7). Housekeeper
honors the same grace window. Inside the seven days, the directory is still
in the loader's recovery path; `plugin.expected_orphan` surfaces it as
`watch`, not `cleanable`. Once the grace expires the same directory
re-surfaces as `plugin.cache_unreferenced` and `clean` will act on it.

**Can I undo a rollback?**
No. `rollback <id> --confirm --yes` is terminal — once it completes, the
operation manifest moves to `rolled_back` and the snapshot is kept only for
garbage collection. The "rollback the rollback" path does not exist by
design; the snapshot exists to undo a `clean`, not to undo a restore.

**What if I lose `<home>/.claude/housekeeper/`?**
Operation history is gone, but no live Claude data is affected (operations
live in their own directory tree). `diagnose`/`plan`/`verify` keep working
as read-only inspectors. `clean` and `rollback` refuse to operate without
snapshot proof, which is the conservative behavior — you cannot
accidentally re-apply or undo something whose manifest no longer exists.

**Why doesn't `harden` hot-reload Claude?**
Claude Code does not document a hot-reload protocol for `settings.json`.
After `harden --confirm --yes` rewrites the file, exit and restart any
running Claude session for the new settings to take effect.

**Why does `clean --batch=<n>` refuse `settings-rewrite`?**
v0.3 batching covers the `file-unlink` mutation kind only (C6 ruling, see
[`docs/migration-v0.2-to-v0.3.md`](docs/migration-v0.2-to-v0.3.md)).
Settings rewrites need their own snapshot + pre-apply check per file and
do not share a manifest with unlinks. Use `harden --confirm --yes` for
each `settings.hook_path_dangling` / `settings.mcp_command_missing`
finding individually.

**When will JSONC be supported?**
JSONC is supported in v0.4.0. `jsonc-parser`'s `modify()` + `applyEdits()`
preserves `//` and `/* */` comments through the `harden` round-trip. If you
previously saw `settings.jsonc_detected` and were advised to remove comments
before hardening, you no longer need to. The refusal class
`settings-jsonc-rewrite-failed` fires only when the parser's round-trip
output diverges from the input — a conservative safety net.

**Why is v0.3 only three detectors hardenable?**
Phase 3 of v0.3 deliberately promoted the safest, most reversible
settings detectors first (`settings.hook_path_dangling`,
`settings.mcp_command_missing`, `settings.invalid_json`). Detectors with
intent-laden choices (which duplicate to keep, which diverged file is
authoritative) stay surface-only — see the table under
[Current Checks](#current-checks) for the full per-detector status.

**How does learning work?**
Every `clean` or `harden` invocation — whether it applies a change or
refuses — appends a record to one of four JSONL files under
`<home>/.claude/housekeeper/learning/`. `refusals.jsonl` captures what
was refused and why. `applied.jsonl` captures what was successfully
applied. `rollbacks.jsonl` captures what was later rolled back. A
lightweight `state.json` file holds running counters so `learn` can
render a summary without reading every line. Run
`claude-housekeeper learn` to see the summary; `learn --json` for the
machine-readable form. Use `learn --mark-false-positive <op_id>` to
reduce the weight of a detector id that fires too aggressively on your
home. Use `learn --prune --older-than=<days>` to trim old entries.

**When should I use `prune`?**
Run `claude-housekeeper prune` any time you want to see installed plugins
that have not been involved in any applied operation within the 7-day
grace window and carry no active hook or command reference. This is an
audit-only view in v0.4.0 — no mutation occurs. The table tells you
which plugins are candidates for uninstall so you can decide whether to
remove them manually. v0.4.1 will wire the uninstall mutation after the
audit window validates the heuristic against real homes.

**What if `--stream` halts mid-stream?**
When a chunk fails, `clean --stream` rolls back the completed chunks in
reverse order and exits with a non-zero status. The partially-streamed
manifest stays at `status: applied` with `partialApply: true`. The
`housekeeper.interrupted_operation` detector will surface it on the next
`diagnose` run, and `nextStep` will route to `rollback <op_id>`. Stream
resume across invocations is not supported in v0.4.0 — restart with a
fresh batch.

**JSONC support — what changed in v0.4?**
In v0.3, any `settings.json` containing `//` or `/* */` comments
surfaced as `settings.jsonc_detected` at `inform` stance and was not
hardenable. In v0.4, `jsonc-parser` (Microsoft, MIT) preserves comments
through the rewrite via `modify()` + `applyEdits()`. The one new refusal
class is `settings-jsonc-rewrite-failed`, which fires only when the
parser's round-trip output diverges from the original — a per-file
safety net. The `settings.jsonc_detected` finding itself is now
hardenable: running `harden --confirm --yes` on a JSONC file will
succeed and preserve your comments.
