# Traceability — Claude Housekeeper v0.1

Date: 2026-05-10. Companion to `notes/PLAN.md` and `notes/TASKBOARD.md`.

This is the single coverage matrix for every first-wedge detector remapped in
`PLAN.md` §3 Phase 2. It extends the seed table in
`docs/requirements-traceability.md` to the full ~22-detector set and surfaces
all gaps between detector → spec → fixture → golden → acceptance card → test.

Cite format: `<filename> §<section>`. Where a spec doc has no numbered
sections, the section header (the nearest `##` title) is named instead.

Stance abbreviations: `inf` inform, `wat` watch, `rev` review, `prb` probe,
`pro` protect, `prep` prepare, `rep` repair, `blk` block.

Test file column: `T-NNN` is the taskboard ID that creates the test/fixture.
Existing tests live in `test/audit.test.mjs` (legacy, slated to be migrated
out by T-312).

---

## 1. Coverage Matrix

| # | Finding id | Pain (one sentence) | Requirement (one sentence) | Spec sources | Fixture id | Golden § | Acceptance card § | Stance(s) | Test file (target) |
|---|---|---|---|---|---|---|---|---|---|
| 1 | `settings.invalid_json` | Malformed `settings.json` poisons every downstream inference and Claude behaves erratically. | Stop dependent inference and prepare a parse-repair plan with the exact line/column. | `protocol-contracts.md` §"Edge Case 10. Invalid Settings"; `safe-mode.md` "Hard Rules"; `decision-calculus.md` §6 row "malformed settings with exact location"; `loader-semantics.md` §1 | `invalid-settings` | §7 | §7 | `prep` (parse) + `blk` (dependent inference) | T-308, T-310 |
| 2 | `settings.hook_path_dangling` | A hook points at a deleted plugin path so Claude crashes or silently misfires. | Detect direct missing absolute hook paths without running the hook. | `evidence-keyring.md` "Direct Hook Path"; `protocol-contracts.md` §"Edge Case 9. Broken Hook Path"; `loader-semantics.md` §5; `safe-mode.md` "Hard Rules" | `broken-hook-simple` | §2 | §1 | `prep` | T-302, T-310 |
| 3 | `settings.hook_command_shell_ambiguous` | A hook command embeds shell expansion so Housekeeper cannot tell whether the path is real. | Treat shell ambiguity as a missing key and require a live debug probe before any claim. | `truth-probe-catalog.md` "Hook Debug"; `surface-classification-spec.md` §"Execution Class — shell-expansion-risk"; `loader-semantics.md` §5; `decision-calculus.md` §6 row "safe mode cannot prove live behavior" | `broken-hook-shell-ambiguous` | §3 | §2 | `prb` | T-303, T-310 |
| 4 | `settings.mcp_command_missing` | An MCP server config points at a missing absolute command so the server fails on session start. | Parse `.mcp.json` and flag missing direct command paths without ever starting the server. | `loader-semantics.md` §6; `safe-mode.md` "Hard Rules"; `protocol-contracts.md` §"Edge Case 15. External Side Effects" | `mcp-command-missing` | MISSING | MISSING | `prep` (direct) / `prb` (shell) | T-318, T-310 |
| 5 | `plugin.expected_orphan` | Orphaned plugin cache versions look like garbage but a still-running session may load them. | Within the documented ~7-day grace window, mark as `watch` and block "unused" language. | `loader-semantics.md` §2 ("removed automatically about 7 days"); `loader-semantics.md` §7; `evidence-keyring.md` "Cache References"; `decision-calculus.md` §6 row "expected orphan within grace period" | `expected-orphan-cache` | §4 | §3 | `wat` | T-304, T-310 |
| 6 | `plugin.cache_unreferenced` | An orphan cache outside the grace window may or may not still be loaded by a process. | Mark as `probe` until a freshness key (active session / process / retention) clears it. | `loader-semantics.md` §7; `evidence-keyring.md` "Freshness Keys"; `unknowns.md` "Cache Internals"; `decision-calculus.md` §6 row "possible load-bearing cache" | `candidate-stale-cache` | §5 | §4 | `prb` | T-305, T-205a, T-310 |
| 7 | `plugin.duplicate_registration` | Same plugin enabled at user and project scope; user cannot tell which is effective. | Show both registrations and explain precedence; never auto-deduplicate. | `loader-semantics.md` §1; `protocol-contracts.md` §"Edge Case 7. Duplicate Plugin Scope"; `decision-calculus.md` §6 row "local override or diverged copy" (analogous) | `duplicate-scope-plugin` | MISSING | MISSING | `rev` | T-315, T-310 |
| 8 | `plugin.cache_size` | Plugin cache balloons but the user has no idea if any of it matters. | Inform on total plugin cache footprint without asserting cleanability. | `decision-calculus.md` §3 "Inform" (example "plugin cache size") | MISSING | MISSING | MISSING | `inf` | MISSING |
| 9 | `registry.local_command_shadow` | A local command silently overrides a plugin command and the user does not know it exists. | Show shadow with both source paths and precedence; do not propose removal. | `surface-map.md` "Local Resources"; `protocol-contracts.md` §"Edge Case 8. Local Shadow Of Plugin Resource"; `decision-calculus.md` §6 row "local override or diverged copy" | MISSING (only `local-shadow-identical` and `local-shadow-diverged` cover sub-cases) | MISSING | MISSING | `rev` | MISSING |
| 10 | `registry.local_skill_shadow` | A local skill shadows a plugin skill and changes Claude's effective behavior. | Same as #9 for skills. | `loader-semantics.md` §4; `surface-map.md` "Local Resources"; `protocol-contracts.md` §"Edge Case 8" | MISSING | MISSING | MISSING | `rev` | MISSING |
| 11 | `registry.local_command_identical` | A byte-identical local copy of a plugin command — possibly intentional, possibly drift. | Mark as `review`; only `prepare` exists with rollback proof. | `protocol-contracts.md` §"Edge Case 8. Local Shadow" rule "byte-identical local shadow"; `decision-calculus.md` §6 same row; protocol-contracts Edge Case Default Table row "byte-identical local shadow" | `local-shadow-identical` | MISSING | MISSING | `rev` | T-316, T-310 |
| 12 | `registry.local_command_diverged` | A local copy of a plugin command has been edited; overwriting it would destroy authorship. | Mark as `review` and explicitly forbid suggesting overwrite of local edits. | `protocol-contracts.md` §"Edge Case 8" rule "diverged local shadow"; `decision-calculus.md` §6 row "local override or diverged copy" | `local-shadow-diverged` | MISSING | MISSING | `rev` | T-317, T-310 |
| 13 | `registry.broken_frontmatter` | A skill or command file has malformed frontmatter so Claude silently drops it. | Flag integrity issue and prepare a parse repair. | `protocol-contracts.md` §3 Evidence Contract (general); `protocol-contracts.md` §"Edge Case 10. Invalid Settings" (analogous integrity rule) — **no detector-specific spec** | MISSING | MISSING | MISSING | `prep` | MISSING |
| 14 | `registry.tiny_registry_files` | Sub-byte registry stubs may be intentional placeholders or could be drift. | Mark as `review`; do not auto-classify. | **no detector-specific spec** (general `decision-calculus.md` §6 "review" row) | MISSING | MISSING | MISSING | `rev` | MISSING |
| 15 | `state.zombie_mode` | A mode state file says `active=true` but heartbeat is old; Claude refuses to start a new session. | Mark as `review` until process/session evidence resolves it. | `protocol-contracts.md` §"Edge Case 11. Zombie Mode State"; `protocol-contracts.md` Edge Case Default Table row "zombie state with weak evidence" | MISSING | MISSING | MISSING | `rev` (or `prb` per spec) | MISSING |
| 16 | `state.expired_cancel_signal` | Old cancel-signal files persist but Claude no longer needs them. | Inform only; time-only evidence cannot drive action. | **no detector-specific spec**; closest support: `decision-calculus.md` §3 "Inform" example "namespace inventory" — analogical only | MISSING | MISSING | MISSING | `inf` | MISSING |
| 17 | `state.large_replay_log` | Replay logs grow unbounded and may slow diagnosis. | Inform on size; rotation requires policy plus rollback proof. | `protocol-contracts.md` §"Edge Case 13. Large Logs" | MISSING | MISSING | MISSING | `inf` / `wat` | MISSING |
| 18 | `fs.large_log` | Generic large logs under `~/.claude/`. | Same rule as #17. | `protocol-contracts.md` §"Edge Case 13. Large Logs" | MISSING | MISSING | MISSING | `inf` | MISSING |
| 19 | `fs.old_file_history` | Old `file-history/` snapshots may still be wanted. | Time-only evidence ⇒ `watch`, never delete. | `protocol-contracts.md` §"Edge Case 12. Active Session Artifacts" (analogous: "Never purge sessions solely by age") | MISSING | MISSING | MISSING | `wat` | MISSING |
| 20 | `fs.old_short_lived_cache` | Short-lived cache directories sit past their useful life. | Time-only evidence ⇒ `watch`. | `protocol-contracts.md` §"Edge Case 12" (analogous) — **no detector-specific spec** | MISSING | MISSING | MISSING | `wat` | MISSING |
| 21 | `fs.corrupt_backup` | A backup file is unreadable, hiding the fact that an earlier op never finished safely. | Integrity finding; prepare review. | `protocol-contracts.md` §8 Reversibility Contract (rollback evidence integrity); `protocol-contracts.md` §"Edge Case 17. Interrupted Cleanup" (analogous) — **no detector-specific spec** | MISSING | MISSING | MISSING | `prep` | MISSING |
| 22 | `fs.drift_dir` | Manual artifact directories appear in `~/.claude/` from prior tooling. | Mark as `review` — could be authorship. | `protocol-contracts.md` §14 User Ownership Contract (general) — **no detector-specific spec** | MISSING | MISSING | MISSING | `rev` | MISSING |
| 23 | `housekeeper.interrupted_operation` | A previous Housekeeper operation crashed mid-flight; restarting could clobber the manifest. | Block any new operation while a non-`verified` manifest exists, even in v0.1 (no mutation). | `operational-readiness.md` §4 Self-Failure Layer; `protocol-contracts.md` §"Edge Case 17. Interrupted Cleanup"; `golden-reports.md` §10 | `interrupted-housekeeper-operation` | §10 | MISSING (matrix row only) | `blk` | T-208, T-313, T-310 |

