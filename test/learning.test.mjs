import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  LEARNING_SCHEMA_VERSION,
  appendApplied,
  appendRefusal,
  appendRollback,
  readSummary
} from "../scripts/lib/learning.mjs";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeHome() {
  const tmp = mkdtempSync(path.join(os.tmpdir(), "ck-learning-"));
  return tmp;
}

function learningDir(home) {
  return path.join(home, ".claude", "housekeeper", "learning");
}

function refusalsFile(home) {
  return path.join(learningDir(home), "refusals.jsonl");
}

function appliedFile(home) {
  return path.join(learningDir(home), "applied.jsonl");
}

function rollbacksFile(home) {
  return path.join(learningDir(home), "rollbacks.jsonl");
}

function stateFile(home) {
  return path.join(learningDir(home), "state.json");
}

function readJsonlLines(filePath) {
  const text = readFileSync(filePath, "utf8");
  return text
    .split("\n")
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l));
}

function makeRefusal(overrides = {}) {
  return {
    command: "clean",
    target: "plugin.cache_unreferenced",
    reason: "protected-by-policy",
    refusalClass: "policy",
    targetPath: "/home/user/.claude/plugins/cache/market/tool/1.0",
    opIdRefIfPresent: "",
    ...overrides
  };
}

function makeOpManifest(overrides = {}) {
  return {
    opId: "op_20260601_aabbccdd",
    status: "verified",
    command: "clean",
    targets: ["/home/user/.claude/plugins/cache/market/tool/1.0/plugin.json"],
    filesCount: 1,
    partialApply: false,
    durationMs: 1200,
    ...overrides
  };
}

function makeRollbackManifest(overrides = {}) {
  return {
    opId: "op_20260601_aabbccdd",
    fromStatus: "verified",
    toStatus: "rolled_back",
    filesRestoredCount: 1,
    ...overrides
  };
}

// ---------------------------------------------------------------------------
// 1. LEARNING_SCHEMA_VERSION exported constant
// ---------------------------------------------------------------------------

test("LEARNING_SCHEMA_VERSION is '0.4'", () => {
  assert.equal(LEARNING_SCHEMA_VERSION, "0.4");
});

// ---------------------------------------------------------------------------
// 2. appendRefusal — basic write
// ---------------------------------------------------------------------------

test("appendRefusal creates directory and writes one JSONL line", async () => {
  const home = makeHome();
  await appendRefusal(home, makeRefusal());

  const lines = readJsonlLines(refusalsFile(home));
  assert.equal(lines.length, 1);
  const rec = lines[0];
  assert.equal(rec.learnSchemaVersion, "0.4");
  assert.ok(rec.ts, "ts must be present");
  assert.equal(rec.command, "clean");
  assert.equal(rec.reason, "protected-by-policy");
  assert.equal(rec.refusalClass, "policy");
});

// ---------------------------------------------------------------------------
// 3. appendApplied — basic write
// ---------------------------------------------------------------------------

test("appendApplied creates directory and writes one JSONL line", async () => {
  const home = makeHome();
  await appendApplied(home, makeOpManifest());

  const lines = readJsonlLines(appliedFile(home));
  assert.equal(lines.length, 1);
  const rec = lines[0];
  assert.equal(rec.learnSchemaVersion, "0.4");
  assert.ok(rec.ts);
  assert.equal(rec.opId, "op_20260601_aabbccdd");
  assert.equal(rec.status, "verified");
  assert.equal(rec.command, "clean");
  assert.equal(rec.filesCount, 1);
});

// ---------------------------------------------------------------------------
// 4. appendRollback — basic write
// ---------------------------------------------------------------------------

test("appendRollback creates directory and writes one JSONL line", async () => {
  const home = makeHome();
  await appendRollback(home, makeRollbackManifest());

  const lines = readJsonlLines(rollbacksFile(home));
  assert.equal(lines.length, 1);
  const rec = lines[0];
  assert.equal(rec.learnSchemaVersion, "0.4");
  assert.ok(rec.ts);
  assert.equal(rec.opId, "op_20260601_aabbccdd");
  assert.equal(rec.fromStatus, "verified");
  assert.equal(rec.toStatus, "rolled_back");
  assert.equal(rec.filesRestoredCount, 1);
});

