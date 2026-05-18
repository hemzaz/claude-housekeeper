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
| `findings[].targetPath` | stable | path the finding targets; empty string when the finding is home-rooted or has no single path |
| `findings[].surface` | stable | surface classification object |
| `findings[].evidence` | stable | evidence arrays by key class |
| `findings[].nextAllowedStep` | stable | string; the next step the stance permits |
| `findings[].blockedActions` | stable | strings are descriptive, not enum-locked |
| `findings[].proposedProbe` | stable, nullable | probe metadata object when next step references a live probe (T-210); absent otherwise |
| `findings[].falsePositiveSeenBefore` | stable, nullable | count of prior false-positive markers for this detector + targetPath pair (T-105); absent (not zero) when no markers exist; additive, no schemaVersion bump |
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

## Stable Fields For `0.2` (operation manifest)

The v0.2 release line adds a second public schema: the operation manifest
written by `clean --confirm` and consumed by `rollback`. Manifests live at
`<home>/.claude/housekeeper/operations/<id>.json` (see
[rollback-contracts.md §2](./rollback-contracts.md#2-manifest-location)).

This section pins which manifest fields scripts may depend on within the
v0.2.x release line. The canonical, exhaustive field list lives in
[rollback-contracts.md §3](./rollback-contracts.md#3-manifest-schema); this
table records stability classes only.

Source: `scripts/lib/snapshot.mjs` plus the schema in
[rollback-contracts.md §3](./rollback-contracts.md#3-manifest-schema).

| Field | Class | Rule |
| --- | --- | --- |
| `schemaVersion` | stable | required string; `"0.2"` for v0.2 manifests |
| `id` | stable | required string; matches `op_[0-9]{14}_[0-9a-f]{8}` |
| `home` | stable | required string; absolute path of the managed home |
| `status` | stable | one of the enum values in [rollback-contracts.md §4](./rollback-contracts.md#4-status-enum); consumers MUST tolerate future additions |
| `createdAt` | stable | required ISO 8601 UTC ms-precision string |
| `capturedAt` | stable | required ISO 8601 UTC ms-precision string |
| `appliedAt` | stable, nullable | ISO 8601 string once `applied`; null until then |
| `verifiedAt` | stable, nullable | ISO 8601 string once `verified`; null until then |
| `rolledBackAt` | stable, nullable | ISO 8601 string once `rolled_back`; null until then |
| `abortedAt` | stable, nullable | ISO 8601 string once `aborted`; null until then |
| `housekeeperVersion` | stable | required semver string |
| `command` | stable | one of `"clean"`, `"rollback"`, `"harden"`; consumers MUST tolerate future commands |
| `mode` | stable | one of `"confirm"`, `"dry-run"` |
| `consentSummary` | stable | required non-empty human-readable consent record |
| `files` | stable | required array; may be empty |
| `partialApply` | stable | boolean; default `false` |
| `blockedByProtection` | stable | string array; default `[]` |

### `files[]` element shape

Per-file entry keys present on every manifest file row:

| Key | Class | Rule |
| --- | --- | --- |
| `seq` | stable | 0-based integer; stable across status changes |
| `originalPath` | stable | absolute path of the original file |
| `snapshotPath` | stable | absolute path of the snapshot copy |
| `sha256Before` | stable | 64-char lowercase hex sha256 |
| `sha256After` | stable, nullable | 64-char hex once applied; null until then |
| `mode` | stable | octal string e.g. `"0644"` |
| `size` | stable | byte size of the original file |
| `isSymlink` | stable | boolean |
| `symlinkTarget` | stable, nullable | symlink target string; null when not a symlink |
| `verifyFailure` | stable | boolean; default `false` |
| `rollbackSkipped` | stable | boolean; default `false` |

### May-change fields

Fields whose presence or contract may evolve within v0.2.x:

- `mutationKind` (per-file, when added): metadata describing the kind of
  mutation a file received (e.g. `"unlink"`, `"rewrite"`). The rollback
  dispatcher currently uses `rollbackOp.kind` from the in-memory rollback
  plan, not this manifest field, so a missing or surprising
  `mutationKind` value is non-fatal today. Future versions may use
  `mutationKind` for dispatch — treat it as advisory until then.
- file-row keys added by future Phase work (e.g. richer per-file telemetry).
  Readers MUST ignore unknown keys.

### Change rules for the manifest schema

The general rules from [Change Rules](#change-rules) above apply. In
addition:

- `schemaVersion: "0.2"` manifests are stable within the v0.2 release line.
  Stable field names and broad meanings will not change within v0.2.x.
- New optional fields may be added at any time; readers MUST ignore unknown
  fields (forward compatibility).
- Status enum additions are allowed; readers MUST tolerate unknown status
  values rather than crashing.
- A bump to `schemaVersion: "0.3"` will be accompanied by a migration guide
  and a backward-compatibility reader, following the same pattern as
  [rollback-contracts.md §6](./rollback-contracts.md#6-migration-path-for-v01x-manifests).

## Documented mutation kinds

The `MUTATION_REGISTRY` in `scripts/lib/snapshot.mjs` enumerates the
mutation kinds the apply/rollback pipeline knows how to dispatch. Each
kind has a paired `apply` and `rollback` handler; some carry a
`preApply` hook for validation before the snapshot is committed.

Mutation kinds are stable strings within a major; renaming one is a
breaking change. Adding a new kind is additive and ships in a minor.
Per [versioning-policy.md §2](./versioning-policy.md#2-what-triggers-a-v03-minor-vs-v10-major),
adding a new mutation kind does NOT bump either `schemaVersion`
(report `"0.1"` or manifest `"0.2"`); the manifest grows a new
`mutationKind` value, which readers MUST tolerate per the change
rules above.

| Kind | Added in | Apply contract | Rollback contract |
| --- | --- | --- | --- |
| `dir-rmtree` | v0.2 | Recursively remove a directory tree after snapshot | Restore the snapshot tree byte-for-byte |
| `file-unlink` | v0.2 | Unlink a single file after snapshot | Restore the snapshot file byte-for-byte |
| `settings-rewrite` | v0.3 | Read → parse → apply structural patch → strict JSON serialize → atomic rename (write-temp + rename + fsync-parent) | Restore the snapshot file byte-for-byte |

### `settings-rewrite` (added v0.3)

The `settings-rewrite` kind targets `<home>/.claude/settings.json`. Its
apply/rollback contract is defined in
[`docs/design/v0.3-design.md §3.1`](./design/v0.3-design.md#31-settings-rewrite-mutation-kind):

- The `preApply` hook strict-parses the file, runs the JSONC tokenizer
  on `SyntaxError`, applies the patch in memory, validates the output
  re-parses, and asserts idempotency (apply twice yields the same
  result). Any failure surfaces as a structured refusal
  (`settings-jsonc-detected`, `patch-produces-invalid-json`,
  `patch-not-idempotent`) before the snapshot is taken.
- `apply` writes the new content via the existing atomic-write helper
  (write-temp + `rename(2)` + fsync-parent). Per
  [threat-model.md §8](./threat-model.md#8-settings-write-surface-v03)
  this gives a concurrent Claude reader either the old or new content
  in full, never a partial.
- `rollback` is identical in shape to the existing
  file-restore-from-snapshot path.

Manifest impact: a `settings-rewrite` operation produces a normal
manifest `files[]` entry with the standard `sha256Before` /
`sha256After` / `mode` / `size` keys. No new top-level manifest field
is required; `schemaVersion` stays at `"0.2"`. The `command` field
takes the value `"harden"` (already enumerated as a stable command
value above).

---

## v0.4 Addenda (T-700)

All surfaces in this section are additive minor additions. No
`schemaVersion` bump is required for any of them. Readers MUST
tolerate unknown fields per the change rules above.

### New optional Finding field: `falsePositiveSeenBefore`

Already present in the stable fields table above (added in the T-105
commit). Recorded here for cross-reference:

| Field | Class | Rule |
| --- | --- | --- |
| `findings[].falsePositiveSeenBefore` | stable, nullable | count of prior false-positive markers for this detector + targetPath pair; absent (not zero) when no markers exist; additive, no schemaVersion bump |

### New finding ids (additive)

Two new detector ids join the stable set in v0.4. Adding a detector id
is additive per [versioning-policy.md §1.1](./versioning-policy.md#11-detector-ids).

| Id | Added in | Description |
| --- | --- | --- |
| `plugin.unused_past_grace` | v0.4 | Plugin cache has not been applied within the grace window; emits at `inform` stance (audit-only in v0.4.0) |
| `settings.jsonc_detected` | v0.3 | `settings.json` contains JSONC comments; rewrite refused until comments are removed (see §8.3 of threat model) |

`settings.jsonc_detected` was introduced in v0.3 as the refusal class
`settings-jsonc-detected`. The detector-id form `settings.jsonc_detected`
is the v0.4 canonical name; both strings appear in the codebase and are
stable.

### New on-disk surfaces (v0.4)

v0.4 introduces two new on-disk paths under
`<home>/.claude/housekeeper/`. Both are append-only and local-only.
Neither requires a `schemaVersion` bump.

#### `learning/` directory

| Path | Format | Description |
| --- | --- | --- |
| `<home>/.claude/housekeeper/learning/refusals.jsonl` | JSONL | One JSON line per refusal emitted by `composeCleanPlan` or `composeHardenPlan`; appended via O_APPEND |
| `<home>/.claude/housekeeper/learning/applied.jsonl` | JSONL | One JSON line per successful mutation applied by `executeCleanPlan` or `executeHardenPlan` |
| `<home>/.claude/housekeeper/learning/rollbacks.jsonl` | JSONL | One JSON line per rollback executed by `executeRollbackPlan` |
| `<home>/.claude/housekeeper/learning/state.json` | JSON | Mutable summary state; contains `learnSchemaVersion: "0.4"` on every write |

The `learnSchemaVersion: "0.4"` field is written on every state.json
update (T-101). It is stable within v0.4.x: renaming or removing it
requires a minor bump. Adding fields to state.json is additive.

Each JSONL line carries the `learnSchemaVersion` field so readers can
distinguish entries written by different tool versions without parsing
the summary state.

#### `lock.history` JSONL

| Path | Format | Description |
| --- | --- | --- |
| `<home>/.claude/housekeeper/lock.history` | JSONL | Append-only log; one JSON line per lock acquire or release: `{ts, pid, action, holder, releaseReason?}` |

Fields on each `lock.history` line:

| Field | Class | Rule |
| --- | --- | --- |
| `ts` | stable | ISO 8601 UTC ms-precision timestamp |
| `pid` | stable | process id of the Housekeeper invocation |
| `action` | stable | `"acquire"` or `"release"` |
| `holder` | stable | lock holder string (matches the lockfile content) |
| `releaseReason` | stable, nullable | human-readable release reason; absent on `acquire` lines |

### New mutation kind: `settings-rewrite` (already documented above)

`settings-rewrite` was added in v0.3 and is documented in the
"Documented mutation kinds" table above. No additional entry needed.

### Reserved mutation kind: `json-rewrite`

The kind identifier `json-rewrite` is reserved for Phase 4 (T-400).
It is not yet materialised. When Phase 4 ships, this section will
be updated with the full apply/rollback contract. Adding it is
additive; no `schemaVersion` bump is required.
