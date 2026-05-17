# Taskboard — Claude Housekeeper v0.4

Companion to `notes/PLAN-v0.4.md`. Tasks are atomic, ordered by phase,
each with a single verify criterion. Mark `[x]` when complete; split
T-IDs rather than overloading one.

Status legend: `[ ]` todo · `[~]` in progress · `[x]` done · `[!]` blocked

All tasks branch from the v0.3.0 tag on `main` (`46c6179`). Phase 0
memos may pre-design; implementation (Phase 1+) starts after T-D04
resolves cross-memo conflicts. Protocol mirrors v0.3 T-D01..T-D04.

---

## Phase 0 — Design memos + dev tooling

Three parallel agents author memos; a fourth synthesizes. T-D05 is
independent (dev workflow only).

- [ ] **T-D01 (architect)** `docs/design/v0.4-architect-memo.md`
  - Scope: architecture for learning loop schema, MCP rewrite plan
    composition, prune detector + audit-only protocol, P4 target-id
    expansion, JSONC parser comparison, stream chunking model
  - Must answer all 5 Open Design Questions from `PLAN-v0.4.md §4`
  - Verify: file exists, ≥ 600 lines, references `snapshot.mjs`,
    `harden-plan.mjs`, `clean-plan.mjs`, `audit.mjs`

- [ ] **T-D02 (product)** `docs/design/v0.4-product-memo.md`
  - Scope: CLI surface for `learn`, `--mcp-command-rewrite=`, `prune`,
    `--stream`; refusal phrasing + `nextStep` copy; learning-summary
    output format; CHANGELOG shape for v0.4
  - Verify: file exists, ≥ 400 lines, ≥ 2 end-to-end transcripts

- [ ] **T-D03 (platform)** `docs/design/v0.4-platform-memo.md`
  - Scope: Claude Code interop — registry / hooks / skills re-read
    under atomic rename; plugin uninstall race vs running processes;
    MCP server hot-reload after rewrite
  - Verify: file exists, ≥ 300 lines, cites ≥ 3 external sources

- [ ] **T-D04 (tie-breaker)** Synthesize into `docs/design/v0.4-design.md`
  - Resolve every cross-memo conflict; promote Decision Log rows for
    Q1–Q5
  - Verify: every Q1–Q5 has a row with date and rationale; file refs
    each peer memo by section
  - blockedBy: T-D01, T-D02, T-D03

- [ ] **T-D05 (tooling)** Pre-commit forbidden-language hook (N8)
  - Scope: `.husky/pre-commit` runs `node
    test/forbidden-language.test.mjs` on staged files
  - Verify: commit with forbidden term fails hook locally with same
    message CI emits
  - Independent of T-D01..T-D04

---

## Phase 1 — Learning loop + lock.history (P1 + N6)

- [ ] **T-099a** `<home>/.claude/housekeeper/lock.history` append-only
      JSONL (N6 carry-over)
  - Scope: `scripts/lib/lock.mjs` appends one JSON line per acquire /
    release: `{ts, pid, action, holder, releaseReason?}`
  - Verify: unit test acquires + releases 3 times; reads `lock.history`;
    asserts 6 lines in correct order
  - blockedBy: T-D04 (Q1 may apply)

- [ ] **T-100** `scripts/lib/learning.mjs` with append helpers
  - Scope: `appendRefusal`, `appendApplied`, `appendRollback`,
    `readSummary`
  - Verify: 10/5/3 appends; `readSummary` returns correct counters
  - blockedBy: T-D04

- [ ] **T-101** Learning schema version per Q1 ruling
  - Verify: chosen schema field present on every write
  - blockedBy: T-D04 (Q1)

- [ ] **T-102** Wire `appendRefusal` into `composeCleanPlan` and
      `composeHardenPlan`
  - Verify: existing tests pass; new assertion checks `refusals.jsonl`
    line count matches refusal count
  - blockedBy: T-100

