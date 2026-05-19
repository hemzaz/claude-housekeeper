// Plugin prune tests — T-304
//
// Covers: grace-window boundary (29d/30d/31d), false-positive decoration
// plumbing, history-unavailable path, CLI mutation-attempt refusal, table
// format, --safe posture honored (skip shell-history scan).

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  utimesSync
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { assembleReport, KNOWN_DETECTORS } from "../scripts/lib/audit.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CLI = path.join(REPO_ROOT, "scripts", "claude-housekeeper.mjs");
const NOW_MS = Date.now();

// ---------------------------------------------------------------------------
// Test fixture helpers
// ---------------------------------------------------------------------------

function runCli(args) {
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd: REPO_ROOT,
    encoding: "utf8"
  });
}

/** Create a minimal .claude home directory with settings.json and plugins/. */
function buildHome(parent) {
  const home = path.join(parent, ".claude");
  mkdirSync(home, { recursive: true });
  writeFileSync(path.join(home, "settings.json"), JSON.stringify({}));
  mkdirSync(path.join(home, "plugins"), { recursive: true });
  mkdirSync(path.join(home, "plugins", "cache"), { recursive: true });
  return home;
}

/**
 * Create a plugin install directory and set its mtime to simulate age.
 * daysOld controls how far in the past the mtime is set.
 */
function buildPluginInstallDir(installPath, daysOld) {
  mkdirSync(installPath, { recursive: true });
  writeFileSync(path.join(installPath, "plugin.json"), JSON.stringify({ name: "test" }));
  const t = new Date(NOW_MS - daysOld * 24 * 60 * 60 * 1000);
  utimesSync(installPath, t, t);
}

function writeInstalledPlugins(home, plugins) {
  writeFileSync(
    path.join(home, "plugins", "installed_plugins.json"),
    JSON.stringify({ plugins })
  );
}

function writeLearningApplied(home, entries) {
  const dir = path.join(home, "housekeeper", "learning");
  mkdirSync(dir, { recursive: true });
  const lines = entries.map((e) => JSON.stringify(e)).join("\n") + "\n";
  writeFileSync(path.join(dir, "applied.jsonl"), lines);
}

function writeLearningState(home, state) {
  const dir = path.join(home, "housekeeper", "learning");
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "state.json"), JSON.stringify(state));
}

// ---------------------------------------------------------------------------
// T1: KNOWN_DETECTORS includes plugin.unused_past_grace
// ---------------------------------------------------------------------------

test("T1: KNOWN_DETECTORS includes plugin.unused_past_grace", () => {
  assert.ok(
    KNOWN_DETECTORS.has("plugin.unused_past_grace"),
    "plugin.unused_past_grace must be in KNOWN_DETECTORS"
  );
});

// ---------------------------------------------------------------------------
// T2: grace-window boundary — 29-day plugin (within grace, no finding)
// ---------------------------------------------------------------------------

test("T2: 29-day plugin is within grace window — no finding emitted", () => {
  const parent = mkdtempSync(path.join(tmpdir(), "ck-prune-29-"));
  const home = buildHome(parent);

  const installPath = path.join(home, "plugins", "cache", "syn-market", "old-helper", "1.0.0");
  buildPluginInstallDir(installPath, 29);
  writeInstalledPlugins(home, [
    { marketplace: "syn-market", name: "old-helper", version: "1.0.0", scope: "user", installPath }
  ]);

  const report = assembleReport(home, { mode: "diagnose" });
  const pruneFindings = report.findings.filter((f) => f.id === "plugin.unused_past_grace");
  assert.strictEqual(pruneFindings.length, 0, "29-day plugin should not trigger a finding");
});

// ---------------------------------------------------------------------------
// T3: grace-window boundary — 30-day plugin (at boundary, finding emitted)
// ---------------------------------------------------------------------------

test("T3: 30-day plugin at grace boundary — finding emitted at inform stance", () => {
  const parent = mkdtempSync(path.join(tmpdir(), "ck-prune-30-"));
  const home = buildHome(parent);

  const installPath = path.join(home, "plugins", "cache", "syn-market", "old-helper", "1.0.0");
  buildPluginInstallDir(installPath, 30);
  writeInstalledPlugins(home, [
    { marketplace: "syn-market", name: "old-helper", version: "1.0.0", scope: "user", installPath }
  ]);

  const report = assembleReport(home, { mode: "diagnose" });
  const pruneFindings = report.findings.filter((f) => f.id === "plugin.unused_past_grace");
  assert.strictEqual(pruneFindings.length, 1, "30-day plugin should trigger exactly one finding");
  assert.strictEqual(pruneFindings[0].stance, "inform");
  assert.strictEqual(pruneFindings[0].claimLevel, "observation");
});

