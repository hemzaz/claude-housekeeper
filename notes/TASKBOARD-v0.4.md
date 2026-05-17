# Taskboard — Claude Housekeeper v0.4

Companion to `notes/PLAN-v0.4.md`. Tasks are atomic, ordered by phase, each
with a single verify criterion. Mark `[x]` when complete; if a task expands,
split it into new T-IDs rather than overloading one.

Status legend: `[ ]` todo · `[~]` in progress · `[x]` done · `[!]` blocked

All tasks branch from the `v0.3.0` tag on `main` (released 2026-05-17,
`CHANGELOG.md [0.3.0]`). Phase 0 may pre-design in parallel; Phase 1+
implementation work waits on T-D04.

---

## Phase 0 — Design memos

Three parallel agents author independent memos; a fourth pass synthesizes
them into a buildable spec, matching the T-D04 protocol from v0.3.

- [ ] **T-D01 (architect)** Author `docs/design/v0.4-architect-memo.md`
  - Scope: learning-loop schema, MCP rewrite strategy, `plugin-uninstall`
    mutation kind, registry harden surface, JSONC v2 parser integration,
    stream-batch sub-op model
  - Must answer all 5 Open Design Questions from `PLAN-v0.4.md §4`
  - Verify: file exists, ≥ 600 lines, references `snapshot.mjs`, `audit.mjs`,
    `harden-plan.mjs`, `clean-plan.mjs`

- [ ] **T-D02 (product)** Author `docs/design/v0.4-product-memo.md`
  - Scope: CLI surface for `housekeeper learn`, `harden --strategy=rewrite`,
    `clean --grace=`, `clean --batch=stream`; refusal phrasing; `nextStep`
    copy for each new refusal class
  - Must propose CHANGELOG entry shape for v0.4
  - Verify: file exists, ≥ 400 lines, one end-to-end transcript per pillar

- [ ] **T-D03 (platform)** Author `docs/design/v0.4-platform-memo.md`
  - Scope: Claude Code interop, `claude plugin uninstall` exit semantics,
    JSONC library evaluation, learning-loop file-locking
  - Verify: file exists, ≥ 300 lines, cites at least 3 external sources

- [ ] **T-D04 (tie-breaker)** Synthesize into `docs/design/v0.4-design.md`;
      resolve cross-memo conflicts; promote `PLAN-v0.4.md §5 Decision Log`
      rows for Q1–Q5 (each with date + rationale). blockedBy: T-D01..D03

---

## Phase 1 — Learning loop (P1)

- [ ] **T-100** Add `scripts/lib/learning.mjs` with `appendLearningEvent`,
      `readLearningSummary`, `rotateIfOversize`; verify: unit tests for
      append, rotate-at-cap, schema-violation refusal. blockedBy: T-D04 (Q1)

- [ ] **T-101** Wire write-side hooks into `runDiagnose`, `runClean`,
      `runHarden` to emit `accepted_plan` + `rollback_outcome` events
  - Verify: integration test asserts N events written after N operations
  - blockedBy: T-100

- [ ] **T-102** `housekeeper learn` subcommand parser + dispatch
  - Scope: `learn`, `learn show --detector=`, `learn mark <id>`,
    `learn purge --older-than=`, `learn export --json [--redact]`
  - Verify: `--help` shows tree; unknown sub-verbs and flags rejected

- [ ] **T-103** `learn mark` append-only writer
  - Verify: line count grows by 1 per `mark`; prior lines byte-identical
  - blockedBy: T-100

- [ ] **T-104** `docs/learning-loop.md` documenting `schemaVersion: "0.1"`,
      event kinds, ring-rotation
  - Verify: file exists; cross-linked from `docs/schema-stability.md`

- [ ] **T-105** `test/learning.test.mjs` — 12+ tests
  - Cover: append, rotate, schema-violation refusal, mark idempotency,
    purge advisory, `export --redact` strips identifiable signals

---

## Phase 2 — MCP rewrite (P2)

