// Rollback plan composition for Claude Housekeeper v0.2.
//
// T-801..T-803 scope: read operation manifests, validate rollback freshness,
// and execute the restore while preserving the Housekeeper lock invariant.

import { existsSync } from "node:fs";
import { copyFile, mkdir, readFile, readdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { atomicWrite, hashFile } from "./snapshot.mjs";
import { acquireLock, releaseLock, LockHeldError } from "./lock.mjs";
import { appendRollback } from "./learning.mjs";

const ROLLBACKABLE_STATUSES = new Set(["applied", "verified", "snapshot_taken"]);

export class PlanDriftError extends Error {
  constructor(opId, targetPath, expectedHash, actualHash) {
    super(`Rollback plan drift detected for ${targetPath}`);
    this.name = "PlanDriftError";
    this.code = "rollback-plan-drift";
    this.opId = opId;
    this.targetPath = targetPath;
    this.expectedHash = expectedHash;
    this.actualHash = actualHash;
  }
}

export class SnapshotIntegrityError extends Error {
  constructor(snapshotPath, expectedHash, actualHash) {
    super(`Snapshot integrity check failed for ${snapshotPath}`);
    this.name = "SnapshotIntegrityError";
    this.code = "snapshot-integrity";
    this.snapshotPath = snapshotPath;
    this.expectedHash = expectedHash;
    this.actualHash = actualHash;
  }
}

// LockHeldError is imported from lock.mjs and re-exported so v0.3 callers see no API change.
export { LockHeldError };

export class RollbackNotImplementedError extends Error {
  constructor(kind) {
    super(`Rollback operation kind "${kind}" is not implemented in v0.2.0`);
    this.name = "RollbackNotImplementedError";
    this.code = "rollback-kind-not-implemented";
    this.kind = kind;
  }
}

export class AbortNotAllowedError extends Error {
  constructor(opId, status) {
    super(`Operation ${opId} has status "${status}", which cannot be aborted.`);
    this.name = "AbortNotAllowedError";
    this.code = "abort-not-allowed";
    this.opId = opId;
    this.status = status;
  }
}

function makeRefusal(reason, message, targetPath = "") {
  return {
    class: "RollbackPlanRefusal",
    reason,
    targetPath,
    message,
    exitCode: 2
  };
}

function emptyPlan(home, opId, sourceManifestPath, refused) {
  return {
    schemaVersion: "0.2",
    opId,
    home,
    sourceManifestPath,
    operations: [],
    refused,
    composedAt: new Date().toISOString()
  };
}

function expectedPostApplyHash(entry, status) {
  if (status === "snapshot_taken") return entry.sha256Before;
  return entry.sha256After === undefined ? null : entry.sha256After;
}

async function detectDrift(entry, status) {
  const expected = expectedPostApplyHash(entry, status);
  const exists = existsSync(entry.originalPath);

  if (expected === null) {
    if (!exists) return null;
    let actual = "present";
    try {
      actual = await hashFile(entry.originalPath);
    } catch {
      // The existence check already proves drift for expected absence.
    }
    return { expected, actual };
  }

  if (!exists) {
    return { expected, actual: null };
  }

  const actual = await hashFile(entry.originalPath);
  if (actual !== expected) return { expected, actual };
  return null;
}

function makeOperation(entry) {
  return {
    originalPath: entry.originalPath,
    sha256Before: entry.sha256Before,
    sha256After: entry.sha256After === undefined ? null : entry.sha256After,
    snapshotPath: entry.snapshotPath,
    mutationKind: "dir-rmtree",
    rollbackOp: {
      kind: "file-restore-from-snapshot",
      args: {
        sourcePath: entry.snapshotPath,
        targetPath: entry.originalPath,
        mode: entry.mode,
        isSymlink: Boolean(entry.isSymlink),
        symlinkTarget: entry.symlinkTarget === undefined ? null : entry.symlinkTarget
      }
    }
  };
}

async function readOperationManifest(sourceManifestPath) {
  return JSON.parse(await readFile(sourceManifestPath, "utf8"));
}

const ROLLBACK_REGISTRY = Object.freeze({
  "file-restore-from-snapshot": async (args) => {
    await mkdir(dirname(args.targetPath), { recursive: true });
    await copyFile(args.sourcePath, args.targetPath);
  }
});

/**
 * composeRollbackPlan(home, opIdOrOptions) — read a Housekeeper operation
 * manifest and return a dry-run rollback plan.
 *
 * Accepts two call forms:
 *   composeRollbackPlan(home, "op_<id>")         — single-op rollback (v0.3)
 *   composeRollbackPlan(home, { streamId })       — stream rollback (v0.4 P6)
 *
 * For the stream form, returns:
 *   { isStream: true, streamId, subPlans: [...], composedAt }
 * where subPlans are per-chunk rollback plans in reverse chunk order.
 *
 * `home` is the Claude home directory (`~/.claude`), matching the CLI and
 * audit module convention. Manifests live at:
 *   <home>/housekeeper/operations/<opId>.json           (single-op)
 *   <home>/housekeeper/operations/<streamId>/parent.json (stream)
 */
export async function composeRollbackPlan(home, opIdOrOptions) {
  // Stream rollback: accept { streamId } options object.
  if (opIdOrOptions && typeof opIdOrOptions === "object" && opIdOrOptions.streamId) {
    return _composeStreamRollbackPlan(home, opIdOrOptions.streamId);
  }

  const opId = opIdOrOptions;
  const sourceManifestPath = join(home, "housekeeper", "operations", `${opId}.json`);

  if (!existsSync(sourceManifestPath)) {
    return emptyPlan(home, opId, sourceManifestPath, [
      makeRefusal("manifest-not-found", `No operation manifest found for ${opId}.`)
    ]);
  }

  let manifest;
  try {
    manifest = await readOperationManifest(sourceManifestPath);
  } catch {
    return emptyPlan(home, opId, sourceManifestPath, [
      makeRefusal("manifest-malformed", `Operation manifest ${sourceManifestPath} is not valid JSON.`)
    ]);
  }

  if (!ROLLBACKABLE_STATUSES.has(manifest.status)) {
    return emptyPlan(home, opId, sourceManifestPath, [
      makeRefusal(
        "manifest-not-rollbackable",
        `Operation ${opId} has status "${manifest.status}", which cannot be rolled back.`
      )
    ]);
  }

  const snapshotDir = join(home, "housekeeper", "snapshots", opId);
  if (!existsSync(snapshotDir)) {
    return emptyPlan(home, opId, sourceManifestPath, [
      makeRefusal("snapshot-tree-missing", `Snapshot tree is missing for ${opId}.`)
    ]);
  }

  const files = Array.isArray(manifest.files) ? manifest.files : [];
  for (const entry of files) {
    if (!entry || !entry.snapshotPath || !existsSync(entry.snapshotPath)) {
      return emptyPlan(home, opId, sourceManifestPath, [
        makeRefusal(
          "snapshot-tree-incomplete",
          `Snapshot file is missing for ${entry?.originalPath || opId}.`,
          entry?.originalPath || ""
        )
      ]);
    }
  }

  for (const entry of files) {
    const drift = await detectDrift(entry, manifest.status);
    if (drift) {
      return emptyPlan(home, opId, sourceManifestPath, [
        {
          ...makeRefusal(
            "drift-detected",
            `Current file state no longer matches operation ${opId}.`,
            entry.originalPath
          ),
          expectedHash: drift.expected,
          actualHash: drift.actual
        }
      ]);
    }
  }

  return {
    schemaVersion: "0.2",
    opId,
    home,
    sourceManifestPath,
    operations: files.map(makeOperation),
    refused: [],
    composedAt: new Date().toISOString()
  };
}

/**
 * validateRollbackPlan(plan, home) — re-read the operation manifest and verify
 * that both the post-apply file state and snapshot copies still match the plan.
 *
 * Throws PlanDriftError when the live original path no longer matches the
 * operation's post-apply state. Throws SnapshotIntegrityError when a snapshot
 * file is missing or no longer hashes to sha256Before.
 */
export async function validateRollbackPlan(plan, home) {
  if (Array.isArray(plan.refused) && plan.refused.length > 0) {
    return { ...plan, validatedAt: new Date().toISOString() };
  }

  const sourceManifestPath = join(home, "housekeeper", "operations", `${plan.opId}.json`);
  const manifest = await readOperationManifest(sourceManifestPath);
  const files = Array.isArray(manifest.files) ? manifest.files : [];

  for (const entry of files) {
    const drift = await detectDrift(entry, manifest.status);
    if (drift) {
      throw new PlanDriftError(plan.opId, entry.originalPath, drift.expected, drift.actual);
    }
  }

  for (const entry of files) {
    if (!entry.snapshotPath || !existsSync(entry.snapshotPath)) {
      throw new SnapshotIntegrityError(entry.snapshotPath || "", entry.sha256Before, null);
    }
    const actual = await hashFile(entry.snapshotPath);
    if (actual !== entry.sha256Before) {
      throw new SnapshotIntegrityError(entry.snapshotPath, entry.sha256Before, actual);
    }
  }

  return {
    ...plan,
    sourceManifestPath,
    operations: files.map(makeOperation),
    validatedAt: new Date().toISOString()
  };
}

/**
 * executeRollbackPlan(plan, home) — restore each snapshotted file and mark the
 * operation manifest rolled_back. Caller is expected to pass a validated plan.
 */
export async function executeRollbackPlan(plan, home) {
  const lockHandle = await acquireLock(home);

  try {
    const sourceManifestPath = join(home, "housekeeper", "operations", `${plan.opId}.json`);
    const manifest = await readOperationManifest(sourceManifestPath);
    const filesByPath = new Map((manifest.files || []).map((entry) => [entry.originalPath, entry]));

    for (const op of plan.operations) {
      const kind = op.rollbackOp?.kind || "";
      const rollback = ROLLBACK_REGISTRY[kind];
      if (!rollback) throw new RollbackNotImplementedError(kind);

      await rollback(op.rollbackOp.args || {});

      const actual = await hashFile(op.originalPath);
      if (actual !== op.sha256Before) {
        throw new SnapshotIntegrityError(op.snapshotPath, op.sha256Before, actual);
      }

      const entry = filesByPath.get(op.originalPath);
      if (entry) entry.rollbackVerified = true;
    }

    const fromStatus = manifest.status;
    manifest.status = "rolled_back";
    manifest.rolledBackAt = new Date().toISOString();
    await atomicWrite(sourceManifestPath, JSON.stringify(manifest, null, 2) + "\n");

    try {
      await appendRollback(home, {
        opId: manifest.id || plan.opId,
        fromStatus,
        toStatus: "rolled_back",
        filesRestoredCount: plan.operations.length
      });
    } catch (err) {
      process.stderr.write(`[rollback-plan] appendRollback failed: ${err && err.message}\n`);
    }

    return manifest;
  } finally {
    await releaseLock(lockHandle, "rolled_back");
  }
}

// ── Stream rollback (T-603, T-605) ────────────────────────────────────────────
//
// Per docs/design/v0.4-architect-memo.md §7.5: rolling back a stream rolls back
// all completed sub-manifests in REVERSE chunk order. The halted chunk (if any,
// status "applied" with partialApply: true) is rolled back FIRST, then
// completed chunks in descending chunkIndex order.

/**
 * _composeStreamRollbackPlan(home, streamId) — internal helper. Reads the
 * stream parent.json, locates all sub-manifests under operations/stream_<id>/,
 * and returns a composite stream rollback plan:
 *
 *   {
 *     isStream: true,
 *     streamId,
 *     subPlans: [...],   // per-chunk rollback plans, reverse-ordered
 *     refused: [],
 *     composedAt: ISO
 *   }
 */
async function _composeStreamRollbackPlan(home, streamId) {
  const streamDir = join(home, "housekeeper", "operations", streamId);
  const parentPath = join(streamDir, "parent.json");
  const composedAt = new Date().toISOString();

  const makeStreamRefusal = (reason, message) => ({
    isStream: true,
    streamId,
    subPlans: [],
    refused: [{ class: "RollbackPlanRefusal", reason, message, exitCode: 2 }],
    composedAt
  });

  if (!existsSync(parentPath)) {
    return makeStreamRefusal(
      "stream-manifest-not-found",
      `No stream parent manifest found for ${streamId}.`
    );
  }

  let parent;
  try {
    parent = JSON.parse(await readFile(parentPath, "utf8"));
  } catch {
    return makeStreamRefusal(
      "stream-manifest-malformed",
      `Stream parent manifest ${parentPath} is not valid JSON.`
    );
  }

  // Discover all chunk_NNN.json files in the stream directory.
  let dirEntries;
  try {
    dirEntries = await readdir(streamDir);
  } catch {
    return makeStreamRefusal(
      "stream-manifest-not-found",
      `Stream directory ${streamDir} could not be read.`
    );
  }

  // Parse chunk manifests and determine their chunkIndex from filename.
  const chunkManifests = [];
  for (const name of dirEntries) {
    if (!name.startsWith("chunk_") || !name.endsWith(".json")) continue;
    // The chunk opId stored in the manifest's "id" field is used by composeRollbackPlan.
    const chunkManifestPath = join(streamDir, name);
    let chunkMeta;
    try {
      chunkMeta = JSON.parse(await readFile(chunkManifestPath, "utf8"));
    } catch {
      continue; // skip unreadable chunk manifests
    }
    // Only include chunks that are rollbackable (applied or verified, not terminal).
    const ROLLBACKABLE = new Set(["applied", "verified", "snapshot_taken"]);
    if (!ROLLBACKABLE.has(chunkMeta.status)) continue;

    // Extract chunkIndex from the filename: chunk_000.json → 0.
    const indexStr = name.slice("chunk_".length, -".json".length);
    const chunkIndex = parseInt(indexStr, 10);
    if (!Number.isFinite(chunkIndex)) continue;

    chunkManifests.push({ chunkIndex, opId: chunkMeta.id, status: chunkMeta.status, partialApply: Boolean(chunkMeta.partialApply) });
  }

  if (chunkManifests.length === 0) {
    return makeStreamRefusal(
      "stream-no-rollbackable-chunks",
      `No rollbackable chunk manifests found for stream ${streamId}.`
    );
  }

  // Sort by chunkIndex DESCENDING — completed chunks in reverse order.
  // The halted chunk (partialApply: true) is first if present.
  chunkManifests.sort((a, b) => {
    // Halted chunk first (partialApply), then descending chunkIndex.
    if (a.partialApply && !b.partialApply) return -1;
    if (!a.partialApply && b.partialApply) return 1;
    return b.chunkIndex - a.chunkIndex;
  });

  // Compose per-chunk rollback plans using the standard single-op path.
  // Each chunk's opId is the key into the flat operations/ manifest directory
  // (snapshot.mjs writes to operations/<opId>.json).
  const subPlans = [];
  for (const { chunkIndex, opId } of chunkManifests) {
    // composeRollbackPlan (single-op form) for each chunk's opId.
    // The chunk manifests are flat op_*.json files in operations/ (not stream/).
    // We call the internal single-op path by passing the opId string.
    const subPlan = await composeRollbackPlan(home, opId);
    subPlans.push({ ...subPlan, chunkIndex });
  }

  return {
    isStream: true,
    streamId,
    subPlans,
    refused: [],
    composedAt,
    parent
  };
}

/**
 * abortRollbackOperation(opId, home) — cancel a pre-apply operation.
 *
 * Aborting is intentionally narrower than rollback: only pre-apply
 * statuses (`planned`, `snapshot_taken`) are eligible because no user
 * files have been mutated yet. CHANGELOG.md v0.2.0-beta.1 pins both
 * statuses as abortable; the audit hint for
 * `housekeeper.interrupted_operation` routes both to
 * `rollback <id> --abort`.
 */
export async function abortRollbackOperation(opId, home) {
  const lockHandle = await acquireLock(home);

  try {
    const sourceManifestPath = join(home, "housekeeper", "operations", `${opId}.json`);
    const manifest = await readOperationManifest(sourceManifestPath);
    if (manifest.status !== "snapshot_taken" && manifest.status !== "planned") {
      throw new AbortNotAllowedError(opId, manifest.status);
    }

    await rm(join(home, "housekeeper", "snapshots", opId), { recursive: true, force: true });
    manifest.status = "aborted";
    manifest.abortedAt = new Date().toISOString();
    await atomicWrite(sourceManifestPath, JSON.stringify(manifest, null, 2) + "\n");
    return manifest;
  } finally {
    await releaseLock(lockHandle, "process-exit");
  }
}
