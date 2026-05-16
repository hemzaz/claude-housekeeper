// Detector-promotion integration tests for v0.3 Phase 3 (T-300..T-303).
//
// Verifies that the three promoted detectors (settings.hook_path_dangling,
// settings.mcp_command_missing, settings.invalid_json) flow through
// audit → composeHardenPlan → validate → execute end-to-end with the right
// patch semantics per docs/design/v0.3-design.md §3.4.

import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { assembleReport } from "../scripts/lib/audit.mjs";
import {
  composeHardenPlan,
  validateHardenPlan,
  executeHardenPlan
} from "../scripts/lib/harden-plan.mjs";

// ── helpers ───────────────────────────────────────────────────────────────

function makeHome() {
  const home = mkdtempSync(path.join(tmpdir(), "ck-promotion-test-"));
  mkdirSync(path.join(home, "plugins"), { recursive: true });
  return home;
}

// ── T-300: detector.hardenable flag on settings.hook_path_dangling ────────

test("T-300 audit: settings.hook_path_dangling finding carries hardenable: true", () => {
  const home = makeHome();
  const missing = path.join(home, "plugins", "cache", "mp", "p", "1.0.0", "h.sh");
  writeFileSync(path.join(home, "settings.json"), JSON.stringify({
    hooks: { PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: missing }] }] }
  }) + "\n");
  const report = assembleReport(home, { mode: "safe" });
  const finding = report.findings.find((f) => f.id === "settings.hook_path_dangling");
  assert.ok(finding, "expected hook_path_dangling finding");
  assert.equal(finding.hardenable, true);
});

// ── T-300: end-to-end harden of a dangling hook ──────────────────────────

test("T-300 harden: removes the dangling hook entry; settings.json stays valid JSON", async () => {
  const home = makeHome();
  const missing = path.join(home, "plugins", "cache", "mp", "p", "1.0.0", "h.sh");
  const settingsPath = path.join(home, "settings.json");
  writeFileSync(settingsPath, JSON.stringify({
    hooks: {
      PreToolUse: [{
        matcher: "Bash",
        hooks: [{ type: "command", command: missing }]
      }]
    }
  }, null, 2) + "\n");

  const plan = await composeHardenPlan(home, {
    target: "settings.hook_path_dangling",
    path: settingsPath
  });
  assert.equal(plan.refused.length, 0, `unexpected refusals: ${JSON.stringify(plan.refused)}`);
  assert.equal(plan.operations.length, 1);
  // Verify the patch is a set on ["hooks"], not the identity sentinel.
  assert.equal(plan.operations[0].mutationOp.patch.op, "set");
  assert.deepEqual(plan.operations[0].mutationOp.patch.path, ["hooks"]);

  const validated = await validateHardenPlan(plan, home);
  const manifest = await executeHardenPlan(validated, home);
  assert.equal(manifest.status, "verified");

  const after = JSON.parse(readFileSync(settingsPath, "utf8"));
  // The dangling hook command must be gone; the PreToolUse event survives
  // but with no hooks left (since we only had one) — accept either an empty
  // hooks array on the matcher OR the matcher pruned entirely.
  const pre = after.hooks?.PreToolUse;
  if (Array.isArray(pre) && pre.length > 0) {
    const remaining = (pre[0]?.hooks || []).map((h) => h.command);
    assert.ok(!remaining.includes(missing), "dangling command must be pruned");
  }
});

// ── T-300: existing healthy hook entries survive the patch ───────────────