- [ ] **T-200** Extend `composeHardenPlan` to accept `strategy: "remove" |
      "rewrite"` per finding (default `remove`)
  - blockedBy: T-D04 (Q2)

- [ ] **T-201** `resolveMcpRewrite(entry, env)` resolver in `harden-plan.mjs`
  - Verify: unit test covers single-match-in-allowlist, multi-match,
    single-match-outside, no-match
  - blockedBy: T-200

- [ ] **T-202** Refusal classes `mcp-rewrite-ambiguous`,
      `mcp-rewrite-out-of-allowlist`, `mcp-rewrite-no-match`
  - Verify: classifier fires each on matching fixture; `nextStep` non-empty

- [ ] **T-203** CLI: `harden --strategy=<remove|rewrite>`
  - Verify: `--help` shows; `--strategy=foo` rejects clearly

- [ ] **T-204** Fixture `mcp-command-missing-rewriteable/` + golden test
  - Verify: harden with `--strategy=rewrite` produces rewritten path

- [ ] **T-205** `test/mcp-rewrite.test.mjs` — 10+ tests

---

## Phase 3 — Plugin pruning (P3)

- [ ] **T-300** Detector `plugin.disused` in `scripts/lib/audit.mjs`
  - Verify: fixture `plugin-disused-30d/` yields one `plugin.disused`
    finding at `prepare` stance with `cleanable: true`
  - blockedBy: T-D04 (Q3)

- [ ] **T-301** Mutation kind `plugin-uninstall` in `MUTATION_REGISTRY`
  - Scope: shells out to `claude plugin uninstall <name>@<mp> --scope <s>`;
    captures stdout/stderr; snapshots cache tree pre-invocation
  - Verify: unit test (with `claude` stubbed) asserts correct argv and
    pre-invocation snapshot
  - blockedBy: T-300

- [ ] **T-302** Rollback re-installs via `claude plugin install`
  - Verify: integration test does uninstall → rollback → plugin present

- [ ] **T-303** CLI `clean --grace=<days>` (default 30)
  - Verify: `--help` shows; `--grace=foo` rejects

- [ ] **T-304** Refusal classes `plugin-still-referenced`,
      `plugin-uninstall-binary-missing`
  - Verify: classifier fires each on matching fixture

- [ ] **T-305** Fixture `plugin-disused-30d/` + `plugin-disused-but-referenced/`
  - Verify: first yields the finding; second does NOT and refusal fires
    on direct invocation

- [ ] **T-306** `test/plugin-uninstall.test.mjs` — 10+ tests

---

## Phase 4 — Harden non-settings surfaces (P4)

- [ ] **T-400** `composeHardenPlan` dispatches on detector family
  - Scope: route `registry.*` and `hooks.*` to sub-composers
  - blockedBy: T-D04

- [ ] **T-401** `composeRegistryHardenPlan` for `registry.local_command_identical`
  - Verify: registry pointer rewritten, file not deleted

- [ ] **T-402** `--strategy=rewrite-path=<new>` for `settings.hook_path_dangling`
  - Verify: hook entry's command path updated to supplied value

- [ ] **T-403** Refusal classes `registry-shape-unknown`,
      `registry-not-rewriteable-in-v0.4`
  - Verify: classifier fires on matching fixture

- [ ] **T-404** Fixture `registry-rewriteable/` + `test/harden-non-settings.test.mjs`
      (8+ tests)

---

## Phase 5 — JSONC v2 (P5)

- [ ] **T-500** Choose JSONC parser per Q4; add dep to `package.json`
  - Verify: `npm install` succeeds across matrix; `npm pack --dry-run`
    size delta < 100 KiB
  - blockedBy: T-D04 (Q4)

- [ ] **T-501** Mutation kind `settings-jsonc-rewrite` in `MUTATION_REGISTRY`
  - Verify: snapshot a comment-bearing file, identity-patch, rollback,
    assert byte-equality

- [ ] **T-502** Refusal class `jsonc-comment-orphaned`
  - Verify: classifier fires when a patch would detach a comment from
    its anchor key

