# Changelog

All notable changes to **claude-housekeeper** are recorded here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html)
with two caveats documented in the design notes:

- Detector ids (`plugin.cache_unreferenced`, etc.) are stable within a major.
- Report `schemaVersion` (`"0.1"`) and operation-manifest `schemaVersion`
  (`"0.2"`) each move on their own line.

## [Unreleased]

_No changes yet._

## [0.4.0] — 2026-05-19

GA release of the v0.4 line. Promotes `0.4.0-beta.1` to stable after
release-workflow CI passed (run `26086817652`) and a baseline soak
against `~/.claude` cleared all stop conditions, including the T-703
extensions exercising `learn` and `prune`.

No new features or contract changes since `0.4.0-beta.1`. The only
post-beta diff is the test fix in
[#114](https://github.com/hemzaz/claude-housekeeper/pull/114) (T10/T11
in `test/plugin-prune.test.mjs` now build a synthetic `--home` so the
GitHub Actions runner — which has no `~/.claude` — exercises the
v0.4 mutation-refusal path).

See `[0.4.0-beta.1]` below for the full v0.4 changelog, and
[`docs/migration-v0.3-to-v0.4.md`](docs/migration-v0.3-to-v0.4.md)
for the upgrade guide.

## [0.4.0-beta.1] — 2026-05-18

The v0.4 line. Introduces a full on-disk learning loop (`learn` and
`prune` subcommands), MCP command rewrite (`--mcp-command-rewrite=`),
JSONC-aware `settings.json` rewrite via `jsonc-parser`, batch streaming
(`clean --batch=N --stream`), four new detectors, and the canonical
`json-rewrite` mutation kind (with `settings-rewrite` kept as a
back-compat alias).

All v0.3 contracts hold byte-for-byte. The only new runtime dependency
is `jsonc-parser` (Microsoft, MIT, zero transitive dependencies).

See [`docs/migration-v0.3-to-v0.4.md`](docs/migration-v0.3-to-v0.4.md)
for the upgrade guide.

### Added

- **`housekeeper learn` subcommand** (Phase 1, T-100..T-107). Surfaces
  a summary of what Housekeeper has learned from past sessions — which
  refusals recur, which findings were marked as false positives, and
  which applied operations were later rolled back. Four flag variants:
  - No args: plain-text learning summary (counts + top recurrers).
  - `--json`: machine-readable summary object.
  - `--prune --older-than=<days>`: remove learning log entries older
    than the specified number of days and print how many were pruned.
  - `--mark-false-positive <op_id>`: mark an operation's refusal as a
    false positive so the detector id shows a reduced weight in future
    summaries.
- **`housekeeper prune` subcommand** (Phase 3, T-300..T-304). Audit-only
  view filtered to `plugin.unused_past_grace` findings. Prints a table
  of installed plugins that have not appeared in any applied operation
  within the grace window. No mutation in v0.4.0; v0.4.1 will wire the
  uninstall mutation after the audit window validates the heuristic.
- **`harden --mcp-command-rewrite=<old>=<new>`** (Phase 2, T-200..T-204).
  Extends `composeHardenPlan` to rewrite an MCP server's `command` path
  in `settings.json` from `<old>` to `<new>`. Three pre-snapshot refusal
  classes guard the rewrite: `mcp-rewrite-target-missing` (the target
  MCP entry is not found), `mcp-rewrite-target-not-executable` (the new
  path exists but is not executable), and `mcp-rewrite-source-not-found`
  (the `<old>` path does not match any MCP entry). Each refusal carries
  a `nextStep`.
- **`clean --batch=N --stream`** (Phase 6, T-600..T-605). Streams a
  large batch in configurable chunks. `--stream` is only valid with
  `--batch=N` where N > 50; rejected with `stream-resume-not-supported`
  for smaller batches. Per-chunk snapshot + apply + verify pipeline;
  halts and triggers per-chunk rollback in reverse order on any chunk
  failure. Refusal classes: `stream-chunk-budget-exceeded` and
  `stream-resume-not-supported`.
- **On-disk learning loop** (Phase 1, T-100..T-107). Four append-only
  JSONL files under `<home>/.claude/housekeeper/learning/`:
  - `refusals.jsonl` — written by `composeCleanPlan` and
    `composeHardenPlan` on every refusal.
  - `applied.jsonl` — written by `executeCleanPlan` and
    `executeHardenPlan` on every successful application.
  - `rollbacks.jsonl` — written by `executeRollbackPlan` on every
    successful restore.
  - `state.json` — lightweight counters updated after each append;
    allows `learn` to render a summary without scanning every JSONL line.
  Schema version field on every write per Q1 ruling.
