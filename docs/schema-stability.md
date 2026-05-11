# Schema Stability

The JSON report is a public interface.

This document defines which fields are stable, experimental, nullable,
redacted, or internal.

## Field Classes

- `stable`: scripts may depend on the field name and broad meaning
- `experimental`: present for early users; may change with minor versions
- `nullable`: may be null or omitted when evidence is unavailable
- `redacted`: value is intentionally obscured
- `internal`: not guaranteed for external use

## Stable Fields For `0.1`

Source: `scripts/lib/report.mjs` `renderJsonReport()` plus
`stripFindingForJson()`, and `scripts/lib/audit.mjs` `collectBoundaries()`.

| Field | Class | Rule |
| --- | --- | --- |
| `schemaVersion` | stable | required string; `0.1` |
| `mode` | stable | `safe`, `diagnose`, `plan`, `live`, or future enum |
| `home` | stable | scanned home root path |
| `generatedAt` | stable | ISO 8601 timestamp |
| `filesChanged` | stable | required boolean; always `false` in v0.1 |
| `primary` | stable, nullable | finding id of the primary finding, or null |
| `stanceSummary` | stable | all eight stance keys present (`inform`, `watch`, `review`, `probe`, `protect`, `prepare`, `repair`, `block`) |
| `findings[].id` | stable | namespaced id |
| `findings[].class` | stable | broad finding family |
| `findings[].claimLevel` | stable | evidence ladder level |
| `findings[].stance` | stable | user-facing stance |
| `findings[].summary` | stable | one-line human summary string |
| `findings[].surface` | stable | surface classification object |
| `findings[].evidence` | stable | evidence arrays by key class |
| `findings[].nextAllowedStep` | stable | string; the next step the stance permits |
| `findings[].blockedActions` | stable | strings are descriptive, not enum-locked |
| `findings[].proposedProbe` | stable, nullable | probe metadata object when next step references a live probe (T-210); absent otherwise |
| `boundaries` | stable | list may be empty; element shape below |
| `degraded` | stable | list may be empty; element shape below |

### `findings[].surface` element shape

Surface classification keys present on every finding (per
`makeSurfaceClassification` in `scripts/lib/contracts.mjs`):
`surfaceClass`, `ownerClass`, `loadBearingClass`, `sensitivityClass`,
`executionClass`, `rollbackClass`, `scopeClass`, `confidence`, `limits`.

### `findings[].evidence` element shape

Evidence keys present on every finding (per `makeEvidenceSet` in
`scripts/lib/contracts.mjs`): `structural`, `loader`, `behavioral`,
`ownership`, `freshness`, `reversibility`, `missing`. Each value is an
array of strings; empty arrays are valid.

### `findings[].proposedProbe` element shape

Present only when the finding's next step references a live probe
(`scripts/lib/audit.mjs` `pickProbeMetadata`). Keys:
`reference` (probe label, e.g. `claude --debug hooks`), `class`
(`loader` or `behavioral`), `mayExecute` (string describing what the
probe may execute), `consent` (`medium` or `high`).

### `boundaries[]` element shape

Each boundary entry (per `collectBoundaries` in `scripts/lib/audit.mjs`):

| Key | Class | Rule |
| --- | --- | --- |
| `type` | stable | `protected`, `sector-boundary`, or `secret-adjacent` |
| `path` | stable | target path that triggered the boundary |
| `reason` | stable | human-readable explanation |
| `findingId` | stable | id of the finding that produced this boundary |

### `degraded[]` element shape

Each degraded entry is either a string or an object describing a
budget hit (per `scripts/lib/report.mjs` `formatScanDegradedSection`).
Object keys when present:

| Key | Class | Rule |
| --- | --- | --- |
| `budget` | stable | which scan budget tripped (e.g. `maxFiles`, `maxBytes`, `maxWallMs`) |
| `skipped` | stable | string description of the skipped subtree |
| `effect` | stable | what evidence was not collected |
| `nextStep` | stable | recommended follow-up action |

## Experimental Fields

- exact path redaction metadata
- report rendering hints
- compatibility notes
- policy match internals
- detector timing
- file count and byte count details

## Change Rules

- removing a stable field requires a schema version change
- changing stable enum meaning requires a schema version change
- adding fields is allowed
- adding enum values is allowed; consumers must tolerate unknown values
- redacted values must not become raw values without explicit opt-in
- internal fields must not be documented as safe for automation

## Nullability Rules

Null or missing is valid when:

- a live probe was not run
- a file was unreadable
- a scan budget was hit
- privacy mode redacted the value
- compatibility is unknown

Do not encode missing evidence as false evidence.

## Required `mode` field

`mode` is REQUIRED on every JSON report. It records the active runtime mode
at scan time: `safe` (under `--safe`), `diagnose` (default `diagnose`
invocation), or `live` (live-probe mode, post-v0.1).

Goldens MUST declare which runtime mode they were captured under inside
their fixture's `card.yaml` `mode_expectations` block.

Byte-compare tests (T-203) MUST use the per-fixture mode rather than assume
a single default.
