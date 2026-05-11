import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync
} from "node:fs";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  composeRollbackPlan,
  executeRollbackPlan,
  validateRollbackPlan,
  abortRollbackOperation,
  AbortNotAllowedError,
  LockHeldError,
  PlanDriftError,
  RollbackNotImplementedError,
  SnapshotIntegrityError
} from "../scripts/lib/rollback-plan.mjs";
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
    targetDir,
    opId,
    manifest,
    operationsDir: path.join(claudeHome, "housekeeper", "operations"),
    snapshotsDir: path.join(claudeHome, "housekeeper", "snapshots", opId)
  };
}

async function makeSnapshotTakenOperation() {
  const parent = await mkdtemp(path.join(tmpdir(), "ck-rollback-abort-"));
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
    consentSummary: "test abort"
  });

  return {
    claudeHome,
    targetDir,
    opId,
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

test("validateRollbackPlan happy path adds validatedAt", async () => {
  const { claudeHome, opId } = await makeAppliedOperation();
  const plan = await composeRollbackPlan(claudeHome, opId);

  const validated = await validateRollbackPlan(plan, claudeHome);

  assert.equal(validated.opId, opId);
  assert.equal(validated.refused.length, 0);
  assert.match(validated.validatedAt, /^\d{4}-\d{2}-\d{2}T/);
});

test("validateRollbackPlan re-detects drift after compose", async () => {
  const { claudeHome, opId, manifest } = await makeAppliedOperation();
  const plan = await composeRollbackPlan(claudeHome, opId);
  const restoredPath = manifest.files[0].originalPath;
  mkdirSync(path.dirname(restoredPath), { recursive: true });
  writeFileSync(restoredPath, "changed after compose\n");

  await assert.rejects(
    () => validateRollbackPlan(plan, claudeHome),
    (err) => {
      assert.ok(err instanceof PlanDriftError);
      assert.equal(err.targetPath, restoredPath);
      return true;
    }
  );
});

test("validateRollbackPlan rejects a missing snapshot file", async () => {
  const { claudeHome, opId, manifest } = await makeAppliedOperation();
  const plan = await composeRollbackPlan(claudeHome, opId);
  unlinkSync(manifest.files[0].snapshotPath);

  await assert.rejects(
    () => validateRollbackPlan(plan, claudeHome),
    (err) => {
      assert.ok(err instanceof SnapshotIntegrityError);
      assert.equal(err.snapshotPath, manifest.files[0].snapshotPath);
      return true;
    }
  );
});

test("validateRollbackPlan rejects a corrupted snapshot file", async () => {
  const { claudeHome, opId, manifest } = await makeAppliedOperation();
  const plan = await composeRollbackPlan(claudeHome, opId);
  writeFileSync(manifest.files[0].snapshotPath, "corrupted snapshot bytes\n");

  await assert.rejects(
    () => validateRollbackPlan(plan, claudeHome),
    (err) => {
      assert.ok(err instanceof SnapshotIntegrityError);
      assert.equal(err.snapshotPath, manifest.files[0].snapshotPath);
      assert.equal(err.expectedHash, manifest.files[0].sha256Before);
      return true;
    }
  );
});

test("executeRollbackPlan happy path restores files and marks manifest rolled_back", async () => {
  const { claudeHome, opId, manifest, targetDir } = await makeAppliedOperation();
  const plan = await validateRollbackPlan(await composeRollbackPlan(claudeHome, opId), claudeHome);

  const updated = await executeRollbackPlan(plan, claudeHome);

  assert.equal(updated.status, "rolled_back");
  assert.match(updated.rolledBackAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.ok(existsSync(targetDir));
  for (const entry of manifest.files) {
    assert.equal(readFileSync(entry.originalPath, "utf8"), readFileSync(entry.snapshotPath, "utf8"));
  }
  assert.equal(updated.files.every((entry) => entry.rollbackVerified === true), true);
  assert.equal(existsSync(path.join(claudeHome, "housekeeper", "lock")), false);
});

test("executeRollbackPlan refuses a fresh lockfile", async () => {
  const { claudeHome, opId } = await makeAppliedOperation();
  const plan = await validateRollbackPlan(await composeRollbackPlan(claudeHome, opId), claudeHome);
  const lockPath = path.join(claudeHome, "housekeeper", "lock");
  writeFileSync(lockPath, JSON.stringify({
    pid: process.pid,
    hostname: os.hostname(),
    opId: "op_20260511143022_a1b2c3d4",
    startedAt: new Date().toISOString(),
    stalenessAt: new Date(Date.now() + 30 * 60 * 1000).toISOString()
  }, null, 2) + "\n");

  await assert.rejects(
    () => executeRollbackPlan(plan, claudeHome),
    (err) => {
      assert.ok(err instanceof LockHeldError);
      assert.equal(err.lockManifest.pid, process.pid);
      return true;
    }
  );
});

test("executeRollbackPlan releases lockfile after rollback operation failure", async () => {
  const { claudeHome, opId } = await makeAppliedOperation();
  const plan = await validateRollbackPlan(await composeRollbackPlan(claudeHome, opId), claudeHome);
  const badPlan = {
    ...plan,
    operations: plan.operations.map((op, index) => index === 0
      ? { ...op, rollbackOp: { kind: "not-implemented", args: {} } }
      : op)
  };

  await assert.rejects(
    () => executeRollbackPlan(badPlan, claudeHome),
    (err) => err instanceof RollbackNotImplementedError
  );
  assert.equal(existsSync(path.join(claudeHome, "housekeeper", "lock")), false);
});

test("abortRollbackOperation aborts snapshot_taken operation and deletes snapshot directory", async () => {
  const { claudeHome, opId, operationsDir, snapshotsDir } = await makeSnapshotTakenOperation();

  const updated = await abortRollbackOperation(opId, claudeHome);

  assert.equal(updated.status, "aborted");
  assert.match(updated.abortedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(existsSync(snapshotsDir), false);
  assert.equal(existsSync(path.join(claudeHome, "housekeeper", "lock")), false);
  const manifest = JSON.parse(readFileSync(path.join(operationsDir, `${opId}.json`), "utf8"));
  assert.equal(manifest.status, "aborted");
  assert.equal(manifest.abortedAt, updated.abortedAt);
});

test("abortRollbackOperation refuses applied operation", async () => {
  const { claudeHome, opId, snapshotsDir } = await makeAppliedOperation();

  await assert.rejects(
    () => abortRollbackOperation(opId, claudeHome),
    (err) => {
      assert.ok(err instanceof AbortNotAllowedError);
      assert.equal(err.opId, opId);
      assert.equal(err.status, "verified");
      return true;
    }
  );
  assert.equal(existsSync(snapshotsDir), true);
});
