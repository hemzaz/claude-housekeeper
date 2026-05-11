# Snapshot Architecture — Claude Housekeeper v0.2

This document specifies when snapshots are taken, where they live, what they
contain, and how failures are handled. It is the authoritative reference for the
snapshot writer and rollback subsystems landing in v0.2.

---

## 1. When Snapshots Are Taken

**Rule: a snapshot is taken before ANY mutation, never as a side-effect of a
read-only operation.**

Triggers that require a snapshot:

| Command | Trigger point |
|---|---|
| `clean --confirm` | Before each file is moved, deleted, or modified |
| `rollback <id>` | Before restoring any file (the restore is itself a mutation) |
| Future `harden --confirm` | Before each settings or hook patch |

Read-only operations (`diagnose`, `plan`, `clean --dry-run`) MUST NOT create
snapshot directories. The absence of a snapshot directory is itself evidence that
no mutation occurred.

A partial snapshot (writing some but not all files in the target set) MUST NOT
be used to proceed with the apply step. If snapshot writing fails for any file
in the target set, the entire operation is aborted before any mutation and the
operation status stays `planned`. See §6 for failure modes.

---

## 2. Where Snapshots Live

```
<home>/.claude/housekeeper/
├── operations/
│   └── op_20260511143022_a1b2c3d4.json   ← operation manifest
└── snapshots/
    └── op_20260511143022_a1b2c3d4/
        ├── manifest.json                  ← file list + hashes
        ├── files/
        │   ├── 0001_settings.json         ← original file bytes
        │   └── 0002_installed_plugins.json
        └── meta.json                      ← op id, version, consent summary
```

`<home>` is the Claude home directory being managed (e.g. `~/.claude`). The
snapshot directory is always inside `<home>/.claude/housekeeper/snapshots/<op_id>/`
to keep rollback data co-located with the home it protects and out of the active
loader path.

The `operations/` directory holds manifests. The `snapshots/` directory holds
the actual file bytes. Both are keyed by the same operation id.

---

## 3. What Is Hashed

Every file in the target set is hashed with **sha256** before writing its
snapshot copy. The hex digest is stored in the snapshot `manifest.json` under
the `files[].sha256Before` field.

Hashing covers:

- The original file bytes exactly as read from disk (no line-ending normalization)
- Symlinks: hash the symlink target string, not the dereferenced content; record
  `isSymlink: true` and `symlinkTarget: "<target>"` in the file entry

Hashing does NOT cover:

- File mode or ownership (recorded separately as `mode` and `uid`/`gid`)
- Directories (directory existence is recorded, not hashed)

The same sha256 hash is recomputed after the mutation step and stored in
`files[].sha256After`. Verification compares `sha256After` (actual) against the
value computed from the mutated file on disk.

---

## 4. Atomic Write Protocol

All snapshot writes use the **write-temp + rename + fsync-parent** protocol to
prevent partial file corruption:

```
1. write to  <target>.tmp  (random suffix, same directory)
2. fsync     <target>.tmp
3. rename    <target>.tmp  →  <target>   (atomic on POSIX)
4. fsync     parent directory           (ensures rename is durable)
```

Applied to every file in `snapshots/<op_id>/files/` and to the two manifest
files (`manifest.json`, `meta.json`). The operation manifest in `operations/`
is written last, after all snapshot files are fsynced, so its presence signals
a complete snapshot.

If any step fails, the partially-written `.tmp` file is unlinked. The
`operations/<op_id>.json` manifest is never written until all snapshot files
are complete. The snapshot directory may exist but is considered incomplete
(and therefore invalid) until its paired operation manifest exists.

---

## 5. Integrity Flow

```
READ phase (no mutation):
  for each target file:
    sha256Before = hash(file)
    write file bytes to snapshots/<op_id>/files/<seq>_<basename>
    manifest.files[n].sha256Before = sha256Before

APPLY phase (mutation):
  precondition: verify hash(file) == manifest.files[n].sha256Before
    → if mismatch: abort; status stays "snapshot_taken"
  apply mutation to file
  sha256After = hash(mutated file)
  manifest.files[n].sha256After = sha256After
  status → "applied"

VERIFY phase (read-only):
  for each file:
    actual = hash(file on disk)
    expected = manifest.files[n].sha256After
    if actual != expected: flag as corruption; status stays "applied" (partial)
  if all match: status → "verified"
```

