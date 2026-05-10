# Operational Readiness

This document defines what must be true before Housekeeper is exposed to real
users as a product, even as a read-only preview.

The framework can be coherent and still not be operationally ready. Operational
readiness asks a different question:

> Can a user run this under stress, understand the result, recover from
> mistakes, report problems safely, and trust the product boundaries?

For the first wedge, readiness means the answer is yes for read-only diagnosis
of broken hooks and plugin cache drift.

## 1. Golden Report Layer

Housekeeper needs canonical reports before it needs more checks.

Required golden reports:

- clean home
- broken direct hook path
- shell-ambiguous hook path
- expected orphan plugin cache
- candidate stale plugin cache
- protected finding
- invalid settings
- degraded huge home scan
- checkpoint-only rollback blocked
- Housekeeper internal state problem

Canonical examples live in `golden-reports.md`.

Each golden report must include:

- `HOUSEKEEPER REPORT`
- `No files changed.`
- primary finding
- stance summary
- evidence
- missing key, if any
- boundaries
- skipped or degraded scan notes
- next safe step

Golden reports are product contracts. If code changes alter them materially, the
change must be intentional.

Readiness gate:

- no public release without at least five golden human reports and matching
  JSON reports.

## 2. Compatibility Layer

Housekeeper must know what world it has been tested in.

Track:

- Claude Code version
- OS
- shell
- Node version
- install method
- plugin support availability
- settings schema behavior
- plugin cache behavior
- hook debug behavior
- MCP config behavior
- path semantics

The matrix lives in `compatibility-matrix.md`.

Compatibility states:

- `supported`: tested and expected to work
- `degraded`: tested but some keys unavailable
- `unknown`: not tested; report must say so
- `unsupported`: known not to work safely

Readiness gate:

- first release must publish the tested matrix, even if narrow.

## 3. Distribution And Recovery Layer

The product must be runnable when Claude itself is unhealthy.

Distribution surfaces:

- standalone CLI
- plugin slash command wrapper
- package runner such as `npx`
- future native `claude housekeep` surface

Rule:

- the plugin surface is convenience
- the standalone surface is recovery

If plugin loading is broken, the user must still have a documented path to run
safe diagnosis without relying on plugin loading.

Readiness gate:

- README must show at least one out-of-band invocation path.

## 4. Self-Failure Layer

Housekeeper must inspect its own state before trusting it.

Self-failure cases:

- corrupt Housekeeper config
- corrupt knowledge file
- interrupted operation manifest
- missing operation snapshot
- unknown Housekeeper schema version
- stale scan cache
- policy conflict
- uninstall residue
- mismatched binary and plugin wrapper versions

Default stance:

- self-failure is `block` for mutation
- self-failure may still allow read-only diagnosis if the affected state is not
  needed

Readiness gate:

- read-only mode must degrade around Housekeeper self-failure instead of
  crashing.

## 5. Support And Damage Protocol Layer

Users will eventually report that Housekeeper damaged something.

The project must define how to respond before mutation exists.

Support intake may ask for:

- Housekeeper version
- Claude Code version
- OS
- command run
- redacted report JSON
- operation id, if any
- list of changed files from Housekeeper manifest
- rollback attempt output
- exact error message

Support intake must not ask for:

- raw API keys
- `.env` content
- private key files
- full shell history
- raw transcripts by default
- unredacted customer or infrastructure names

Damage triage order:

1. Was there a Housekeeper operation id?
2. Did Housekeeper report `filesChanged: true`?
3. Does the manifest list the path?
4. Does rollback proof exist?
5. Did another process change the same path concurrently?
6. Was the path protected or inside a sector boundary?
7. Was the command run through standalone, plugin, or Claude-generated shell?

Readiness gate:

- public issue templates must support false positives, damaged environment
  reports, loader-semantics reports, and compatibility reports.

## 6. Release Gate Layer

Readiness is a binary gate, not a mood.

Minimum release gates for read-only preview:

