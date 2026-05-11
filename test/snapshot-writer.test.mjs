import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { unlinkSync } from "node:fs";
import { mkdir, writeFile, readFile, access, readdir } from "node:fs/promises";
import { join } from "node:path";
import os from "node:os";
import {
  takeSnapshot,
  generateOpId,
  SnapshotRefusedError,
  SnapshotBudgetError,
  MAX_OPERATION_FILES,
  MAX_OPERATION_BYTES,
  gcSnapshots,
  applyOperation,
  verify,
  OperationStateError,
  SnapshotDriftError
} from "../scripts/lib/snapshot.mjs";

// ── helpers ──────────────────────────────────────────────────────────────────

async function makeSyntheticHome() {
  const dir = join(os.tmpdir(), `housekeeper-test-${generateOpId()}`);
  await mkdir(dir, { recursive: true });
  return dir;
}

async function fileExists(p) {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

function sha256Hex(content) {
  const buf = typeof content === "string" ? Buffer.from(content, "utf8") : content;
  return createHash("sha256").update(buf).digest("hex");
}

// ── generateOpId ─────────────────────────────────────────────────────────────

test("generateOpId returns string matching op_<14digits>_<8hex> format", () => {
  const id = generateOpId();
  assert.match(id, /^op_\d{14}_[0-9a-f]{8}$/);
  // op_(3) + 14 digits + _(1) + 8 hex = 26 chars
  // (docs/rollback-contracts.md §1 example: op_20260511143022_a1b2c3d4 = 26)
  assert.equal(id.length, 26);
});

test("generateOpId produces unique ids on successive calls", () => {
  const ids = new Set(Array.from({ length: 20 }, () => generateOpId()));
  assert.ok(ids.size > 1);
});

// ── takeSnapshot — happy path ─────────────────────────────────────────────────

test("takeSnapshot returns opId matching op id regex", async () => {
  const home = await makeSyntheticHome();
  await writeFile(join(home, "a.json"), '{"x":1}\n');
  const { opId } = await takeSnapshot(home, {
    targets: [join(home, "a.json")]
  });
  assert.match(opId, /^op_\d{14}_[0-9a-f]{8}$/);
});

test("takeSnapshot creates snapshot copy with original content", async () => {
  const home = await makeSyntheticHome();
  const content = "hello snapshot\n";
  await writeFile(join(home, "file1.txt"), content);

  const { opId } = await takeSnapshot(home, {
    targets: [join(home, "file1.txt")]
  });

  const snapshotFile = join(
    home, ".claude", "housekeeper", "snapshots", opId, "files", "0000_file1.txt"
  );
  assert.ok(await fileExists(snapshotFile), "snapshot file should exist");
  const read = await readFile(snapshotFile, "utf8");
  assert.equal(read, content);
});

test("takeSnapshot creates snapshot copies for two files", async () => {
  const home = await makeSyntheticHome();
  await writeFile(join(home, "alpha.txt"), "alpha\n");
  await writeFile(join(home, "beta.txt"), "beta\n");

  const { opId } = await takeSnapshot(home, {
    targets: [join(home, "alpha.txt"), join(home, "beta.txt")]
  });

  const filesDir = join(home, ".claude", "housekeeper", "snapshots", opId, "files");
  assert.ok(await fileExists(join(filesDir, "0000_alpha.txt")), "first snapshot file");
  assert.ok(await fileExists(join(filesDir, "0001_beta.txt")), "second snapshot file");
});

test("takeSnapshot creates operation manifest at correct path", async () => {
  const home = await makeSyntheticHome();
  await writeFile(join(home, "s.json"), "{}");

  const { opId } = await takeSnapshot(home, {
    targets: [join(home, "s.json")]
  });

  const manifestPath = join(
    home, ".claude", "housekeeper", "operations", `${opId}.json`
  );
  assert.ok(await fileExists(manifestPath), "operation manifest should exist");
});

test("takeSnapshot manifest is parseable JSON", async () => {
  const home = await makeSyntheticHome();
  await writeFile(join(home, "f.txt"), "data");

  const { opId } = await takeSnapshot(home, {
    targets: [join(home, "f.txt")]
  });

  const manifestPath = join(
    home, ".claude", "housekeeper", "operations", `${opId}.json`
  );
  const raw = await readFile(manifestPath, "utf8");
  const parsed = JSON.parse(raw);
  assert.ok(parsed, "manifest should parse");
});

test("takeSnapshot manifest has status=snapshot_taken", async () => {
  const home = await makeSyntheticHome();
  await writeFile(join(home, "g.txt"), "content");

  const { manifest } = await takeSnapshot(home, {
    targets: [join(home, "g.txt")]
  });

  assert.equal(manifest.status, "snapshot_taken");
});

test("takeSnapshot manifest has schemaVersion=0.2", async () => {
  const home = await makeSyntheticHome();
  await writeFile(join(home, "h.txt"), "v");

  const { manifest } = await takeSnapshot(home, {
    targets: [join(home, "h.txt")]
  });

  assert.equal(manifest.schemaVersion, "0.2");
});

test("takeSnapshot manifest files[].sha256Before matches actual file hash", async () => {
  const home = await makeSyntheticHome();
  const content = "precise content for hashing\n";
  await writeFile(join(home, "precise.txt"), content);

  const { manifest } = await takeSnapshot(home, {
    targets: [join(home, "precise.txt")]
  });

  const expected = sha256Hex(Buffer.from(content, "utf8"));
  assert.equal(manifest.files[0].sha256Before, expected);
});

test("takeSnapshot manifest files[].sha256Before matches for two files", async () => {
  const home = await makeSyntheticHome();
  const c1 = "file one content\n";
  const c2 = "file two content\n";
  await writeFile(join(home, "one.txt"), c1);
  await writeFile(join(home, "two.txt"), c2);

  const { manifest } = await takeSnapshot(home, {
    targets: [join(home, "one.txt"), join(home, "two.txt")]
  });

  assert.equal(manifest.files[0].sha256Before, sha256Hex(Buffer.from(c1, "utf8")));
  assert.equal(manifest.files[1].sha256Before, sha256Hex(Buffer.from(c2, "utf8")));
});

test("takeSnapshot manifest files[].sha256After is null (not yet applied)", async () => {
  const home = await makeSyntheticHome();
  await writeFile(join(home, "x.txt"), "x");

  const { manifest } = await takeSnapshot(home, {
    targets: [join(home, "x.txt")]
  });

  assert.equal(manifest.files[0].sha256After, null);
});

test("takeSnapshot manifest home field matches provided home", async () => {
  const home = await makeSyntheticHome();
  await writeFile(join(home, "y.txt"), "y");

  const { manifest } = await takeSnapshot(home, {
    targets: [join(home, "y.txt")]
  });

  assert.equal(manifest.home, home);
});

test("takeSnapshot manifest id matches returned opId", async () => {
  const home = await makeSyntheticHome();
  await writeFile(join(home, "z.txt"), "z");

  const { opId, manifest } = await takeSnapshot(home, {
    targets: [join(home, "z.txt")]
  });

  assert.equal(manifest.id, opId);
});

test("takeSnapshot manifest file on disk matches returned manifest object", async () => {
  const home = await makeSyntheticHome();
  await writeFile(join(home, "disk.txt"), "disk content");

  const { opId, manifest } = await takeSnapshot(home, {
    targets: [join(home, "disk.txt")]
  });

  const manifestPath = join(
    home, ".claude", "housekeeper", "operations", `${opId}.json`
  );
  const parsed = JSON.parse(await readFile(manifestPath, "utf8"));
  assert.deepEqual(parsed, manifest);
});

// ── takeSnapshot — no targets ─────────────────────────────────────────────────

test("takeSnapshot with empty targets produces manifest with empty files array", async () => {
  const home = await makeSyntheticHome();

  const { manifest } = await takeSnapshot(home, { targets: [] });

  assert.equal(manifest.status, "snapshot_taken");
  assert.deepEqual(manifest.files, []);
});

// ── takeSnapshot — negative: missing target ───────────────────────────────────

test("takeSnapshot throws when target file does not exist", async () => {
  const home = await makeSyntheticHome();
  const missing = join(home, "does-not-exist.txt");

  await assert.rejects(
    () => takeSnapshot(home, { targets: [missing] }),
    /ENOENT|no such file/i
  );
});

test("takeSnapshot does NOT write manifest when a target file is missing", async () => {
  const home = await makeSyntheticHome();
  const missing = join(home, "ghost.txt");

  try {
    await takeSnapshot(home, { targets: [missing] });
  } catch {
    // expected
  }

  const operationsDir = join(home, ".claude", "housekeeper", "operations");
  const exists = await fileExists(operationsDir);
  if (exists) {
    const entries = await readdir(operationsDir);
    assert.equal(entries.length, 0, "no manifest should be written on failure");
  }
  // If operationsDir does not exist at all, that is also correct.
});

// ── takeSnapshot — idempotency ────────────────────────────────────────────────

test("takeSnapshot twice produces two different op ids", async () => {
  const home = await makeSyntheticHome();
  await writeFile(join(home, "idem.txt"), "idempotency test");

  const { opId: id1 } = await takeSnapshot(home, {
    targets: [join(home, "idem.txt")]
  });
  const { opId: id2 } = await takeSnapshot(home, {
    targets: [join(home, "idem.txt")]
  });

  assert.notEqual(id1, id2);
});

test("takeSnapshot twice: both snapshot dirs exist", async () => {
  const home = await makeSyntheticHome();
  await writeFile(join(home, "twice.txt"), "twice");

  const { opId: id1 } = await takeSnapshot(home, {
    targets: [join(home, "twice.txt")]
  });
  const { opId: id2 } = await takeSnapshot(home, {
    targets: [join(home, "twice.txt")]
  });

  const snapshotBase = join(home, ".claude", "housekeeper", "snapshots");
  assert.ok(await fileExists(join(snapshotBase, id1)), "first snapshot dir");
  assert.ok(await fileExists(join(snapshotBase, id2)), "second snapshot dir");
});

test("takeSnapshot twice: both operation manifests exist", async () => {
  const home = await makeSyntheticHome();
  await writeFile(join(home, "ops.txt"), "ops");

  const { opId: id1 } = await takeSnapshot(home, {
    targets: [join(home, "ops.txt")]
  });
  const { opId: id2 } = await takeSnapshot(home, {
    targets: [join(home, "ops.txt")]
  });

  const opsDir = join(home, ".claude", "housekeeper", "operations");
  assert.ok(await fileExists(join(opsDir, `${id1}.json`)), "first manifest");
  assert.ok(await fileExists(join(opsDir, `${id2}.json`)), "second manifest");
});

// ── T-602 — protected-path guard ──────────────────────────────────────────────

test("T-602 negative: takeSnapshot throws SnapshotRefusedError when target matches doNotTouch rule", async () => {
  const home = await makeSyntheticHome();
  await writeFile(join(home, "protected.txt"), "sensitive");
  // Write a doNotTouch rule covering the target file.
  await mkdir(join(home, "housekeeper"), { recursive: true });
  await writeFile(
    join(home, "housekeeper", "config.json"),
    JSON.stringify({
      doNotTouch: [{ path: join(home, "protected.txt"), reason: "test protection rule" }]
    })
  );

  const err = await takeSnapshot(home, {
    targets: [join(home, "protected.txt")]
  }).then(() => null, (e) => e);

  assert.ok(err instanceof SnapshotRefusedError, "should throw SnapshotRefusedError");
  assert.equal(err.reason, "protected-path");
  assert.ok(Array.isArray(err.blockedByProtection), "blockedByProtection should be an array");
  assert.equal(err.blockedByProtection.length, 1);
  assert.equal(err.blockedByProtection[0].path, join(home, "protected.txt"));
});

test("T-602 negative: no snapshot files and no operation manifest written on protected-path refusal", async () => {
  const home = await makeSyntheticHome();
  await writeFile(join(home, "guarded.txt"), "guarded content");
  await mkdir(join(home, "housekeeper"), { recursive: true });
  await writeFile(
    join(home, "housekeeper", "config.json"),
    JSON.stringify({
      doNotTouch: [{ path: join(home, "guarded.txt"), reason: "no-write" }]
    })
  );

  try {
    await takeSnapshot(home, { targets: [join(home, "guarded.txt")] });
  } catch {
    // expected
  }

  // No snapshot directory should exist.
  const snapshotsDir = join(home, ".claude", "housekeeper", "snapshots");
  assert.equal(await fileExists(snapshotsDir), false, "snapshots dir must not exist");
  // No operation manifest should exist.
  const operationsDir = join(home, ".claude", "housekeeper", "operations");
  assert.equal(await fileExists(operationsDir), false, "operations dir must not exist");
});

test("T-602 positive: takeSnapshot succeeds when home has no protection rules", async () => {
  const home = await makeSyntheticHome();
  await writeFile(join(home, "safe.txt"), "safe content");
  // No config file — loadConfig returns empty rules.

  const { manifest } = await takeSnapshot(home, {
    targets: [join(home, "safe.txt")]
  });

  assert.equal(manifest.status, "snapshot_taken");
  assert.equal(manifest.files.length, 1);
});

// ── T-603 — budget enforcement ────────────────────────────────────────────────

test("T-603 file-count: takeSnapshot throws SnapshotBudgetError when 51 files are targeted", async () => {
  const home = await makeSyntheticHome();
  const targets = [];
  for (let i = 0; i < MAX_OPERATION_FILES + 1; i++) {
    const p = join(home, `file${i}.txt`);
    await writeFile(p, "x");
    targets.push(p);
  }

  const err = await takeSnapshot(home, { targets }).then(() => null, (e) => e);

  assert.ok(err instanceof SnapshotBudgetError, "should throw SnapshotBudgetError");
  assert.equal(err.reason, "budget-exceeded");
  assert.equal(err.actual.files, MAX_OPERATION_FILES + 1);
  assert.equal(err.limit.files, MAX_OPERATION_FILES);
});

test("T-603 byte-budget: takeSnapshot throws SnapshotBudgetError when total bytes exceed 10 MiB", async () => {
  const home = await makeSyntheticHome();
  // Two files each just over 5 MiB → total > 10 MiB.
  const chunk = Buffer.alloc(6 * 1024 * 1024, 0x61); // 6 MiB of 'a'
  const f1 = join(home, "big1.bin");
  const f2 = join(home, "big2.bin");
  await writeFile(f1, chunk);
  await writeFile(f2, chunk);

  const err = await takeSnapshot(home, { targets: [f1, f2] }).then(() => null, (e) => e);

  assert.ok(err instanceof SnapshotBudgetError, "should throw SnapshotBudgetError");
  assert.equal(err.reason, "budget-exceeded");
  assert.ok(err.actual.bytes > MAX_OPERATION_BYTES, "actual.bytes should exceed limit");
  assert.equal(err.limit.bytes, MAX_OPERATION_BYTES);
});

test("T-603 boundary: takeSnapshot succeeds with exactly 50 files totalling under 10 MiB", async () => {
  const home = await makeSyntheticHome();
  // 50 files × 100 KiB = 5 MiB total — within both limits.
  const chunk = Buffer.alloc(100 * 1024, 0x62); // 100 KiB of 'b'
  const targets = [];
  for (let i = 0; i < MAX_OPERATION_FILES; i++) {
    const p = join(home, `boundary${i}.bin`);
    await writeFile(p, chunk);
    targets.push(p);
  }

  const { manifest } = await takeSnapshot(home, { targets });

  assert.equal(manifest.status, "snapshot_taken");
  assert.equal(manifest.files.length, MAX_OPERATION_FILES);
});

test("T-603 refusal does not leak: no snapshot or manifest files on budget refusal", async () => {
  const home = await makeSyntheticHome();
  // Trigger file-count refusal (51 files).
  const targets = [];
  for (let i = 0; i < MAX_OPERATION_FILES + 1; i++) {
    const p = join(home, `leak${i}.txt`);
    await writeFile(p, "y");
    targets.push(p);
  }

  try {
    await takeSnapshot(home, { targets });
  } catch {
    // expected
  }

  const snapshotsDir = join(home, ".claude", "housekeeper", "snapshots");
  assert.equal(await fileExists(snapshotsDir), false, "snapshots dir must not exist on budget refusal");
  const operationsDir = join(home, ".claude", "housekeeper", "operations");
  assert.equal(await fileExists(operationsDir), false, "operations dir must not exist on budget refusal");
});

// ── T-604 — gcSnapshots ───────────────────────────────────────────────────────

/**
 * Write a fake operation manifest directly (without takeSnapshot) so we can
 * create many verified manifests quickly without actual file targets.
 */
async function writeFakeManifest(home, id, status) {
  const { mkdir: mkdirFs, writeFile: writeFileFs } = await import("node:fs/promises");
  const operationsDir = join(home, ".claude", "housekeeper", "operations");
  await mkdirFs(operationsDir, { recursive: true });
  const manifest = {
    schemaVersion: "0.2",
    id,
    home,
    status,
    createdAt: new Date().toISOString(),
    capturedAt: new Date().toISOString(),
    appliedAt: null,
    verifiedAt: null,
    rolledBackAt: null,
    abortedAt: null,
    housekeeperVersion: "0.2.0",
    command: "clean",
    mode: "confirm",
    consentSummary: "test",
    files: [],
    partialApply: false,
    blockedByProtection: []
  };
  await writeFileFs(join(operationsDir, `${id}.json`), JSON.stringify(manifest, null, 2) + "\n");
}

/**
 * Create a fake snapshot directory for an op id so GC has something to delete.
 */
async function createFakeSnapshotDir(home, id) {
  const { mkdir: mkdirFs } = await import("node:fs/promises");
  const snapshotDir = join(home, ".claude", "housekeeper", "snapshots", id);
  await mkdirFs(snapshotDir, { recursive: true });
}

/**
 * Generate a chronological op id with a given index (so sort order is deterministic).
 * Uses a fixed base timestamp with the index padded into the seconds field.
 */
function makeChronologicalOpId(index) {
  const sec = String(index).padStart(2, "0");
  const hex = String(index).padStart(8, "0");
  // e.g. op_20260101000000_00000000, op_20260101000001_00000001, ...
  return `op_202601010000${sec}_${hex}`;
}

test("T-604 gcSnapshots removes the 2 oldest of 12 verified manifests", async () => {
  const home = await makeSyntheticHome();

  // Create 12 verified manifests with chronological ids.
  for (let i = 0; i < 12; i++) {
    const id = makeChronologicalOpId(i);
    await writeFakeManifest(home, id, "verified");
    await createFakeSnapshotDir(home, id);
  }

  const result = await gcSnapshots(home);

  assert.equal(result.removed.length, 2, "should remove 2 oldest");
  assert.equal(result.kept.length, 10, "should keep 10 most recent");

  // The removed ones should be the two with the smallest (oldest) ids.
  const removedSorted = [...result.removed].sort();
  assert.equal(removedSorted[0], makeChronologicalOpId(0));
  assert.equal(removedSorted[1], makeChronologicalOpId(1));
});

test("T-604 gcSnapshots deletes snapshot directory for removed ops", async () => {
  const home = await makeSyntheticHome();

  for (let i = 0; i < 12; i++) {
    const id = makeChronologicalOpId(i);
    await writeFakeManifest(home, id, "verified");
    await createFakeSnapshotDir(home, id);
  }

  await gcSnapshots(home);

  // The 2 oldest snapshot dirs should be gone.
  const snapshotBase = join(home, ".claude", "housekeeper", "snapshots");
  assert.equal(
    await fileExists(join(snapshotBase, makeChronologicalOpId(0))),
    false,
    "oldest snapshot dir should be deleted"
  );
  assert.equal(
    await fileExists(join(snapshotBase, makeChronologicalOpId(1))),
    false,
    "second-oldest snapshot dir should be deleted"
  );
  // The 10th (newest) should still exist.
  assert.ok(
    await fileExists(join(snapshotBase, makeChronologicalOpId(11))),
    "newest snapshot dir should remain"
  );
});

test("T-604 gcSnapshots preserves non-terminal manifests (planned)", async () => {
  const home = await makeSyntheticHome();

  // 12 verified + 1 planned — the planned one must survive regardless.
  for (let i = 0; i < 12; i++) {
    const id = makeChronologicalOpId(i);
    await writeFakeManifest(home, id, "verified");
    await createFakeSnapshotDir(home, id);
  }
  const plannedId = "op_20260201000000_ffffffff";
  await writeFakeManifest(home, plannedId, "planned");

  const result = await gcSnapshots(home);

  assert.ok(result.kept.includes(plannedId), "planned op must be in kept");
  assert.ok(!result.removed.includes(plannedId), "planned op must NOT be removed");

  // Its manifest file should still exist on disk.
  const operationsDir = join(home, ".claude", "housekeeper", "operations");
  assert.ok(
    await fileExists(join(operationsDir, `${plannedId}.json`)),
    "planned manifest file must not be deleted"
  );
});

test("T-604 gcSnapshots with fewer than 10 terminal ops removes nothing", async () => {
  const home = await makeSyntheticHome();

  // Only 5 verified manifests — all should be kept.
  for (let i = 0; i < 5; i++) {
    const id = makeChronologicalOpId(i);
    await writeFakeManifest(home, id, "verified");
  }

  const result = await gcSnapshots(home);

  assert.equal(result.removed.length, 0, "nothing should be removed when <= 10 terminal ops");
  assert.equal(result.kept.length, 5);
});

test("T-604 gcSnapshots on empty operations dir returns empty arrays", async () => {
  const home = await makeSyntheticHome();
  // Don't create any operations dir.

  const result = await gcSnapshots(home);

  assert.deepEqual(result.removed, []);
  assert.deepEqual(result.kept, []);
});

// ── T-702 — applyOperation ────────────────────────────────────────────────────

test("T-702 applyOperation happy path: status transitions to applied", async () => {
  const home = await makeSyntheticHome();
  const content = "original content\n";
  await writeFile(join(home, "target.txt"), content);

  const { opId } = await takeSnapshot(home, {
    targets: [join(home, "target.txt")]
  });

  const newContent = "mutated content\n";
  const ops = [
    { apply: async (p) => writeFile(p, newContent) }
  ];

  const result = await applyOperation(opId, home, ops);

  assert.equal(result.status, "applied");
  assert.ok(result.appliedAt !== null, "appliedAt should be set");
});

test("T-702 applyOperation happy path: sha256After matches post-apply file hash", async () => {
  const home = await makeSyntheticHome();
  const content = "original\n";
  await writeFile(join(home, "file.txt"), content);

  const { opId } = await takeSnapshot(home, {
    targets: [join(home, "file.txt")]
  });

  const newContent = "after mutation\n";
  const ops = [
    { apply: async (p) => writeFile(p, newContent) }
  ];

  const result = await applyOperation(opId, home, ops);

  const expectedHash = sha256Hex(Buffer.from(newContent, "utf8"));
  assert.equal(result.files[0].sha256After, expectedHash);
});

test("T-702 applyOperation drift detection: throws SnapshotDriftError when file mutated externally", async () => {
  const home = await makeSyntheticHome();
  await writeFile(join(home, "drifted.txt"), "original\n");

  const { opId } = await takeSnapshot(home, {
    targets: [join(home, "drifted.txt")]
  });

  // Mutate the file externally AFTER snapshot but BEFORE apply.
  await writeFile(join(home, "drifted.txt"), "changed externally\n");

  const ops = [
    { apply: async (p) => writeFile(p, "should not reach\n") }
  ];

  const err = await applyOperation(opId, home, ops).then(() => null, (e) => e);

  assert.ok(err instanceof SnapshotDriftError, "should throw SnapshotDriftError");
  assert.equal(err.code, "SNAPSHOT_DRIFT");
  assert.ok(err.filePath.endsWith("drifted.txt"));
});

test("T-702 drift detection: no mutation proceeds after SnapshotDriftError", async () => {
  const home = await makeSyntheticHome();
  const original = "untouched original\n";
  await writeFile(join(home, "safe.txt"), original);

  const { opId } = await takeSnapshot(home, {
    targets: [join(home, "safe.txt")]
  });

  await writeFile(join(home, "safe.txt"), "drifted\n");

  let applyCalled = false;
  const ops = [
    {
      apply: async () => {
        applyCalled = true;
        await writeFile(join(home, "safe.txt"), "mutated by apply\n");
      }
    }
  ];

  try {
    await applyOperation(opId, home, ops);
  } catch {
    // expected SnapshotDriftError
  }

  assert.equal(applyCalled, false, "apply function must not be called after drift detection");
});

test("T-702 partial apply: ops[1].apply throws → partialApply:true, file[1].applied:false", async () => {
  const home = await makeSyntheticHome();
  await writeFile(join(home, "f0.txt"), "f0\n");
  await writeFile(join(home, "f1.txt"), "f1\n");
  await writeFile(join(home, "f2.txt"), "f2\n");

  const { opId } = await takeSnapshot(home, {
    targets: [
      join(home, "f0.txt"),
      join(home, "f1.txt"),
      join(home, "f2.txt")
    ]
  });

  const ops = [
    { apply: async (p) => writeFile(p, "f0-mutated\n") },
    {
      apply: async () => {
        throw new Error("simulated apply failure");
      }
    },
    { apply: async (p) => writeFile(p, "f2-mutated\n") }
  ];

  const result = await applyOperation(opId, home, ops);

  assert.equal(result.partialApply, true, "partialApply should be true");
  assert.equal(result.files[1].applied, false, "file[1].applied should be false");
  assert.equal(result.status, "applied", "status should still be applied");
});

test("T-702 partial apply: file[0] and file[2] have sha256After set on success", async () => {
  const home = await makeSyntheticHome();
  await writeFile(join(home, "g0.txt"), "g0\n");
  await writeFile(join(home, "g1.txt"), "g1\n");
  await writeFile(join(home, "g2.txt"), "g2\n");

  const { opId } = await takeSnapshot(home, {
    targets: [
      join(home, "g0.txt"),
      join(home, "g1.txt"),
      join(home, "g2.txt")
    ]
  });

  const ops = [
    { apply: async (p) => writeFile(p, "g0-mutated\n") },
    { apply: async () => { throw new Error("fail"); } },
    { apply: async (p) => writeFile(p, "g2-mutated\n") }
  ];

  const result = await applyOperation(opId, home, ops);

  assert.ok(result.files[0].sha256After !== null, "file[0] sha256After should be set");
  assert.ok(result.files[2].sha256After !== null, "file[2] sha256After should be set");
  assert.equal(result.files[1].sha256After, null, "file[1] sha256After should remain null");
});

test("T-702 applyOperation throws OperationStateError when status is not snapshot_taken", async () => {
  const home = await makeSyntheticHome();
  await writeFile(join(home, "h.txt"), "h\n");

  const { opId } = await takeSnapshot(home, { targets: [join(home, "h.txt")] });

  // Apply once to transition to "applied".
  await applyOperation(opId, home, [{ apply: async (p) => writeFile(p, "h-mutated\n") }]);

  // Attempting to apply again should throw OperationStateError.
  const err = await applyOperation(opId, home, [
    { apply: async (p) => writeFile(p, "h-again\n") }
  ]).then(() => null, (e) => e);

  assert.ok(err instanceof OperationStateError, "should throw OperationStateError");
  assert.equal(err.code, "OPERATION_STATE_ERROR");
  assert.equal(err.expected, "snapshot_taken");
  assert.equal(err.actual, "applied");
});

// ── T-703 — verify ────────────────────────────────────────────────────────────

test("T-703 verify transitions status to verified when all sha256 match", async () => {
  const home = await makeSyntheticHome();
  const content = "verify me\n";
  await writeFile(join(home, "v.txt"), content);

  const { opId } = await takeSnapshot(home, { targets: [join(home, "v.txt")] });

  const mutated = "verify me mutated\n";
  await applyOperation(opId, home, [{ apply: async (p) => writeFile(p, mutated) }]);

  const result = await verify(opId, home);

  assert.equal(result.status, "verified");
  assert.ok(result.verifiedAt !== null, "verifiedAt should be set");
});

test("T-703 verify sha256 round-trip: sha256After matches content written by apply", async () => {
  const home = await makeSyntheticHome();
  await writeFile(join(home, "rr.txt"), "round-trip original\n");

  const { opId } = await takeSnapshot(home, { targets: [join(home, "rr.txt")] });

  const mutated = "round-trip mutated\n";
  await applyOperation(opId, home, [{ apply: async (p) => writeFile(p, mutated) }]);

  const result = await verify(opId, home);

  const expectedHash = sha256Hex(Buffer.from(mutated, "utf8"));
  assert.equal(result.files[0].sha256After, expectedHash);
  assert.equal(result.status, "verified");
});

test("T-703 verify leaves status applied and sets verifyFailure:true on corrupted file", async () => {
  const home = await makeSyntheticHome();
  await writeFile(join(home, "corrupt.txt"), "original\n");

  const { opId } = await takeSnapshot(home, { targets: [join(home, "corrupt.txt")] });

  const mutated = "mutated by apply\n";
  await applyOperation(opId, home, [{ apply: async (p) => writeFile(p, mutated) }]);

  // Corrupt the file after apply but before verify.
  await writeFile(join(home, "corrupt.txt"), "corrupted after apply\n");

  const result = await verify(opId, home);

  assert.equal(result.status, "applied", "status should remain applied on verify failure");
  assert.equal(result.files[0].verifyFailure, true, "verifyFailure should be true on mismatch");
});

test("T-703 verify throws OperationStateError when status is not applied", async () => {
  const home = await makeSyntheticHome();
  await writeFile(join(home, "pre-verify.txt"), "x\n");

  const { opId } = await takeSnapshot(home, { targets: [join(home, "pre-verify.txt")] });

  // Status is snapshot_taken, not applied — verify should refuse.
  const err = await verify(opId, home).then(() => null, (e) => e);

  assert.ok(err instanceof OperationStateError, "should throw OperationStateError");
  assert.equal(err.expected, "applied");
  assert.equal(err.actual, "snapshot_taken");
});

// ── Deletion-aware — Patch A + Patch B ───────────────────────────────────────

test("Patch A — successful deletion does not set partialApply", async () => {
  const home = await makeSyntheticHome();
  const filePath = join(home, "del-a.txt");
  await writeFile(filePath, "to be deleted\n");

  const { opId } = await takeSnapshot(home, { targets: [filePath] });

  const manifest = await applyOperation(opId, home, [
    { apply: (p) => { unlinkSync(p); } }
  ]);

  assert.ok(!manifest.partialApply, "partialApply should be false/undefined for successful deletion");
  assert.equal(manifest.files[0].applied, true, "applied should be true");
  assert.equal(manifest.files[0].sha256After, null, "sha256After should be null for deletion");
  assert.equal(manifest.status, "applied");
});

test("Patch A — failed deletion (apply throws) still sets partialApply", async () => {
  const home = await makeSyntheticHome();
  const filePath = join(home, "del-b.txt");
  await writeFile(filePath, "will not be deleted\n");

  const { opId } = await takeSnapshot(home, { targets: [filePath] });

  const manifest = await applyOperation(opId, home, [
    { apply: () => { throw new Error("simulated apply failure"); } }
  ]);

  assert.equal(manifest.partialApply, true, "partialApply should be true on apply failure");
  assert.equal(manifest.files[0].applied, false, "applied should be false on failure");
});

test("Patch A — successful content-replace still records sha256After (existing behaviour preserved)", async () => {
  const home = await makeSyntheticHome();
  const filePath = join(home, "replace-a.txt");
  const original = "original content\n";
  const mutated = "mutated content\n";
  await writeFile(filePath, original);

  const { opId } = await takeSnapshot(home, { targets: [filePath] });

  const manifest = await applyOperation(opId, home, [
    { apply: async (p) => writeFile(p, mutated) }
  ]);

  const expectedHash = sha256Hex(Buffer.from(mutated, "utf8"));
  assert.equal(manifest.files[0].sha256After, expectedHash, "sha256After should match new content hash");
  assert.equal(manifest.files[0].applied, true);
  assert.ok(!manifest.partialApply, "partialApply should not be set on successful replace");
});

test("Patch B — verify of a clean deletion transitions to verified", async () => {
  const home = await makeSyntheticHome();
  const filePath = join(home, "del-c.txt");
  await writeFile(filePath, "delete me\n");

  const { opId } = await takeSnapshot(home, { targets: [filePath] });

  await applyOperation(opId, home, [
    { apply: (p) => { unlinkSync(p); } }
  ]);

  const result = await verify(opId, home);

  assert.equal(result.status, "verified", "status should be verified after clean deletion");
  assert.ok(!result.files[0].verifyFailure, "verifyFailure should not be set on clean deletion");
});

test("Patch B — verify catches a silently-failed deletion", async () => {
  const home = await makeSyntheticHome();
  const filePath = join(home, "del-d.txt");
  await writeFile(filePath, "to be deleted then restored\n");

  const { opId } = await takeSnapshot(home, { targets: [filePath] });

  // Apply deletes the file — sha256After is recorded as null in the manifest.
  await applyOperation(opId, home, [
    { apply: (p) => { unlinkSync(p); } }
  ]);

  // Simulate file reappearing after apply (e.g. another process restored it).
  await writeFile(filePath, "restored by another process\n");

  const result = await verify(opId, home);

  assert.equal(result.files[0].verifyFailure, true, "verifyFailure should be true when file exists after deletion op");
  assert.equal(result.status, "applied", "status should remain applied on verify failure");
});
