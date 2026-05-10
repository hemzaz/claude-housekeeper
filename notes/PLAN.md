# Plan — Claude Housekeeper to v0.1 Public Read-Only Preview

Date: 2026-05-10. Project root: `~/PROJ/housekeeper/`.

## 1. Reality check (gap between docs and code)

The framework is heavily documented (~50 docs in `docs/`) and is consistent
end-to-end. The current code (`scripts/lib/audit.mjs`, ~770 LOC) is a working
audit but lives in **legacy vocabulary** that contradicts the docs:

| Area | Docs say | Code does | Gap |
|---|---|---|---|
| Header line | `HOUSEKEEPER REPORT\nNo files changed.` | `SCORECARD` | Wrong header; no "No files changed." |
| Stance | 8 stances (`inform`/`watch`/`review`/`probe`/`protect`/`prepare`/`repair`/`block`) | severity/risk/confidence + `proposedAction` like `repair`/`quarantine`/`fix` | No stance field at all |
| Contracts | `SurfaceClassification`, `EvidenceSet`, `Finding`, `Stance`, `Report`, `PolicyMatch`, `ScanLimit` | Flat issue objects with `severity`/`risk`/`path` | None of the contract objects exist |
| Output sections | PRIMARY / STANCE SUMMARY / BOUNDARIES / SCAN / BLOCKED / PROTECTED | Scorecard rows + plan list | Wrong shape |
| JSON | Schema-versioned, `filesChanged: false`, stable fields list | Ad-hoc shape, no schema version | No JSON contract |
| Refusal language | "No files changed. clean requires…" rollback proof citation | One-line refusal, no citation | Close but inconsistent |
| Fixtures | 8+ synthetic homes under `fixtures/synthetic-homes/<id>/` with `card.yaml`, `report.txt`, `report.json` | Empty (`fixtures/README.md` only); tests build homes inline in `tmpdir` | Fixture matrix is unbuilt |
| Golden reports | 10 canonical reports in `docs/golden-reports.md` | None compared against | No golden test |
| Safe mode | `--safe` flag, separate from default | No flag | Missing |
| Compatibility matrix | Published per release | No machine-readable record | Missing |
| Issue templates | False-positive + damaged-environment + loader-semantics + compatibility | False-positive + cleanup-request only | 2 templates short |
| `verify` | Smoketest probes with non-interactive subagent dispatch | Subagent dispatch is stubbed `FAIL Not implemented` | Known stub |
| README | `claude-housekeeper diagnose` etc. + read-only promise | Already aligned to read-only | OK |

**Vocabulary collisions to fix in code** (will trip release-blockers in
`docs/release-blockers.md`):

- `proposedAction: "repair"` — repair has a strict spec; using it as a generic
  action label dilutes the stance grammar.
- `proposedAction: "quarantine"` — quarantine implies snapshot+manifest, neither
  of which exist; using it without rollback proof is a release blocker.
- `risk: "reversible-cleanup"` — implies reversibility evidence we don't have.
- `action: "fix settings.json"` / `"fix config"` — "fix" violates the language
  rules in `docs/decision-calculus.md` §11 ("Avoid: 'auto-fix'").
- Scorecard column `action: "clean --scope=plugins"` — points users at the
  refusing command, but doesn't carry stance.

## 2. Strategy

The doc set is the contract. Code must move to it, not the other way around.
Migration path keeps the working detectors and rewrites the **wrapper** around
them: classification → evidence → stance → report. Detector logic stays mostly
intact under the hood.

Three guiding rules:

1. **No new detectors until the contract is reshaped.** New detection on top
   of legacy vocabulary just doubles the migration cost.
2. **Fixture-driven TDD from now on.** Every contract change pins itself to a
   synthetic home + acceptance card + golden report. This is what
   `docs/implementation-blueprint.md` §2 prescribes.
3. **Read-only is sacred.** No code path that writes, deletes, or executes
   user files lands in v0.1, even by accident. CI must guard this.

## 3. Phases

