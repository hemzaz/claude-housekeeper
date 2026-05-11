# Rollback Contracts — Claude Housekeeper v0.2

This document pins the operation id format, manifest location, manifest schema,
status enum, and migration rules for v0.1.x compatibility. It is the
authoritative contract for `scripts/lib/snapshot.mjs` and the rollback command.

---

## 1. Operation Id Format

```
op_<YYYYMMDDHHMMSS>_<8hex>
```

Examples:
- `op_20260511143022_a1b2c3d4`
- `op_20260101000000_00000001`

Rules:

- `YYYYMMDDHHMMSS` is UTC time at the moment the operation is created, zero-padded.
- `8hex` is 4 random bytes encoded as lowercase hexadecimal (`crypto.randomBytes(4).toString('hex')`).
- Total length: 28 characters exactly.
- Only characters `[a-z0-9_]` are allowed. No slashes, dots, or spaces.
- The id is stable for the lifetime of the operation; it never changes after creation.
- The id doubles as the snapshot directory name and the manifest filename.

Rationale: timestamp prefix gives chronological sort for free; the 8-hex suffix
provides enough entropy to prevent collisions within a single second, which is
all that is needed for single-user local tooling.

---

## 2. Manifest Location

```
<home>/.claude/housekeeper/operations/<id>.json
```

Where `<home>` is the Claude home directory being managed (e.g. `~/.claude`).

The snapshot files live at:

```
<home>/.claude/housekeeper/snapshots/<id>/
```