- **`lock.history` JSONL** (N6 carry-over, T-099a). Append-only JSONL
  at `<home>/.claude/housekeeper/lock.history`. One line per acquire /
  release: `{ts, pid, action, holder, releaseReason?}`. Provides an
  audit trail for lockfile contention without requiring a separate log
  rotation scheme.
- **Four new detectors** (Phase 3–4):
  - `plugin.unused_past_grace` — installed plugin that has no entry in
    `applied.jsonl` within the 7-day grace window and no active hook or
    command reference; surfaces at `inform` stance (T-300).
  - `registry.command_dangling` — local command file whose counterpart
    plugin entry no longer exists in `installed_plugins.json`; hardenable
    via `json-rewrite` (T-401).
  - `hooks.config_dangling` — hook entry in `settings.json` whose
    command path exists but the parent plugin is no longer installed;
    hardenable via `json-rewrite` (T-402).
  - `registry.skills_entry_dangling` — skills registry entry referencing
    a plugin that is no longer installed; hardenable via `json-rewrite`
    (T-403).
- **`json-rewrite` mutation kind** (Phase 4, T-400). Canonical third
  mutation kind in `MUTATION_REGISTRY` for structured JSON patching via
  `jsonc-parser`'s `modify()` + `applyEdits()`. Comment-preserving:
  `//` and `/* */` blocks in `settings.json` survive the round-trip.
  `settings-rewrite` is now a back-compat alias that routes through the
  same implementation. The three Phase-4 hardenable detectors
  (`registry.command_dangling`, `hooks.config_dangling`,
  `registry.skills_entry_dangling`) use this kind.
- **`falsePositiveSeenBefore` optional field on `Finding`** (T-105).
  When `learn --mark-false-positive <op_id>` has been invoked for an
  operation, subsequent `diagnose` runs decorate the matching finding
  with `falsePositiveSeenBefore: N` (the count of prior false-positive
  marks for this detector id). Field is omitted when the count is zero.
- **`jsonc-parser` runtime dependency** (Phase 5, T-500). Pinned at
  `^3.3.1`. Used by `MUTATION_REGISTRY["json-rewrite"].preApply` and
  `.apply` for comment-preserving JSONC rewrites. Zero transitive
  dependencies (Microsoft MIT). Ratified exception to the zero-deps
  invariant per architect memo §6.5 and platform memo §4.4.
- **Pre-commit forbidden-language hook** (T-D05). `.husky/pre-commit`
  runs `node test/forbidden-language.test.mjs` on staged files. Fails
  the commit with file name, line number, and matched phrase — the same
  surface CI emits.

### Changed

- **`settings-rewrite` is now a back-compat alias for `json-rewrite`.**
  All v0.3 operation manifests with `kind: settings-rewrite` remain
  readable and restorable under v0.4 without conversion. The alias
  routes to the same `preApply / apply / rollback` implementation.
  Tests written against `settings-rewrite` pass byte-for-byte (T-400).
- **`settings.jsonc_detected` findings are now hardenable.** In v0.3,
  `settings.jsonc_detected` was an `inform`-stance non-actionable finding
  (comments could not be safely preserved). In v0.4, `jsonc-parser`'s
  `modify()` + `applyEdits()` preserves comments through the rewrite.
  Harden now acts on JSONC-bearing settings files; the refusal class
  `settings-jsonc-rewrite-failed` fires only when the parser diverges
  from the original content on a round-trip identity check (T-502).

### Notes

- **Zero-deps invariant:** retained except for `jsonc-parser`. The
  ratified exception is documented in architect memo §6.5 and platform
  memo §4.4. All other modules remain pure Node.js built-ins.
- **HMAC residual G13:** manifest signing is deliberately out of scope
  for v0.4. Carried forward; see `docs/threat-model.md`.
- **MCP rewrite foreign-owner threat mitigation** (user-supplied path
  injection via `--mcp-command-rewrite=`) is deferred to v0.4.x. The
  `mcp-rewrite-target-not-executable` refusal class provides partial
  mitigation in v0.4.0-beta.1.

### Migration

See [`docs/migration-v0.3-to-v0.4.md`](docs/migration-v0.3-to-v0.4.md)
for the full upgrade guide. No breaking changes from v0.3.0.

## [0.3.0] — 2026-05-17

The v0.3 line. Introduces `harden --confirm --yes` for guarded
settings.json rewrite, `clean --batch` for aggregating multiple
findings under a single operation manifest, two-phase JSONC detection,
and promotes three settings detectors from `planned` to **hardenable**.

`diagnose`, `plan`, `verify`, `clean`, and `rollback` are unchanged.
The v0.2 read-only and single-op mutation contracts hold byte-for-byte.

### Added

