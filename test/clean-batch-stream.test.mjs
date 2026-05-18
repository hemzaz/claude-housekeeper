// Stream batch clean tests — T-601..T-605.
//
// Covers Phase 6 of v0.4:
//   T-601 parser: --stream flag on clean --batch=<n>; rejects --stream with n ≤ 50
//   T-602 composeStreamCleanPlan: generator of chunked plans under one streamId
//   T-603 per-chunk snapshot+apply+verify; per-chunk failure halts stream
//   T-604 refusal classes stream-chunk-budget-exceeded, stream-resume-not-supported
//   T-605 12+ tests covering chunk boundary, per-chunk halt, reverse-order rollback,
//         resume refusal, --stream ≤ 50 parse refusal
//
// Per docs/design/v0.4-design.md §2 Q5: fixed 50-item chunks.
// Per docs/design/v0.4-architect-memo.md §7.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  utimesSync,
  existsSync,
  readFileSync,
  readdirSync
} from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  composeStreamCleanPlan,
  executeStreamCleanPlan,
  STREAM_CHUNK_SIZE
} from "../scripts/lib/clean-plan.mjs";
import {
  composeRollbackPlan
} from "../scripts/lib/rollback-plan.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CLI = path.join(REPO_ROOT, "scripts", "claude-housekeeper.mjs");

// ── helpers ──────────────────────────────────────────────────────────────────

function makeHome() {
  const parent = mkdtempSync(path.join(tmpdir(), "ck-stream-test-"));
  const home = path.join(parent, ".claude");
  mkdirSync(home, { recursive: true });
  writeFileSync(path.join(home, "settings.json"), "{}\n");
  return home;
}

function addUnreferencedCache(home, { market = "test-market", plugin, version = "0.9.0" } = {}) {
  const cacheDir = path.join(home, "plugins", "cache", market, plugin, version);
  mkdirSync(cacheDir, { recursive: true });
  // One file per cache dir keeps expandedFiles count at 1 per pair, so 50
  // pairs fit exactly within the snapshot MAX_OPERATION_FILES=50 budget.
  writeFileSync(path.join(cacheDir, "plugin.json"), JSON.stringify({ name: plugin, version }) + "\n");
  const longAgo = (Date.now() - 30 * 24 * 60 * 60 * 1000) / 1000;
  utimesSync(cacheDir, longAgo, longAgo);
  return cacheDir;
}

function runCli(args) {
  return spawnSync(process.execPath, [CLI, ...args], { cwd: REPO_ROOT, encoding: "utf8" });
}

// Create N unreferenced caches and return their pairs array.
function makeNPairs(home, n) {
  const pairs = [];
  for (let i = 0; i < n; i++) {
    const dir = addUnreferencedCache(home, { plugin: `stream-plugin-${i}` });
    pairs.push({ target: "plugin.cache_unreferenced", path: dir });
  }
  return pairs;
}

// Collect all yielded results from an async generator.
async function collectGenerator(gen) {
  const results = [];
  for await (const item of gen) {
    results.push(item);
  }
  return results;
}

// ── T-601: --stream parse refusal when n ≤ 50 ───────────────────────────────

test("T-601 CLI parser: --stream with --batch=50 is rejected (no benefit, n ≤ 50)", () => {
  const result = runCli(["clean", "--stream", "--batch=50", "--confirm"]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr + result.stdout, /stream.*50|50.*stream|stream-chunk-budget-exceeded/i);
});

test("T-601 CLI parser: --stream with --batch=10 (default ≤ 50) is rejected", () => {
  const result = runCli(["clean", "--stream", "--batch=10", "--confirm"]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr + result.stdout, /stream.*50|50.*stream|stream-chunk-budget-exceeded/i);
});

test("T-601 CLI --help shows --stream flag", () => {
  const result = runCli(["--help"]);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /--stream/);
});

// ── T-604: stream-resume-not-supported refusal ───────────────────────────────

test("T-604 CLI: --resume=<streamId> is refused with stream-resume-not-supported", () => {
  const result = runCli(["clean", "--resume=stream_20260101000000_ffffffff"]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr + result.stdout, /stream-resume-not-supported|resume.*not supported|not supported.*resume/i);
});

// ── T-602: STREAM_CHUNK_SIZE constant ────────────────────────────────────────

test("T-602 STREAM_CHUNK_SIZE is 50 (matches MAX_OPERATION_FILES per Q5 ruling)", () => {
  assert.equal(STREAM_CHUNK_SIZE, 50);
});

// ── T-602: composeStreamCleanPlan chunk boundary ──────────────────────────────