### Cross-cutting requirements (not single detectors but cited by spec)

| # | Requirement | Spec sources | Fixture id | Golden § | Acceptance card § | Test file |
|---|---|---|---|---|---|---|
| X1 | Every report opens with `HOUSEKEEPER REPORT\nNo files changed.` | `golden-reports.md` preamble; `build-readiness.md` §5; `report-grammar.md` §1 | every fixture | every § | every card | T-003, T-310 |
| X2 | JSON ships `schemaVersion`, `mode`, `filesChanged: false` as stable fields | `schemas.md` §1; `schema-stability.md`; `operational-readiness.md` §8 | every fixture | (JSON goldens) | n/a | T-004, T-209, T-404, T-507 |
| X3 | Forbidden language never appears in rendered output | `decision-calculus.md` §11; `report-grammar.md` §8; `vocabulary.md` §3; `loader-semantics.md` §10; `repair-rollback-spec.md` §8 | every fixture | every § | n/a | T-311 |
| X4 | Sector boundary inheritance (parent ↔ child) | `surface-classification-spec.md` §7; `protocol-contracts.md` §5A and §"Edge Case 4 + 5"; `sector-boundaries.md` | `protected-secret-path` | §6 | §5 | T-306, T-310 |
| X5 | Scan-budget degradation reports `degraded: yes` and never claims completeness | `safe-mode.md` "Scan Budgets"; `field-validation.md` §"Scan Budgets"; `operational-readiness.md` §1; `decision-calculus.md` §9 | `huge-home-degraded` | §8 | §8 | T-309, T-402, T-310 |
| X6 | Checkpoint-only rollback ⇒ `block`; never accept Claude checkpoint as Housekeeper rollback proof | `repair-rollback-spec.md` §"Rollback Proof Levels"; `surface-map.md` "Rollback Class"; `protocol-contracts.md` §8; `decision-calculus.md` §5 hard override | `checkpoint-only-rollback` | §9 | §6 | T-307, T-310 |
| X7 | `--redact` privacy mode redacts secret-adjacent fields | `redaction-examples.md` "Command Strings" + "Path Prefixes"; `safe-mode.md` "Privacy Mode"; `release-blockers.md` "Public Support Blockers" | `secret-command-fragment` | MISSING | MISSING | T-319, T-408 |
| X8 | Self-failure (corrupt config / unknown schema) degrades read-only without crashing | `operational-readiness.md` §4; `protocol-contracts.md` §"Edge Case 25 + 26" | MISSING (no fixture) | MISSING | MISSING | T-409 |
| X9 | Truth-probe payload attached to "next step" probe recommendations | `truth-probe-catalog.md` "Catalog"; `loader-semantics.md` §9.1 | reuses `broken-hook-shell-ambiguous` | §3 (text only — payload not specified) | §2 | T-210 |
| X10 | Symlink not auto-traversed; report identity mismatch | `protocol-contracts.md` §"Edge Case 6. Symlinks And Aliases"; `surface-classification-spec.md` "Scope Class" | `symlinked-home` | MISSING | MISSING | T-314, T-310 |
| X11 | Out-of-band invocation path documented (`npx claude-housekeeper`) | `operational-readiness.md` §3 Distribution and Recovery Layer | n/a (README) | n/a | n/a | T-508 |

