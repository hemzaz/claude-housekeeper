// Snapshot and rollback contract factories for Claude Housekeeper v0.2.
// Pure functions — return new plain objects matching docs/rollback-contracts.md.
// No mutation, no I/O.

export const SCHEMA_VERSION_V2 = "0.2";

// Status enum — matches docs/rollback-contracts.md §4.
export const OPERATION_STATUSES = Object.freeze([
  "planned",
  "snapshot_taken",
  "applied",
  "verified",
  "rolled_back",
  "aborted"
]);

// Terminal statuses: housekeeper.interrupted_operation does NOT fire for these.
export const TERMINAL_STATUSES = Object.freeze(["verified", "rolled_back", "aborted"]);

/**
 * makeFileSnapshot(opts) — one entry in the manifest files[] array.
 *
 * Required fields: seq, originalPath, snapshotPath, sha256Before, mode, size,
 *   isSymlink, symlinkTarget.
 * Optional fields: sha256After, verifyFailure, rollbackSkipped.
 */
export function makeFileSnapshot(opts = {}) {
  return {
    seq: typeof opts.seq === "number" ? opts.seq : 0,
    originalPath: opts.originalPath || "",
    snapshotPath: opts.snapshotPath || "",
    sha256Before: opts.sha256Before || "",
    sha256After: opts.sha256After !== undefined ? opts.sha256After : null,
    mode: opts.mode || "0644",
    size: typeof opts.size === "number" ? opts.size : 0,
    isSymlink: Boolean(opts.isSymlink),
    symlinkTarget:
      opts.symlinkTarget !== undefined ? opts.symlinkTarget : null,
    verifyFailure: Boolean(opts.verifyFailure),
    rollbackSkipped: Boolean(opts.rollbackSkipped)
  };
}

/**
 * makeRollbackPlan(opts) — summary of what rollback will do for an operation.
 *
 * This object is informational: produced before rollback executes so the user
 * can confirm. It does NOT drive the rollback itself.
 */
export function makeRollbackPlan(opts = {}) {
  return {
    operationId: opts.operationId || "",
    filesToRestore: Array.isArray(opts.filesToRestore)
      ? opts.filesToRestore.map((f) => ({ ...f }))
      : [],
    filesToSkip: Array.isArray(opts.filesToSkip)
      ? opts.filesToSkip.map((f) => ({ ...f }))
      : [],
    estimatedRisk: opts.estimatedRisk || "low",
    requiresConfirmation: Boolean(opts.requiresConfirmation)
  };
}

/**
 * makeOperationManifest(opts) — the top-level operation manifest.
 *
 * Matches the schema in docs/rollback-contracts.md §3.
 * Invalid or unrecognised status values are coerced to "planned".
 */
export function makeOperationManifest(opts = {}) {
  const status = OPERATION_STATUSES.includes(opts.status)
    ? opts.status
    : "planned";

  return {
    schemaVersion: SCHEMA_VERSION_V2,
    id: opts.id || "",
    home: opts.home || "",
    status,
    createdAt: opts.createdAt || new Date(0).toISOString(),
    capturedAt: opts.capturedAt || new Date(0).toISOString(),
    appliedAt: opts.appliedAt !== undefined ? opts.appliedAt : null,
    verifiedAt: opts.verifiedAt !== undefined ? opts.verifiedAt : null,
    rolledBackAt: opts.rolledBackAt !== undefined ? opts.rolledBackAt : null,
    abortedAt: opts.abortedAt !== undefined ? opts.abortedAt : null,
    housekeeperVersion: opts.housekeeperVersion || "0.2.0",
    command: opts.command || "clean",
    mode: opts.mode || "dry-run",
    consentSummary: opts.consentSummary || "",
    files: Array.isArray(opts.files)
      ? opts.files.map((f) => makeFileSnapshot(f))
      : [],
    partialApply: Boolean(opts.partialApply),
    blockedByProtection: Array.isArray(opts.blockedByProtection)
      ? [...opts.blockedByProtection]
      : []
  };
}
