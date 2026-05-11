# Taskboard — Claude Housekeeper v0.2

Companion to `notes/PLAN-v0.2.md`. Tasks are atomic, ordered by phase, each
with a single verify criterion. Mark `[x]` when complete; if a task expands,
split it into new T-IDs rather than overloading one.

Status legend: `[ ]` todo · `[~]` in progress · `[x]` done · `[!]` blocked

All tasks in this board are blocked until PR #29 (docs) and PR #30 (type
factories) are merged into main.

---

## Phase 6 — Snapshot writer

- [ ] **T-600** Add `scripts/lib/snapshot.mjs` I/O layer: `takeSnapshot()`
  - Scope: new function in `scripts/lib/snapshot.mjs` — adds the actual file
    I/O on top of the type factories already present
  - Implement write-temp + rename + fsync-parent atomic protocol from
    `docs/snapshot-architecture.md §4`
  - Verify: unit test writes a snapshot for a synthetic home file and confirms
    the operation manifest is created only after all snapshot files are fsynced
  - blockedBy: PR #29, PR #30

- [ ] **T-601** Implement sha256 hashing in snapshot writer
  - Scope: `scripts/lib/snapshot.mjs` — add `hashFile(path)` using
    `node:crypto` `createHash('sha256')`; wire into `takeSnapshot()`
  - Verify: `hashFile` returns a 64-char lowercase hex string; snapshot
    manifest `sha256Before` matches `crypto.createHash('sha256')` of the
    original file bytes
  - blockedBy: T-600

- [ ] **T-602** Implement protected-path check in snapshot writer
  - Scope: `scripts/lib/snapshot.mjs` — before writing any file, check each
    target against `loadProtectionPolicy(home)`; abort with
    `blockedByProtection[]` populated if any match
  - Verify: snapshot writer refuses a target that matches a `doNotTouch` rule;
    operation manifest `status` stays `"planned"`; snapshot directory is not
    created
  - blockedBy: T-600

- [ ] **T-603** Implement per-operation budget enforcement
  - Scope: `scripts/lib/snapshot.mjs` — check `targetFiles.length <= 50` and
    `sum(sizes) <= 10 MB` before any I/O; abort with clear error if exceeded
  - Verify: operation targeting 51 files is refused before any snapshot file
    is written; error message includes actual count and limit
  - blockedBy: T-600

- [ ] **T-604** Implement snapshot GC
  - Scope: new `gcSnapshots(home)` in `scripts/lib/snapshot.mjs` — removes
    manifests + snapshot directories for `verified`/`rolled_back` operations
    beyond the last 10; never touches non-terminal operations
  - Verify: after creating 12 verified operations, GC removes exactly 2;
    any operation with non-terminal status is untouched
  - blockedBy: T-600

- [ ] **T-605** Add `test/snapshot-io.test.mjs` integration tests
  - Scope: new test file — uses `node:fs/promises` + `node:os.tmpdir()` to
    exercise the full snapshot I/O path against real files
  - Verify: round-trip test: `takeSnapshot` → read manifest → assert
    `sha256Before` matches actual file hash; all 4 atomic-write steps
    exercised; partial snapshot leaves no manifest
  - blockedBy: T-601, T-602, T-603

---

## Phase 7 — `clean --confirm` implementation

- [ ] **T-700** Add `--confirm` flag to `clean` command parser
  - Scope: `scripts/claude-housekeeper.mjs` — add `--confirm` boolean flag;
    wire it through to the clean handler; `--dry-run` remains the default
  - Verify: `--help` output shows `--confirm`; passing `--confirm` sets a
    `confirm: true` option in the parsed args; dry-run is not active when
    `--confirm` is passed
  - blockedBy: T-600

- [ ] **T-701** Implement consent gate for `clean --confirm`
  - Scope: `scripts/claude-housekeeper.mjs` — before calling `takeSnapshot`,
    print the operation plan and prompt for explicit confirmation; resolve
    open design question Q1 (see PLAN-v0.2.md) before implementing
  - Verify: without confirmation input, no snapshot is written; with
    confirmation, `takeSnapshot` is called; `--yes` flag bypasses prompt for
    non-interactive use (CI)
  - blockedBy: T-700

- [ ] **T-702** Implement `applyOperation()` in snapshot module
  - Scope: `scripts/lib/snapshot.mjs` — adds `applyOperation(id, home, ops)`
    that re-checks `sha256Before`, calls mutation functions, records
    `sha256After`; sets `partialApply: true` on failure; resolve Q5 before
    implementing auto-rollback behaviour
  - Verify: applying a clean operation changes the target file; manifest
    transitions to `"applied"`; if apply is interrupted (simulated), manifest
    shows `partialApply: true`
  - blockedBy: T-601

- [ ] **T-703** Implement `verify()` in snapshot module
  - Scope: `scripts/lib/snapshot.mjs` — adds `verify(id, home)` that recomputes
    sha256 of each mutated file and compares to `sha256After`; transitions to
    `"verified"` on all-pass or leaves `"applied"` with `verifyFailure` flags
  - Verify: after a clean apply, `verify()` transitions status to `"verified"`;
    corrupting a file before verify causes `verifyFailure: true` on that entry
  - blockedBy: T-702

- [ ] **T-704** Wire snapshot → apply → verify into `clean --confirm` flow
  - Scope: `scripts/claude-housekeeper.mjs` — connect T-700..T-703 into the
    end-to-end confirmed clean flow: consent → snapshot → apply → verify
  - Verify: `clean --confirm --yes` on a synthetic home creates an operation
    manifest with status `"verified"` and the target file is changed
  - blockedBy: T-701, T-703