Each phase ends with a verifiable check. If the check fails, the phase isn't
done.

### Phase 0 — Vocabulary hygiene (low-risk, high-clarity)

Goal: stop the bleeding on contradicting language so the rest of the
migration starts from a quieter baseline.

- Replace `proposedAction: "repair" | "quarantine" | "fix"` with neutral
  placeholders (`"none"`) until the stance engine lands. The
  `protectionReason`/`protected` flag stays.
- Replace `action: "fix settings.json"` and `"fix config"` with `"review"`.
- Add `filesChanged: false` to the JSON report and `No files changed.` to the
  human report header (above SCORECARD), even before the full report grammar
  rewrite. This earns the central public promise immediately.
- Add the JSON schema version field (`schemaVersion: "0.1-pre"`) so external
  consumers know they are reading pre-release output.

Verify: existing tests still pass; `node scripts/claude-housekeeper.mjs
diagnose` first line is `HOUSEKEEPER REPORT`, second line is `No files
changed.`; `--json` includes `filesChanged: false` and `schemaVersion`.

### Phase 1 — Contract objects

Goal: introduce the seven contract objects from
`docs/build-readiness.md` §3 as plain data shapes with constructors. No
detector rewrites yet.

- New file `scripts/lib/contracts.mjs` exporting:
  `makeSurfaceClassification`, `makeEvidenceSet`, `makeFinding`, `makeStance`,
  `makeReport`, `makePolicyMatch`, `makeScanLimit`. Each is a pure factory
  with default values matching `docs/schemas.md`.
- Add `scripts/lib/stance.mjs` implementing the decision calculus order from
  `docs/decision-calculus.md` §4: protect → block → probe → review → prepare
  → repair → watch → inform. Pure function `decideStance(inputs) → Stance`.
- Add `scripts/lib/surface.mjs` with the classification table from
  `docs/surface-classification-spec.md` §4 (axes + action eligibility).

Verify: a unit test per module — round-trip a fixture-card YAML through the
factories and assert shape.

### Phase 2 — Stance-first audit pipeline (the core rewrite)

Goal: rebuild `audit.mjs` so detectors emit `Finding` objects through the
classification → evidence → stance pipeline, while keeping detection logic.

- Each detector returns `{ surface, evidence, missingKeys, hint }` instead of
  the current scorecard rows.
- A central `assembleReport()` runs every detector, classifies surfaces,
  collects evidence, applies policy, and runs the stance engine.
- New report renderer (`scripts/lib/report.mjs`) implements the human format
  from `docs/report-grammar.md` and the JSON shape from `docs/schemas.md`.
- `formatScorecard` is removed; `formatPlan` is rewritten as the plan view
  (`docs/golden-reports.md` style, but for the plan command).

Detector remap (current id → finding.id, claimLevel, default stance):

