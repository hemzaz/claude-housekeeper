# Module Boundaries — Phase 1–4 Implementation Contract

This file is the canonical export and import topology for the v0.1 read-only
diagnose/plan pipeline. The lead programmer follows it when authoring T-101
through T-411.

The 10 modules below are exactly the set listed in
`docs/implementation-blueprint.md` §3 — `config`, `policy`, `observe`,
`surface`, `evidence`, `findings`, `stance`, `report`, `fixtures`, `tests`.
No modules are added, merged, or split here. Spec deviations and ambiguity
are deferred to §"Open questions".

The pipeline order is fixed by `docs/framework-kernel.md` §1:

```text
observe -> classify surfaces -> collect evidence -> classify findings -> choose stance -> report
```

Mutation modules (`mutate`, `snapshot`, `quarantine`, `rollback`) are
explicitly out of v0.1 scope per `docs/build-readiness.md` §3 and
`docs/implementation-blueprint.md` §3 ("Do not create modules for mutation,
snapshots, quarantine, hardening, learning, or rollback in the first
wedge.") — none appears below.

Every public export here is a pure function or a plain-data factory. No
module performs filesystem writes, network calls, hook execution, MCP
startup, or Claude command invocation. The CI guard from T-005
(`test/no-mutation.test.mjs`) enforces the absence of mutation primitives.

---

## config

**File:** `scripts/lib/config.mjs`
**Test:** `test/config.test.mjs`
**Owner phase:** Phase 1 (parallel to T-104) / extended in Phase 4
**Spec sources:** `docs/implementation-blueprint.md` §3, `notes/PLAN.md` §3
Phase 4 (T-401, T-402, T-407), `docs/safe-mode.md` "Entry Point",
`docs/architecture.md` "Audit"

**Public exports:**
- `parseCliArgs(argv) → { mode, home, scope, configPath, json, redact, scanLimits }` — parse CLI flags including `--home`, `--config`, `--scope`, `--json`, `--safe`, `--redact`, and budget overrides; values are normalized but not validated against the filesystem.
- `resolveHome(rawHome) → absolutePath` — resolve declared Claude home (default `~/.claude`) into an absolute path string; does not stat.
- `defaultScanLimits() → ScanLimit` — return the default `ScanLimit` contract object (`maxFiles=5000`, `maxBytes=1 MiB/file`, `maxWallMs=5000`) per T-402; values pinned by `docs/safe-mode.md`.
- `pickMode({safeFlag, command}) → "diagnose" | "plan" | "safe"` — derive the report `mode` field per T-209 and `docs/schema-stability.md`.

**Imports from:**
- `./contracts.mjs` (for `makeScanLimit`)

**Consumed by:**
- `scripts/claude-housekeeper.mjs` (CLI entry)
- `./audit.mjs` (orchestration; receives the parsed config)
- `./policy.mjs` (config path resolution only)

**Forbidden:**
- No filesystem reads (no `readFileSync`, no `existsSync`).
- No process spawning, hook execution, or Claude command invocation.
- No mutation of input `argv` or environment.
- No conversion of CLI flags into stance, severity, or finding decisions — config is data only.

---

## policy

**File:** `scripts/lib/policy.mjs`
**Test:** `test/policy.test.mjs`
**Owner phase:** Phase 1 (T-104), with self-failure degradation in Phase 4 (T-409)
**Spec sources:** `docs/architecture.md` "Audit" (precedence rules),
`docs/schemas.md` §4, `docs/surface-classification-spec.md` §7 (boundary
propagation), `notes/PLAN.md` §6A item 5 (self-failure degradation)

**Public exports:**
- `loadPolicy(homePath, explicitConfigPath) → { policy, degraded }` — read `--config=`, then `<home>/housekeeper/config.json`, then `<home>/housekeeper.json`; return a normalized policy plus a `degraded` array entry when JSON is invalid (do not throw — required by T-409).
- `matchPolicy(policy, observedPath) → PolicyMatch | null` — return a `PolicyMatch` (per `docs/schemas.md` §4) when `observedPath` matches a `doNotTouch` or `protect` glob; null otherwise. Glob matching includes parent-contains-boundary checks per `docs/surface-classification-spec.md` §7.
- `precedence(matches) → PolicyMatch | null` — collapse multiple matches using the precedence in `docs/architecture.md` "Knowledge Integration" §2: do-not-touch overrides allowances; first match wins within a class.

**Imports from:**
- `./contracts.mjs` (for `makePolicyMatch`)
- Node `fs` (read-only) and `path` for config file location only.

**Consumed by:**
- `./audit.mjs` (orchestration; calls `loadPolicy` once per run)
- `./findings.mjs` (each finding queries `matchPolicy` against its target path)
- `./stance.mjs` (stance engine receives the `PolicyMatch` to apply `protect` override)

**Forbidden:**
- No write, unlink, rename, or mkdir.
- No interpretation of policy semantics beyond shape — finding-class decisions live in `findings.mjs`.
- No glob expansion against the live filesystem (matches are string-against-string for the path the caller already observed); does not stat or list directories.
- No reading of policy files outside the three documented locations.

---

## observe

**File:** `scripts/lib/observe.mjs`
**Test:** `test/observe.test.mjs`
**Owner phase:** Phase 2 (supports T-201, T-202)
**Spec sources:** `docs/implementation-blueprint.md` §2 Iteration 2 ("Safe
Observation"), `docs/build-readiness.md` §4 (first checks), `notes/PLAN.md` §3
Phase 2, `docs/architecture.md` "SessionStart Probes" (bounded checks)

**Public exports:**
- `observeSettings(homePath) → { raw, parsed, parseError, path, exists, mtimeMs }` — read `<home>/settings.json` and return structural data plus a parse error envelope when JSON is invalid; never throws on parse failure (per Iteration 2 acceptance: "invalid JSON becomes a finding, not a thrown crash").
- `observePluginRegistry(homePath) → { raw, parsed, parseError, path, exists }` — same shape for `<home>/plugins/installed_plugins.json`.
- `observePluginCacheVersions(homePath, scanLimits) → { entries: [{path, mtimeMs, sizeBytes}], degraded: [reason], skipped: [path] }` — list `<home>/plugins/cache/**` version directories within the `ScanLimit` budget; record budget exhaustion in `degraded`. Does not read file contents.
- `observeMcpRegistry(homePath) → { raw, parsed, parseError, path, exists }` — read `<home>/.mcp.json` only; T-318 requires this for the `mcp-command-missing` fixture without ever starting an MCP server.
- `observeOperationsManifest(homePath) → { manifests: [{path, parsed, parseError}], degraded }` — list `<home>/housekeeper/operations/*.json`. Required by T-208 to surface `housekeeper.interrupted_operation` even with no v0.1 mutation.
- `observePathExists(absolutePath) → { exists, kind, mtimeMs }` — single-path stat used by `findings.mjs` for direct hook path verification (T-302); reports symlink kind without dereferencing.

**Imports from:**
- Node `fs`, `path` (read-only filesystem APIs only).
- `./contracts.mjs` indirectly via consumers — no direct contract construction here.

**Consumed by:**
- `./audit.mjs` (orchestration calls each `observe*` exactly once per run)
- `./findings.mjs` (some detectors call `observePathExists` for per-finding direct probes; never recursive)

**Forbidden:**
- No `unlinkSync`, `rmSync`, `writeFileSync`, `renameSync`, `mkdirSync`, `appendFileSync` — guarded by T-005.
- No execution of hooks, MCP servers, plugins, or any Claude command.
- No content reads from secret-adjacent paths — only metadata (path, mtime, size). Sensitivity classification is `surface.mjs`'s job, but `observe.mjs` MUST refuse to open file contents under `<home>/credentials/**`, `<home>/.env*`, or any path the caller passes a `denyContentRead` flag for.
- No symlink dereferencing by default (per Iteration 2 acceptance "symlinks are reported but not traversed by default" and T-314).
- No recursive walk that ignores `ScanLimit`. Every traversal accepts a budget and stops cleanly when it is exceeded.

---

## surface

**File:** `scripts/lib/surface.mjs`
**Test:** `test/surface.test.mjs`
**Owner phase:** Phase 1 (T-102)
**Spec sources:** `docs/surface-classification-spec.md` §2, §4, §7, §9;
`docs/implementation-blueprint.md` §2 Iteration 3; `notes/PLAN.md` §3 Phase 1

**Public exports:**
- `classifySurface({path, kind, hints, policyMatch, mode}) → SurfaceClassification` — populate every axis from `docs/surface-classification-spec.md` §2: `surfaceClass`, `ownerClass`, `loadBearingClass`, `sensitivityClass`, `executionClass`, `rollbackClass`, `scopeClass`, `confidence`, plus a `limits` array reflecting safe-mode constraints (e.g. `safe-mode-no-loader-key`).
- `propagateBoundary(parentClassification, childClassification) → childClassification'` — apply §7 inheritance: parent sector-boundary makes descendants `sector-boundary`; child sector-boundary makes parent `parent-contains-boundary`.
- `actionEligibility(classification) → { allowed: [stance], blocked: [stance] }` — derive the §4 action-eligibility matrix as a pure lookup so `stance.mjs` can consult it without re-implementing the table.

**Imports from:**
- `./contracts.mjs` (`makeSurfaceClassification`)

**Consumed by:**
- `./findings.mjs` (every detector calls `classifySurface` before producing a `Finding`)
- `./stance.mjs` (consumes `classification` and `actionEligibility` in `decideStance`)
- `./audit.mjs` (orchestration applies `propagateBoundary` between observed parent and child paths)

**Forbidden:**
- No filesystem I/O. Inputs are paths plus precomputed `kind`/`hints`; the function is pure.
- No finding-class assignment (`integrity`, `contamination`, `possession`, `hygiene`, `orientation`) — that's `findings.mjs`.
- No stance assignment.
- No string matching of secret patterns against file contents — sensitivity is inferred from path shape and policy hints only.
- No new enum values beyond those defined in `docs/surface-classification-spec.md` §2.

---

## evidence

**File:** `scripts/lib/evidence.mjs`
**Test:** `test/evidence.test.mjs`
**Owner phase:** Phase 2 (supports T-201, T-202)
**Spec sources:** `docs/framework-kernel.md` §5 (Evidence Gate),
`docs/evidence-keyring.md` (key catalog), `docs/schemas.md` §3 (evidence
sub-shape), `docs/implementation-blueprint.md` §2 Iteration 4

**Public exports:**
- `makeEvidence() → EvidenceSet` — empty set with all six categories (`structural`, `loader`, `behavioral`, `ownership`, `freshness`, `reversibility`) plus `missing: []`. (Re-export of `contracts.makeEvidenceSet` for ergonomics.)
- `addKey(evidence, category, key) → evidence'` — immutably add a typed evidence key; rejects unknown categories.
- `markMissing(evidence, missingKey) → evidence'` — record a missing key with the catalog id from `docs/evidence-keyring.md`.
- `hasMutationKeys(evidence) → boolean` — true only when structural + ownership + reversibility are all present (Evidence Gate minimum from `docs/framework-kernel.md` §5). Used by `stance.mjs` to gate `repair` vs lower stances; in v0.1 always informational because mutation is out of scope.
- `hasRepairKeys(evidence) → boolean` — true when `hasMutationKeys` plus a behavioral key is present (high-impact repair requirement, §5).

**Imports from:**
- `./contracts.mjs` (`makeEvidenceSet`)

**Consumed by:**
- `./findings.mjs` (each detector builds its evidence set as it inspects observed data)
- `./stance.mjs` (gates stance via `hasMutationKeys`/`hasRepairKeys` and via the `missing` list)
- `./report.mjs` (renders the evidence summary and missing-key section)

**Forbidden:**
- No filesystem I/O.
- No knowledge of finding ids — evidence is keyed by category, not finding.
- No mutation of input `EvidenceSet` instances; every helper returns a new copy (per `~/.claude/rules/common/coding-style.md` immutability rule).
- No introduction of new evidence categories beyond the six in `docs/framework-kernel.md` §5.

---

## findings

**File:** `scripts/lib/findings.mjs`
**Test:** `test/findings.test.mjs`
**Owner phase:** Phase 2 (T-201 through T-208, T-210, T-205a)
**Spec sources:** `notes/PLAN.md` §3 Phase 2 detector remap table,
`docs/framework-kernel.md` §8 (finding classes), `docs/golden-reports.md`,
`docs/acceptance-cards.md`, `docs/implementation-blueprint.md` §2 Iteration 4

**Public exports:**
- `runDetectors(observation, policy, mode) → [DetectorOutput]` — entry point that fans out to every individual detector. `DetectorOutput = { surfaceHints, evidence, missingKeys, kind, hint, finding }` per T-201.
- Individual detector functions, one per finding id, each returning `DetectorOutput`:
  - `detectSettingsInvalidJson(observation) → DetectorOutput | null`
  - `detectHookPathDangling(observation) → [DetectorOutput]` (one per dangling hook)
  - `detectHookCommandShellAmbiguous(observation) → [DetectorOutput]`
  - `detectMcpCommandMissing(observation) → [DetectorOutput]`
  - `detectPluginExpectedOrphan(observation) → [DetectorOutput]` — within ~7-day grace window per `docs/loader-semantics.md` §2 (T-205a, T-X06 grace constant).
  - `detectPluginCacheUnreferenced(observation) → [DetectorOutput]` — outside grace window (T-205a).
  - `detectPluginDuplicateRegistration(observation) → [DetectorOutput]`
  - `detectPluginCacheSize(observation) → DetectorOutput` (orientation, `inform`).
  - `detectLocalCommandShadow(observation) → [DetectorOutput]`
  - `detectLocalSkillShadow(observation) → [DetectorOutput]`
  - `detectLocalCommandIdentical(observation) → [DetectorOutput]`
  - `detectLocalCommandDiverged(observation) → [DetectorOutput]`
  - `detectRegistryBrokenFrontmatter(observation) → [DetectorOutput]`
  - `detectInterruptedOperation(observation) → DetectorOutput | null` — T-208; emits `housekeeper.interrupted_operation` with stance `block`.
  - `detectHousekeeperConfigInvalid(observation) → DetectorOutput | null` — T-409 self-failure degradation; stance `inform`.
- `attachProbeMetadata(finding, catalogEntry) → finding'` — T-210 helper to add the `proposedProbe` object from `docs/truth-probe-catalog.md` when the next allowed step references a live probe.

**Detectors NOT in this module (deferred per PLAN §3 C5):**
`state.zombie_modes`, `state.expired_cancel_signals`, `state.large_replay_logs`,
`fs.large_logs`, `fs.old_file_history`, `fs.old_short_lived_cache`,
`fs.corrupt_backups`, `fs.drift_dirs`, `registry.tiny_registry_files` — all
deferred to v0.2.

**Imports from:**
- `./contracts.mjs` (`makeFinding`)
- `./surface.mjs` (`classifySurface`)
- `./evidence.mjs` (`makeEvidence`, `addKey`, `markMissing`)
- `./policy.mjs` (`matchPolicy`)
- `./observe.mjs` (`observePathExists` for direct-path detectors only — never recursive)

**Consumed by:**
- `./audit.mjs` (`assembleReport` calls `runDetectors` and feeds outputs through stance + report layers)

**Forbidden:**
- No filesystem traversal — only `observePathExists` from `observe.mjs` for single-path direct probes; bulk listing belongs to the upstream observation pass.
- No stance computation — that's `stance.mjs`. Detectors emit raw findings with surface and evidence; stance layer attaches the verdict.
- No report rendering — that's `report.mjs`.
- No read of file contents from `secret-adjacent` or `secret-content` surfaces; redaction-required content is pre-redacted before the detector sees it (or the detector consumes only metadata).
- No execution of hooks, MCP servers, plugins, or `claude` commands.
- No invention of new finding ids beyond the 13 in PLAN §3 Phase 2 plus `housekeeper.interrupted_operation` and `housekeeper.config_invalid`.

---

## stance

**File:** `scripts/lib/stance.mjs`
**Test:** `test/stance.test.mjs`
**Owner phase:** Phase 1 (T-103)
**Spec sources:** `docs/decision-calculus.md` §4 (decision order), §5 (hard
overrides), §6 (stance matrix); `docs/framework-kernel.md` §5A, §9
(allowed stances); `docs/implementation-blueprint.md` §2 Iteration 4

**Public exports:**
- `decideStance({surface, evidence, missingKeys, policyMatch, findingClass, mode}) → Stance` — single pure function. Decision order from §4: `protect → block → probe → review → prepare → repair → watch → inform`. Each gate is an early return.
- `STANCE_VALUES` — frozen array of the eight allowed stance strings, sourced from `docs/framework-kernel.md` §9; consumers must not invent strings outside this set.

**Imports from:**
- `./contracts.mjs` (`makeStance`)
- `./surface.mjs` (`actionEligibility` lookup)
- `./evidence.mjs` (`hasMutationKeys`, `hasRepairKeys`)

**Consumed by:**
- `./audit.mjs` (`assembleReport` calls `decideStance` once per detector output)
- `./report.mjs` (consumes the resulting stance for primary-finding selection and stance summary)

**Forbidden:**
- No filesystem I/O.
- No detector-specific branching by finding id — stance is a function of surface + evidence + policy + mode, not of detector identity. (Detectors carry a `findingClass` per `docs/framework-kernel.md` §8 and stance reads from that, but never matches on `finding.id`.)
- No new stance values beyond the eight in `docs/framework-kernel.md` §9.
- No bypassing the gates: `protect` and `block` MUST be checked before any other stance is allowed.
- No `repair` stance assignment in v0.1 — by Evidence Gate, repair requires reversibility evidence the v0.1 build cannot supply, so the engine in v0.1 should always degrade `repair` candidates to `prepare` and surface the missing reversibility key. (Spec source: `docs/framework-kernel.md` §5; PLAN §4 "Out of scope".)

---

## report

**File:** `scripts/lib/report.mjs`
**Test:** `test/report.test.mjs`
**Owner phase:** Phase 2 (T-203, T-204, T-206), extended in Phase 4 (T-209,
T-401, T-402, T-408)
**Spec sources:** `docs/report-grammar.md` §1, §2, §8; `docs/schemas.md` §1;
`docs/golden-reports.md`; `docs/redaction-examples.md`;
`docs/schema-stability.md`; `docs/operational-readiness.md` §8;
`notes/PLAN.md` §3 Phase 2 + §6A items 4, 7, 9, 10

**Public exports:**
- `renderHumanReport(report, {redact}) → string` — emit the canonical human report. First two lines are exactly `HOUSEKEEPER REPORT\nNo files changed.`. Sections per `docs/report-grammar.md` §1: PRIMARY, STANCE SUMMARY, BOUNDARIES, SCAN, plus BLOCKED, PROTECTED, MISSING KEY, SCAN DEGRADED when applicable. Primary-finding selection follows §2.
- `renderJsonReport(report, {redact}) → object` — emit the JSON shape from `docs/schemas.md` §1; every stable field from `docs/schema-stability.md` is always present. Includes `schemaVersion`, `mode`, `filesChanged: false`, `findings`, `boundaries`, `degraded`, `stanceSummary`.
- `renderPlanReport(report, {redact}) → string` — plan-mode rendering for T-206; same renderer in `mode: "plan"`, listing `nextAllowedStep` and `blockedActions` per finding.
- `applyRedaction(value, sensitivityClass) → string` — public for tests; collapses home prefix to `~`, project paths to `<project>`, token-like fragments to `<redacted>` per `docs/redaction-examples.md`. Auto-applied when `redact=true` or when finding `sensitivityClass` is `secret-adjacent`/`secret-content`.

**Imports from:**
- `./contracts.mjs` (read-only consumption of `Report` and `Finding`)

**Consumed by:**
- `scripts/claude-housekeeper.mjs` (CLI prints the rendered output)
- `./audit.mjs` indirectly — `audit.mjs` returns the structured `Report`; rendering happens at the CLI boundary.

**Forbidden:**
- No filesystem I/O. The renderer is pure: `Report → string|object`.
- No detector logic, surface classification, evidence collection, or stance computation — those have already happened.
- No output of any phrase from the canonical forbidden-language list (T-311), enforced by `test/forbidden-language.test.mjs`. The forbidden list spans `docs/decision-calculus.md` §11, `docs/report-grammar.md` §8, `docs/vocabulary.md` §3, `docs/repair-rollback-spec.md` §8, `docs/loader-semantics.md` §10.
- No emission of a `repair` claim, "rollback guaranteed" language, or `clean bill of health` style summary — even when input data would technically allow it.
- No leakage of raw token-shaped substrings (`sk-…`, `ghp_…`, `Bearer …`) under any code path; redaction is applied before any rendering function returns.

---

## fixtures

**File:** `fixtures/synthetic-homes/` (directory tree, one fixture per child)
**Test:** loaded by `test/fixtures.test.mjs` (see `tests` module below)
**Owner phase:** Phase 3 (T-301 through T-319)
**Spec sources:** `docs/build-readiness.md` §6 (8 first-wedge fixtures),
`docs/acceptance-cards.md`, `docs/golden-reports.md`,
`docs/fixture-matrix.md`, `notes/PLAN.md` §3 Phase 3 + §6A item 2

**Public exports:** (filesystem layout, not JS exports)
- `fixtures/synthetic-homes/<id>/home/.claude/...` — synthetic Claude home tree the audit runs against.
- `fixtures/synthetic-homes/<id>/card.yaml` — acceptance card per `docs/schemas.md` §5.
- `fixtures/synthetic-homes/<id>/report.txt` — golden human report, per-fixture mode.
- `fixtures/synthetic-homes/<id>/report.json` — golden JSON report, per-fixture mode.

**v0.1 fixture set (15 fixtures):**

First-wedge 8 (T-301 through T-309 minus T-301 which is the clean baseline):
`clean-home`, `broken-hook-simple`, `broken-hook-shell-ambiguous`,
`expected-orphan-cache`, `candidate-stale-cache`, `protected-secret-path`,
`checkpoint-only-rollback`, `invalid-settings`, `huge-home-degraded`.

Coverage-gap 7 (T-313 through T-319, per PLAN §6A item 2):
`interrupted-housekeeper-operation`, `symlinked-home`,
`duplicate-scope-plugin`, `local-shadow-identical`, `local-shadow-diverged`,
`mcp-command-missing`, `secret-command-fragment`.

**Imports from:** none (data files only)

**Consumed by:**
- `test/fixtures.test.mjs` (T-310; primary consumer)
- `test/forbidden-language.test.mjs` (T-311; renders each fixture and asserts phrase absence)
- `test/redaction.test.mjs` (T-408; runs the renderer over `secret-command-fragment`)
- `test/readme.test.mjs` (T-503; compares README example to `clean-home`)

**Forbidden:**
- No live secrets — every token-shaped string in `secret-command-fragment` and similar fixtures is a fake (e.g. `sk-FAKE-...`) chosen to trigger redaction without being a real credential.
- No symlinks pointing outside the worktree root — T-314 uses a relative or sandbox-internal target so CI can replay deterministically.
- No fixture larger than the `huge-home-degraded` budget (which intentionally exercises degradation); other fixtures must complete inside the default `ScanLimit`.
- No fixture exercises mutation, snapshot, quarantine, or rollback — those modules do not exist in v0.1.

---

## tests

**File:** `test/` (one file per module above plus the cross-cutting suites)
**Test:** self
**Owner phase:** All phases — tests land alongside the module they cover
**Spec sources:** `docs/implementation-blueprint.md` §5 (testing strategy),
`notes/PLAN.md` §3 Phase 3 and verify-criteria for each T-ID,
`~/.claude/rules/common/testing.md` (80% coverage minimum)

**Public exports:** (test files, run by `node --test`)

Per-module unit tests (Phase 1–2):
- `test/contracts.test.mjs` (T-101 verify) — round-trip every contract shape.
- `test/config.test.mjs` — parse CLI flags and budget defaults.
- `test/policy.test.mjs` (T-104 verify) — match, precedence, propagation.
- `test/observe.test.mjs` — bounded reads, parse-error envelopes, no symlink dereference, scan-budget enforcement.
- `test/surface.test.mjs` (T-102 verify) — every surface class with positive + negative cases; boundary propagation.
- `test/evidence.test.mjs` — key construction, missing-key tracking, mutation-key gate.
- `test/findings.test.mjs` (T-201 verify) — each detector emits the right `DetectorOutput` shape.
- `test/stance.test.mjs` (T-103 verify) — each row of the §6 stance matrix; hard overrides; v0.1 repair → prepare degradation.
- `test/report.test.mjs` (T-203, T-204 verify) — header line, section presence, stable-field schema.

Fixture and contract suites (Phase 3):
- `test/fixtures.test.mjs` (T-310) — walk `fixtures/synthetic-homes/`, run `auditClaudeHome`, assert each card.
- `test/forbidden-language.test.mjs` (T-311) — phrase-level scan over rendered output.
- `test/no-mutation.test.mjs` (T-005, already exists) — grep `scripts/` for mutation primitives.
- `test/redaction.test.mjs` (T-408) — `secret-command-fragment` renders without raw tokens.
- `test/readme.test.mjs` (T-503) — README example matches `clean-home` golden.
- `test/audit.test.mjs` — retained only for contract-level assertions not covered by fixtures (T-312); existing inline tmpdir cases migrate to fixtures.

**Imports from:**
- All modules under test (read-only).
- `fixtures/synthetic-homes/` (data only).
- Node `node:test`, `node:assert/strict`, `node:fs`, `node:path`.

**Consumed by:**
- CI (`.github/workflows/ci.yml`, T-501) — runs `npm test`.

**Forbidden:**
- No test that writes outside the system temp directory or the worktree's `fixtures/` tree.
- No test that executes hooks, starts MCP servers, or invokes `claude`.
- No test that asserts behavior outside the spec sources cited in the corresponding T-ID's verify criterion (otherwise the test pins behavior the spec does not authorize).
- No flaky reliance on real time — fixtures fake mtimes via `utimesSync` on test setup, not by sleeping.

---

## Dependency graph

The graph is acyclic. Arrows point from importer to importee.

```
                     scripts/claude-housekeeper.mjs (CLI)
                                |
                                v
                            audit.mjs (orchestration)
                                |
       +------+------+----------+----------+----------+----------+
       |      |      |          |          |          |          |
       v      v      v          v          v          v          v
    config  policy  observe  surface  evidence  findings  stance  report
       |      |      |          |          |          |          |     |
       v      v      v          v          v          v          v     v
              [ contracts.mjs ]  <-- shared leaf, imported by all upper modules
```

Edges in detail:
- `config.mjs` → `contracts.mjs`
- `policy.mjs` → `contracts.mjs`
- `observe.mjs` → (Node `fs`/`path` only; no internal imports)
- `surface.mjs` → `contracts.mjs`
- `evidence.mjs` → `contracts.mjs`
- `findings.mjs` → `contracts.mjs`, `surface.mjs`, `evidence.mjs`, `policy.mjs`, `observe.mjs`
- `stance.mjs` → `contracts.mjs`, `surface.mjs`, `evidence.mjs`
- `report.mjs` → `contracts.mjs`
- `audit.mjs` (orchestration; T-202) → `config.mjs`, `policy.mjs`, `observe.mjs`, `surface.mjs`, `evidence.mjs`, `findings.mjs`, `stance.mjs`, `contracts.mjs` — emits a `Report` for the CLI to render.
- `scripts/claude-housekeeper.mjs` → `config.mjs`, `audit.mjs`, `report.mjs`.

`contracts.mjs` is a shared leaf (factories only). It is not one of the 10
canonical modules from `docs/implementation-blueprint.md` §3, but its
existence is mandated by T-101 and `docs/build-readiness.md` §3 ("Implement
these contract objects first"). It is referenced here as an infrastructure
file every module depends on, in the same role as Node's standard library.

`audit.mjs` is the orchestration entry point. It is not one of the 10
canonical modules either — it pre-existed (`scripts/lib/audit.mjs` ~770
LOC) and gets rewritten in place by T-202. Treat it as the seam where the
10 modules compose.

No module imports from a module below it in the graph upward. The pipeline
direction (`observe → surface → evidence → findings → stance → report`) is
preserved by the import topology.

---

## Open questions

These are spec ambiguities the deliverable could not resolve unilaterally.
Each is named and routed back to the spec or to the operator.

1. **`evidence.mjs` and `findings.mjs` as separate modules.**
   `docs/implementation-blueprint.md` §3 lists them as two separate
   modules. The boundary above honors that listing. A reasonable alternative
   would be to fold `evidence.mjs` into `findings.mjs` since v0.1 has no
   other consumer that constructs evidence sets independently. **Defer to
   spec:** the blueprint is explicit, so they stay split. If the lead
   programmer finds the separation produces no testable difference, raise a
   T-ID to merge under an architecture decision record rather than silently
   collapse.

2. **`config.mjs` ownership of `--redact` semantics vs `report.mjs`.**
   `--redact` is parsed in `config.mjs` but the redaction rules live in
   `report.mjs` per T-408. The current split is that `config.mjs` carries
   the flag and `report.mjs` applies the rules. If `findings.mjs` ever
   needs to know "should I even build a finding for this secret-adjacent
   surface?" the answer changes. v0.1 keeps redaction as a render-time
   transform; v0.2 may need a finding-time gate.

3. **`audit.mjs` is not one of the 10 modules.**
   `docs/implementation-blueprint.md` §3 lists 10 modules and does not
   name an orchestrator. `notes/PLAN.md` §3 Phase 2 explicitly rewrites
   `scripts/lib/audit.mjs` as the orchestrator hosting `assembleReport()`
   (T-202). The deliverable above treats `audit.mjs` as the seam where
   the 10 compose, not as an 11th module. **Flagged here as a deviation
   from the blueprint's literal module count.** No code change proposed —
   just naming the gap so the lead programmer is not surprised.

4. **`contracts.mjs` is not one of the 10 modules.**
   Same shape as #3. `docs/build-readiness.md` §3 mandates contract
   objects, T-101 creates `contracts.mjs`, but `implementation-blueprint.md`
   §3's module list does not include `contracts`. The deliverable treats
   it as a shared leaf. Flagged for awareness; no proposed reconciliation.

5. **Per-fixture `mode` default.**
   PLAN §6B C3 leaves the `mode` field's default unresolved between
   `safe` (which all goldens in `docs/golden-reports.md` use) and
   `diagnose` (which T-209 specifies for normal runs). The `report.mjs`
   contract above passes the resolved `mode` through from `config.mjs`
   without choosing a default — the goldens then assert per-fixture mode.
   Operator should confirm this approach before T-203 byte-compares land.

6. **`repair` stance in v0.1.**
   `stance.mjs`'s contract says the engine should always degrade `repair`
   to `prepare` in v0.1 because the Evidence Gate (`docs/framework-kernel.md`
   §5) requires reversibility keys that v0.1 cannot produce. This is
   inferred from the kernel and from PLAN §4 ("Out of scope"). It is not
   stated as an explicit rule in `docs/decision-calculus.md`. Flag for
   review when the stance test (T-103) lands; if the spec authors disagree,
   the early-return order in `decideStance` will need a v0.1-only branch.

7. **MCP duplicate matching key.**
   PLAN §6B records a known loader-semantics drift: MCP duplicate
   detection should match by name for Local/Project/User scopes and by
   endpoint for Plugin/connector scopes. The detector for this lands in
   v0.2, not v0.1, so no module here carries it. Documented for the next
   board.

8. **`config.mjs` vs the existing CLI parser.**
   `scripts/claude-housekeeper.mjs` already parses CLI flags inline. The
   `config.mjs` boundary above assumes T-207 will lift parsing into the
   new module. If the lead programmer keeps inline parsing for v0.1 and
   only formalizes it in v0.2, `config.mjs` reduces to `defaultScanLimits`
   and `pickMode`. Both shapes preserve the dependency graph.

No other ambiguities were uncovered while drafting this file.