Both paths use the same `<id>`. The manifest is the single source of truth for
operation state. If the manifest file is absent, the operation does not exist
(even if a snapshot directory is present — that is treated as a leftover from
an incomplete `takeSnapshot` and will be GC'd).

---

## 3. Manifest Schema

All fields are present in every manifest. Required fields MUST be supplied by
the caller; optional fields have documented defaults.

```jsonc
{
  // ── Identity ──────────────────────────────────────────────────────────
  "schemaVersion": "0.2",
  "id": "op_20260511143022_a1b2c3d4",
  "home": "/Users/alice/.claude",

  // ── Status ────────────────────────────────────────────────────────────
  "status": "snapshot_taken",

  // ── Timestamps (ISO 8601, UTC, millisecond precision) ─────────────────
  "createdAt": "2026-05-11T14:30:22.000Z",
  "capturedAt": "2026-05-11T14:30:22.123Z",
  "appliedAt": null,
  "verifiedAt": null,
  "rolledBackAt": null,
  "abortedAt": null,

  // ── Operation metadata ────────────────────────────────────────────────
  "housekeeperVersion": "0.2.0",
  "command": "clean",
  "mode": "confirm",
  "consentSummary": "User confirmed clean operation at 2026-05-11T14:30:22Z",

  // ── File entries ──────────────────────────────────────────────────────
  "files": [
    {
      "seq": 0,
      "originalPath": "/Users/alice/.claude/settings.json",
      "snapshotPath": "/Users/alice/.claude/housekeeper/snapshots/op_20260511143022_a1b2c3d4/files/0000_settings.json",
      "sha256Before": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      "sha256After": null,
      "mode": "0600",
      "size": 4096,
      "isSymlink": false,
      "symlinkTarget": null,
      "verifyFailure": false,
      "rollbackSkipped": false
    }
  ],

  // ── Flags ─────────────────────────────────────────────────────────────
  "partialApply": false,
  "blockedByProtection": []
}
```

### Field-by-field reference

| Field | Type | Required | Default | Notes |
|---|---|---|---|---|
| `schemaVersion` | string | yes | — | Always `"0.2"` for v0.2 manifests |
| `id` | string | yes | — | Must match filename stem |
| `home` | string | yes | — | Absolute path; not redacted |
| `status` | string | yes | — | See §4 |
| `createdAt` | string | yes | — | ISO 8601 UTC ms precision |
| `capturedAt` | string | yes | — | ISO 8601 UTC ms precision |
| `appliedAt` | string\|null | no | `null` | Set on transition to `applied` |
| `verifiedAt` | string\|null | no | `null` | Set on transition to `verified` |
| `rolledBackAt` | string\|null | no | `null` | Set on transition to `rolled_back` |
| `abortedAt` | string\|null | no | `null` | Set on transition to `aborted` |
| `housekeeperVersion` | string | yes | — | Semver string |
| `command` | string | yes | — | `"clean"` \| `"rollback"` \| `"harden"` |
| `mode` | string | yes | — | `"confirm"` \| `"dry-run"` |
| `consentSummary` | string | yes | — | Non-empty human-readable consent record |
| `files` | array | yes | — | May be empty if no files targeted |
| `files[].seq` | number | yes | — | 0-based integer, stable across status changes |
| `files[].originalPath` | string | yes | — | Absolute path of the original file |
| `files[].snapshotPath` | string | yes | — | Absolute path of the snapshot copy |
| `files[].sha256Before` | string | yes | — | 64-char lowercase hex sha256 |
| `files[].sha256After` | string\|null | no | `null` | 64-char hex once applied; null until then |
| `files[].mode` | string | yes | — | Octal string e.g. `"0644"` |
| `files[].size` | number | yes | — | Byte size of original file |
| `files[].isSymlink` | boolean | yes | — | |
| `files[].symlinkTarget` | string\|null | yes | — | Symlink target string; null if not a symlink |
| `files[].verifyFailure` | boolean | no | `false` | true if verify phase found hash mismatch |
| `files[].rollbackSkipped` | boolean | no | `false` | true if rollback skipped this file |
| `partialApply` | boolean | no | `false` | true if apply failed mid-way |
| `blockedByProtection` | string[] | no | `[]` | Paths refused due to policy.protected_path |

---

## 4. Status Enum

```
planned → snapshot_taken → applied → verified
                        ↓         ↓
                   rolled_back ←──┘   (also reachable from snapshot_taken)

aborted  (from planned or snapshot_taken only)
```

| Status | Meaning |
|---|---|
| `planned` | Operation created; snapshot not yet written |
| `snapshot_taken` | Snapshot complete; apply not yet started |
| `applied` | Mutation complete; verify not yet run |
| `verified` | Mutation verified correct; terminal success state |
| `rolled_back` | Files restored from snapshot; terminal recovery state |
| `aborted` | Operation cancelled before any mutation; terminal cancel state |

Valid transitions:

| From | To | Trigger |
|---|---|---|
| `planned` | `snapshot_taken` | `takeSnapshot()` completes |
| `planned` | `aborted` | User cancels before snapshot |
| `snapshot_taken` | `applied` | `applyOperation()` completes |
| `snapshot_taken` | `rolled_back` | Rollback called before apply |
| `snapshot_taken` | `aborted` | User aborts after snapshot but before apply |
| `applied` | `verified` | `verify()` passes all hash checks |
| `applied` | `rolled_back` | `rollback()` completes |

Transitions not in this table are invalid. An implementation MUST refuse to
write an invalid transition and surface an error.

---

## 5. Which Statuses Fire `housekeeper.interrupted_operation`

The `housekeeper.interrupted_operation` detector fires when it finds a manifest
whose status is **NOT** in the terminal set:

```
terminal = { "verified", "rolled_back", "aborted" }
```

Non-terminal statuses that trigger the detector:

| Status | Detector message |
|---|---|
| `planned` | "Operation planned but snapshot never written." |
| `snapshot_taken` | "Snapshot taken but apply never ran." |
| `applied` (no `partialApply`) | "Operation applied but not verified." |
| `applied` (`partialApply: true`) | "Partial apply detected; rollback may be needed." |

The detector fires on every session start when any non-terminal manifest exists.
It presents the operation id, the status, the timestamp, and the available
recovery actions. It does NOT auto-recover.

---

## 6. Migration Path for v0.1.x Manifests

v0.1.x does not produce operation manifests (mutation was refused in all
commands). Any `.json` file found in `operations/` that lacks a `schemaVersion`
field, or has `schemaVersion` other than `"0.2"`, is treated as a **legacy
manifest**.

Rules for legacy manifests:

1. **Read as best-effort.** Parse the JSON. Missing fields receive the defaults
   from the table below.
2. **Status defaults to `"planned"`** if the `status` field is absent or
   unrecognized. This is the safest assumption: no mutation occurred.
3. **Never write a legacy manifest.** Upgrades are performed by rewriting the
   manifest with `schemaVersion: "0.2"` and the inferred field values, only
   when the user explicitly runs a recovery command.
4. **`housekeeper.interrupted_operation` fires** for any legacy manifest, with
   the message: "Found legacy operation manifest (pre-v0.2); status assumed
   `planned`."
5. **No automatic migration.** The user must confirm before a legacy manifest
   is rewritten.

Defaults applied to missing fields in legacy manifests:

| Field | Legacy default |
|---|---|
| `schemaVersion` | `"0.1"` (inferred) |
| `status` | `"planned"` |
| `createdAt` | `"1970-01-01T00:00:00.000Z"` |
| `capturedAt` | `"1970-01-01T00:00:00.000Z"` |
| `appliedAt` | `null` |
| `verifiedAt` | `null` |
| `rolledBackAt` | `null` |
| `abortedAt` | `null` |
| `housekeeperVersion` | `"0.1.0"` |
| `command` | `"unknown"` |
| `mode` | `"unknown"` |
| `consentSummary` | `"(legacy — no consent record)"` |
| `files` | `[]` |
| `partialApply` | `false` |
| `blockedByProtection` | `[]` |

---

## 7. Schema Stability Guarantee

`schemaVersion: "0.2"` manifests are stable within the v0.2 release line.
Fields will not be removed or renamed within v0.2.x. New optional fields may
be added; readers MUST ignore unknown fields.

A bump to `schemaVersion: "0.3"` will be accompanied by a migration guide and
a backward-compatibility reader, following the same pattern as §6.
