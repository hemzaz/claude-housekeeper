// Rollback plan composition for Claude Housekeeper v0.2.
//
// T-801 scope: read operation manifests and produce a dry-run plan. This module
// does not restore files; validation and execution land in later Phase 8 tasks.

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { hashFile } from "./snapshot.mjs";

const ROLLBACKABLE_STATUSES = new Set(["applied", "verified", "snapshot_taken"]);

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
    manifest = JSON.parse(await readFile(sourceManifestPath, "utf8"));
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
