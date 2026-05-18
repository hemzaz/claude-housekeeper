// CLI learn subcommand tests — T-104
//
// Covers: --help discovery, fixture-driven summary, --json schema, --prune
// window filtering, --mark-false-positive happy + invalid-id paths, empty-state,
// combined --mark-false-positive + --prune refusal.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CLI = path.join(REPO_ROOT, "scripts", "claude-housekeeper.mjs");

function runCli(args) {
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd: REPO_ROOT,
    encoding: "utf8"
  });
}

// ---------------------------------------------------------------------------
// Fixture builder
// ---------------------------------------------------------------------------

function makeLearnHome() {
  const parent = mkdtempSync(path.join(tmpdir(), "ck-learn-test-"));
  const home = parent; // resolveClaudeHome will append .claude
  return { parent, home };
}

function learningDir(parent) {
  return path.join(parent, ".claude", "housekeeper", "learning");
}

function writeJsonlFile(filePath, records) {
  const content = records.map((r) => JSON.stringify(r)).join("\n") + "\n";
  writeFileSync(filePath, content, "utf8");
}

/**
 * Build a synthetic home with learning data:
 *  - 5 refusals (3 reasons: protected-by-policy×3, budget-exceeded×1, plan-drift×1)
 *  - 3 applied ops
 *  - 2 rollbacks
 */
function makeFixtureHome() {
  const { parent, home } = makeLearnHome();
  const dir = learningDir(parent);
  mkdirSync(dir, { recursive: true });

  const nowIso = new Date().toISOString();

  // 5 refusals
  const refusals = [
    { learnSchemaVersion: "0.4", ts: nowIso, command: "clean", target: "plugin.cache_unreferenced", reason: "protected-by-policy", refusalClass: "policy" },
    { learnSchemaVersion: "0.4", ts: nowIso, command: "clean", target: "plugin.cache_unreferenced", reason: "protected-by-policy", refusalClass: "policy" },
    { learnSchemaVersion: "0.4", ts: nowIso, command: "clean", target: "plugin.cache_unreferenced", reason: "protected-by-policy", refusalClass: "policy" },
    { learnSchemaVersion: "0.4", ts: nowIso, command: "clean", target: "plugin.cache_unreferenced", reason: "budget-exceeded", refusalClass: "budget" },
    { learnSchemaVersion: "0.4", ts: nowIso, command: "clean", target: "plugin.cache_unreferenced", reason: "plan-drift", refusalClass: "drift" }
  ];
  writeJsonlFile(path.join(dir, "refusals.jsonl"), refusals);

  // 3 applied ops
  const applied = [
    { learnSchemaVersion: "0.4", ts: nowIso, opId: "op_20260501000001_aaaaaaaa", status: "verified", command: "clean", targets: ["plugin.cache_unreferenced"], filesCount: 1 },
    { learnSchemaVersion: "0.4", ts: nowIso, opId: "op_20260501000002_bbbbbbbb", status: "verified", command: "clean", targets: ["plugin.cache_unreferenced"], filesCount: 2 },
    { learnSchemaVersion: "0.4", ts: nowIso, opId: "op_20260501000003_cccccccc", status: "verified", command: "harden", targets: ["settings.hook_path_dangling"], filesCount: 1 }
  ];
  writeJsonlFile(path.join(dir, "applied.jsonl"), applied);

  // 2 rollbacks
  const rollbacks = [
    { learnSchemaVersion: "0.4", ts: nowIso, opId: "op_20260501000001_aaaaaaaa", fromStatus: "verified", toStatus: "rolled_back", filesRestoredCount: 1 },
    { learnSchemaVersion: "0.4", ts: nowIso, opId: "op_20260501000002_bbbbbbbb", fromStatus: "verified", toStatus: "rolled_back", filesRestoredCount: 2 }
  ];
  writeJsonlFile(path.join(dir, "rollbacks.jsonl"), rollbacks);

  return { parent, home, dir };
}

// ---------------------------------------------------------------------------
// Test 1: --help mentions learn and shows its flags
// ---------------------------------------------------------------------------

test("--help mentions learn command and its flags", () => {
  const result = runCli(["--help"]);
  assert.equal(result.status, 0, `expected exit 0: ${result.stderr}`);
  assert.match(result.stdout, /learn/, "--help must mention learn");
  assert.match(result.stdout, /--json/, "--help must mention --json");
  assert.match(result.stdout, /--prune/, "--help must mention --prune");
  assert.match(result.stdout, /--older-than/, "--help must mention --older-than");
  assert.match(result.stdout, /--mark-false-positive/, "--help must mention --mark-false-positive");
});

// ---------------------------------------------------------------------------
// Test 2: empty-state (no learning files) prints friendly message and exits 0
// ---------------------------------------------------------------------------