---

## Phase 8 — `rollback <id>` command

- [ ] **T-800** Add `rollback <id>` to the CLI command parser
  - Scope: `scripts/claude-housekeeper.mjs` — add `rollback` subcommand that
    accepts a single positional `<id>` argument; validate id format matches
    `op_[0-9]{14}_[0-9a-f]{8}` before any I/O
  - Verify: `housekeeper rollback op_20260511143022_a1b2c3d4` dispatches to
    the rollback handler with the correct id; invalid id format prints an
    error and exits non-zero without touching any files
  - blockedBy: T-600

- [ ] **T-801** Implement `makeRollbackPlan` dry-run output
  - Scope: `scripts/claude-housekeeper.mjs` — `rollback --dry-run` (default)
    calls `makeRollbackPlan` and prints the plan; resolve Q2 before deciding
    JSON vs. human output format
  - Verify: `rollback --dry-run <id>` prints the files that would be restored
    without writing any files; exit code 0
  - blockedBy: T-800

- [ ] **T-802** Implement `rollback()` I/O in snapshot module
  - Scope: `scripts/lib/snapshot.mjs` — adds `rollback(id, home)` that
    restores each file from its snapshot copy using atomic write; records
    `rolledBackAt`; transitions status to `"rolled_back"`
  - Verify: after `rollback()`, each target file matches its `sha256Before`;
    manifest status is `"rolled_back"`; snapshot directory is retained (GC
    handles cleanup later)
  - blockedBy: T-702

- [ ] **T-803** Add file-changed-after-apply detection to rollback
  - Scope: `scripts/lib/snapshot.mjs` `rollback()` — check current hash vs
    `sha256After`; if changed, warn and require `--force` or skip
  - Verify: rollback on a file changed since apply prints a warning; without
    `--force` the file is skipped and `rollbackSkipped: true` is recorded;
    with `--force` the file is overwritten
  - blockedBy: T-802

- [ ] **T-804** Wire rollback into CLI end-to-end
  - Scope: `scripts/claude-housekeeper.mjs` — connect T-800..T-803 into the
    full rollback flow: validate id → dry-run plan → confirm → rollback → report
  - Verify: `rollback --yes <id>` on a synthetic applied operation restores
    the original file bytes and produces a `"rolled_back"` manifest
  - blockedBy: T-803

---

## Phase 9 — Interrupted-op recovery

- [ ] **T-900** Add interrupted-op manifest reader to `diagnose`
  - Scope: `scripts/lib/audit.mjs` — scan `operations/` for any manifest with
    non-terminal status; emit a `housekeeper.interrupted_operation` finding for
    each one
  - Verify: `diagnose` on a home with a `"snapshot_taken"` manifest produces a
    finding with stance `"block"` and summary listing the operation id and status
  - blockedBy: T-600

- [ ] **T-901** Add recovery action hints to interrupted-op finding
  - Scope: `scripts/lib/audit.mjs` or `scripts/lib/report.mjs` — each
    interrupted-op finding includes a `nextAllowedStep` string with the
    recovery command; resolve Q3 before deciding command surface
  - Verify: interrupted-op finding for status `"applied"` shows
    `nextAllowedStep: "rollback <id>"` or equivalent; finding for
    `"snapshot_taken"` shows `nextAllowedStep: "rollback <id> --abort"`
  - blockedBy: T-900

- [ ] **T-902** Add `rollback --abort <id>` to cancel a pre-apply operation
  - Scope: `scripts/claude-housekeeper.mjs` + `scripts/lib/snapshot.mjs` —
    `rollback --abort <id>` transitions a `"snapshot_taken"` or `"planned"`
    operation to `"aborted"` and removes the snapshot directory
  - Verify: `rollback --abort <id>` on a `"snapshot_taken"` operation sets
    status to `"aborted"` and deletes the snapshot directory; subsequent
    `diagnose` does not fire an interrupted-op finding for that id
  - blockedBy: T-800, T-900

- [ ] **T-903** Add legacy manifest detection to interrupted-op reader
  - Scope: `scripts/lib/audit.mjs` — treat any manifest missing `schemaVersion`
    or with `schemaVersion != "0.2"` as a legacy manifest; emit
    `housekeeper.interrupted_operation` with message: "Found legacy operation
    manifest (pre-v0.2); status assumed planned."
  - Verify: placing a `{}` file in `operations/` triggers the legacy-manifest
    finding; placing a manifest with `schemaVersion: "0.2"` and
    `status: "verified"` does NOT trigger any finding
  - blockedBy: T-900

- [ ] **T-904** SessionStart probe for interrupted operations
  - Scope: `hooks/session-start.mjs` — extend the SessionStart check to
    scan `operations/` for non-terminal manifests and emit a compact reminder
    (one line per operation: id, status, age)
  - Verify: session-start output includes the interrupted-op id and status when
    a non-terminal manifest exists; clean homes produce no interrupted-op output
  - blockedBy: T-900

---

## Cross-phase

- [ ] **T-619** Update `docs/schema-stability.md` for v0.2 manifest schema
  - Scope: `docs/schema-stability.md` — add the v0.2 manifest schema fields to
    the stability table; mark `schemaVersion: "0.2"` as stable for v0.2.x
  - Verify: `test/schema-stability.test.mjs` still passes; the stability doc
    references `docs/rollback-contracts.md` for the full field list
  - blockedBy: PR #29 merged
