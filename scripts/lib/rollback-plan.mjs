// Rollback plan composition for Claude Housekeeper v0.2.
//
// T-801..T-803 scope: read operation manifests, validate rollback freshness,
// and execute the restore while preserving the Housekeeper lock invariant.

import { existsSync } from "node:fs";
import { copyFile, mkdir, readFile, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { atomicWrite, hashFile } from "./snapshot.mjs";
import { acquireLock, releaseLock, LockHeldError } from "./lock.mjs";

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
 * composeRollbackPlan(home, opId) — read a Housekeeper operation manifest and
 * return a dry-run rollback plan.
 *
 * `home` is the Claude home directory (`~/.claude`), matching the CLI and
 * audit module convention. Manifests live at:
 *   <home>/housekeeper/operations/<opId>.json
 */
export async function composeRollbackPlan(home, opId) {
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

    manifest.status = "rolled_back";
    manifest.rolledBackAt = new Date().toISOString();
    await atomicWrite(sourceManifestPath, JSON.stringify(manifest, null, 2) + "\n");

    return manifest;
  } finally {
    await releaseLock(lockHandle, "rolled_back");
  }
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