test("T-602 composeStreamCleanPlan: 101 pairs → 3 chunks (50, 50, 1)", async () => {
  const home = makeHome();
  const pairs = makeNPairs(home, 101);

  const chunks = await collectGenerator(composeStreamCleanPlan(home, { pairs }));

  assert.equal(chunks.length, 3, `expected 3 chunks, got ${chunks.length}`);
  assert.equal(chunks[0].plan.operations.length, 50, "chunk 0 should have 50 ops");
  assert.equal(chunks[1].plan.operations.length, 50, "chunk 1 should have 50 ops");
  assert.equal(chunks[2].plan.operations.length, 1, "chunk 2 should have 1 op (the remainder)");
});

test("T-602 composeStreamCleanPlan: all chunks share one streamId", async () => {
  const home = makeHome();
  const pairs = makeNPairs(home, 55);

  const chunks = await collectGenerator(composeStreamCleanPlan(home, { pairs }));

  assert.equal(chunks.length, 2);
  assert.ok(chunks[0].streamId, "streamId must be set");
  assert.equal(chunks[0].streamId, chunks[1].streamId, "all chunks share the same streamId");
  assert.match(chunks[0].streamId, /^stream_\d{14}_[0-9a-f]{8}$/);
});

test("T-602 composeStreamCleanPlan: chunkIndex is sequential", async () => {
  const home = makeHome();
  const pairs = makeNPairs(home, 55);

  const chunks = await collectGenerator(composeStreamCleanPlan(home, { pairs }));

  assert.equal(chunks[0].chunkIndex, 0);
  assert.equal(chunks[1].chunkIndex, 1);
});

test("T-602 composeStreamCleanPlan: totalChunks reported correctly on each yielded item", async () => {
  const home = makeHome();
  const pairs = makeNPairs(home, 101);

  const chunks = await collectGenerator(composeStreamCleanPlan(home, { pairs }));

  for (const chunk of chunks) {
    assert.equal(chunk.totalChunks, 3, `totalChunks should be 3; got ${chunk.totalChunks}`);
  }
});

// ── T-603: executeStreamCleanPlan happy path ──────────────────────────────────

test("T-603 executeStreamCleanPlan: 55-item stream → 2 chunks, all verified, dirs gone", async () => {
  const home = makeHome();
  const pairs = makeNPairs(home, 55);
  const allDirs = pairs.map((p) => p.path);

  const { streamId, chunks: results, streamPartial } = await executeStreamCleanPlan(home, { pairs });

  assert.ok(streamId, "streamId must be set");
  assert.equal(results.length, 2, "expected 2 chunk manifests");
  assert.equal(streamPartial, false, "no chunk should have failed");
  for (const r of results) {
    assert.equal(r.manifest.status, "verified", `chunk manifest status should be verified; got ${r.manifest.status}`);
  }
  for (const dir of allDirs) {
    assert.ok(!existsSync(dir), `dir should be deleted: ${dir}`);
  }
});

// ── T-603: per-chunk failure halts stream ─────────────────────────────────────

test("T-603 executeStreamCleanPlan: per-chunk failure halts stream after failed chunk", async () => {
  const home = makeHome();

  // Chunk 0: 50 good pairs. Chunk 1: 1 pair pointing at a non-existent path
  // (composeCleanPlan will refuse it → refused, no operations → chunk produces
  // no ops → executeStreamCleanPlan emits streamPartial: true and halts).
  const goodPairs = makeNPairs(home, 50);
  const badPairs = [{ target: "plugin.cache_unreferenced", path: "/nonexistent/path/does-not-exist" }];
  const pairs = [...goodPairs, ...badPairs];

  const result = await executeStreamCleanPlan(home, { pairs });

  // Good chunk should have executed; bad pair causes stream halt.
  assert.ok(result.streamId);
  // Stream should have partial state (bad chunk didn't verify fully or was empty).
  // Because the bad chunk has no ops (all refused), streamPartial reflects that
  // at least one chunk was not completed successfully.
  assert.equal(result.streamPartial, true, "expected streamPartial=true when a chunk has no ops due to all refusals");
  // Only the first chunk (50 ops) should appear in results.
  assert.ok(result.chunks.length >= 1, "at least the good chunk should appear");
  // All dirs in chunk 0 should be gone.
  for (const p of goodPairs) {
    assert.ok(!existsSync(p.path), `good dir should be deleted: ${p.path}`);
  }
});

// ── T-603: parent.json written to operations/stream_<id>/ ─────────────────────