If the apply-phase precondition fails (file changed since snapshot), the
operation aborts with status `snapshot_taken`. No mutation occurs. The user
sees: "File changed since snapshot was taken; aborting."

---

## 6. Failure Modes

### 6.1 Partial Snapshot

**Cause:** snapshot writing fails for one or more target files (disk full,
permission denied, I/O error).

**Effect:** the operation manifest in `operations/` is never written. The
snapshot directory may exist with partial contents.

**Status:** remains `planned` (manifest never transitions).

**Recovery:** the apply step MUST check for the operation manifest before
proceeding. If it is absent, apply refuses with: "Snapshot incomplete; cannot
proceed." The partial snapshot directory is left for GC (§9).

**User-visible state:** `planned` — no mutation attempted.

### 6.2 Partial Apply

**Cause:** mutation succeeds for some files but fails partway through the target
set (disk full, permission error, process kill).

**Effect:** some files are mutated, others are not. The manifest records which
files have `sha256After` and which do not.

**Status:** `applied` with `partialApply: true` flag set in the manifest.

**Recovery:** rollback is triggered automatically when `partialApply: true` is
detected. Each file with a `sha256Before` entry is restored from the snapshot.
Files already restored have their `sha256After` cleared. Status moves to
`rolled_back`.

**User-visible state:** `rolled_back` — "Partial apply detected; rolled back N
files."

### 6.3 Mid-Rollback Crash

**Cause:** process is killed during the rollback flow (power loss, SIGKILL).

**Effect:** some snapshot files are restored, others are not.

**Status:** `applied` with `partialApply: true` persists in the manifest (the
manifest was not updated to `rolled_back` before the crash).

**Recovery:** on the next session, `housekeeper.interrupted_operation` fires
when it finds an operation manifest with status not in `{verified, rolled_back}`.
The recovery flow re-reads the manifest, identifies which files were not yet
restored (those still lacking a post-rollback hash entry), and presents the
manual recovery path.

**User-visible state:** `housekeeper.interrupted_operation` finding in the next
`diagnose` run. Status stays `applied` until the user completes recovery.

---

## 7. Interaction with `policy.protected_path`

**Hard boundary: the snapshot writer REFUSES any path that matches a
`policy.protected_path` rule.**

If any file in the operation target set matches a `protect` or `doNotTouch`
policy rule:

1. The operation is aborted before any snapshot file is written.
2. Status stays `planned`.
3. The user sees: "Path '<path>' is protected; snapshot refused."
4. The protected path is listed in the operation manifest under
   `blockedByProtection[]`.

This boundary cannot be overridden by the `--confirm` flag. Protected paths
require the user to explicitly remove the protection rule before any mutation
is allowed.

---

## 8. Interaction with `housekeeper.interrupted_operation`

The existing `housekeeper.interrupted_operation` detector (v0.1) fires when it
finds a manifest in `operations/` whose status is NOT in
`{verified, rolled_back, aborted}`.

In v0.2, this detector gains a recovery action:

- If status is `snapshot_taken`: offer to abort (delete snapshot directory,
  set status to `aborted`).
- If status is `applied` with `partialApply: true`: offer to complete rollback
  from the snapshot.
- If status is `applied` without `partialApply`: offer to verify (re-run the
  verify phase).

The detector does not auto-recover. It presents options and requires explicit
user confirmation.

---

## 9. Sizing, Budget, and GC

### Per-operation limits

| Parameter | Default | Rationale |
|---|---|---|
| `maxSnapshotFiles` | 50 | Prevents accidental bulk ops |
| `maxSnapshotBytes` | 10 MB | Keeps snapshot storage bounded |
| `maxTargetPathDepth` | 8 | Guards against symlink loops |

If the target set exceeds either limit, the operation is refused before any
snapshot writing begins. The user sees the limit and the actual count.

### Retention

| Condition | Retention |
|---|---|
| Status `verified` or `rolled_back` | Keep last 10 operations |
| Status `aborted` | Delete immediately after user acknowledgement |
| Status `applied`, `snapshot_taken`, `planned` | Keep indefinitely (interrupted) |

### GC posture

GC runs at the start of each `clean --confirm` or `rollback` invocation, before
any new snapshot is taken. It removes the snapshot directories and operation
manifests for operations outside the retention window. GC never touches
operations with interrupted status; those are surfaced by the detector instead.

---