- tests pass
- lint passes
- format passes
- package dry-run contains intended files only
- plugin manifest validates when Claude is available
- stale terminology scan is clean
- first-wedge acceptance cards exist
- golden reports exist
- compatibility matrix exists
- README states read-only status
- site states read-only status
- `clean`, `harden`, and `rollback` refuse mutation
- redaction behavior is tested
- degraded scan behavior is tested
- no code path mutates user state in `diagnose` or `plan`

Ship decision:

- any failed gate blocks public release
- a missing gate may be waived only by documenting the residual risk

## 7. Fixture Matrix Layer

Fixtures must become a matrix, not a list.

Each fixture row must define:

- scenario id
- surface classes
- evidence keys
- missing keys
- expected stance
- blocked actions
- golden report
- JSON report expectations
- safe-mode result
- normal-diagnose result
- live-probe result, if applicable
- compatibility notes

The matrix lives in `fixture-matrix.md`.

Minimum matrix:

| Fixture | Required stance | Must never claim |
| --- | --- | --- |
| `broken-hook-simple` | `prepare` | fixed |
| `broken-hook-shell-ambiguous` | `probe` | hook broken with certainty |
| `expected-orphan-cache` | `watch` | deletion authority |
| `candidate-stale-cache` | `probe` | unused |
| `protected-secret-path` | `protect` | content inspected |
| `checkpoint-only-rollback` | `block` | rollback available |
| `invalid-settings` | `prepare` or `block` | deeper inference is complete |
| `huge-home-degraded` | `inform` or `probe` | full scan completed |
| `interrupted-housekeeper-operation` | `block` | safe to continue mutation |
| `symlinked-home` | `review` or `block` | target identity is obvious |

Readiness gate:

- every first-wedge detector must be covered by at least one fixture row and
  one golden report.

## 8. JSON API Stability Layer

The JSON report is a product surface.

Fields must be classified:

- `stable`: safe for scripts to depend on
- `experimental`: may change between minor versions
- `nullable`: may be missing or null by design
- `redacted`: present but intentionally obscured
- `internal`: not promised to users

The stability contract lives in `schema-stability.md`.

Stable for first release:

- `schemaVersion`
- `mode`
- `filesChanged`
- `findings[].id`
- `findings[].stance`
- `findings[].claimLevel`
- `findings[].surface`
- `findings[].evidence`
- `findings[].blockedActions`
- `stanceSummary`
- `boundaries`
- `degraded`

Rules:

- removing stable fields requires a schema version change
- adding fields is allowed
- redacted fields must not become unredacted without explicit opt-in
- unknown enum values must be tolerated by consumers

Readiness gate:

- schema stability notes must ship with the first JSON output.

## 9. Uninstall And Self-Cleanup Layer

Housekeeper must not become another mess in `.claude`.

Future Housekeeper state must live under:

```text
~/.claude/housekeeper/
```

It must not store operational state inside:

- `~/.claude/commands/`
- `~/.claude/skills/`
- plugin cache trees
- hook directories
- project registries

Uninstall should be able to explain:

- what files Housekeeper created
- what state is user-authored policy
- what state is operation history
- what can be removed
- what should be archived

Readiness gate:

- before Housekeeper writes persistent state, uninstall behavior must be
  documented and tested.

## 10. Human Handoff Layer

When Housekeeper cannot decide, it should help the next human or agent.

Handoff output should include:

- concise problem statement
- evidence collected
- missing key
- protected or blocked paths
- command already run
- scan mode
- safe next command
- unsafe commands to avoid

Example:

```text
HANDOFF
Problem: settings hook references a missing direct plugin cache path.
Evidence: settings parsed; direct absolute path does not exist.
Missing key: live hook verification.
Stance: prepare.
Safe next step: generate patch preview only.
Do not: delete plugin cache, run hook, or claim fixed before verification.
```

Readiness gate:

- every `review`, `probe`, `protect`, and `block` finding must be convertible
  into a useful handoff.

## Operational Readiness Summary

Layer order:

1. golden reports
2. compatibility
3. distribution and recovery
4. self-failure
5. support and damage protocol
6. release gates
7. fixture matrix
8. JSON API stability
9. uninstall and self-cleanup
10. human handoff

If any layer is missing, Housekeeper may still be a promising framework, but it
is not yet a dependable product.