---

## 2. Orphans

This section catalogs every gap surfaced by the matrix above. Each orphan is
labelled by class so the recommendations section can prioritize.

### 2A. Specs that mandate behavior but have no detector / fixture / golden

- **O1 — Background-actor detection.** `protocol-contracts.md` §"Edge Case 16. Background Actors" requires Housekeeper to identify active hooks/agents/MCP servers before mutation. No detector in the Phase 2 remap covers this. Acceptable for v0.1 (no mutation), but the spec is unsatisfied.
- **O2 — Clean-config probe.** `loader-semantics.md` §9.2 documents the `CLAUDE_CONFIG_DIR` clean-launch probe as a "high-value behavioral key." No detector emits a `proposedProbe` for it. T-210 implements truth-probe payloads but only for shell-ambiguous hooks.
- **O3 — Concurrent change / "dirty home" detection.** `protocol-contracts.md` §"Edge Case 2. Dirty Claude Home" requires lowering authority on any path that changed during the scan. No fixture, no detector.
- **O4 — Conflicting policy (project vs. global).** `protocol-contracts.md` §"Edge Case 3. Conflicting Instructions" requires explicit precedence reporting. No fixture in `fixture-matrix.md`, no detector in PLAN §3 table.
- **O5 — Schema-version drift.** `protocol-contracts.md` §"Edge Case 25. Version Drift In Claude Layout" requires `block` for unknown Claude schema versions. No detector, no fixture. (X8 self-failure partially overlaps but covers Housekeeper's own schema, not Claude's.)
- **O6 — Skill shell injection / `disableSkillShellExecution` reporting.** `loader-semantics.md` §4 documents this behavior. No detector planned.
- **O7 — Compatibility-state reporting.** `compatibility-matrix.md` requires every release to publish a compatibility row, but nothing in the report surface emits the active row to the user. Only an authoring task (T-405) — no runtime detector.
- **O8 — Handoff block in report output.** `operational-readiness.md` §10 Human Handoff Layer requires every `review`/`probe`/`protect`/`block` finding to be convertible into the documented HANDOFF block format. No renderer task in PLAN/TASKBOARD targets this explicitly; T-203 specifies sections PRIMARY/STANCE/BOUNDARIES/SCAN/BLOCKED/PROTECTED but not HANDOFF.