| Current check id | New finding.id | Default stance | Notes |
|---|---|---|---|
| `settings.invalid_json` | `settings.invalid_json` | `prepare` | Acceptance card #7 |
| `settings.hook_path_dangling` | `settings.hook_path_dangling` | `prepare` | Card #1 (direct path missing). Shell-ambiguous variant emits `settings.hook_command_shell_ambiguous` with stance `probe` per card #2. |
| `settings.mcp_command_missing` | `settings.mcp_command_missing` | `prepare` | Safe mode parses `.mcp.json` only, never starts servers (`safe-mode.md` "Hard Rules"). |
| `plugin.stale_versions` | **split**: `plugin.expected_orphan` (inside ~7d grace, stance `watch`, card #3) and `plugin.cache_unreferenced` (no grace evidence, stance `probe`, card #4) | `watch` / `probe` | A single detector cannot serve both stances. Grace evidence comes from `loader-semantics.md` §2 (documented 7-day orphan retention). |
| `plugin.duplicate_registrations` | `plugin.duplicate_registration` | `review` | Fixture `duplicate-scope-plugin`. |
| `plugin.cache_size` | `plugin.cache_size` | `inform` | Already informational. |
| `plugin.hook_path_dangling` | merge into `settings.hook_path_dangling` | `prepare` | Same data, dedupe. |
| `registry.local_command_shadow` | `registry.local_command_shadow` | `review` | Fixture `local-shadow-identical`. |
| `registry.local_skill_shadow` | `registry.local_skill_shadow` | `review` | Same. |
| `registry.local_command_identical` | `registry.local_command_identical` | `review` | `prepare` only with rollback proof (`protocol-contracts.md` "Local Shadow"). |
| `registry.local_command_diverged` | `registry.local_command_diverged` | `review` | Fixture `local-shadow-diverged`. |
| `registry.broken_frontmatter` | `registry.broken_frontmatter` | `prepare` | Integrity finding. |
| `registry.tiny_registry_files` | `registry.tiny_registry_files` | `review` | Could be intentional. |
| ~~`state.zombie_modes`~~ | _deferred to v0.2_ | — | **Removed from v0.1 (TRACEABILITY.md C5).** No fixture, no golden, no acceptance card; spec mentions zombie state only as an edge case in `protocol-contracts.md` §11, not as a first-wedge requirement. Carry forward to v0.2 with proper card + golden. |
| ~~`state.expired_cancel_signals`~~ | _deferred to v0.2_ | — | **Removed from v0.1 (C5).** No spec source for this id beyond the existing scratchboard. |
| ~~`state.large_replay_logs`~~ | _deferred to v0.2_ | — | **Removed from v0.1 (C5).** Hygiene; `mvp-cutline.md` §2 excludes broad session/project history cleanup. |
| ~~`fs.large_logs`~~ | _deferred to v0.2_ | — | **Removed from v0.1 (C5).** Same reason. |
| ~~`fs.old_file_history`~~ | _deferred to v0.2_ | — | **Removed from v0.1 (C5).** Same reason. |
| ~~`fs.old_short_lived_cache`~~ | _deferred to v0.2_ | — | **Removed from v0.1 (C5).** Same reason. |
| ~~`fs.corrupt_backups`~~ | _deferred to v0.2_ | — | **Removed from v0.1 (C5).** No fixture or golden; integrity findings outside the first wedge. |
| ~~`fs.drift_dirs`~~ | _deferred to v0.2_ | — | **Removed from v0.1 (C5).** Manual artifact detector with no spec backing. |
| _new_ | `housekeeper.interrupted_operation` | `block` | Required by `operational-readiness.md` §4 + `protocol-contracts.md` §17 + golden report #10. Even with no v0.1 mutation, refuse further work if any incomplete `~/.claude/housekeeper/operations/<id>.json` manifest exists. **TRACEABILITY.md C6 flags missing acceptance card — author one before T-208 lands.** |

**v0.1 detector count after C5 trim:** 13 (down from 22). Hygiene/state findings move to v0.2 alongside the knowledge layer (`docs/learning-loop.md`) and finding lifecycle. This realigns the implementation with `mvp-cutline.md` §1 ("first wedge"): settings parse, hook path analysis, plugin registry parse, plugin cache version map, protection policy, degraded scan reporting — and nothing else.

Verify: every detector test (`test/audit.test.mjs`) is rewritten to assert
`finding.stance`, `finding.surface.surfaceClass`, presence of evidence keys,
and absence of forbidden language in the rendered report.

### Phase 3 — Fixtures, acceptance cards, golden reports

Goal: turn `fixtures/` from documentation into executable test inputs that
catch language and stance regressions.

- Build the 8 first-wedge fixtures listed in `docs/build-readiness.md` §6
  under `fixtures/synthetic-homes/<id>/`:
  `clean-home`, `broken-hook-simple`, `broken-hook-shell-ambiguous`,
  `expected-orphan-cache`, `candidate-stale-cache`, `protected-secret-path`,
  `checkpoint-only-rollback`, `invalid-settings`, `huge-home-degraded`.
- Each fixture: `home/.claude/...`, `card.yaml` (template in `fixtures/README.md`),
  `report.txt` (golden), `report.json` (golden).
- New test file `test/fixtures.test.mjs` walks `fixtures/synthetic-homes/`,
  runs `auditClaudeHome`, and asserts each acceptance card.
- New test file `test/forbidden-language.test.mjs` asserts no rendered report
  contains the words from `docs/decision-calculus.md` §11 forbidden list:
  `safe`, `trash`, `junk`, `obviously unused`, `auto-fix`, `guaranteed
  rollback`, `optimized`, `clean bill of health`, `fixed everything`.

Verify: `npm test` passes with the new fixture-driven tests; goldens diff
cleanly.

### Phase 4 — Operational readiness

Goal: meet `docs/operational-readiness.md` gates for a public preview.

- Add `--safe` flag and a `mode: "safe" | "diagnose"` field to the report.
  Safe mode follows `docs/safe-mode.md`: no live probes, no traversal of
  secret-adjacent paths beyond metadata, scan budget enforced.
- Implement scan budgets (`maxFiles`, `maxBytes`, `maxWallMs`) with
  degraded-scan reporting in the SCAN section.
- Write `docs/compatibility-matrix.md` with one real entry: macOS + tested
  Claude Code version + tested Node LTS.
- Write `docs/schema-stability.md` listing stable fields (already mostly
  drafted in `docs/operational-readiness.md` §8).
- Add the 2 missing GitHub issue templates: `damaged-environment.md` and
  `loader-semantics.md` (compatibility template can fold into damaged-env or
  ship separately).
- Replace the stubbed subagent dispatch probe in `verify` with a documented
  "not implemented in v0.1, run `claude` manually for now" message that
  doesn't claim FAIL.

Verify: `claude-housekeeper diagnose --safe --scope=settings --json |
jq .mode` is `"safe"`; `npm run lint` and `npm run format` pass; CI runs the
new tests against current LTS and latest Node.

### Phase 5 — Release prep

Goal: pass the launch checklist.

- `claude plugin validate .claude-plugin/plugin.json` (when `claude` is
  available — gate it in CI with a feature check).
- `npm pack --dry-run` snapshot test that the tarball contains only the
  `files` declared in `package.json`.
- README pass: confirm the read-only language is verbatim what the v0.1
  reports emit; remove any roadmap claim that overshoots the wedge.
- Tag `v0.1.0` only after the `docs/launch-checklist.md` "Release Readiness"
  bullets are all checked.

Verify: dry-run release in a fork; reviewer can read the README and a
diagnose report and form the same understanding.

## 4. Out of scope for v0.1 (carry to v0.2+)

Per `docs/mvp-cutline.md` §2 and `docs/north-star.md` §1:

- Mutation of any kind: `clean`, `harden`, `rollback` keep refusing.
- Snapshot, manifest, quarantine implementations.
- Live Claude probes by default (probes stay opt-in via `verify`).
- Automatic learning from false positives (manual `doNotTouch` only).
- Background daemon, SessionStart hook, prevention hooks.
- Secrets scanning as a feature.
- Subagent dispatch probe in `verify`.
- Windows / WSL / Linux compatibility claims (until tested).

## 5. Open questions for the operator

1. **Subagent dispatch in `verify`**: the current stub returns FAIL, which is
   misleading. Phase 4 changes it to a "not implemented" notice. Confirm this
   is the right read.
2. **Plugin slash command name**: docs use `/claude-housekeeper:housekeep`
   and the file is `commands/housekeep.md`. Confirm this naming sticks for
   v0.1 (or rename to `inspect` / `diagnose` to match command vocabulary).
3. **Repository hosting**: `package.json` says `hemzaz/claude-housekeeper`
   and `homepage: hemzaz.github.io/claude-housekeeper/`. Confirm this is the
   real public org/repo target.
4. **`--safe` as default vs. opt-in**: docs treat safe mode as a recovery
   posture (`docs/safe-mode.md` "Entry Point"), but normal `diagnose` is
   already non-executing. Decision: keep normal diagnose default, add
   `--safe` as a stricter mode that disables even structural reads of
   secret-adjacent metadata. Confirm.
5. **`commands/housekeep.md` `disable-model-invocation: true`**: this means
   the slash command will not be auto-invoked by Claude. Intentional? It's
   the right call for a tool that should be triggered consciously by the
   user, but worth confirming.

## 6. Risks

- **Detector regressions** during the rewrite. Mitigation: the existing 4
  tests in `test/audit.test.mjs` get rewritten as fixture cards before the
  rewrite, so we have a regression net throughout.
- **Goldens become brittle**. Mitigation: assert by section
  (PRIMARY/STANCE/BOUNDARIES/SCAN), not byte-equal whole-file diff.
- **Scope creep into mutation**. Mitigation: a CI check that greps for
  `unlinkSync`, `rmSync`, `writeFileSync` (allowed only in `test/`) and
  fails the build.
- **README drift from CLI output**. Mitigation: a test that runs `diagnose`
  against `clean-home` fixture and asserts the README example block matches
  it section-by-section.

## 6A. Spec re-read addendum (2026-05-10)

After re-reading every doc in `docs/` (50 files), the phasing above survives,
but the following gaps surfaced and are added to the taskboard:

1. **Detector split** — `plugin.stale_versions` must split into
   `plugin.expected_orphan` (`watch`) vs `plugin.cache_unreferenced` (`probe`),
   keyed to the documented 7-day grace window. Single legacy id collapsed two
   spec stances. (Phase 2 table updated above.)

2. **Fixture matrix coverage gap** — `docs/fixture-matrix.md` lists 16 rows.
   Phase 3 currently builds 8 (the first wedge). Seven more belong in v0.1
   because their stances are exercised by detectors already remapped:
   `interrupted-housekeeper-operation`, `symlinked-home`, `duplicate-scope-plugin`,
   `local-shadow-identical`, `local-shadow-diverged`, `mcp-command-missing`,
   `secret-command-fragment`. The 8th matrix row (`clean-home`) is already in
   the first wedge. (`local-shadow-identical` and `local-shadow-diverged` are
   strictly required because detectors remap to them.)

3. **`housekeeper.interrupted_operation` detector** — `operational-readiness.md`
   §4 plus `protocol-contracts.md` §17 require this detector even before
   mutation lands. Read v0.1 emits `block` if any
   `~/.claude/housekeeper/operations/<id>.json` exists with status not
   `verified`. Golden report #10 already specifies the output.

4. **Redaction / privacy mode** — `release-blockers.md` Public Support Blockers
   list "no redaction examples" as blocking. `redaction-examples.md` and
   `safe-mode.md` "Privacy Mode" both specify `--redact` behavior. v0.1 must
   ship a tested redaction path for path prefixes and command-line tokens.

5. **Self-failure degradation** — `operational-readiness.md` §4 requires that
   read-only mode degrade around Housekeeper self-failure (corrupt config,
   stale knowledge, unknown schema version) instead of crashing. Test via
   fixture or unit test.

6. **Compatibility report issue template** — `release-blockers.md` Public
   Support Blockers lists a third missing template alongside damaged-environment
   and loader-semantics. (Phase 4 task T-406 had only two; raise to three.)

7. **`mode` default in JSON output** — `schema-stability.md` requires `mode`
   to always be present. Default `mode: "diagnose"` in normal runs;
   `mode: "safe"` under `--safe`. Currently nothing emits the field.

8. **Schema version bump at tag** — JSON `schemaVersion` should be `"0.1-pre"`
   during Phase 0–4 and bump to `"0.1"` at v0.1.0 tag time per `schemas.md` §1
   and `schema-stability.md`.

9. **README out-of-band invocation path** — `operational-readiness.md` §3
   Distribution Layer requires the README show at least one out-of-band
   invocation (e.g. `npx claude-housekeeper diagnose --safe`) so users can
   recover when plugin loading is itself broken.

10. **Truth-probe payload contract** — when a report's "next step" recommends a
    live probe, the JSON should attach the probe's `class`, `mayExecute`,
    `consent` fields per `truth-probe-catalog.md`. Otherwise consumers can't
    distinguish a `/doctor` recommendation from `claude --debug hooks`.

11. **Forbidden-language list expansion** — combining the avoid-lists from
    `decision-calculus.md` §11, `report-grammar.md` §8, `vocabulary.md` §3,
    `loader-semantics.md` §10, and `repair-rollback-spec.md` §8 yields the
    canonical set. Test phrase-level (e.g. "safe to delete", "safe cleanup",
    not the word "safe" alone, since "safe step" and "safe mode" are valid).

12. **Sector-boundary parent inheritance** — `surface-classification-spec.md`
    §7 defines transitive boundary propagation. The `protected-secret-path`
    fixture must exercise both directions (parent boundary covering
    descendants; child boundary blocking parent recursion).

These twelve items reach into Phases 2–5 of the existing taskboard, not a new
phase. They are added as T-IDs in `TASKBOARD.md` rather than restructured.

## 6B. Audit-driven corrections (2026-05-10, after team kickoff)

Two read-only research dispatches (PM traceability audit, Claude Code
loader-semantics audit) returned with corrections. See
`notes/TRACEABILITY.md` and `notes/LOADER-SEMANTICS-AUDIT.md`.

**Applied:**

- **C5 — scratchboard hygiene detectors removed from v0.1.** Nine detectors
  (`state.zombie_modes`, `state.expired_cancel_signals`,
  `state.large_replay_logs`, `fs.large_logs`, `fs.old_file_history`,
  `fs.old_short_lived_cache`, `fs.corrupt_backups`, `fs.drift_dirs`,
  `registry.tiny_registry_files`) inherited from the existing audit code
  with no spec backing. They are deferred to v0.2 (knowledge and
  boundaries) where finding lifecycle and retention policy land. v0.1
  detector count drops from 22 to 13, restoring alignment with
  `mvp-cutline.md` §1.

- **MCP duplicate-matching key (loader-semantics drift).** When
  `mcp.duplicate_registration` becomes a detector (likely v0.2, since it's
  not in the first wedge), it must match by **name** for Local/Project/User
  scopes and by **endpoint** (URL or command string) for Plugin and
  claude.ai-connector scopes. A name-only match will both miss real
  conflicts and flag harmless reuse. Spec doc `loader-semantics.md` §6 needs
  an update to record this — that update is itself a Phase 4 task (added
  below as T-411).

**Open / needs decision:**

- **C3 — `mode` field default.** Goldens (`docs/golden-reports.md`) all
  show `mode: safe` because they are safe-mode invocations. T-209 specified
  default `mode: diagnose` for normal runs. The two are reconcilable: each
  fixture's golden lives at the mode the test asserts. T-203 byte-compares
  must therefore pin per-fixture mode rather than assume a single default.
  No PLAN change needed; T-203 / T-209 verify-criteria already imply this,
  but the contract should be made explicit when the renderer lands.

- **C1 / C2 / C4 / C6 — missing fixture authoring** (8 cards, 6 goldens,
  redaction fixture, interrupted-op acceptance card). Authoring is
  substantive work — held until the user authorizes the TDD-guide / Tech
  writer roles to start.

- **Loader spec drift (4 changed entries).** Source URLs moved
  (`slash-commands` → `skills`); marketplace source-type enum is more
  restrictive than spec's loose list; `strictKnownMarketplaces` not
  reachable on audited URLs (likely on `/en/plugin-marketplaces`). These
  belong in a single `loader-semantics.md` revision pass, not a code
  change. Added as T-411.

## 7. The success state

`v0.1.0` ships when a stranger can:

1. Install the plugin or run `npx claude-housekeeper diagnose`.
2. Get a stance-first report that starts with `HOUSEKEEPER REPORT\nNo files
   changed.`
3. Identify the primary issue without reading anything else.
4. See protected items, blocked actions, and the next safe step explicitly.
5. Trust that nothing on disk changed.

That is the entire wedge. Everything else waits.