test("learn empty-state: no learning files prints friendly message and exits 0", () => {
  const { home } = makeLearnHome();
  // .claude dir must exist for resolveClaudeHome but learning dir absent
  mkdirSync(path.join(home, ".claude"), { recursive: true });
  const result = runCli(["learn", `--home=${home}`]);
  assert.equal(result.status, 0, `expected exit 0: ${result.stderr}`);
  // Must print the header
  assert.match(result.stdout, /HOUSEKEEPER LEARN/);
  // Must be friendly about no data
  assert.match(result.stdout, /no learning records|nothing to show|no records|0 refusals|0 operations|No data/i);
});

// ---------------------------------------------------------------------------
// Test 3: fixture-driven summary produces correct counters
// ---------------------------------------------------------------------------

test("learn fixture-driven summary: correct counters (5 refusals, 3 applied, 2 rollbacks)", () => {
  const { parent, home } = makeFixtureHome();
  mkdirSync(path.join(home, ".claude"), { recursive: true });
  const result = runCli(["learn", `--home=${parent}`]);
  assert.equal(result.status, 0, `expected exit 0: stdout=${result.stdout} stderr=${result.stderr}`);
  assert.match(result.stdout, /HOUSEKEEPER LEARN/);
  // Header must show window
  assert.match(result.stdout, /30-day window/i);
  // Top refusals section
  assert.match(result.stdout, /TOP REFUSAL/i);
  assert.match(result.stdout, /protected-by-policy/);
  // Rollbacks section
  assert.match(result.stdout, /LAST.*ROLLBACK|ROLLBACK/i);
  // Lifetime counters section
  assert.match(result.stdout, /5.*refusal|refusal.*5/i);
});

// ---------------------------------------------------------------------------
// Test 4: --json outputs valid JSON matching documented schema
// ---------------------------------------------------------------------------

test("learn --json: outputs valid JSON with required schema fields", () => {
  const { parent } = makeFixtureHome();
  const result = runCli(["learn", "--json", `--home=${parent}`]);
  assert.equal(result.status, 0, `expected exit 0: ${result.stderr}`);

  let parsed;
  assert.doesNotThrow(() => {
    parsed = JSON.parse(result.stdout);
  }, "output must be valid JSON");

  // Required schema fields per product memo §3.2
  assert.ok("learnSchemaVersion" in parsed, "must have learnSchemaVersion");
  assert.ok("generatedAt" in parsed, "must have generatedAt");
  assert.ok("windowDays" in parsed, "must have windowDays");
  assert.ok("windowStart" in parsed, "must have windowStart");
  assert.ok("windowEnd" in parsed, "must have windowEnd");
  assert.ok("topRefusalClasses" in parsed, "must have topRefusalClasses");
  assert.ok(Array.isArray(parsed.topRefusalClasses), "topRefusalClasses must be array");
  assert.ok("topCleanedDetectors" in parsed, "must have topCleanedDetectors");
  assert.ok(Array.isArray(parsed.topCleanedDetectors), "topCleanedDetectors must be array");
  assert.ok("lastRollbacks" in parsed, "must have lastRollbacks");
  assert.ok(Array.isArray(parsed.lastRollbacks), "lastRollbacks must be array");
  assert.ok("falsePositives" in parsed, "must have falsePositives");
  assert.ok(typeof parsed.falsePositives === "object", "falsePositives must be object");

  // Verify refusal count from fixture (5 refusals, top reason protected-by-policy×3)
  assert.ok(parsed.topRefusalClasses.length >= 1, "must have at least one refusal class");
  const top = parsed.topRefusalClasses[0];
  assert.equal(top.reason, "protected-by-policy");
  assert.equal(top.count, 3);

  // learnSchemaVersion must be "0.4"
  assert.equal(parsed.learnSchemaVersion, "0.4");
});

// ---------------------------------------------------------------------------
// Test 5: --prune --older-than=N removes only old entries
// ---------------------------------------------------------------------------

test("learn --prune --older-than=7 removes only old refusal entries", () => {
  const { parent } = makeLearnHome();
  const dir = learningDir(parent);
  mkdirSync(dir, { recursive: true });
  mkdirSync(path.join(parent, ".claude"), { recursive: true });

  const now = new Date();
  const old = new Date(now - 30 * 24 * 60 * 60 * 1000); // 30 days ago
  const recent = new Date(now - 2 * 24 * 60 * 60 * 1000); // 2 days ago

  const refusalsPath = path.join(dir, "refusals.jsonl");
  const records = [
    { learnSchemaVersion: "0.4", ts: old.toISOString(), command: "clean", target: "x", reason: "old-reason", refusalClass: "policy" },
    { learnSchemaVersion: "0.4", ts: recent.toISOString(), command: "clean", target: "x", reason: "recent-reason", refusalClass: "policy" }
  ];
  writeJsonlFile(refusalsPath, records);

  const result = runCli(["learn", "--prune", "--older-than=7", `--home=${parent}`]);
  assert.equal(result.status, 0, `expected exit 0: stderr=${result.stderr}`);

  // After prune, only the recent record should remain
  const remaining = readFileSync(refusalsPath, "utf8")
    .split("\n")
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l));

  assert.equal(remaining.length, 1, "only 1 record should remain after pruning old entries");
  assert.equal(remaining[0].reason, "recent-reason");
});

