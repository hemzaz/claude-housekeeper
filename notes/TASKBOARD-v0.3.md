# Taskboard — Claude Housekeeper v0.3

Companion to `notes/PLAN-v0.3.md`. Tasks are atomic, ordered by phase, each
with a single verify criterion. Mark `[x]` when complete; if a task expands,
split it into new T-IDs rather than overloading one.

Status legend: `[ ]` todo · `[~]` in progress · `[x]` done · `[!]` blocked

All tasks in this board are blocked until the v0.2.0 GA tag lands on `main`
(release branch is `release/v0.2.0`). Tasks may pre-design (Phase 0) but
implementation (Phase 1+) starts after the v0.2.0 tag.

---

## Phase 0 — Design memos

Three parallel agents author independent memos; a fourth pass synthesizes
them into a buildable spec, matching the T-704 protocol from v0.2.

- [ ] **T-D01 (architect)** Author `docs/design/v0.3-architect-memo.md`
  - Scope: end-to-end architecture for `settings-rewrite` mutation kind,
    `harden` pipeline, batch flow, and detector promotion
  - Must cover: pre-apply checks, idempotency requirement, snapshot integration,
    rollback path equivalence, interaction with v0.2's lock/budget
  - Must answer all 5 Open Design Questions from `PLAN-v0.3.md §4` with a
    proposed default and a one-line rationale
  - Verify: file exists, ≥ 600 lines, references at least `snapshot.mjs`,
    `clean-plan.mjs`, `rollback-plan.mjs`, `audit.mjs`

- [ ] **T-D02 (product)** Author `docs/design/v0.3-product-memo.md`
  - Scope: user-facing CLI surface for `harden --confirm`, `clean --batch`;
    refusal phrasing; `nextStep` field copy for each new refusal reason
  - Must cover: how a user transitions from `prepare`-stance finding to
    successful harden + verify + rollback round-trip
  - Must propose CHANGELOG entry shape for v0.3 (Added/Changed/Fixed)
  - Verify: file exists, ≥ 400 lines, includes at least one end-to-end
    transcript example

- [ ] **T-D03 (platform)** Author `docs/design/v0.3-platform-memo.md`
  - Scope: Claude Code interop — what does Claude do if `settings.json` is
    swapped via atomic rename while the app is running? does Claude re-read
    on SIGHUP / file watcher? does JSONC support matter?
  - Must cover: documented Claude settings schema fields used by the new
    detectors, race-condition analysis, JSONC parser choice (Q2)
  - Must list any Claude Code release notes / blog posts cited
  - Verify: file exists, ≥ 300 lines, cites at least 3 external sources

- [ ] **T-D04 (tie-breaker)** Synthesize the three memos into
      `docs/design/v0.3-design.md`
  - Resolve every cross-memo conflict explicitly, log the ruling, and
    promote PLAN-v0.3.md `§5 Decision Log` entries for Q1–Q5
  - Verify: every Q1–Q5 has a `Decision Log` row with date and rationale;
    file references each peer memo by section
  - blockedBy: T-D01, T-D02, T-D03

---

## Phase 1 — `settings-rewrite` mutation kind

- [ ] **T-100** Add `settings-rewrite` to `MUTATION_REGISTRY` in
      `scripts/lib/snapshot.mjs`
  - Scope: new registry entry with apply / rollback handlers
  - Verify: a unit test snapshots a settings file, applies an identity patch,
    rolls back, and asserts byte-equality to the pre-patch original
  - blockedBy: T-D04

- [ ] **T-101** JSONC handling per Q2 ruling
  - Scope: parser layer in `scripts/lib/audit.mjs` and the new
    `scripts/lib/harden-plan.mjs` agrees on JSONC posture
  - Verify: a `.jsonc` settings fixture either parses or refuses, per the
    Q2 decision; no silent acceptance
  - blockedBy: T-D04 (Q2)

- [ ] **T-102** Idempotency check
  - Scope: `settings-rewrite` applies the patch in dry-run, then re-applies
    to the result and asserts byte-equality before snapshotting
  - Verify: a non-idempotent patch (e.g. one that appends instead of merges)
    is refused with `patch-not-idempotent`

- [ ] **T-103** Atomic-write protocol
  - Scope: settings-rewrite apply uses the existing write-temp + rename +
    fsync-parent helper from `snapshot.mjs`
  - Verify: a kill-mid-write simulation leaves either the old file untouched
    or the new file fully written — never a partial

- [ ] **T-104** `test/settings-rewrite.test.mjs` integration tests
  - Scope: 8+ tests covering identity, single-key patch, nested patch, JSONC
    refusal, non-idempotent refusal, atomic-write, sha256 round-trip, rollback
  - blockedBy: T-100, T-101, T-102, T-103