### 2B. Detectors with no fixture or no golden

| Detector id | Fixture | Golden | Acceptance card | Severity |
|---|---|---|---|---|
| `plugin.cache_size` | MISSING | MISSING | MISSING | low (informational; no spec card) |
| `registry.local_command_shadow` | MISSING (sub-cases only) | MISSING | MISSING | **medium — wedge-row in `requirements-traceability.md` covers it** |
| `registry.local_skill_shadow` | MISSING | MISSING | MISSING | **medium — same wedge row** |
| `registry.broken_frontmatter` | MISSING | MISSING | MISSING | medium |
| `registry.tiny_registry_files` | MISSING | MISSING | MISSING | low |
| `state.zombie_mode` | MISSING | MISSING | MISSING | medium (Edge Case 11 mandates `review`) |
| `state.expired_cancel_signal` | MISSING | MISSING | MISSING | low |
| `state.large_replay_log` | MISSING | MISSING | MISSING | low |
| `fs.large_log` | MISSING | MISSING | MISSING | low |
| `fs.old_file_history` | MISSING | MISSING | MISSING | low |
| `fs.old_short_lived_cache` | MISSING | MISSING | MISSING | low |
| `fs.corrupt_backup` | MISSING | MISSING | MISSING | medium (integrity, no spec card) |
| `fs.drift_dir` | MISSING | MISSING | MISSING | low |

