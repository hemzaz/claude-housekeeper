// Snapshot and rollback contract factories for Claude Housekeeper v0.2.
// Pure functions (factories) — return new plain objects matching docs/rollback-contracts.md.
// I/O functions (takeSnapshot) — write-temp + rename + fsync-parent atomic protocol.

import { createHash, randomBytes } from "node:crypto";
import {
  mkdir,
  open,
  rename,
  lstat,
  readlink,
  readFile,
  unlink
} from "node:fs/promises";
import { join, basename } from "node:path";
import os from "node:os";

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

// ── I/O helpers ─────────────────────────────────────────────────────────────

/**
 * generateOpId() — returns a new operation id in the format:
 *   op_<YYYYMMDDHHMMSS>_<8hex>
 * Per docs/rollback-contracts.md §1.
 */
export function generateOpId() {
  const now = new Date();
  const pad = (n, w) => String(n).padStart(w, "0");
  const ts =
    pad(now.getUTCFullYear(), 4) +
    pad(now.getUTCMonth() + 1, 2) +
    pad(now.getUTCDate(), 2) +
    pad(now.getUTCHours(), 2) +
    pad(now.getUTCMinutes(), 2) +
    pad(now.getUTCSeconds(), 2);
  const hex = randomBytes(4).toString("hex");
  return `op_${ts}_${hex}`;
}

/**
 * hashFile(filePath) — sha256 hex digest of file bytes.
 * For symlinks, hashes the symlink target string (not dereferenced content).
 * Returns a 64-char lowercase hex string.
 */
export async function hashFile(filePath) {
  const lstats = await lstat(filePath);
  let buf;
  if (lstats.isSymbolicLink()) {
    const target = await readlink(filePath);
    buf = Buffer.from(target, "utf8");
  } else {
    buf = await readFile(filePath);
  }
  return createHash("sha256").update(buf).digest("hex");
}

/**
 * atomicWrite(destPath, content) — write-temp + rename + fsync-parent.
 * Implements the atomic protocol from docs/snapshot-architecture.md §4:
 *   1. Write to <dest>.tmp.<random> (same directory)
 *   2. fsync the tmp file
 *   3. rename tmp → dest (atomic on POSIX)
 *   4. fsync parent directory (ensures rename is durable)
 *
 * content may be a Buffer or string.
 * On failure, unlinks the tmp file before rethrowing.
 */
async function atomicWrite(destPath, content) {
  const dir = destPath.slice(0, destPath.lastIndexOf("/"));
  const tmpPath = `${destPath}.tmp.${randomBytes(4).toString("hex")}`;
  let fh;
  try {
    fh = await open(tmpPath, "w");
    await fh.writeFile(content);
    await fh.sync();
    await fh.close();
    fh = null;
    await rename(tmpPath, destPath);
  } catch (err) {
    if (fh) {
      try { await fh.close(); } catch { /* ignore */ }
    }
    try { await unlink(tmpPath); } catch { /* ignore */ }
    throw err;
  }
  // fsync parent directory to ensure the rename is durable.
  let dirFh;
  try {
    dirFh = await open(dir, "r");
    await dirFh.sync();
    await dirFh.close();
  } catch {
    // fsync on a directory is not supported on all platforms (notably macOS
    // returns EINVAL). Treat failure as a no-op — the rename is already
    // durable on local APFS/HFS+ and ext4 with ordered data mode.
  }
}

/**
 * takeSnapshot(home, opts) — snapshot writer entry point.
 *
 * Implements the full atomic snapshot flow from docs/snapshot-architecture.md §4:
 *   - For each target file: hash, write snapshot copy via atomicWrite
 *   - Write meta.json inside the snapshot dir
 *   - Write operation manifest to operations/<op_id>.json LAST
 *     (its presence signals a complete snapshot)
 *
 * opts.targets  — array of absolute paths to snapshot (required)
 * opts.command  — "clean" | "rollback" | "harden" (default "clean")
 * opts.mode     — "confirm" | "dry-run" (default "confirm")
 * opts.consentSummary — human-readable consent record (default "")
 * opts.housekeeperVersion — semver string (default "0.2.0")
 *
 * Returns { opId, manifest } on success.
 * Throws on any I/O failure; no manifest is written on error.
 *
 * TODO: T-602 protected path check (before any I/O)
 * TODO: T-603 budget enforcement (maxSnapshotFiles=50, maxSnapshotBytes=10MB)
 */
export async function takeSnapshot(home, opts = {}) {
  const targets = Array.isArray(opts.targets) ? opts.targets : [];
  const command = opts.command || "clean";
  const mode = opts.mode || "confirm";
  const consentSummary = opts.consentSummary || "";
  const housekeeperVersion = opts.housekeeperVersion || "0.2.0";

  // TODO: T-602 protected path check
  // TODO: T-603 budget enforcement

  const opId = generateOpId();
  const snapshotDir = join(home, ".claude", "housekeeper", "snapshots", opId);
  const filesDir = join(snapshotDir, "files");
  const operationsDir = join(home, ".claude", "housekeeper", "operations");
  const manifestPath = join(operationsDir, `${opId}.json`);

  // Create snapshot directory structure.
  await mkdir(filesDir, { recursive: true });
  await mkdir(operationsDir, { recursive: true });

  const now = new Date().toISOString();
  const fileEntries = [];

  for (let i = 0; i < targets.length; i++) {
    const origPath = targets[i];
    const lstats = await lstat(origPath);
    const isSymlink = lstats.isSymbolicLink();
    const symlinkTarget = isSymlink ? await readlink(origPath) : null;

    // Read content for snapshot copy.
    let content;
    if (isSymlink) {
      // For symlinks: store the target string as the snapshot content.
      content = Buffer.from(symlinkTarget, "utf8");
    } else {
      content = await readFile(origPath);
    }

    const sha256Before = createHash("sha256").update(content).digest("hex");
    const seq = i;
    const seqStr = String(seq).padStart(4, "0");
    const snapshotFileName = `${seqStr}_${basename(origPath)}`;
    const snapshotFilePath = join(filesDir, snapshotFileName);

    // Atomic write of snapshot file copy.
    await atomicWrite(snapshotFilePath, content);

    // Mode bits as octal string e.g. "0644".
    const modeBits = (lstats.mode & 0o7777).toString(8).padStart(4, "0");

    fileEntries.push(
      makeFileSnapshot({
        seq,
        originalPath: origPath,
        snapshotPath: snapshotFilePath,
        sha256Before,
        sha256After: null,
        mode: modeBits,
        size: lstats.size,
        isSymlink,
        symlinkTarget
      })
    );
  }

  // Write meta.json inside the snapshot dir (before the operation manifest).
  const meta = {
    operationId: opId,
    housekeeperVersion,
    capturedAt: now
  };
  await atomicWrite(join(snapshotDir, "meta.json"), JSON.stringify(meta, null, 2) + os.EOL);

  // Build and write the operation manifest LAST — its presence signals
  // that all snapshot files are complete and durable.
  const manifest = makeOperationManifest({
    id: opId,
    home,
    status: "snapshot_taken",
    createdAt: now,
    capturedAt: now,
    housekeeperVersion,
    command,
    mode,
    consentSummary,
    files: fileEntries
  });

  await atomicWrite(manifestPath, JSON.stringify(manifest, null, 2) + os.EOL);

  return { opId, manifest };
}
