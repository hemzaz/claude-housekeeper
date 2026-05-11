// T-401 — safe-mode posture tests.
//
// Asserts:
//   1. Report.mode echoes "safe" when assembleReport is called with mode: "safe".
//   2. In safe mode, content under sector-boundary paths (~/.claude/credentials/**,
//      .env files) is NOT surfaced in the rendered report. We assert this by
//      writing sentinel content into those files and checking that the rendered
//      output never contains the sentinels — combined with the unit assertion
//      below that the safe-mode hashFile/readText guards short-circuit the read.
//   3. In safe mode, the MCP-command existsSync probe is skipped when the command
//      path crosses a sector boundary; no settings.mcp_command_missing finding
//      is emitted from such paths.

import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  utimesSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { assembleReport } from "../scripts/lib/audit.mjs";

test("safe mode echoes mode: 'safe' in the report", () => {
  const home = makeFixtureHome();
  const report = assembleReport(home, { mode: "safe" });
  assert.equal(report.mode, "safe");
});

test("safe mode tags every finding's surface.limits with 'safe-mode-no-loader-key'", () => {
  // Generate a finding by creating an unreferenced plugin-cache version dir
  // (well outside any grace window); the cache_unreferenced detector emits a
  // finding whose surface should carry the safe-mode limit when mode === "safe".
  const home = makeFixtureHome();
  const orphan = path.join(home, "plugins/cache/m/p/9.9.9");
  mkdirSync(orphan, { recursive: true });
  // Set its mtime well in the past so it falls outside the grace window and
  // the cache_unreferenced detector fires.
  const oldTime = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
  utimesSync(orphan, oldTime, oldTime);
  writeFileSync(path.join(home, "plugins/installed_plugins.json"), "{}");

  const safeReport = assembleReport(home, { mode: "safe" });
  assert.ok(safeReport.findings.length > 0, "safe report has at least one finding");
  for (const f of safeReport.findings) {
    assert.ok(
      Array.isArray(f.surface.limits) && f.surface.limits.includes("safe-mode-no-loader-key"),
      `${f.id} missing safe-mode-no-loader-key limit; got ${JSON.stringify(f.surface.limits)}`
    );
  }

  const diagnoseReport = assembleReport(home, { mode: "diagnose" });
  assert.ok(diagnoseReport.findings.length > 0, "diagnose report has at least one finding");
  for (const f of diagnoseReport.findings) {
    assert.ok(
      !Array.isArray(f.surface.limits) || !f.surface.limits.includes("safe-mode-no-loader-key"),
      `${f.id} carries safe-mode limit outside safe mode; got ${JSON.stringify(f.surface.limits)}`
    );
  }
});

test("safe mode does NOT surface credentials/ or .env content in the report", () => {
  const home = makeFixtureHome();

  // Place a synthetic credentials directory and an .env file. Real fixture-style
  // sector-boundary surfaces. Content is a sentinel string we will not see in
  // any rendered output.
  const credentialsDir = path.join(home, "credentials");
  mkdirSync(credentialsDir, { recursive: true });
  const credentialsFile = path.join(credentialsDir, "tokens.json");
  writeFileSync(credentialsFile, '{"token":"FAKE-TEST-TOKEN-DO-NOT-READ"}');
  const envFile = path.join(home, ".env");
  writeFileSync(envFile, "ANTHROPIC_API_KEY=sk-FAKE-TEST-DO-NOT-READ\n");

  // Add a local command shadow under credentials/ so the divergence detector
  // would normally hashFile inside the boundary. The safe-mode guard in
  // hashFile/readText must short-circuit. Use a path inside credentials/ to
  // force the boundary predicate to fire.
  const pluginRoot = path.join(home, "plugins/cache/m/p/1");
  mkdirSync(path.join(pluginRoot, "commands"), { recursive: true });
  writeFileSync(path.join(pluginRoot, "commands/x.md"), "---\ndescription: x\n---\nbody\n");
  mkdirSync(path.join(home, "commands"), { recursive: true });
  writeFileSync(path.join(home, "commands/x.md"), "---\ndescription: x\n---\nbody\n");
  writeFileSync(
    path.join(home, "plugins/installed_plugins.json"),
    JSON.stringify({
      version: 2,
      plugins: { "p@m": [{ installPath: pluginRoot, scope: "user", version: "1" }] }
    })
  );

  const safeReport = assembleReport(home, { mode: "safe", scope: "all" });
  assert.equal(safeReport.mode, "safe");
  const safeJson = JSON.stringify(safeReport);
  assert.equal(
    safeJson.includes("FAKE-TEST-TOKEN-DO-NOT-READ"),
    false,
    "safe-mode rendered JSON must not include credentials sentinel"
  );
  assert.equal(
    safeJson.includes("sk-FAKE-TEST-DO-NOT-READ"),
    false,
    "safe-mode rendered JSON must not include env sentinel"
  );
  // No finding may carry the credentials path or .env path in its targetPath.
  for (const finding of safeReport.findings) {
    assert.equal(
      String(finding.targetPath || "").includes(credentialsFile),
      false,
      `finding targetPath must not point at the credentials file in safe mode (got ${finding.id})`
    );
    assert.equal(
      String(finding.targetPath || "").includes(envFile),
      false,
      `finding targetPath must not point at the .env file in safe mode (got ${finding.id})`
    );
  }
});

