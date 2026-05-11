import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { mkdir, writeFile, readFile, access, readdir } from "node:fs/promises";
import { join } from "node:path";
import os from "node:os";
import {
  takeSnapshot,
  generateOpId,
  SnapshotRefusedError,
  SnapshotBudgetError,
  MAX_OPERATION_FILES,
  MAX_OPERATION_BYTES
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
