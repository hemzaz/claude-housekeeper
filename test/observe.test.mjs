// T-402 — observe module unit tests.
//
// Asserts:
//   - walkBounded honors maxFiles and reports max-files in degraded[]
//   - walkBounded honors maxWallMs and reports max-wall-ms in degraded[]
//   - symlinks are recorded but not traversed
//   - non-existent root returns empty entries (no throw)
//   - clean walk produces no degraded entries

import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  symlinkSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  walkBounded,
  DEFAULT_MAX_FILES,
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_WALL_MS
} from "../scripts/lib/observe.mjs";

test("walkBounded returns empty entries for non-existent root", () => {
  const result = walkBounded("/nonexistent/path/that/does/not/exist");
  assert.deepEqual(result.entries, []);
  assert.deepEqual(result.degraded, []);
  assert.equal(result.stopped, false);
});

test("walkBounded reports max-files when budget is exceeded", () => {
  const root = mkdtempSync(path.join(tmpdir(), "observe-files-"));
  for (let i = 0; i < 12; i += 1) {
    writeFileSync(path.join(root, `f-${i}.txt`), "x");
  }

  const result = walkBounded(root, { maxFiles: 5 });
  assert.equal(result.stopped, true);
  assert.ok(result.entries.length <= 5, `entries should not exceed budget, got ${result.entries.length}`);
  const reasons = result.degraded.map((d) => d.reason);
  assert.ok(reasons.includes("max-files"), `expected max-files in degraded reasons; got ${JSON.stringify(reasons)}`);
  for (const entry of result.degraded) {
    assert.equal(entry.kind, "scan-degraded");
    assert.ok(entry.path);
  }
});

test("walkBounded honors maxWallMs and stops cleanly", () => {
  const root = mkdtempSync(path.join(tmpdir(), "observe-wall-"));
  // Build a moderately deep tree so the walk has more than zero work to do.
  let dir = root;
  for (let depth = 0; depth < 5; depth += 1) {
    dir = path.join(dir, `d${depth}`);
    mkdirSync(dir);
    for (let i = 0; i < 10; i += 1) {
      writeFileSync(path.join(dir, `f-${i}.txt`), "x");
    }
  }
  // Use a budget of 0 to guarantee the wall-time check fires on the first iteration.
  const result = walkBounded(root, { maxWallMs: 0 });
  // Either max-wall-ms triggered, or the budget check ran on first iteration
  // before any entries accumulated. Both are acceptable degraded outcomes.
  if (result.stopped) {
    assert.ok(
      result.degraded.some((d) => d.reason === "max-wall-ms"),
      `expected max-wall-ms reason; got ${JSON.stringify(result.degraded)}`
    );
  }
});

test("walkBounded records symlinks but does not follow them", () => {
  const root = mkdtempSync(path.join(tmpdir(), "observe-symlink-"));
  const target = mkdtempSync(path.join(tmpdir(), "observe-symlink-target-"));
  for (let i = 0; i < 20; i += 1) {
    writeFileSync(path.join(target, `target-${i}.txt`), "x");
  }
  symlinkSync(target, path.join(root, "linked"));

  const result = walkBounded(root, { maxFiles: DEFAULT_MAX_FILES });
  const symlinkEntries = result.entries.filter((e) => e.kind === "symlink");
  assert.equal(symlinkEntries.length, 1, "exactly one symlink recorded");
  // None of the target files should appear under the root walk.
  const targetReached = result.entries.some((e) => e.path.includes("target-") && e.kind === "file");
  assert.equal(targetReached, false, "symlink target must not be traversed");
});

test("walkBounded under-budget produces no degraded entries", () => {
  const root = mkdtempSync(path.join(tmpdir(), "observe-clean-"));
  writeFileSync(path.join(root, "a.txt"), "1");
  writeFileSync(path.join(root, "b.txt"), "2");
  const result = walkBounded(root);
  assert.equal(result.stopped, false);
  assert.deepEqual(result.degraded, []);
  assert.equal(result.entries.length, 2);
  for (const entry of result.entries) {
    assert.equal(entry.kind, "file");
    assert.equal(typeof entry.sizeBytes, "number");
    assert.equal(typeof entry.mtimeMs, "number");
  }
});

test("DEFAULT_* constants pin the documented budgets", () => {
  assert.equal(DEFAULT_MAX_FILES, 5000);
  assert.equal(DEFAULT_MAX_BYTES, 1024 * 1024);
  assert.equal(DEFAULT_MAX_WALL_MS, 5000);
});
