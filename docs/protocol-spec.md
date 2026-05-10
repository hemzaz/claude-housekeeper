# Protocol Spec

This is the normative Housekeeper protocol.

It translates philosophy into enforceable behavior. Product UI and CLI details
can change, but these rules should remain stable.

Keywords `MUST`, `MUST NOT`, `SHOULD`, and `MAY` are normative.

The smaller framework grammar is defined in `docs/framework-kernel.md`.

The stance decision rules are defined in `docs/decision-calculus.md`.

## 1. Phases

Housekeeper has seven phases:

1. `orient`: define scope, mode, and sector boundaries.
2. `observe`: collect structural evidence under budget.
3. `surface-classify`: classify observed resources before findings.
4. `resolve`: optionally collect loader and behavioral evidence.
5. `classify`: produce findings with risk, confidence, and missing keys.
6. `plan`: propose actions without permission.
7. `act`: execute only approved scoped operations.
8. `verify`: prove behavior or report residual risk.

Mutation is only possible in `act`.

`surface-classify` is mandatory. If it fails, Housekeeper may emit an
`unknown-surface` or `scan-degraded` finding, but it must not emit an actionable
cleanup or repair finding.

## 2. Execution Modes

### Safe Mode

MUST be out-of-band from Claude plugin loading.

MUST NOT run hooks, MCP servers, plugin binaries, skill shell injection, project
scripts, or network calls.

MAY parse bounded files and check direct path existence.

MUST mark live conclusions as `live-probe-required`.

### Normal Diagnose

MAY use structural evidence across the declared scope.

MAY recommend live probes.

MUST NOT mutate.

### Live Diagnose

MAY run Claude truth-probes with consent.

MUST label probes that may start MCP servers, load plugins, run hooks, use
credentials, or write logs.

### Plan

MUST be reviewable.

MUST separate inform, watch, review, probe, protect, prepare, repair, and block
items.

MUST NOT imply approval.

### Clean/Repair

MUST require explicit consent.

MUST snapshot first.

MUST verify or explain why verification is impossible.

## 3. Evidence Grades

Housekeeper MUST attach an evidence grade to each finding:

- `structural`: from files, metadata, parse results, path existence
- `loader`: from Claude's resolved view
- `behavioral`: from a bounded action or smoke test
- `ownership`: from scope, policy, source, or version control status
- `freshness`: from active references, grace periods, sessions, or processes
- `reversibility`: from snapshot and rollback proof

A finding MAY have multiple grades.

Mutation requires structural, ownership, and reversibility grades.

High-impact repair additionally requires behavioral verification.

## 3.1 Surface Classification Gate

Before a finding is actionable, Housekeeper MUST classify its target surface.

Required classification axes:

- `surfaceClass`
- `ownerClass`
- `loadBearingClass`
- `sensitivityClass`
- `executionClass`
- `rollbackClass`
- `scopeClass`
- `confidence`

Rules:

- unknown surface class blocks mutation
- unknown owner blocks mutation
- possible load-bearing status defaults to `review`
- secret-adjacent or secret-content status activates privacy and sector rules
- executable status separates structural scan from live probe
- `checkpoint-only` rollback blocks mutation
- out-of-scope status blocks action

Housekeeper MUST NOT produce an action candidate directly from path age, size,
or name. It must first classify the surface.

## 4. Finding Lifecycle

Findings move through these states:

```text
observed -> suspected -> classified -> planned -> approved -> acted -> verified
```

Alternative terminal states:

- `protected`
- `blocked`
- `deferred`
- `false-positive`
- `needs-live-probe`
- `out-of-scope`

Housekeeper MUST NOT skip from `observed` to `acted`.

Housekeeper MUST speak at the strongest claim level supported by evidence:

1. observation
2. surface classification
3. suspicion
4. finding
5. diagnosis
6. plan
7. operation
8. verification

Missing keys stop the ladder at the current level.

## 5. Risk And Authority

Risk labels:

- `none`
- `protected`
- `review`
- `prepare`
- `repair`
- `destructive`
- `blocked`

Authority rules:

- ambiguity lowers authority
- do-not-touch overrides confidence
- sector boundary overrides consent unless narrowly reopened
- learned knowledge never grants mutation authority
- unsupported conclusions stay `review` or `probe`
- checkpoint-only rollback blocks mutation

## 5.1 Stance Contract

Every classified finding SHOULD resolve to one user-facing stance:

- `inform`
- `watch`
- `review`
- `probe`
- `protect`
- `prepare`
- `repair`
- `block`

Stance is separate from severity, confidence, and risk.

Stance decides how Housekeeper talks to the user now.

Risk describes what action would cost.

Severity describes how bad the condition may be.

Confidence describes how strong the belief is.

Authority describes what Housekeeper may do.

## 6. Output Contract

Default output SHOULD be small:

- primary issue
- evidence
- next step
- risk
- confidence
- no-files-changed statement
- skipped/degraded scan notes

Detailed output MAY include:

- stance summary
- evidence table
- protected items
- missing keys
- proposed live probes
- machine-readable JSON

The product SHOULD optimize for orientation under stress.

## 7. Privacy Contract

Reports MUST redact before model-visible output when privacy mode is enabled.

Reports MUST NOT include raw secret values.

Reports SHOULD avoid full command lines when token-like values appear.

Shared reports SHOULD support:

- basename-only paths
- path hashes
- redacted home prefix
- JSON keys without sensitive values
- aggregate counts

## 8. Compatibility Contract

Housekeeper MUST feature-detect Claude behavior.

It MUST NOT assume undocumented loader semantics across versions.

Each loader rule SHOULD record:

- Claude Code version
- OS
- install method
- fixture
- command used
- observed result
- source link or test result

Unsupported versions should degrade to safe structural reporting.

## 9. Self-Governance Contract

Housekeeper MUST be able to inspect its own state.

It MUST keep its state outside Claude-loaded command, skill, hook, and plugin
namespaces unless intentionally installed as a plugin component.

It MUST support uninstall semantics:

- remove Housekeeper-owned scan cache
- preserve user-requested reports unless told otherwise
- preserve rollback manifests until expired by explicit retention policy
- leave a final manifest of what was removed

Housekeeper MUST NOT become the next mess.

## 10. Rollback Boundary

Claude checkpointing MUST NOT be used as Housekeeper's rollback guarantee.

Housekeeper MAY report that a Claude checkpoint exists, but only as context.

Every Housekeeper mutation MUST have its own rollback proof:

- snapshot or manifest
- expected before-state
- operation id
- restore command
- precondition checks
- sector-boundary exclusions

If rollback proof is `checkpoint-only`, the action is blocked.

If rollback proof is `unknown`, the action is blocked.

If rollback proof is `external-side-effects`, the action is elevated or blocked
depending on scope and consent.