// ---------------------------------------------------------------------------
// 5. Mandatory T-100 criterion: 10/5/3 appends + readSummary counters
// ---------------------------------------------------------------------------

test("readSummary returns correct counters after 10/5/3 appends", async () => {
  const home = makeHome();

  for (let i = 0; i < 10; i++) {
    await appendRefusal(home, makeRefusal({ reason: `reason-${i % 3}` }));
  }
  for (let i = 0; i < 5; i++) {
    await appendApplied(
      home,
      makeOpManifest({ opId: `op_applied_${i}`, filesCount: i + 1 })
    );
  }
  for (let i = 0; i < 3; i++) {
    await appendRollback(
      home,
      makeRollbackManifest({ opId: `op_rolled_${i}`, filesRestoredCount: i })
    );
  }

  const summary = await readSummary(home);
  assert.deepEqual(summary.counters, {
    totalRefusals: 10,
    totalApplied: 5,
    totalRollbacks: 3
  });
});

// ---------------------------------------------------------------------------
// 6. Empty-state behavior: no files → zeros without error
// ---------------------------------------------------------------------------

test("readSummary returns zero counters when no files exist", async () => {
  const home = makeHome();
  const summary = await readSummary(home);

  assert.deepEqual(summary.counters, {
    totalRefusals: 0,
    totalApplied: 0,
    totalRollbacks: 0
  });
  assert.deepEqual(summary.topRefusals, []);
  assert.deepEqual(summary.topCleanedDetectors, []);
  assert.deepEqual(summary.recentRollbacks, []);
  assert.equal(summary.falsePositiveCount, 0);
});

// ---------------------------------------------------------------------------
// 7. Schema version present on every write
// ---------------------------------------------------------------------------

test("every appended line carries learnSchemaVersion: '0.4'", async () => {
  const home = makeHome();
  await appendRefusal(home, makeRefusal());
  await appendApplied(home, makeOpManifest());
  await appendRollback(home, makeRollbackManifest());

  for (const file of [refusalsFile(home), appliedFile(home), rollbacksFile(home)]) {
    const lines = readJsonlLines(file);
    for (const rec of lines) {
      assert.equal(rec.learnSchemaVersion, "0.4", `Missing learnSchemaVersion in ${file}`);
    }
  }
});

// ---------------------------------------------------------------------------
// 8. 30-day window filtering
// ---------------------------------------------------------------------------

test("readSummary respects windowDays and excludes old records", async () => {
  const home = makeHome();

  // Old refusal (40 days ago)
  const oldTs = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString();
  const oldLine = JSON.stringify({
    learnSchemaVersion: "0.4",
    ts: oldTs,
    command: "clean",
    target: "plugin.cache_unreferenced",
    reason: "old-reason",
    refusalClass: "policy"
  });
  const dir = learningDir(home);
  mkdirSync(dir, { recursive: true });
  writeFileSync(refusalsFile(home), oldLine + "\n", { flag: "a" });

  // New refusal (today)
  await appendRefusal(home, makeRefusal({ reason: "new-reason" }));

  const summary = await readSummary(home, { windowDays: 30 });
  // totalRefusals includes ALL records (lifetime counters)
  assert.equal(summary.counters.totalRefusals, 2);

  // topRefusals should only include records within 30 days
  const inWindow = summary.topRefusals.find((r) => r.reason === "old-reason");
  const newReason = summary.topRefusals.find((r) => r.reason === "new-reason");
  assert.equal(inWindow, undefined, "old reason must be filtered from topRefusals");
  assert.ok(newReason, "new reason must appear in topRefusals");
});

// ---------------------------------------------------------------------------
// 9. Top-5 truncation when more than 5 distinct values
// ---------------------------------------------------------------------------

test("readSummary topRefusals truncates to top 5", async () => {
  const home = makeHome();

  // 6 distinct reasons, varying counts
  for (let i = 0; i < 6; i++) {
    // reason-0 gets 7, reason-1 gets 6, ..., reason-5 gets 2
    const count = 7 - i;
    for (let j = 0; j < count; j++) {
      await appendRefusal(home, makeRefusal({ reason: `reason-${i}` }));
    }
  }

  const summary = await readSummary(home);
  assert.ok(summary.topRefusals.length <= 5, "topRefusals must be at most 5");
  // Top entry must be the one with highest count (reason-0, count=7)
  assert.equal(summary.topRefusals[0].reason, "reason-0");
});