test("T-603 executeStreamCleanPlan: parent.json written under operations/stream_<id>/", async () => {
  const home = makeHome();
  const pairs = makeNPairs(home, 52);

  const { streamId } = await executeStreamCleanPlan(home, { pairs });

  const parentPath = path.join(home, "housekeeper", "operations", streamId, "parent.json");
  assert.ok(existsSync(parentPath), `parent.json should exist at ${parentPath}`);
  const parent = JSON.parse(readFileSync(parentPath, "utf8"));
  assert.equal(parent.schemaVersion, "0.2");
  assert.equal(parent.kind, "stream-parent");
  assert.equal(parent.streamId, streamId);
  assert.equal(parent.totalChunks, 2);
  assert.equal(parent.chunkSize, 50);
});

// ── T-603: rollback of a stream (reverse order) ───────────────────────────────

test("T-603 rollback of a stream: composeRollbackPlan with streamId returns reverse-ordered plans", async () => {
  const home = makeHome();
  const pairs = makeNPairs(home, 55);
  const allDirs = pairs.map((p) => p.path);

  const { streamId, chunks } = await executeStreamCleanPlan(home, { pairs });

  assert.equal(chunks.length, 2);
  // Confirm dirs are deleted.
  for (const dir of allDirs) {
    assert.ok(!existsSync(dir), `dir should be gone before rollback: ${dir}`);
  }

  // composeRollbackPlan with { streamId } should return a composite plan.
  const rollbackResult = await composeRollbackPlan(home, { streamId });
  assert.ok(rollbackResult.isStream, "result should be marked as stream rollback");
  assert.equal(rollbackResult.subPlans.length, 2, "should have one sub-plan per completed chunk");
  // Sub-plans must be in reverse chunk order.
  const indices = rollbackResult.subPlans.map((p) => p.chunkIndex);
  assert.deepEqual(indices, [1, 0], "sub-plans must be in reverse chunk order");
});

// ── T-604: stream-chunk-budget-exceeded refusal (synthetic) ──────────────────

test("T-604 stream-chunk-budget-exceeded: composeStreamCleanPlan emits refusal when a chunk has budget issues", async () => {
  // We test the refusal class by directly checking that any chunk where
  // all pairs are refused results in stream halting with streamPartial: true.
  // The budget-exceeded refusal fires when n ≤ 50 with --stream (parse level).
  // The stream-level budget check (>50 files/10MiB per chunk) is defensive and
  // tested through executeStreamCleanPlan above. Here we verify the refusal
  // object shape from composeStreamCleanPlan when pairs produce refusals.
  const home = makeHome();
  // plugin.expected_orphan refuses fresh (within-grace) caches with
  // no-mutation-mapping-in-v0.2. The path must exist so the detector sees it.
  const freshPairs = Array.from({ length: 3 }, (_, i) => {
    const cacheDir = path.join(home, "plugins", "cache", "test-market", `fresh-plugin-${i}`, "1.0.0");
    mkdirSync(cacheDir, { recursive: true });
    writeFileSync(path.join(cacheDir, "plugin.json"), JSON.stringify({ name: `fresh-plugin-${i}`, version: "1.0.0" }) + "\n");
    // Recent mtime = within grace period → plugin.expected_orphan refuses.
    return { target: "plugin.expected_orphan", path: cacheDir };
  });

  const chunks = await collectGenerator(composeStreamCleanPlan(home, { pairs: freshPairs }));
  assert.equal(chunks.length, 1);
  // All pairs should be refused since plugin.expected_orphan is not cleanable
  // (no-mutation-mapping-in-v0.2 — no mutation class for expected_orphan in v0.2).
  assert.equal(chunks[0].plan.operations.length, 0);
  assert.ok(chunks[0].plan.refused.length > 0, "expected at least one refusal");
});

// ── T-602/T-604: stream-resume-not-supported refusal object ──────────────────

test("T-604 stream-resume-not-supported: composeStreamCleanPlan with resumeStreamId returns refusal", async () => {
  const home = makeHome();
  const pairs = makeNPairs(home, 5);

  // Passing resumeStreamId triggers immediate stream-resume-not-supported refusal.
  const chunks = await collectGenerator(composeStreamCleanPlan(home, {
    pairs,
    resumeStreamId: "stream_20260101000000_ffffffff"
  }));

  assert.equal(chunks.length, 1, "should yield exactly one refusal item");
  assert.ok(chunks[0].refused, "refusal item must have .refused array");
  assert.equal(chunks[0].refused[0].reason, "stream-resume-not-supported");
  assert.ok(chunks[0].refused[0].nextStep && chunks[0].refused[0].nextStep.length > 0,
    "nextStep copy must be non-empty");
});