## 10. Pseudocode

### `takeSnapshot(operationId, targetFiles, home)`

```
fn takeSnapshot(operationId, targetFiles, home):
  snapshotDir = home/.claude/housekeeper/snapshots/{operationId}
  manifestPath = home/.claude/housekeeper/operations/{operationId}.json

  assert targetFiles.length <= maxSnapshotFiles
  assert sum(sizes(targetFiles)) <= maxSnapshotBytes

  for each policy in loadProtectionPolicy(home):
    for each file in targetFiles:
      if pathMatchesProtection(file, policy):
        abort("Path is protected; snapshot refused")

  mkdirAtomic(snapshotDir/files)

  fileEntries = []
  for (i, file) in enumerate(targetFiles):
    bytes = readFile(file)
    sha256Before = sha256(bytes)
    dest = snapshotDir/files/{padded(i)}_{basename(file)}
    writeAtomic(dest, bytes)
    fileEntries.append({
      seq: i, originalPath: file, snapshotPath: dest,
      sha256Before, mode: statMode(file), size: len(bytes),
      isSymlink: isSymlink(file), symlinkTarget: symlinkTarget(file)
    })

  writeAtomic(snapshotDir/meta.json, {
    operationId, housekeeperVersion, capturedAt: now()
  })

  // Write manifest last — its presence signals a complete snapshot
  writeAtomic(manifestPath, makeOperationManifest({
    id: operationId, status: "snapshot_taken", files: fileEntries,
    home, capturedAt: now()
  }))

  return { snapshotDir, manifestPath, fileEntries }
```

### `applyOperation(operationId, home, mutationFn)`

```
fn applyOperation(operationId, home, mutationFn):
  manifest = readManifest(home, operationId)
  assert manifest.status == "snapshot_taken"

  appliedFiles = []
  for entry in manifest.files:
    currentHash = sha256(readFile(entry.originalPath))
    if currentHash != entry.sha256Before:
      abort("File changed since snapshot; aborting")
    mutationFn(entry.originalPath)
    sha256After = sha256(readFile(entry.originalPath))
    entry.sha256After = sha256After
    appliedFiles.append(entry)

  updateManifest(operationId, home, {
    status: "applied", files: appliedFiles, appliedAt: now()
  })
```

### `verify(operationId, home)`

```
fn verify(operationId, home):
  manifest = readManifest(home, operationId)
  assert manifest.status == "applied"

  allMatch = true
  for entry in manifest.files:
    actual = sha256(readFile(entry.originalPath))
    if actual != entry.sha256After:
      allMatch = false
      entry.verifyFailure = true

  if allMatch:
    updateManifest(operationId, home, { status: "verified", verifiedAt: now() })
  else:
    // leave status as "applied"; surface via interrupted_operation detector
```

### `rollback(operationId, home)`

```
fn rollback(operationId, home):
  manifest = readManifest(home, operationId)
  assert manifest.status in {"applied", "snapshot_taken"}

  for entry in manifest.files:
    currentHash = sha256(readFile(entry.originalPath))
    if currentHash != entry.sha256After:
      warn("File changed after apply; confirm overwrite")
      if not userConfirmed: continue
    writeAtomic(entry.originalPath, readFile(entry.snapshotPath))

  updateManifest(operationId, home, {
    status: "rolled_back", rolledBackAt: now()
  })
```

---

## 11. Failure-Mode → User-Visible State Table

| Failure mode | Operation status | User-visible finding |
|---|---|---|
| Snapshot write fails (any file) | `planned` | "Snapshot incomplete; no mutation attempted." |
| Protected path in target set | `planned` | "Path is protected; operation refused." |
| File changed between snapshot and apply | `snapshot_taken` | "File changed since snapshot; aborting." |
| Apply fails partway through | `applied` (`partialApply: true`) | "Partial apply detected; initiating rollback." |
| Mid-rollback crash | `applied` (persists) | `housekeeper.interrupted_operation` on next session |
| Verify hash mismatch | `applied` (persists) | `housekeeper.interrupted_operation` — "Verify failed for N files." |
| Rollback target changed | `applied` (persists) | "File changed after apply; confirm overwrite or skip." |
| Manifest corrupt | any | `housekeeper.interrupted_operation` — "Manifest unreadable; manual recovery required." |
| Target set exceeds budget | `planned` | "Target exceeds limit (N files / M bytes); operation refused." |