// ---------------------------------------------------------------------------
// 10. JSONL atomicity: each line is valid JSON
// ---------------------------------------------------------------------------

test("each line written to JSONL is valid JSON", async () => {
  const home = makeHome();
  for (let i = 0; i < 5; i++) {
    await appendRefusal(home, makeRefusal({ reason: `r${i}` }));
  }

  const text = readFileSync(refusalsFile(home), "utf8");
  const lines = text.split("\n").filter((l) => l.trim().length > 0);
  assert.equal(lines.length, 5);
  for (const line of lines) {
    assert.doesNotThrow(() => JSON.parse(line), `Invalid JSON line: ${line}`);
  }
});

// ---------------------------------------------------------------------------
// 11. Read path tolerates malformed line (skip + continue, no crash)
// ---------------------------------------------------------------------------

test("readSummary skips malformed JSONL lines without crashing", async () => {
  const home = makeHome();
  const dir = learningDir(home);
  mkdirSync(dir, { recursive: true });

  // Write one malformed line then one valid line
  writeFileSync(
    refusalsFile(home),
    "THIS IS NOT JSON\n" +
      JSON.stringify({
        learnSchemaVersion: "0.4",
        ts: new Date().toISOString(),
        command: "clean",
        target: "x",
        reason: "good-reason",
        refusalClass: "policy"
      }) +
      "\n"
  );

  let summary;
  assert.doesNotThrow(async () => {
    summary = await readSummary(home);
  });
  summary = await readSummary(home);
  // The valid line should be counted; the bad line should be skipped
  assert.equal(summary.counters.totalRefusals, 1);
});

// ---------------------------------------------------------------------------
// 12. Concurrent appends: 10 concurrent appendRefusal → 10 lines
// ---------------------------------------------------------------------------

test("concurrent appendRefusal calls produce correct line count", async () => {
  const home = makeHome();

  await Promise.all(
    Array.from({ length: 10 }, (_, i) =>
      appendRefusal(home, makeRefusal({ reason: `concurrent-${i}` }))
    )
  );

  const lines = readJsonlLines(refusalsFile(home));
  assert.equal(lines.length, 10);
});

// ---------------------------------------------------------------------------
// 13. state.json falsePositives reflected in readSummary.falsePositiveCount
// ---------------------------------------------------------------------------

test("readSummary reflects falsePositives from state.json", async () => {
  const home = makeHome();
  const dir = learningDir(home);
  mkdirSync(dir, { recursive: true });

  writeFileSync(
    stateFile(home),
    JSON.stringify({ learnSchemaVersion: "0.4", falsePositives: 7 }) + "\n"
  );

  const summary = await readSummary(home);
  assert.equal(summary.falsePositiveCount, 7);
});

// ---------------------------------------------------------------------------
// 14. recentRollbacks ordered newest-first (last 10)
// ---------------------------------------------------------------------------

test("recentRollbacks returns entries ordered newest-first, capped at 10", async () => {
  const home = makeHome();

  // Append 12 rollbacks with distinguishable timestamps
  for (let i = 0; i < 12; i++) {
    const ts = new Date(Date.now() + i * 1000).toISOString();
    const dir = learningDir(home);
    mkdirSync(dir, { recursive: true });
    const rec = JSON.stringify({
      learnSchemaVersion: "0.4",
      ts,
      opId: `op_${i}`,
      fromStatus: "verified",
      toStatus: "rolled_back",
      filesRestoredCount: i
    });
    writeFileSync(rollbacksFile(home), rec + "\n", { flag: "a" });
  }

  const summary = await readSummary(home);
  assert.equal(summary.recentRollbacks.length, 10, "must be capped at 10");

  // newest-first means op_11, op_10, op_9, ...
  assert.equal(summary.recentRollbacks[0].opId, "op_11");
  assert.equal(summary.recentRollbacks[1].opId, "op_10");
});

// ---------------------------------------------------------------------------
// 15. windowDays echoed back in summary
// ---------------------------------------------------------------------------

test("readSummary echoes windowDays in result", async () => {
  const home = makeHome();
  const summary = await readSummary(home, { windowDays: 14 });
  assert.equal(summary.windowDays, 14);
});
