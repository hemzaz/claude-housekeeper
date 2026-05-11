# Changelog

All notable changes to **claude-housekeeper** are recorded here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html)
with two caveats documented in the design notes:

- Detector ids (`plugin.cache_unreferenced`, etc.) are stable within a major.
- Report `schemaVersion` (`"0.1"`) and operation-manifest `schemaVersion`
  (`"0.2"`) each move on their own line.

## [Unreleased]

### Added

- `CHANGELOG.md` (this file) covering every tagged release.
- `docs/migration-v0.1-to-v0.2.md` — user-facing v0.1 → v0.2 upgrade guide.
- `docs/threat-model.md` — single-user local threat model documenting
  trust boundaries for the snapshot, rollback, and operation-manifest
  surfaces. Records G13 (manifest signing) as deliberately out of scope
  for v0.2 with rationale.

### Changed

- `README.md` "Current Checks" now marks each detector as
  **cleanable in v0.2.0**, **planned**, or **never cleanable**.
- `README.md` and `docs/index.html` link to the new CHANGELOG,
  migration guide, and threat model.

## [0.2.0-beta.1] — 2026-05-11

First beta of the v0.2 line. Adds interrupted-operation recovery, broadens
the cleanable set with a `file-unlink` mutation kind, and tightens manifest
detection. 365 tests on the Ubuntu + macOS × Node 20 + 22 matrix.

### Added