test("T-300 harden: leaves healthy hook entries intact", async () => {
  const home = makeHome();
  const okPath = path.join(home, "real-hook.sh");
  writeFileSync(okPath, "#!/bin/sh\n");
  const missing = path.join(home, "plugins", "cache", "mp", "p", "1.0.0", "h.sh");
  const settingsPath = path.join(home, "settings.json");
  writeFileSync(settingsPath, JSON.stringify({
    hooks: {
      PreToolUse: [{
        matcher: "Bash",
        hooks: [
          { type: "command", command: okPath },
          { type: "command", command: missing }
        ]
      }]
    }
  }, null, 2) + "\n");

  const plan = await composeHardenPlan(home, {
    target: "settings.hook_path_dangling",
    path: settingsPath
  });
  const validated = await validateHardenPlan(plan, home);
  await executeHardenPlan(validated, home);

  const after = JSON.parse(readFileSync(settingsPath, "utf8"));
  const cmds = (after.hooks.PreToolUse[0].hooks || []).map((h) => h.command);
  assert.ok(cmds.includes(okPath), "healthy hook must survive");
  assert.ok(!cmds.includes(missing), "dangling hook must be gone");
});

// ── T-301: detector.hardenable flag on settings.mcp_command_missing ──────

test("T-301 audit: settings.mcp_command_missing finding carries hardenable: true", () => {
  const home = makeHome();
  writeFileSync(path.join(home, "settings.json"), JSON.stringify({
    mcpServers: { "bad-server": { command: "/nonexistent/binary", args: [] } }
  }) + "\n");
  const report = assembleReport(home, { mode: "diagnose" });
  const finding = report.findings.find((f) => f.id === "settings.mcp_command_missing");
  assert.ok(finding, "expected mcp_command_missing finding");
  assert.equal(finding.hardenable, true);
});

// ── T-301: end-to-end harden of a missing MCP server ─────────────────────

test("T-301 harden: removes the broken mcpServers.<name> entry", async () => {
  const home = makeHome();
  const settingsPath = path.join(home, "settings.json");
  writeFileSync(settingsPath, JSON.stringify({
    mcpServers: {
      "ghost": { command: "/nonexistent/ghost-bin", args: [] },
      "real": { command: "echo", args: ["hi"] }
    }
  }, null, 2) + "\n");

  const plan = await composeHardenPlan(home, {
    target: "settings.mcp_command_missing",
    path: settingsPath
  });
  assert.equal(plan.refused.length, 0, `unexpected refusals: ${JSON.stringify(plan.refused)}`);
  assert.equal(plan.operations.length, 1);
  assert.equal(plan.operations[0].mutationOp.patch.op, "set");
  assert.deepEqual(plan.operations[0].mutationOp.patch.path, ["mcpServers"]);

  const validated = await validateHardenPlan(plan, home);
  const manifest = await executeHardenPlan(validated, home);
  assert.equal(manifest.status, "verified");

  const after = JSON.parse(readFileSync(settingsPath, "utf8"));
  assert.equal(after.mcpServers.ghost, undefined, "broken MCP must be gone");
  assert.ok(after.mcpServers.real, "non-absolute-path MCP entry survives");
});

// ── T-302: invalid_json detector flags hardenable but harden refuses ─────

test("T-302 audit: settings.invalid_json finding carries hardenable: true", () => {
  const home = makeHome();
  writeFileSync(path.join(home, "settings.json"), `{ unbalanced\n`);
  const report = assembleReport(home, { mode: "safe" });
  const finding = report.findings.find((f) => f.id === "settings.invalid_json");
  assert.ok(finding, "expected invalid_json finding");
  assert.equal(finding.hardenable, true);
});

test("T-302 harden: invalid_json target refuses with settings-shape-unknown", async () => {
  const home = makeHome();
  const settingsPath = path.join(home, "settings.json");
  writeFileSync(settingsPath, `{ "hooks": [\n`);

  const plan = await composeHardenPlan(home, {
    target: "settings.invalid_json",
    path: settingsPath
  });
  assert.equal(plan.operations.length, 0);
  assert.equal(plan.refused.length, 1);
  assert.equal(plan.refused[0].reason, "settings-shape-unknown");
  assert.ok(plan.refused[0].nextStep.length > 0);
});
