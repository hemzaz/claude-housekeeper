# Implementation Blueprint

This document is the bridge from framework to code.

It does not authorize implementation by itself. It tells a future coding agent
how to build the first wedge once the user says to code.

Read first:

1. `north-star.md`
2. `mvp-cutline.md`
3. `framework-kernel.md`
4. `decision-calculus.md`
5. `surface-classification-spec.md`
6. `evidence-keyring.md`
7. `schemas.md`
8. `acceptance-cards.md`

Then use this blueprint.

## 1. Build Target

Build only:

> Safe out-of-band diagnosis of broken hooks and plugin cache drift.

The product state after this build is a read-only home inspector.

It can say:

- what it observed
- what surface each target belongs to
- what evidence exists
- what key is missing
- what stance the user should take
- what no-op plan or live probe would come next

It cannot:

- mutate user files
- repair settings
- delete or quarantine cache
- install prevention hooks
- learn policy automatically
- use Claude checkpointing as rollback proof

## 2. Build Order

### Iteration 0: Contract Skeleton

Create the contract objects before detectors:

- `SurfaceClassification`
- `EvidenceSet`
- `Finding`
- `Stance`
- `Report`
- `PolicyMatch`
- `ScanLimit`

Acceptance:

- contract objects can represent every acceptance-card fixture
- JSON report can contain empty findings and `filesChanged: false`
- no mutation object exists in the runtime path

### Iteration 1: Fixtures First

Create fixtures for:

- `broken-hook-simple`
- `broken-hook-shell-ambiguous`
- `expected-orphan-cache`
- `candidate-stale-cache`
- `protected-secret-path`
- `checkpoint-only-rollback`
- `invalid-settings`
- `huge-home-degraded`

Each fixture must include an acceptance card.

Acceptance:

- every fixture declares expected surfaces, evidence, stance, blocked actions,
  and report text expectations
- tests fail before detector logic exists

### Iteration 2: Safe Observation

Implement bounded observation:

- locate declared Claude home
- parse settings structurally
- parse plugin registry structurally
- list plugin cache version directories within budget
- read protection policy structurally
- record skipped paths and scan limits

Acceptance:

- invalid JSON becomes a finding, not a thrown crash
- unreadable files become degraded evidence
- symlinks are reported but not traversed by default
- no hook, MCP, plugin, shell, or Claude command is executed

### Iteration 3: Surface Classification

Classify every observed target before finding classification.

Minimum classifications:

- settings files -> authored config
- hook command path -> executable-adjacent authored config
- plugin registry -> Claude application data plus plugin registration surface
- plugin cache version dir -> Claude application data
- policy file -> Housekeeper/user-authored config
- protected path match -> protected scope class
- checkpoint-only rollback fixture -> rollback blocker

Acceptance:

- no finding can be emitted without a surface classification
- unknown owner, unknown rollback, and possible load-bearing state weaken stance
- secret-adjacent paths do not trigger content reads

### Iteration 4: Evidence And Findings

Implement first wedge findings:

- invalid settings JSON
- direct missing absolute hook path
- shell-ambiguous hook command
- plugin cache version not referenced by known registry evidence
- expected orphan within documented grace evidence
- protected path match
- scan degraded by budget or boundary
- checkpoint-only rollback blocked

Acceptance:

- each finding has structural evidence or a missing key
- cache drift without freshness proof produces `probe` or `watch`, not
  deletion authority
- direct missing hook path produces `prepare`, but only for patch preview
- shell ambiguity produces `probe`
- protected match produces `protect`

### Iteration 5: Stance-First Report

Render human and JSON reports.

Human report must start with:

```text
HOUSEKEEPER REPORT
No files changed.
```

Required sections:

- primary finding
- stance summary
- boundaries
- scan mode
- degraded scan notes
- next safe step

JSON report must include:

- schema version
- `filesChanged: false`
- findings
- surface classifications
- evidence
- missing keys
- stance
- blocked actions

Acceptance:

- a stressed user can identify the primary issue in the first screen
- protected findings remain visible
- skipped and degraded scans are explicit
- no report claims a repair, cleanup, or health status that was not verified

## 3. Suggested Module Boundaries

The first implementation should keep modules small and boring:

- `config`: CLI arguments, mode, home path, budget, config path
- `policy`: do-not-touch and allowance parsing, matching, explanations
- `observe`: bounded filesystem observation with no interpretation
- `surface`: surface classification rules
- `evidence`: evidence key construction and missing-key tracking
- `findings`: finding classifiers for the first wedge
- `stance`: decision calculus
- `report`: human and JSON rendering
- `fixtures`: synthetic homes and acceptance cards
- `tests`: contract and fixture tests

Plus two infrastructure modules required by Phase 1: `contracts` (data-shape
factories from `docs/schemas.md`) and `audit` (orchestrator that wires
detectors → surface → evidence → stance → report). These are not standalone
first-wedge concerns; they exist to compose the listed modules.

Do not create modules for mutation, snapshots, quarantine, hardening, learning,
or rollback in the first wedge.

## 4. Command Semantics

Supported now:

- `diagnose`: read-only report
- `diagnose --json`: read-only machine report
- `plan`: read-only explanation of possible next steps

Visible but refusing until mutation is authorized:

- `clean`
- `harden`
- `rollback`

Refusal output must include:

- `No files changed.`
- why the command is unavailable
- which proof is missing
- which doc defines the missing contract

## 5. Testing Strategy

Use fixture-driven TDD.

For every fixture, assert:

- no files changed
- every finding has a surface
- every finding has evidence or a missing key
- every finding has a stance
- protected findings are visible and non-actionable
- blocked actions are named
- forbidden language does not appear

Also test:

- invalid JSON
- missing files
- unreadable files where the platform allows simulation
- symlink loop prevention
- scan budget exhaustion
- Windows-style paths as strings, even if first runtime is Unix
- redaction of home prefixes and secret-like command fragments

## 6. Forbidden Shortcuts

A coding agent must not:

- infer deletion authority from path age, size, or name
- call registry absence proof of cache inactivity
- run Claude in safe mode
- run hooks to test hooks
- start MCP servers during diagnosis
- dereference symlinks by default
- read secret-adjacent content for convenience
- rely on Claude checkpointing for rollback
- hide uncertainty behind friendly wording
- collapse `review`, `probe`, `prepare`, and `repair` into one warning class

## 7. Done Definition

The first wedge is done when:

- all first-wedge fixture tests pass
- `diagnose`, `diagnose --json`, and `plan` are read-only
- report output is stance-first
- every finding traces to surface classification and evidence
- cache findings never imply deletion authority
- hook findings never imply repair without verification
- protected findings are visible and non-actionable
- `clean`, `harden`, and `rollback` refuse mutation with clear proof language
- README, plugin command docs, and site match the same promises

## 8. Next Best Move After First Wedge

Do not jump to cleanup.

The next best move is field validation:

1. collect redacted reports from real homes
2. label false positives
3. complete loader-semantics fixtures
4. measure scan budgets on huge homes
5. revise acceptance cards
6. only then design repair and rollback operations