- [ ] **T-103** Wire `appendApplied` and `appendRollback` into the
      respective execute paths
  - Verify: end-to-end clean → rollback test asserts 1 line in each
  - blockedBy: T-100

- [ ] **T-104** `housekeeper learn` subcommand parser + handler
  - Scope: no args (summary), `--json`, `--prune --older-than=<days>`,
    `--mark-false-positive <op_id>`
  - Verify: `--help` shows new flags; summary against a fixture matches
    documented format
  - blockedBy: T-100, T-101

- [ ] **T-105** `diagnose` decoration with `falsePositiveSeenBefore: N`
  - Verify: fixture with one marker emits the field on the matching
    finding only
  - blockedBy: T-104

- [ ] **T-106** `test/learning.test.mjs` — 12+ tests covering append
      paths, summary, JSON output, prune, false-positive marker, schema
  - blockedBy: T-100..T-105

- [ ] **T-107** Performance bench: append cost < 5ms p99 on 10k-line
      JSONL
  - blockedBy: T-100

---

## Phase 2 — MCP repair beyond stripping (P2)

- [ ] **T-200** `--mcp-command-rewrite=<old>=<new>` CLI parser
  - Verify: rejects malformed values; `--help` shows the flag

- [ ] **T-201** `composeHardenPlan` extension for MCP rewrite mode
  - Verify: fixture with one broken MCP entry + valid new path produces
    a non-empty operations array
  - blockedBy: T-200

- [ ] **T-202** Refusal classes: `mcp-rewrite-target-missing`,
      `mcp-rewrite-target-not-executable`, `mcp-rewrite-source-not-found`
  - Scope: pre-snapshot checks in `validateHardenPlan`
  - Verify: 3 fixture-based tests each trigger one class
  - blockedBy: T-201

- [ ] **T-203** Acceptance card + fixture for MCP rewrite happy path
  - blockedBy: T-201

- [ ] **T-204** `test/mcp-rewrite.test.mjs` — 10+ tests covering happy,
      each refusal, idempotency, snapshot / rollback round-trip

---

## Phase 3 — Plugin pruning audit (P3, v0.4.0)

Audit-only in v0.4.0; v0.4.1 ships mutation after the audit window
validates the heuristic.

- [ ] **T-300** `plugin.unused_past_grace` detector in `audit.mjs`
  - Scope: walks installed plugins; reads `installed-at`; queries
    `applied.jsonl`; emits at `inform` stance
  - Verify: 3-plugin fixture (stale / active / fresh) emits exactly one
    finding
  - blockedBy: T-D04 (Q3 — grace window), T-105

- [ ] **T-301** `housekeeper prune` subcommand (audit-only)
  - Scope: filters diagnose to `plugin.unused_past_grace`; formats as
    table
  - Verify: against fixture prints exactly one row for stale plugin
  - blockedBy: T-300

- [ ] **T-302** Fixture: `plugin-unused-past-grace/`
  - blockedBy: T-300

- [ ] **T-303** Refusal class `prune-history-unavailable`
  - Verify: fixture with unreadable shell history emits
    `historyAvailable: false`
  - blockedBy: T-300

- [ ] **T-304** `test/plugin-prune.test.mjs` — 8+ tests including
      grace-window boundary, false-positive interaction, history-
      unavailable path

---

## Phase 4 — Harden non-settings surfaces (P4)

- [ ] **T-400** Q2 ruling — `settings-rewrite` vs `json-rewrite` kind
      shape lands in `MUTATION_REGISTRY`
  - Verify: all v0.3 settings-rewrite tests pass byte-for-byte
  - blockedBy: T-D04 (Q2)

- [ ] **T-401** `registry.command_dangling` detector + harden target
  - Verify: fixture asserts patch removes dangling entry, preserves
    others byte-for-byte
  - blockedBy: T-400

- [ ] **T-402** `hooks.config_dangling` detector + harden target
  - blockedBy: T-400