- **Broaden cleanable set** (Phase 10, #64). `file-unlink` joins
  `dir-rmtree` as the second mutation kind. Two new detectors are now
  cleanable through `clean --confirm --yes`:
  - `housekeeper.stale_lock` — concurrency lockfile older than 30 min.
  - `registry.local_command_identical` — local command byte-identical
    to its plugin counterpart.
- **Interrupted-operation reminders** (#62). The SessionStart hook
  surfaces non-terminal operation manifests (`planned`,
  `snapshot_taken`, `applied` without `verified`) so users learn about
  stuck operations at session boundaries rather than the next clean.
- **Rollback abort flow** (#60). `rollback --abort <id>` cancels a
  `snapshot_taken` or `planned` operation and removes its unused
  snapshot tree.
- **Interrupted-operation recovery hints** (#59). Audit findings for
  `housekeeper.interrupted_operation` now carry a `nextStep` that
  names the exact `rollback <id>` or `rollback --abort <id>` command
  to run.

### Changed

- Operation manifests now record `schemaVersion: "0.2"` and survive
  legacy-manifest detection (see Fixed below).
- README and `docs/index.html` reflect the broadened cleanable set.

### Fixed

- **Legacy operation-manifest detection** (#61). Pre-v0.2 manifests
  without `schemaVersion` are now classified and surfaced rather than
  silently ignored.

## [0.2.0-alpha.1] — 2026-05 (earlier)

First mutation-capable release. Introduces snapshot-backed
`clean --confirm --yes` and `rollback <id>` for a single detector
(`plugin.cache_unreferenced`).

### Added

- **`clean --confirm --yes`** for `plugin.cache_unreferenced` (#49, #50).
  Removes one plugin cache version per invocation, outside the 7-day
  Claude Code grace window, after taking a snapshot.
- **Rollback CLI flow** (#53, #54, #55, #56, #57).
  - `rollback <id> --dry-run` shows the restore plan.
  - `rollback <id> --confirm --yes` restores the operation from its
    snapshot tree.
- **`composeCleanPlan` / `validateCleanPlan` / `executeCleanPlan`
  pipeline** (#49). Twelve-rule refusal classifier with first-match-wins
  ordering. Refusals carry `targetPath`, `class`, `reason`, `message`,
  and structured exit codes.
- **`composeRollbackPlan` / `validateRollbackPlan` /
  `executeRollbackPlan` pipeline** (#54, #55, #56). Mirror of the clean
  pipeline for restore operations.
- **Operation manifests** under
  `<home>/.claude/housekeeper/operations/`. Status state machine:
  `planned → snapshot_taken → applied → {verified, rolled_back, aborted}`.
- **Atomic snapshot protocol** — write-temp + rename + fsync-parent.
- **Per-operation budget** — 50 files / 10 MiB hard limit.
- **Concurrency lockfile** at `<home>/.claude/housekeeper/lock`
  using `O_EXCL`; 30-minute staleness threshold.
- **Deletion-aware `applyOperation` and `verify`** (#47, T-704 step 1).
- **`plugin.cache_referenced_by_hook` detector** (#48) — protects
  cache versions still wired into hook configuration.
- **`housekeeper.stale_lock` detector** (#48) — informational in
  alpha, cleanable in beta.

### Changed

- Snapshot architecture is pinned in `docs/rollback-contracts.md` and
  `docs/snapshot-architecture.md`.
- Mutation kinds are routed through a registry (`MUTATION_REGISTRY`)
  rather than dispatched inline.

### Security

- All mutation paths require Housekeeper-owned snapshot proof. There
  is no path from observation directly to mutation.
- The lockfile prevents concurrent `clean`/`rollback` invocations on
  the same home.

## [0.1.2] — earlier

Final v0.1 patch. Adds the `home.clean` meta-detector and lints the
incoming v0.2 snapshot scaffolding.

### Added

- **`home.clean` meta-detector** (#35). Emits an `inform`-stance
  finding when no other detector fires, so a clean home is never an
  empty report.
- **Snapshot and rollback type factories** (#30) scaffolded for v0.2.
- **`docs/snapshot-architecture.md`** and
  **`docs/rollback-contracts.md`** (#29) — design contracts pinned
  before implementation.
- **`verify` subagent dispatch smoketest** (#32, T-403).

### Changed

- Lint chain now covers the v0.2 snapshot module group (#33).

### Fixed

- `expected-orphan-cache` golden fixture realigned with runtime
  evidence bucketing (#34).

## [0.1.1] — earlier

v0.1 polish release. Adds the optional SessionStart prevention hook,
CLI `--help` / `--version`, `findings[].targetPath`, and several
small redaction / safe-mode fixes.

### Added

- **Optional SessionStart prevention hook** (#27) at
  `hooks/session-start.mjs`. Quiet on routine state; surfaces `block`
  / `probe` findings to stderr on session start. Opt-in only.
- **CLI `--help` and `--version`** (#25). Clearer error on unknown
  arguments.
- **`findings[].targetPath`** in the JSON shape (#19). `--redact` no
  longer mangles deep paths.
- **`plugin.cache_size` evidence** ranks the top three plugins by
  total bytes (#21).

### Changed

- Plugin slash-command hint corrected; `--confirm` documented in CLI
  help (#26).
- `safe-mode` `surface.limits` use a per-detector boundary token (#23).
- Every finding's `surface.limits` carries
  `"safe-mode-no-loader-key"` in safe mode (#20).
- README, site, and spec docs synced with v0.1.0 and v0.1.x polish (#24).

### Fixed

- Stub `review-required` next-step replaced with the spec-aligned
  `nextAllowedStep` (#22).
- `local_command_shadow` dedup vs `identical`/`diverged` collisions;
  path shown in `plan` output (#18).

## [0.1.0] — earlier

First public release. Read-only first wedge for broken hooks, plugin
cache drift, and protected local state.

### Added

- **`diagnose`, `plan`, `verify`** read-only commands.
- **Stance-first report grammar** with eight stances (`inform`,
  `watch`, `review`, `probe`, `protect`, `prepare`, `repair`, `block`).
- **Surface classification** on every finding (nine axes plus
  per-detector safe-mode limits).
- **Stable JSON schema** `schemaVersion: "0.1"`.
- **`--safe` posture** and **`--redact`** privacy mode.
- **Self-failure read-only degradation** so Housekeeper still reports
  when its own state is broken.
- **GitHub Pages product site** at
  `https://hemzaz.github.io/claude-housekeeper/`.
- **CI matrix** Ubuntu + macOS × Node 20 + 22.
- First-wedge detectors:
  - `settings.invalid_json`, `settings.hook_path_dangling`,
    `settings.hook_command_shell_ambiguous`,
    `settings.mcp_command_missing`.
  - `plugin.expected_orphan`, `plugin.cache_unreferenced`,
    `plugin.duplicate_registration`, `plugin.cache_size`.
  - `registry.local_skill_shadow`, `registry.local_command_identical`,
    `registry.local_command_diverged`, `registry.broken_frontmatter`.
  - `housekeeper.interrupted_operation`, `housekeeper.config_invalid`,
    `housekeeper.operations_unreadable`.
  - `home.not_found`, `home.scan_budget_hit`.

### Security

- `diagnose`, `plan`, `verify` never modify files.
- Do-not-touch rules are a hard boundary; protected findings are
  visible but non-actionable.

[Unreleased]: https://github.com/hemzaz/claude-housekeeper/compare/v0.2.0-beta.1...HEAD
[0.2.0-beta.1]: https://github.com/hemzaz/claude-housekeeper/releases/tag/v0.2.0-beta.1
[0.2.0-alpha.1]: https://github.com/hemzaz/claude-housekeeper/releases/tag/v0.2.0-alpha.1
[0.1.2]: https://github.com/hemzaz/claude-housekeeper/releases/tag/v0.1.2
[0.1.1]: https://github.com/hemzaz/claude-housekeeper/releases/tag/v0.1.1
[0.1.0]: https://github.com/hemzaz/claude-housekeeper/releases/tag/v0.1.0