// ---------------------------------------------------------------------------
// T4: grace-window boundary — 31-day plugin (past grace, finding emitted)
// ---------------------------------------------------------------------------

test("T4: 31-day plugin past grace — finding emitted with correct fields", () => {
  const parent = mkdtempSync(path.join(tmpdir(), "ck-prune-31-"));
  const home = buildHome(parent);

  const installPath = path.join(home, "plugins", "cache", "syn-market", "old-helper", "1.0.0");
  buildPluginInstallDir(installPath, 31);
  writeInstalledPlugins(home, [
    { marketplace: "syn-market", name: "old-helper", version: "1.0.0", scope: "user", installPath }
  ]);

  const report = assembleReport(home, { mode: "diagnose" });
  const pruneFindings = report.findings.filter((f) => f.id === "plugin.unused_past_grace");
  assert.strictEqual(pruneFindings.length, 1, "31-day plugin should trigger a finding");
  assert.strictEqual(pruneFindings[0].stance, "inform");
  assert.ok(
    pruneFindings[0].targetPath.includes("old-helper"),
    "targetPath should identify the plugin"
  );
});

// ---------------------------------------------------------------------------
// T5: active plugin (recent applied.jsonl entry) — no finding
// ---------------------------------------------------------------------------

test("T5: plugin with recent activity in applied.jsonl is not flagged", () => {
  const parent = mkdtempSync(path.join(tmpdir(), "ck-prune-active-"));
  const home = buildHome(parent);

  const installPath = path.join(home, "plugins", "cache", "syn-market", "active-plugin", "2.0.0");
  buildPluginInstallDir(installPath, 60); // installed 60 days ago

  writeInstalledPlugins(home, [
    { marketplace: "syn-market", name: "active-plugin", version: "2.0.0", scope: "user", installPath }
  ]);

  // Recent applied.jsonl entry targeting the plugin's install path
  const recentTs = new Date(NOW_MS - 5 * 24 * 60 * 60 * 1000).toISOString();
  writeLearningApplied(home, [
    {
      learnSchemaVersion: "0.4",
      ts: recentTs,
      opId: "op_20260501_aabbccdd",
      status: "verified",
      command: "clean",
      targets: [path.join(installPath, "plugin.json")],
      filesCount: 1
    }
  ]);

  const report = assembleReport(home, { mode: "diagnose" });
  const pruneFindings = report.findings.filter((f) => f.id === "plugin.unused_past_grace");
  assert.strictEqual(pruneFindings.length, 0, "Plugin with recent learning activity should not be flagged");
});

// ---------------------------------------------------------------------------
// T6: 3-plugin fixture — exactly one finding (stale only)
// ---------------------------------------------------------------------------

test("T6: 3-plugin fixture emits exactly one finding for the stale plugin", () => {
  const parent = mkdtempSync(path.join(tmpdir(), "ck-prune-fixture-"));
  const home = buildHome(parent);

  // Stale: 90 days old, no activity
  const staleInstallPath = path.join(home, "plugins", "cache", "syn-market", "stale-plugin", "1.0.0");
  buildPluginInstallDir(staleInstallPath, 90);

  // Active: 90 days old, recent applied.jsonl entry
  const activeInstallPath = path.join(home, "plugins", "cache", "syn-market", "active-plugin", "2.0.0");
  buildPluginInstallDir(activeInstallPath, 90);

  // Fresh: 5 days old, no activity
  const freshInstallPath = path.join(home, "plugins", "cache", "syn-market", "fresh-plugin", "0.1.0");
  buildPluginInstallDir(freshInstallPath, 5);

  writeInstalledPlugins(home, [
    { marketplace: "syn-market", name: "stale-plugin", version: "1.0.0", scope: "user", installPath: staleInstallPath },
    { marketplace: "syn-market", name: "active-plugin", version: "2.0.0", scope: "user", installPath: activeInstallPath },
    { marketplace: "syn-market", name: "fresh-plugin", version: "0.1.0", scope: "user", installPath: freshInstallPath }
  ]);

  // Learning activity for active-plugin only
  const recentTs = new Date(NOW_MS - 3 * 24 * 60 * 60 * 1000).toISOString();
  writeLearningApplied(home, [
    {
      learnSchemaVersion: "0.4",
      ts: recentTs,
      opId: "op_20260515_aabbccdd",
      status: "verified",
      command: "clean",
      targets: [path.join(activeInstallPath, "plugin.json")],
      filesCount: 1
    }
  ]);

  const report = assembleReport(home, { mode: "diagnose" });
  const pruneFindings = report.findings.filter((f) => f.id === "plugin.unused_past_grace");
  assert.strictEqual(pruneFindings.length, 1, "Exactly one finding for the stale plugin");
  assert.ok(
    pruneFindings[0].targetPath.includes("stale-plugin"),
    "The finding should be for stale-plugin"
  );
});

