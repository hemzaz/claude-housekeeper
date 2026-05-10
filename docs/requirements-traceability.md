# Requirements Traceability

This document ties the original pain to product requirements, specs, and tests.

It protects the build from drifting into generic cleanup.

## First-Wedge Trace

| Pain | Requirement | Spec source | Acceptance source |
| --- | --- | --- | --- |
| Claude becomes unstable after hooks point at removed plugin paths | Detect direct missing hook paths without running hooks | `evidence-keyring.md`, `safe-mode.md`, `protocol-spec.md` | `broken-hook-simple`, `golden-reports.md` |
| Shell-heavy hook commands are hard to reason about | Treat shell ambiguity as a missing key, not certainty | `truth-probe-catalog.md`, `surface-classification-spec.md` | `broken-hook-shell-ambiguous` |
| Plugin cache accumulates old versions | Map installed registry evidence against cache versions | `loader-semantics.md`, `evidence-keyring.md` | `expected-orphan-cache`, `candidate-stale-cache` |
| Old cache can still serve active sessions | Require freshness key before stronger cache claims | `evidence-keyring.md`, `unknowns.md` | `candidate-stale-cache` |
| Local commands and skills can shadow plugin resources | Report collisions without assuming user intent | `surface-map.md`, `decision-calculus.md` | `local-shadow-identical`, `local-shadow-diverged` |
| User has areas Housekeeper must never touch | Enforce do-not-touch and sector-boundary policy | `sector-boundaries.md`, `policy-grammar.md` | `protected-secret-path` |
| Claude checkpointing sounds like rollback but is not enough | Block mutation without Housekeeper-owned rollback proof | `repair-rollback-spec.md`, `surface-map.md` | `checkpoint-only-rollback` |
| Huge homes can make diagnosis slow or partial | Enforce scan budgets and report degraded claims | `safe-mode.md`, `field-validation.md` | `huge-home-degraded` |
| Invalid settings can poison deeper inference | Stop dependent inference when core config is invalid | `protocol-spec.md`, `safe-mode.md` | `invalid-settings` |
| Housekeeper could become its own source of rot | Detect self-failure and block mutation | `operational-readiness.md`, `state-governance.md` | `interrupted-housekeeper-operation` |

## Non-Requirements For First Wedge

The first wedge does not require:

- mutation
- quarantine
- repair application
- hardening hooks
- learning rules
- live probes by default
- background daemons
- broad disk cleanup
- team policy enforcement

If a future implementation needs one of these, it is outside the first wedge and
requires explicit authorization.

## Traceability Rule

Every new detector should add one row:

```text
pain -> requirement -> spec source -> acceptance source
```

If a detector cannot point to a real pain and an acceptance card, do not build it
yet.