---

## Phase 2 — Harden plan pipeline

- [ ] **T-200** `composeHardenPlan(home, {target, path})` in
      `scripts/lib/harden-plan.mjs`
  - Scope: mirrors `composeCleanPlan`; emits operations + refusals
  - blockedBy: T-100, T-D04

- [ ] **T-201** `validateHardenPlan` — pre-snapshot drift + budget check
  - blockedBy: T-200

- [ ] **T-202** `executeHardenPlan` — snapshot → apply → verify
  - blockedBy: T-201

- [ ] **T-203** Refusal classifier — extend the 12-rule taxonomy with
      harden-specific reasons (Plan §3)
  - blockedBy: T-200

- [ ] **T-204** `test/harden-plan.test.mjs` — 20+ tests covering happy path,
      each refusal class, drift detection, lock contention

---

## Phase 3 — Detector promotion

Three detectors graduate from `planned` to cleanable. Each gets an
acceptance card + golden fixture before code.

- [ ] **T-300** `settings.hook_path_dangling` → `hardenable`
  - Fixture: extend existing `broken-hook-simple/`
  - Acceptance card: removes the broken hook entry from settings.json
  - blockedBy: T-202

- [ ] **T-301** `settings.mcp_command_missing` → `hardenable`
  - Fixture: extend existing `mcp-command-missing/` (must exist after T-D04)
  - Acceptance card: removes the broken MCP entry
  - blockedBy: T-202

- [ ] **T-302** `settings.invalid_json` per Q1 ruling
  - Fixture: extend existing `invalid-settings/`
  - blockedBy: T-D04 (Q1), T-202

- [ ] **T-303** Update `README.md` "Current Checks" table to reflect three
      newly-cleanable detectors
  - blockedBy: T-300, T-301, T-302

---

## Phase 4 — CLI wiring

- [ ] **T-400** `harden` subcommand parser
  - Scope: accept `--confirm`, `--yes`, `--target=<id>`, `--path=<path>`,
    `--dry-run`, `--timeout=<seconds>`, `--json`
  - Verify: `--help` shows the new flags; parsing rejects unknown args

- [ ] **T-401** `runHarden(options)` handler in `scripts/claude-housekeeper.mjs`
  - Scope: mirror `runClean`; consent gate, plan composition, validation,
    apply, verify
  - blockedBy: T-202, T-400

- [ ] **T-402** `harden` deadline (mirror G15 `--timeout`)
  - blockedBy: T-401

- [ ] **T-403** CLI integration tests in `test/cli.test.mjs`
  - 5+ tests covering help text, missing flag refusals, dry-run output,
    successful harden against a synthetic home, rollback round-trip

---

## Phase 5 — Batch operations

- [ ] **T-500** `--batch` flag + repeated `--target=`/`--path=` parsing
  - Scope: extend `parseArgs` to accept multiple target/path pairs
  - Verify: parser yields an array of `{target, path}` pairs; `--batch=N`
    sets aggregate cap (default 10)

- [ ] **T-501** Batch plan composition
  - Scope: extend `composeCleanPlan` (or new wrapper) to aggregate operations
    across N findings; enforce aggregate budget
  - blockedBy: T-500

- [ ] **T-502** Batch snapshot + apply + verify
  - Scope: one operation manifest covers all batch operations
  - blockedBy: T-501

- [ ] **T-503** Batch refusal semantics per Q3 ruling
  - blockedBy: T-D04 (Q3), T-502

- [ ] **T-504** `test/clean-batch.test.mjs` — 12+ tests
  - Includes partial-apply behavior per Q3, rollback-of-batch, lock contention

---

## Phase 6 — Release prep

- [ ] **T-600** CHANGELOG entry under `[Unreleased]` for the v0.3.0 line
- [ ] **T-601** `docs/migration-v0.2-to-v0.3.md` — user-facing upgrade guide
- [ ] **T-602** README updates — harden command surface, batch examples,
      current-checks table refresh
- [ ] **T-603** Site (`docs/index.html`) — version pin and harden mention
- [ ] **T-604** Q5 ruling — automate version pinning OR add CI guard
- [ ] **T-605** Compatibility matrix entry for v0.3.0 (Q1–Q5 outcomes
      recorded)

---

## Cross-phase

- [ ] **T-700** Schema-stability: add `settings-rewrite` to documented
      mutation kinds in `docs/schema-stability.md`
  - blockedBy: T-D04
- [ ] **T-701** Threat model addendum: settings-write surface
  - blockedBy: T-D04
- [ ] **T-702** Versioning policy: confirm `harden` and `clean --batch`
      additions are additive (v0.3 minor, not v1.0 major)
  - blockedBy: Phase 4 + 5 design land