// ---------------------------------------------------------------------------
// T7: false-positive decoration plumbing
// ---------------------------------------------------------------------------

test("T7: falsePositiveSeenBefore decoration plumbs through for plugin.unused_past_grace", () => {
  const parent = mkdtempSync(path.join(tmpdir(), "ck-prune-fp-"));
  const home = buildHome(parent);

  const installPath = path.join(home, "plugins", "cache", "syn-market", "fp-plugin", "1.0.0");
  buildPluginInstallDir(installPath, 45);
  writeInstalledPlugins(home, [
    { marketplace: "syn-market", name: "fp-plugin", version: "1.0.0", scope: "user", installPath }
  ]);

  // Write a false-positive marker for plugin.unused_past_grace + this installPath
  writeLearningState(home, {
    learnSchemaVersion: "0.4",
    falsePositives: [
      {
        targetDetector: "plugin.unused_past_grace",
        targetPath: installPath,
        markedAt: new Date().toISOString(),
        opId: "op_20260101_aabbccdd"
      }
    ]
  });

  const report = assembleReport(home, { mode: "diagnose" });
  const pruneFindings = report.findings.filter((f) => f.id === "plugin.unused_past_grace");
  assert.strictEqual(pruneFindings.length, 1, "Should have one finding");
  assert.strictEqual(
    pruneFindings[0].falsePositiveSeenBefore,
    1,
    "falsePositiveSeenBefore should be 1 when one marker exists"
  );
});

// ---------------------------------------------------------------------------
// T8: history-unavailable path — historyAvailable: false in finding
// ---------------------------------------------------------------------------

test("T8: unreadable history file results in historyAvailable: false on the finding", () => {
  const parent = mkdtempSync(path.join(tmpdir(), "ck-prune-hist-"));
  const home = buildHome(parent);

  const installPath = path.join(home, "plugins", "cache", "syn-market", "hist-plugin", "1.0.0");
  buildPluginInstallDir(installPath, 45);
  writeInstalledPlugins(home, [
    { marketplace: "syn-market", name: "hist-plugin", version: "1.0.0", scope: "user", installPath }
  ]);

  // Pass a non-existent historyFile path so the shell-history scan cannot read it
  const report = assembleReport(home, {
    mode: "diagnose",
    historyFile: "/nonexistent/path/to/history_file_that_does_not_exist"
  });

  const pruneFindings = report.findings.filter((f) => f.id === "plugin.unused_past_grace");
  assert.strictEqual(pruneFindings.length, 1, "Should emit a finding");
  assert.strictEqual(
    pruneFindings[0].historyAvailable,
    false,
    "historyAvailable should be false when history file is unreadable"
  );
});

// ---------------------------------------------------------------------------
// T9: --safe posture — shell-history scan skipped, limit token set
// ---------------------------------------------------------------------------

test("T9: --safe mode skips shell-history scan and adds safe-mode-no-shell-history limit token", () => {
  const parent = mkdtempSync(path.join(tmpdir(), "ck-prune-safe-"));
  const home = buildHome(parent);

  const installPath = path.join(home, "plugins", "cache", "syn-market", "safe-plugin", "1.0.0");
  buildPluginInstallDir(installPath, 45);
  writeInstalledPlugins(home, [
    { marketplace: "syn-market", name: "safe-plugin", version: "1.0.0", scope: "user", installPath }
  ]);

  const report = assembleReport(home, { mode: "safe" });
  const pruneFindings = report.findings.filter((f) => f.id === "plugin.unused_past_grace");
  assert.strictEqual(pruneFindings.length, 1, "Should still emit a finding in safe mode");

  const finding = pruneFindings[0];
  assert.strictEqual(finding.historyAvailable, false, "historyAvailable should be false in safe mode");

  const limits = finding.surface?.limits || [];
  assert.ok(
    limits.includes("safe-mode-no-shell-history"),
    `surface.limits should contain 'safe-mode-no-shell-history'; got: ${JSON.stringify(limits)}`
  );
});