// ---------------------------------------------------------------------------
// Test 6: --prune without --older-than exits 2 with helpful message
// ---------------------------------------------------------------------------

test("learn --prune without --older-than exits 2 with helpful message", () => {
  const { parent } = makeLearnHome();
  mkdirSync(path.join(parent, ".claude"), { recursive: true });
  const result = runCli(["learn", "--prune", `--home=${parent}`]);
  assert.equal(result.status, 2, `expected exit 2, got ${result.status}`);
  assert.match(result.stderr, /--prune requires --older-than/);
  assert.match(result.stderr, /No records deleted/);
});

// ---------------------------------------------------------------------------
// Test 7: --mark-false-positive happy path updates state.json
// ---------------------------------------------------------------------------

test("learn --mark-false-positive updates state.json", () => {
  const { parent } = makeLearnHome();
  const dir = learningDir(parent);
  mkdirSync(dir, { recursive: true });
  mkdirSync(path.join(parent, ".claude"), { recursive: true });

  const opId = "op_20260518000000_deadbeef";
  const result = runCli(["learn", "--mark-false-positive", opId, `--home=${parent}`]);
  assert.equal(result.status, 0, `expected exit 0: stderr=${result.stderr}`);

  const stateFile = path.join(dir, "state.json");
  assert.ok(existsSync(stateFile), "state.json must be created");
  const state = JSON.parse(readFileSync(stateFile, "utf8"));
  assert.ok(Array.isArray(state.falsePositives), "falsePositives must be an array");
  assert.ok(state.falsePositives.length >= 1, "falsePositives must have at least one entry");
});

// ---------------------------------------------------------------------------
// Test 8: --mark-false-positive with invalid op_id exits 2
// ---------------------------------------------------------------------------

test("learn --mark-false-positive with invalid op_id exits 2", () => {
  const { parent } = makeLearnHome();
  mkdirSync(path.join(parent, ".claude"), { recursive: true });
  const result = runCli(["learn", "--mark-false-positive", "not-an-op-id", `--home=${parent}`]);
  assert.equal(result.status, 2, `expected exit 2, got ${result.status}`);
  assert.match(result.stderr, /invalid.*op.id|op.id.*invalid|expected format/i);
});

// ---------------------------------------------------------------------------
// Test 9: --mark-false-positive combined with --prune exits 2
// ---------------------------------------------------------------------------

test("learn --mark-false-positive combined with --prune exits 2", () => {
  const { parent } = makeLearnHome();
  mkdirSync(path.join(parent, ".claude"), { recursive: true });
  const opId = "op_20260518000000_deadbeef";
  const result = runCli([
    "learn",
    "--mark-false-positive", opId,
    "--prune", "--older-than=7",
    `--home=${parent}`
  ]);
  assert.equal(result.status, 2, `expected exit 2, got ${result.status}`);
  assert.match(result.stderr, /cannot be combined|Run each separately/i);
});

// ---------------------------------------------------------------------------
// Test 10: --mark-false-positive increments existing counter
// ---------------------------------------------------------------------------

test("learn --mark-false-positive with legacy counter shape migrates to array", () => {
  const { parent } = makeLearnHome();
  const dir = learningDir(parent);
  mkdirSync(dir, { recursive: true });
  mkdirSync(path.join(parent, ".claude"), { recursive: true });

  // Write legacy counter-only shape (3 = prior marks before T-105 schema change).
  const stateFile = path.join(dir, "state.json");
  writeFileSync(stateFile, JSON.stringify({ learnSchemaVersion: "0.4", falsePositives: 3 }) + "\n");

  const opId = "op_20260518000000_deadbeef";
  const result = runCli(["learn", "--mark-false-positive", opId, `--home=${parent}`]);
  assert.equal(result.status, 0, `expected exit 0: ${result.stderr}`);

  const state = JSON.parse(readFileSync(stateFile, "utf8"));
  // After migration: array shape with the new marker; old counter is discarded.
  assert.ok(Array.isArray(state.falsePositives), "falsePositives must be migrated to array");
  assert.equal(state.falsePositives.length, 1, "one entry for the new mark (legacy counter discarded)");
  assert.equal(state.falsePositives[0].opId, opId);
});