- [ ] **T-503** Flip `settings.jsonc_detected` from `inform` → `hardenable: true`
  - Verify: README "Current Checks" updated; golden test confirms new
    stance

- [ ] **T-504** Fixture `settings-jsonc-rewriteable/`
  - Verify: harden produces rewritten file with comments preserved

- [ ] **T-505** `test/settings-jsonc-rewrite.test.mjs` — 10+ tests

---

## Phase 6 — Stream batch (P6)

- [ ] **T-600** `--batch=stream` parser
  - Verify: `--help` shows; `--batch=foo` rejects
  - blockedBy: T-D04 (Q5)

- [ ] **T-601** Stream composer emits sub-ops without aggregate cap;
      parent manifest carries `subOperations[]`
  - Verify: 75 ops compose under one parent without refusal

- [ ] **T-602** Per-sub-op snapshot writer at `<op_id>/sub/<seq>/`
  - Verify: RSS bounded across 100-op stream

- [ ] **T-603** Parent status: `verified` iff all sub-ops verified, else
      `applied + partialApply: true`
  - Verify: injected sub-op failure leaves parent at `applied + partialApply`

- [ ] **T-604** Interrupted-operation GC for stream batches
  - Verify: kill-mid-stream test leaves no orphan sub-trees after recovery

- [ ] **T-605** Refusal `stream-batch-includes-non-batchable-kind`
  - Verify: fires when settings-rewrite / settings-jsonc-rewrite /
    plugin-uninstall mixed into a stream

- [ ] **T-606** `test/clean-batch-stream.test.mjs` — 12+ tests

---

## Phase 7 — Release prep + N-item sweep

- [ ] **T-700** CHANGELOG entry under `[Unreleased]` for v0.4.0
- [ ] **T-701** `docs/migration-v0.3-to-v0.4.md` upgrade guide
- [ ] **T-702** README updates — `learn`, `--strategy=rewrite`,
      `plugin.disused`, JSONC v2 status, stream batch, current-checks refresh
- [ ] **T-703** Site (`docs/index.html`) version pin + v0.4 mention
- [ ] **T-704** CI `version-pin` job picks up v0.4 tag (inherited from
      v0.3 T-604)
- [ ] **T-705** **(N5)** Marketplace listing prep — README polish,
      `plugin.json` keyword optimization; verify: keyword set in
      `docs/marketplace-listing.md`
- [ ] **T-706** **(N6)** `<home>/.claude/housekeeper/lock.history`
      append-only (acquire/release lines, 1 MiB ring); verify: integration
      test asserts each event appends a line
- [ ] **T-707** **(N8)** `.husky/pre-commit` runs
      `node scripts/check-forbidden-language.mjs` on staged files; verify:
      forbidden token blocks the commit
- [ ] **T-708** Compatibility matrix entry for v0.4.0 (Q1–Q5 + Claude
      Code version pinned)

---

## Cross-phase

- [ ] **T-800** Schema-stability: add `settings-jsonc-rewrite` and
      `plugin-uninstall` to documented mutation kinds; document
      `learning/events.jsonl` `schemaVersion: "0.1"` on its own line
  - blockedBy: T-D04

- [ ] **T-801** Threat model addendum: shell-out surface for
      `plugin-uninstall`, allow-list integrity for MCP rewrite,
      learning loop file-locking
  - blockedBy: T-D04

- [ ] **T-802** Versioning policy: confirm `learn`, `--strategy=rewrite`,
      `--grace=`, `--batch=stream`, `plugin.disused`, and JSONC v2 stance
      shift are additive (v0.4 minor)
  - blockedBy: Phases 1–6

- [ ] **T-803** Soak script (`scripts/soak.sh`) learns v0.4 surfaces
      (`learn export`, `--strategy=rewrite` dry-runs, `plugin.disused`
      dry-runs, `--batch=stream` dry-runs)
  - blockedBy: Phases 1, 2, 3, 6