- **`harden --confirm --yes`** (#88, #92, T-200..T-204, T-400..T-403).
  New mutation subcommand mirroring `clean`'s four-branch consent gate.
  Routes through `composeHardenPlan → validateHardenPlan →
  executeHardenPlan`, takes a snapshot, applies a `settings-rewrite`
  patch, and verifies the result. Successful runs print a `RELOAD HINT`
  block reminding the user to restart their Claude session — Claude
  does not document hot-reload of `settings.json`. Same `--target=`,
  `--path=`, `--dry-run`, `--json`, and `--timeout=<seconds>` surface
  as `clean`. Rollback works through the existing `rollback <id>` flow.
- **`settings-rewrite` mutation kind** (#86, T-100..T-104). Third
  mutation kind in `MUTATION_REGISTRY` (after `dir-rmtree` and
  `file-unlink`). Per-kind `preApply / apply / rollback` contract:
  `preApply` runs strict `JSON.parse`, the JSONC tokenizer, applies
  the patch in memory twice for idempotency, and validates the output
  is still valid JSON before snapshotting. `apply` uses the existing
  `atomicWrite` helper (write-temp + rename + fsync-parent). `rollback`
  copies the snapshot tree back over the target.
- **`clean --batch=<n>`** (#91, T-500..T-504). Aggregates multiple
  `--target=`/`--path=` pairs under one operation manifest. Default
  aggregate cap 10, max 50 (matches the per-op snapshot budget).
  Manifest-atomic semantics per Q3 ruling: `status: verified` only
  when every op verifies; on per-op failure the manifest stays at
  `applied` with `partialApply: true` and `housekeeper.interrupted_operation`
  surfaces it next session. `clean --batch` excludes `settings-rewrite`
  operations by design (use `harden` instead). New refusal classes
  `batch-exceeds-aggregate-budget`, `batch-pair-cap-exceeded`, and
  `settings-rewrite-not-batchable`, each with a `nextStep`.
- **Two-phase JSONC detection** (#87, T-101). When `settings.json`
  fails strict `JSON.parse`, a lex-aware tokenizer scans for `//` or
  `/*` outside string context. Comment-bearing inputs emit a new
  `settings.jsonc_detected` finding at `inform` stance — they are not
  broken, but Housekeeper cannot safely round-trip comments through
  `settings-rewrite` in v0.3. Existing `settings.invalid_json` is now
  disjoint from `settings.jsonc_detected`. Revisit deferred to v0.4.
- **Three promoted detectors** (#90, T-300..T-303). The following
  detectors carry `hardenable: true` on their `DetectorOutput` and are
  acted on by `harden --confirm --yes`:
  - `settings.hook_path_dangling` — patch removes every hook entry
    whose command references a missing absolute plugin-cache path.
  - `settings.mcp_command_missing` — patch removes every `mcpServers`
    entry whose absolute command path is missing.
  - `settings.invalid_json` — surfaces with `hardenable: true` so
    `diagnose` suggests `harden`; the actual invocation refuses with
    `settings-shape-unknown` per Q1 ruling.
- **`hardenable` flag on `DetectorOutput`** (Q4 ruling). Detectors
  self-declare candidacy; the README "Current Checks" table gains a
  fourth column.
- **CI `version-pin` job** (#85, T-604). New `.github/workflows/ci.yml`
  job that asserts `docs/index.html` contains `v$(jq -r .version
  package.json)`. Prevents the GA tag from shipping with a stale site
  version pin. Closes the G4 release-readiness gap from v0.2.
- **Schema/threat/versioning addenda** (#85, T-700..T-702).
  - `docs/schema-stability.md` documents `settings-rewrite` alongside
    `dir-rmtree` and `file-unlink` as a stable mutation kind. Manifest
    `schemaVersion` stays at `"0.2"`.
  - `docs/threat-model.md` §8 covers the settings-write surface:
    atomic-rename guarantees on macOS APFS and Linux ext4, the new
    `settings-network-filesystem` refusal class for NFS/SMB, the
    bounded read-race window (Claude sees old or new, never partial),
    and confirms the single-user-local trust boundary from v0.2 is
    unchanged. Adds threat scenarios T9–T13.
  - `docs/versioning-policy.md` §2.1 records that `settings-rewrite`,
    `harden`, and `clean --batch` are additive — v0.3 minor, not v1.0.

### Changed

- **`composeCleanPlan` now accepts `allowedExecutionClasses`** (#83,
  T-099). The 12-rule classifier's hardcoded `executionClass === "inert"`
  check is promoted to a parameter. `runClean` continues to pass
  `["inert"]` (no behavior change); `runHarden` passes `["inert",
  "known-execution-context"]` so harden can act on non-inert config
  surfaces. Without this refactor every harden invocation would refuse
  with `execution-class` and v0.3 would ship a no-op.
- **README "Current Checks" gains a fourth column** for hardenable
  status. Three settings detectors marked **hardenable** in v0.3.0.
- **`docs/index.html`** documents the v0.3 surface in the timeline.

### Fixed

- _No bug fixes in this release; v0.2.0 GA bug-fix backlog landed in_
  _the 0.2.0 line._

## [0.2.0] — 2026-05-16

GA release of the v0.2 line. Drops the `-beta` suffix after the GA-blocker
pass landed on `main` and the first soak night passed against a real
`~/.claude`.

### Added

- `CHANGELOG.md` covering every tagged release.
- `docs/migration-v0.1-to-v0.2.md` — user-facing v0.1 → v0.2 upgrade guide.
- `docs/threat-model.md` — single-user local threat model documenting
  trust boundaries for the snapshot, rollback, and operation-manifest
  surfaces. Records G13 (manifest signing) as deliberately out of scope
  for v0.2 with rationale.
- `docs/versioning-policy.md` (G12, #72) — what is stable within a major
  (detector ids, refusal `class`/`reason`, schema versions, bin name,
  public flags) and what triggers v0.3 vs v1.0.
- `nextStep` field on every clean refusal (G7, #71). Refusals carry a
  user-facing recovery hint alongside `class`/`reason`/`message`. Internal
  `ownerClass`/`executionClass`/`rollbackClass` tokens are no longer
  surfaced in user-visible messages.
- `--timeout=<seconds>` flag on `clean` (G15, #74). Exits 124 (matches
  GNU `timeout(1)`) when the deadline fires. Distinct from refusal (2)
  and runtime failure (1) so CI can detect deadline expiry separately.
- `scripts/soak.sh` (N3, #75) — read-only nightly soak runner that
  captures diagnose/plan/verify output, diffs against yesterday, and
  enforces stop conditions (`filesChanged: true`, schemaVersion drift,
  malformed op id, empty refusal message).
- Two new fixtures (G8, #69 #70):
  - `dual-scope-plugin-install/` — user-scope and project-scope install
    of the same plugin.
  - `plugin-installed-from-disk/` — `installSource: "local"`, no
    marketplace metadata.

### Changed

- `README.md` "Current Checks" now marks each detector as
  **cleanable in v0.2.0**, **planned**, or **never cleanable**.
- `README.md` and `docs/index.html` link to the new CHANGELOG,
  migration guide, threat model, and versioning policy.

### Fixed

- **Abort recovery hint mapping** (G16, #73). `abortRollbackOperation`
  refused `planned` operations despite the CHANGELOG v0.2.0-beta.1 promise
  that both `planned` and `snapshot_taken` are abortable; the audit hint
  also routed `planned` (and legacy-coerced-to-planned) operations to
  bare `rollback <id>`, which then refused because plain rollback requires
  `applied` — a dead-end loop. Both fixed; all non-terminal statuses now
  map to a command that doesn't refuse.
- **Object-keyed registry `installPath` default** (#80). The audit's
  `flattenPluginEntries` parsed the array-form `installed_plugins.json`
  with a conventional `<home>/plugins/cache/<marketplace>/<name>/<version>`
  default when `installPath` was omitted, but the object-keyed form
  spread `...record` raw — so an entry without `installPath` caused the
  matching cache to be flagged as `plugin.cache_unreferenced`. Fixed by
  parsing the `<name>@<marketplace>` key (with `lastIndexOf("@")` for
  scoped names) and applying the same default.
- **`duplicate-scope-plugin` fixture aligned with detector** (#81). The
  fixture's golden claimed `plugin.duplicate_registration` should fire,
  but the detector only reads `installed_plugins.json` (not per-scope
  `settings.json` blocks). Result: diagnose silently reported
  `home.clean`. Fixture now populates `installed_plugins.json` with both
  scope entries; goldens regenerated.

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
  `snapshot_taken` or `planned` operation and removes its no-longer-needed
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

[Unreleased]: https://github.com/hemzaz/claude-housekeeper/compare/v0.4.0-beta.1...HEAD
[0.4.0-beta.1]: https://github.com/hemzaz/claude-housekeeper/compare/v0.3.0...v0.4.0-beta.1
[0.3.0]: https://github.com/hemzaz/claude-housekeeper/releases/tag/v0.3.0
[0.2.0]: https://github.com/hemzaz/claude-housekeeper/releases/tag/v0.2.0
[0.2.0-beta.1]: https://github.com/hemzaz/claude-housekeeper/releases/tag/v0.2.0-beta.1
[0.2.0-alpha.1]: https://github.com/hemzaz/claude-housekeeper/releases/tag/v0.2.0-alpha.1
[0.1.2]: https://github.com/hemzaz/claude-housekeeper/releases/tag/v0.1.2
[0.1.1]: https://github.com/hemzaz/claude-housekeeper/releases/tag/v0.1.1
[0.1.0]: https://github.com/hemzaz/claude-housekeeper/releases/tag/v0.1.0