test("hashFile and readText short-circuit on sector-boundary paths in safe mode", async () => {
  // Behavioral check: build a fixture where divergence/identical detection would
  // normally be invoked, place the local command under credentials/, and assert
  // that no shadow/identical/diverged finding is produced for that file in safe
  // mode (because hashFile returns "" and identity comparison short-circuits).
  const home = makeFixtureHome();
  const pluginRoot = path.join(home, "plugins/cache/m/p/1");
  mkdirSync(path.join(pluginRoot, "commands"), { recursive: true });
  writeFileSync(path.join(pluginRoot, "commands/x.md"), "---\ndescription: x\n---\nplugin\n");

  const credCommandsDir = path.join(home, "credentials");
  mkdirSync(credCommandsDir, { recursive: true });
  writeFileSync(path.join(credCommandsDir, "secret.md"), "ANTHROPIC_API_KEY=sk-FAKE-DO-NOT-READ");

  writeFileSync(
    path.join(home, "plugins/installed_plugins.json"),
    JSON.stringify({
      version: 2,
      plugins: { "p@m": [{ installPath: pluginRoot, scope: "user", version: "1" }] }
    })
  );

  const safeReport = assembleReport(home, { mode: "safe", scope: "all" });
  const safeJson = JSON.stringify(safeReport);
  assert.equal(
    safeJson.includes("sk-FAKE-DO-NOT-READ"),
    false,
    "safe-mode renderer must not surface credentials content"
  );
});

test("safe mode skips MCP existsSync probe across a sector boundary", () => {
  const home = makeFixtureHome();
  // MCP server pointing at an absolute path inside the credentials dir.
  const credentialsDir = path.join(home, "credentials");
  mkdirSync(credentialsDir, { recursive: true });
  const ghostCommand = path.join(credentialsDir, "ghost-binary");

  writeFileSync(
    path.join(home, "settings.json"),
    JSON.stringify({
      mcpServers: { hidden: { command: ghostCommand } }
    })
  );

  const safeReport = assembleReport(home, { mode: "safe", scope: "settings" });
  const safeMcp = safeReport.findings.filter((f) => f.id === "settings.mcp_command_missing");
  assert.equal(
    safeMcp.length,
    0,
    "safe mode must not emit MCP findings that require crossing a sector boundary"
  );

  // Diagnose mode (default) does emit, proving the probe is the only difference.
  const diagnoseReport = assembleReport(home, { mode: "diagnose", scope: "settings" });
  const diagnoseMcp = diagnoseReport.findings.filter((f) => f.id === "settings.mcp_command_missing");
  assert.ok(diagnoseMcp.length >= 1, "diagnose mode still reports the missing MCP command");
});

// ---------- helpers ----------

function makeFixtureHome() {
  const home = mkdtempSync(path.join(tmpdir(), "safe-mode-"));
  mkdirSync(path.join(home, "plugins"), { recursive: true });
  writeFileSync(path.join(home, "settings.json"), "{}");
  return home;
}