- [ ] **T-403** `skills.entry_dangling` detector + harden target
  - blockedBy: T-400

- [ ] **T-404** README "Current Checks" table refresh — three new
      hardenable detectors
  - blockedBy: T-401, T-402, T-403

- [ ] **T-405** `test/harden-nonsettings.test.mjs` — 15+ tests
      (5 per target × happy / refusal / rollback)

---

## Phase 5 — JSONC v2 (P5)

- [ ] **T-500** Q4 ruling — parser adoption (or stay refused)
  - Scope: install chosen library; add to `package.json` if (a) or (b)
  - blockedBy: T-D04 (Q4)

- [ ] **T-501** Round-trip fidelity test on 5 JSONC fixtures
  - Verify: identity patch yields byte-equal output
  - blockedBy: T-500

- [ ] **T-502** Replace `settings-jsonc-detected` with
      `settings-jsonc-rewrite-failed`
  - Verify: previously-refusing JSONC fixture now hardens (or refuses
    with new class on parser failure)
  - blockedBy: T-501

- [ ] **T-503** Update `docs/design/v0.3-design.md §2.2` cross-reference
      noting Q2 v0.3 ruling is superseded by Q4 v0.4 ruling
  - blockedBy: T-502

- [ ] **T-504** `test/jsonc-rewrite.test.mjs` — 10+ tests across the 5
      fixtures × identity / single-key / nested / divergence-refusal

---

## Phase 6 — Batch stream (P6) + release prep

- [ ] **T-600** Q5 ruling — chunking model
  - blockedBy: T-D04 (Q5)

- [ ] **T-601** `--stream` flag in `clean --batch=<n>` parser
  - Verify: `--help` shows flag; parsing rejects `--stream` with n ≤ 50

- [ ] **T-602** Stream plan composition — generator of `{target, path}`
      pairs
  - blockedBy: T-600, T-601

- [ ] **T-603** Per-chunk snapshot + apply + verify; per-chunk rollback
      in reverse on stream halt
  - blockedBy: T-602

- [ ] **T-604** Refusal classes `stream-chunk-budget-exceeded` and
      `stream-resume-not-supported`
  - blockedBy: T-603

- [ ] **T-605** `test/clean-batch-stream.test.mjs` — 12+ tests covering
      chunk boundary, per-chunk failure halt, rollback-of-stream

- [ ] **T-606** Plugin marketplace listing prep (N5): polish
      `.claude-plugin/plugin.json` keywords; add screenshot directive
      if marketplace supports; README polish. Verify: `claude plugin
      validate` (if available) passes
- [ ] **T-607** CHANGELOG entry under `[Unreleased]` for v0.4.0
- [ ] **T-608** `docs/migration-v0.3-to-v0.4.md` upgrade guide
- [ ] **T-609** README updates — `learn`, `prune`, MCP rewrite, P4
      surfaces, JSONC v2, `--stream`, current-checks table refresh
- [ ] **T-610** Site (`docs/index.html`) — version pin + new subcommand
      mention
- [ ] **T-611** Compatibility matrix entry for v0.4.0 (Q1–Q5 recorded)

---

## Cross-phase

- [ ] **T-700** Schema-stability: add `learning` files + `lock.history`
      to `docs/schema-stability.md`; add `json-rewrite` (or new kinds
      per Q2) to documented mutation kinds. blockedBy: T-D04
- [ ] **T-701a** Threat model addendum: learning-loop surface (PII,
      read/write trust boundary). blockedBy: T-D04
- [ ] **T-701b** Threat model addendum: MCP rewrite (user-supplied path
      injection). blockedBy: T-D04
- [ ] **T-702** Versioning policy: confirm `learn`, `prune`, P4 ids,
      `--stream` are additive (v0.4 minor). blockedBy: Phase 1–6 land
- [ ] **T-703** Soak script extension: exercise `learn` and `prune` as
      read-only steps in `scripts/soak.sh`. blockedBy: T-104, T-301
