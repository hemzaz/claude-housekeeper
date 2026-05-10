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

| Field | Class | Rule |
| --- | --- | --- |
| `schemaVersion` | stable | required |
| `mode` | stable | `safe`, `diagnose`, `live`, or future enum |
| `filesChanged` | stable | required boolean |
| `primary` | stable, nullable | finding id or null |
| `stanceSummary` | stable | all stance keys present |
| `findings[].id` | stable | namespaced id |
| `findings[].class` | stable | broad finding family |
| `findings[].claimLevel` | stable | evidence ladder level |
| `findings[].stance` | stable | user-facing stance |
| `findings[].surface` | stable | surface classification object |
| `findings[].evidence` | stable | evidence arrays by key class |
| `findings[].blockedActions` | stable | strings are descriptive, not enum-locked |
| `boundaries` | stable | list may be empty |
| `degraded` | stable | list may be empty |

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