### 2C. Fixtures in `fixture-matrix.md` with no acceptance card or no golden

`docs/acceptance-cards.md` lists 8 cards (#1–#8). `docs/fixture-matrix.md`
lists 16 rows. `docs/golden-reports.md` lists 10. The diff:

| Fixture (matrix row) | Acceptance card § | Golden § |
|---|---|---|
| `clean-home` | MISSING | §1 |
| `interrupted-housekeeper-operation` | MISSING | §10 |
| `symlinked-home` | MISSING | MISSING |
| `duplicate-scope-plugin` | MISSING | MISSING |
| `local-shadow-identical` | MISSING | MISSING |
| `local-shadow-diverged` | MISSING | MISSING |
| `mcp-command-missing` | MISSING | MISSING |
| `secret-command-fragment` | MISSING | MISSING |

That is **8 of 16 fixture rows** (50%) with no acceptance card, and **6 of 16**
with no golden report. The acceptance-card doc is materially behind the fixture
matrix.

### 2D. Inconsistencies between PLAN.md remap and the spec docs

- **I1 — `clean-home` is unspoken in PLAN's Phase 2 remap table.** It has a fixture (T-301), a golden (`golden-reports.md` §1), but no row in the PLAN remap table because it's not really a detector. Easy to miss; `requirements-traceability.md` doesn't have a row for it either.
- **I2 — PLAN's remap lists `state.zombie_modes` (plural) → `state.zombie_mode` (singular).** Naming consistency only; pluralization should match the singular form everywhere. Currently scripts use plural; PLAN flips to singular without naming `requirements-traceability.md` (which doesn't mention it at all).
- **I3 — `requirements-traceability.md` row "Local commands and skills can shadow plugin resources"** points to acceptance sources `local-shadow-identical` and `local-shadow-diverged`, but neither has an acceptance card in `docs/acceptance-cards.md`. The wedge row promises evidence the spec doesn't carry.
- **I4 — `requirements-traceability.md` row "Housekeeper could become its own source of rot"** points to `interrupted-housekeeper-operation` for acceptance, but this fixture also has no acceptance card.
- **I5 — `golden-reports.md` §10 (Housekeeper Internal State Problem) ships the canonical block for `housekeeper.interrupted_operation`, but PLAN's Phase 2 detector remap labels it `_new_`** — meaning no current code emits it. T-208 and T-313 close this, but the acceptance card is still missing (see I4).
- **I6 — PLAN T-209 says `mode` field defaults to `"diagnose"`,** while `golden-reports.md` §1 Clean Home shows `mode: safe` and §7 Invalid Settings shows `mode: safe`. Goldens were authored under the assumption that `--safe` is the demo invocation, not that `--safe` is opt-in. This contradicts open question #4 in PLAN. Either the goldens need to be regenerated for `mode: diagnose`, or the default mode flips. Decision required before T-203 / T-209 can land cleanly.
- **I7 — Hygiene detectors 14–22 (`tiny_registry_files`, `expired_cancel_signal`, `large_replay_log`, `large_log`, `old_file_history`, `old_short_lived_cache`, `corrupt_backup`, `drift_dir`)** have no detector-specific spec doc. They survive in PLAN's Phase 2 remap because the existing `audit.mjs` emits them. This is a **scratchboard-bleed** — code shaping the spec instead of the reverse, which the project's stated discipline (PLAN §2 "The doc set is the contract") forbids.
- **I8 — `plugin.cache_size`** has zero spec citation outside `decision-calculus.md` §3's one-word example. PLAN keeps it in Phase 2 as `inform`. Functionally fine, but no fixture and no golden means no regression net.
- **I9 — `state.zombie_modes` → `state.zombie_mode` claims default stance `review`** in PLAN's table; `protocol-contracts.md` §"Edge Case 11" says `review` *or* `probe` depending on freshness key. PLAN over-narrows the spec.
- **I10 — `fs.large_log` and `state.large_replay_log` disagree on stance class.** PLAN has `state.large_replay_log` as `inform` *or* `watch`, but `fs.large_log` strictly `inform`. The two should converge on a single rule (the spec doesn't differentiate them).

---

## 3. Recommendations

Critical for v0.1 ⇒ block release. Deferrable ⇒ document the gap and ship.

### 3A. Critical for v0.1 (must close before tag)

- **C1 — Acceptance cards 9–16 (Orphan 2C).** Without acceptance cards for `interrupted-housekeeper-operation`, `symlinked-home`, `duplicate-scope-plugin`, `local-shadow-identical`, `local-shadow-diverged`, `mcp-command-missing`, `secret-command-fragment`, and `clean-home`, half the v0.1 fixtures have no executable assertion contract. T-313 through T-319 build the fixtures themselves but presume cards exist. **Action**: extend `docs/acceptance-cards.md` to include cards #9–#16 before the fixture-build tasks fire.
- **C2 — Goldens for fixtures 9–16 (Orphan 2C).** `golden-reports.md` covers 10 reports; six fixtures still lack golden output. `operational-readiness.md` §1 readiness gate requires "at least five golden human reports and matching JSON reports" — currently met — but four of those five have no JSON golden listed. **Action**: ship `report.json` goldens alongside human goldens for at least the seven fixtures listed in PLAN §6A item 2.
- **C3 — `mode` default contradiction (Inconsistency I6).** Goldens show `mode: safe`, PLAN says `mode: diagnose` is default. Without resolution, T-203 cannot byte-compare goldens. **Action**: resolve open question #4 (PLAN §5) and either regenerate goldens or update T-209.
- **C4 — Redaction fixture and golden (Cross-cutting X7).** `release-blockers.md` lists "no redaction examples" as a public support blocker. `secret-command-fragment` fixture exists (T-319) but has no acceptance card and no golden. **Action**: add acceptance card, ship a golden showing `<redacted>` substitutions.
- **C5 — Hygiene-detector deletion (Inconsistency I7).** Detectors 14–22 are scratchboard inventions with no spec backing. Per PLAN §2 rule 1 ("No new detectors until the contract is reshaped"), these need either spec rows added to `protocol-contracts.md` Edge Cases plus acceptance cards, or removal from v0.1. **Recommendation: drop them from v0.1's `findings[]` output**; keep the scan code as inert until v0.2 adds spec support. Shipping unspecced detectors invites "what does this mean?" support load.
- **C6 — `housekeeper.interrupted_operation` acceptance card (Inconsistency I4/I5).** Detector implementation is fully planned (T-208), fixture exists (T-313), golden exists (`golden-reports.md` §10), but the acceptance card is missing. Subset of C1 but called out separately because the spec triple (`operational-readiness.md` §4 + `protocol-contracts.md` §17 + golden #10) explicitly demands it.

### 3B. Deferrable to v0.2 (document the gap, ship anyway)

- **D1 — Background-actor / dirty-home / clean-config probe (Orphans O1, O2, O3).** All three require live introspection that v0.1 explicitly refuses (`mvp-cutline.md` §2). Document in `readiness-gap-ledger.md`.
- **D2 — Conflicting-policy detection (Orphan O4).** Multi-scope policy precedence reporting is a feature, not a release blocker. Defer.
- **D3 — Schema-version drift detection (Orphan O5).** v0.1 is single-Claude-version locked by `compatibility-matrix.md` (T-405). Drift handling matters when v0.2 runs across Claude versions.
- **D4 — Skill-shell-injection reporting (Orphan O6).** Belongs to v0.2's knowledge layer.
- **D5 — Compatibility-state surfacing in report (Orphan O7).** Authoring (T-405) is enough for v0.1. Runtime emission is a v0.2 feature.
- **D6 — HANDOFF block in renderer (Orphan O8).** `operational-readiness.md` §10 mandates this for `review`/`probe`/`protect`/`block` findings, but the existing PRIMARY section in `report-grammar.md` already covers most of the same data. Either fold HANDOFF requirements into PRIMARY in T-203, or carry forward. **Action**: clarify in `report-grammar.md` whether PRIMARY is the v0.1 substitute for HANDOFF; defer formal HANDOFF to v0.2.
- **D7 — Stance ambiguity for zombie / replay-log (Inconsistencies I9, I10).** Tied to C5: if the hygiene detectors stay in v0.1, narrow the spec; if they're cut, no action needed.

### 3C. Non-blocking corrections (housekeeping for the docs)

- Add `clean-home` to PLAN §3 Phase 2 remap and to `requirements-traceability.md` as the baseline row (Inconsistency I1).
- Reconcile `state.zombie_modes` vs `state.zombie_mode` naming everywhere (Inconsistency I2).
- Update `requirements-traceability.md` to point at the acceptance cards once C1 lands (Inconsistencies I3, I4).
- Add a `cross-cutting requirements` table (X1–X11 here) to `requirements-traceability.md` so future detectors inherit the platform rules.

---

## 4. Summary stats

- Detectors in PLAN Phase 2 remap: **22** finding ids (rows 1–22 in §1) plus **1** new (`housekeeper.interrupted_operation`, row 23) = **23 total**.
- Cross-cutting requirements traced: **11** (X1–X11).
- Detectors with full coverage (fixture + golden + acceptance card): **7** of 23 (rows 1, 2, 3, 5, 6, 11, 12 — and #23 is missing the acceptance card).
- Orphan classes flagged: **8** specs with no detector (O1–O8), **13** detectors with at least one missing artifact (2B), **8** fixtures with missing cards/goldens (2C), **10** PLAN/spec inconsistencies (I1–I10).
- v0.1 critical orphans: **6** (C1–C6).
- v0.2-deferrable: **7** (D1–D7).