// ---------------------------------------------------------------------------
// T10: CLI mutation-attempt refusal — prune --confirm exits 2
// ---------------------------------------------------------------------------

test("T10: CLI prune --confirm exits 2 with prune-mutation-not-in-v0.4.0 message", () => {
  const parent = mkdtempSync(path.join(tmpdir(), "ck-prune-t10-"));
  buildHome(parent);
  const result = runCli(["prune", "--confirm", `--home=${parent}`]);
  assert.strictEqual(result.status, 2, "prune --confirm must exit 2");
  const output = result.stdout + result.stderr;
  assert.ok(
    output.includes("v0.4.0") || output.includes("v0.4.1"),
    `Output should reference v0.4 version; got:\n${output}`
  );
});

// ---------------------------------------------------------------------------
// T11: CLI mutation-attempt refusal — prune --yes exits 2
// ---------------------------------------------------------------------------

test("T11: CLI prune --yes exits 2 with mutation refusal message", () => {
  const parent = mkdtempSync(path.join(tmpdir(), "ck-prune-t11-"));
  buildHome(parent);
  const result = runCli(["prune", "--yes", `--home=${parent}`]);
  assert.strictEqual(result.status, 2, "prune --yes must exit 2");
  const output = result.stdout + result.stderr;
  assert.ok(
    output.includes("v0.4.0") || output.includes("v0.4.1"),
    `Output should reference v0.4 version; got:\n${output}`
  );
});

// ---------------------------------------------------------------------------
// T12: CLI prune table format — fixture-backed output contains plugin name
// ---------------------------------------------------------------------------

test("T12: CLI prune renders a table with stale plugin name and audit-only notice", () => {
  const parent = mkdtempSync(path.join(tmpdir(), "ck-prune-table-"));
  const home = buildHome(parent);

  const installPath = path.join(home, "plugins", "cache", "syn-market", "table-plugin", "1.0.0");
  buildPluginInstallDir(installPath, 45);
  writeInstalledPlugins(home, [
    { marketplace: "syn-market", name: "table-plugin", version: "1.0.0", scope: "user", installPath }
  ]);

  const result = runCli(["prune", `--home=${parent}`]);
  assert.strictEqual(result.status, 0, `prune should exit 0; stderr: ${result.stderr}`);
  const output = result.stdout;

  assert.ok(output.includes("PRUNE"), `Output should contain PRUNE header; got:\n${output}`);
  assert.ok(
    output.includes("table-plugin") || output.includes("syn-market"),
    `Output should mention the stale plugin; got:\n${output}`
  );
  assert.ok(
    output.includes("audit") || output.includes("v0.4"),
    `Output should mention audit-only / v0.4; got:\n${output}`
  );
});

// ---------------------------------------------------------------------------
// T13: CLI prune --json outputs valid JSON with findings array
// ---------------------------------------------------------------------------

test("T13: CLI prune --json outputs valid JSON with plugin.unused_past_grace findings", () => {
  const parent = mkdtempSync(path.join(tmpdir(), "ck-prune-json-"));
  const home = buildHome(parent);

  const installPath = path.join(home, "plugins", "cache", "syn-market", "json-plugin", "1.0.0");
  buildPluginInstallDir(installPath, 45);
  writeInstalledPlugins(home, [
    { marketplace: "syn-market", name: "json-plugin", version: "1.0.0", scope: "user", installPath }
  ]);

  const result = runCli(["prune", "--json", `--home=${parent}`]);
  assert.strictEqual(result.status, 0, `prune --json should exit 0; stderr: ${result.stderr}`);

  let parsed;
  assert.doesNotThrow(
    () => { parsed = JSON.parse(result.stdout); },
    "Output must be valid JSON"
  );
  assert.ok(Array.isArray(parsed.findings), "JSON output must have a findings array");
  assert.ok(
    parsed.findings.some((f) => f.id === "plugin.unused_past_grace"),
    "findings must include plugin.unused_past_grace"
  );
});
