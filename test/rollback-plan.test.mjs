import assert from "node:assert/strict";
import {
  mkdirSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync
} from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { composeRollbackPlan } from "../scripts/lib/rollback-plan.mjs";
import { applyOperation, takeSnapshot, verify } from "../scripts/lib/snapshot.mjs";

async function makeAppliedOperation() {
  const parent = await mkdtemp(path.join(tmpdir(), "ck-rollback-plan-"));
  const claudeHome = path.join(parent, ".claude");
  const targetDir = path.join(claudeHome, "plugins", "cache", "market", "tool", "0.9.0");
  mkdirSync(targetDir, { recursive: true });
  const fileA = path.join(targetDir, "plugin.json");
  const fileB = path.join(targetDir, "data.txt");
  writeFileSync(fileA, "{\"name\":\"tool\"}\n");
  writeFileSync(fileB, "cache data\n");

  const { opId } = await takeSnapshot(parent, {
    targets: [fileA, fileB],
    command: "clean",
    mode: "confirm",
    consentSummary: "test clean"
  });

  await applyOperation(opId, parent, [
    { apply: async () => unlinkSync(fileA) },
    {
      apply: async () => {
        unlinkSync(fileB);
        rmSync(targetDir, { recursive: true, force: false });
      }
    }
  ]);
  const manifest = await verify(opId, parent);

  return {
    claudeHome,
    opId,
    manifest,
    operationsDir: path.join(claudeHome, "housekeeper", "operations"),
    snapshotsDir: path.join(claudeHome, "housekeeper", "snapshots", opId)
  };
}

test("composeRollbackPlan happy path: verified clean op produces file restore operations", async () => {
  const { claudeHome, opId, manifest } = await makeAppliedOperation();

  const plan = await composeRollbackPlan(claudeHome, opId);

  assert.equal(plan.schemaVersion, "0.2");
  assert.equal(plan.opId, opId);
  assert.equal(plan.home, claudeHome);
  assert.equal(plan.refused.length, 0);
  assert.equal(plan.operations.length, manifest.files.length);
  assert.equal(plan.sourceManifestPath, path.join(claudeHome, "housekeeper", "operations", `${opId}.json`));
  assert.match(plan.composedAt, /^\d{4}-\d{2}-\d{2}T/);

  for (let i = 0; i < manifest.files.length; i++) {
    const op = plan.operations[i];
    const entry = manifest.files[i];
    assert.equal(op.originalPath, entry.originalPath);
    assert.equal(op.snapshotPath, entry.snapshotPath);
    assert.equal(op.sha256Before, entry.sha256Before);
    assert.equal(op.sha256After, entry.sha256After);
    assert.equal(op.mutationKind, "dir-rmtree");
    assert.deepEqual(op.rollbackOp, {
      kind: "file-restore-from-snapshot",
      args: {
        sourcePath: entry.snapshotPath,
        targetPath: entry.originalPath,
        mode: entry.mode,
        isSymlink: entry.isSymlink,
        symlinkTarget: entry.symlinkTarget
      }
    });
  }
});

test("composeRollbackPlan returns manifest-not-found refusal", async () => {
  const parent = await mkdtemp(path.join(tmpdir(), "ck-rollback-missing-"));
  const claudeHome = path.join(parent, ".claude");
  mkdirSync(claudeHome, { recursive: true });

  const plan = await composeRollbackPlan(claudeHome, "op_20260511143022_a1b2c3d4");

  assert.equal(plan.operations.length, 0);
  assert.equal(plan.refused.length, 1);
  assert.equal(plan.refused[0].reason, "manifest-not-found");
});

test("composeRollbackPlan returns manifest-malformed refusal", async () => {
  const parent = await mkdtemp(path.join(tmpdir(), "ck-rollback-malformed-"));
  const claudeHome = path.join(parent, ".claude");
  const operationsDir = path.join(claudeHome, "housekeeper", "operations");
  mkdirSync(operationsDir, { recursive: true });
  const opId = "op_20260511143022_a1b2c3d4";
  writeFileSync(path.join(operationsDir, `${opId}.json`), "{not json\n");

  const plan = await composeRollbackPlan(claudeHome, opId);

  assert.equal(plan.operations.length, 0);
  assert.equal(plan.refused.length, 1);
  assert.equal(plan.refused[0].reason, "manifest-malformed");
});

test("composeRollbackPlan refuses terminal rolled_back manifest", async () => {
  const { claudeHome, opId, operationsDir } = await makeAppliedOperation();
  const manifestPath = path.join(operationsDir, `${opId}.json`);
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  manifest.status = "rolled_back";
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");

  const plan = await composeRollbackPlan(claudeHome, opId);

  assert.equal(plan.operations.length, 0);
  assert.equal(plan.refused.length, 1);
  assert.equal(plan.refused[0].reason, "manifest-not-rollbackable");
});

test("composeRollbackPlan refuses missing snapshot tree", async () => {
  const { claudeHome, opId, snapshotsDir } = await makeAppliedOperation();
  rmSync(snapshotsDir, { recursive: true, force: true });

  const plan = await composeRollbackPlan(claudeHome, opId);

  assert.equal(plan.operations.length, 0);
  assert.equal(plan.refused.length, 1);
  assert.equal(plan.refused[0].reason, "snapshot-tree-missing");
});

test("composeRollbackPlan refuses incomplete snapshot tree", async () => {
  const { claudeHome, opId, manifest } = await makeAppliedOperation();
  unlinkSync(manifest.files[0].snapshotPath);

  const plan = await composeRollbackPlan(claudeHome, opId);

  assert.equal(plan.operations.length, 0);
  assert.equal(plan.refused.length, 1);
  assert.equal(plan.refused[0].reason, "snapshot-tree-incomplete");
});

test("composeRollbackPlan refuses drift after verified deletion", async () => {
  const { claudeHome, opId, manifest } = await makeAppliedOperation();
  const restoredPath = manifest.files[0].originalPath;
  mkdirSync(path.dirname(restoredPath), { recursive: true });
  writeFileSync(restoredPath, "changed after verify\n");

  const plan = await composeRollbackPlan(claudeHome, opId);

  assert.equal(plan.operations.length, 0);
  assert.equal(plan.refused.length, 1);
  assert.equal(plan.refused[0].reason, "drift-detected");
  assert.equal(plan.refused[0].targetPath, restoredPath);
});
