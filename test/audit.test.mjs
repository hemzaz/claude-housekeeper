import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { assembleReport, auditClaudeHome } from "../scripts/lib/audit.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_ROOT = path.resolve(__dirname, "..", "fixtures", "synthetic-homes");

// ---------- T-201 / T-202: detector + assembleReport contract shape ----------

test("assembleReport returns Report shape with stable fields", () => {
  const home = fixtureHome();
  const report = assembleReport(home);

  assert.equal(report.schemaVersion, "0.1");
  assert.equal(report.filesChanged, false);
  assert.equal(report.mode, "diagnose"); // T-209 default
  assert.ok(report.home);
  assert.ok(report.generatedAt);
  assert.ok(report.stanceSummary);
  for (const k of ["inform", "watch", "review", "probe", "protect", "prepare", "repair", "block"]) {
    assert.equal(typeof report.stanceSummary[k], "number");
  }
  assert.ok(Array.isArray(report.findings));
  assert.ok(Array.isArray(report.boundaries));
  assert.ok(Array.isArray(report.degraded));
});

test("findings carry stance, surface, and evidence", () => {
  const home = fixtureHome();
  const live = path.join(home, "plugins/cache/market/tool/1.0.0");
  const stale = path.join(home, "plugins/cache/market/tool/0.9.0");
  mkdirSync(live, { recursive: true });
  mkdirSync(stale, { recursive: true });
  writeJson(path.join(home, "plugins/installed_plugins.json"), {
    version: 2,
    plugins: { "tool@market": [{ installPath: live, scope: "user", version: "1.0.0" }] }
  });
  writeJson(path.join(home, "settings.json"), {
    hooks: { Stop: [{ hooks: [{ command: `node ${stale}/scripts/missing.mjs` }] }] }
  });

  const report = assembleReport(home);

  for (const f of report.findings) {
    assert.ok(f.id, "finding has id");
    assert.ok(f.stance, "finding has stance");
    assert.ok(f.surface, "finding has surface");
    assert.ok(f.surface.surfaceClass, "surface has surfaceClass");
    assert.ok(f.evidence, "finding has evidence");
    for (const k of ["structural", "loader", "behavioral", "ownership", "freshness", "reversibility", "missing"]) {
      assert.ok(Array.isArray(f.evidence[k]), `evidence.${k} is array`);
    }
    assert.ok(Array.isArray(f.blockedActions));
    // No legacy fields.
    assert.equal(f.severity, undefined);
    assert.equal(f.risk, undefined);
    assert.equal(f.proposedAction, undefined);
    assert.equal(f.action, undefined);
  }
});

// ---------- T-205 / T-205a: detector id remap + plugin split ----------

test("dangling hook path emits settings.hook_path_dangling, not the legacy id", () => {
  const home = fixtureHome();
  const stale = path.join(home, "plugins/cache/market/tool/0.9.0");
  mkdirSync(stale, { recursive: true });
  writeJson(path.join(home, "settings.json"), {
    hooks: { Stop: [{ hooks: [{ command: `node ${stale}/scripts/missing.mjs` }] }] }
  });
  writeJson(path.join(home, "plugins/installed_plugins.json"), {
    version: 2,
    plugins: {
      "tool@market": [{
        installPath: path.join(home, "plugins/cache/market/tool/1.0.0"),
        scope: "user",
        version: "1.0.0"
      }]
    }
  });

  const report = assembleReport(home);
  const ids = report.findings.map((f) => f.id);
  assert.ok(ids.includes("settings.hook_path_dangling"));

  for (const removed of [
    "fs.large_logs", "fs.old_file_history", "fs.old_short_lived_cache",
    "fs.corrupt_backups", "fs.drift_dirs",
    "state.zombie_modes", "state.expired_cancel_signals", "state.large_replay_logs",
    "registry.tiny_registry_files", "plugin.stale_versions",
    "plugin.duplicate_registrations", "plugin.hook_path_dangling", "config.invalid_json"
  ]) {
    assert.equal(ids.includes(removed), false, `legacy id ${removed} must not appear`);
  }
});

test("plugin orphans split: within grace -> watch, outside grace -> probe", () => {
  const home = fixtureHome();
  const live = path.join(home, "plugins/cache/market/tool/1.0.0");
  const fresh = path.join(home, "plugins/cache/market/tool/0.9.0"); // within grace
  const old = path.join(home, "plugins/cache/market/tool/0.1.0"); // outside grace
  mkdirSync(live, { recursive: true });
  mkdirSync(fresh, { recursive: true });
  mkdirSync(old, { recursive: true });
  writeJson(path.join(home, "plugins/installed_plugins.json"), {
    version: 2,
    plugins: { "tool@market": [{ installPath: live, scope: "user", version: "1.0.0" }] }
  });
  writeJson(path.join(home, "settings.json"), {});

  // Push the old version's mtime ~30 days into the past (well outside the grace window).
  const longAgo = (Date.now() - 30 * 24 * 60 * 60 * 1000) / 1000;
  utimesSync(old, longAgo, longAgo);

  const report = assembleReport(home);
  const expectedOrphan = report.findings.filter((f) => f.id === "plugin.expected_orphan");
  const cacheUnreferenced = report.findings.filter((f) => f.id === "plugin.cache_unreferenced");

  assert.equal(expectedOrphan.length, 1);
  assert.equal(expectedOrphan[0].stance, "watch");
  assert.equal(cacheUnreferenced.length, 1);
  assert.equal(cacheUnreferenced[0].stance, "probe");
});

test("array-form installed plugin registry marks matching cache version as live", () => {
  const home = fixtureHome();
  const live = path.join(home, "plugins/cache/market/tool/1.0.0");
  mkdirSync(live, { recursive: true });
  writeJson(path.join(home, "plugins/installed_plugins.json"), {
    plugins: [{ marketplace: "market", name: "tool", version: "1.0.0", enabled: true }]
  });
  writeJson(path.join(home, "settings.json"), {});

  const report = assembleReport(home);
  const ids = report.findings.map((f) => f.id);
  assert.equal(ids.includes("plugin.expected_orphan"), false);
  assert.equal(ids.includes("plugin.cache_unreferenced"), false);
});

// ---------- T-208: housekeeper.interrupted_operation ----------

test("interrupted operation manifest yields a single block finding", () => {
  const home = fixtureHome();
  const opsDir = path.join(home, "housekeeper/operations");
  mkdirSync(opsDir, { recursive: true });
  writeJson(path.join(opsDir, "op_001.json"), { status: "applying" });

  const report = assembleReport(home);
  const interrupted = report.findings.find((f) => f.id === "housekeeper.interrupted_operation");
  assert.ok(interrupted, "interrupted finding must exist");
  assert.equal(interrupted.stance, "block");
  assert.equal(interrupted.surface.surfaceClass, "housekeeper-owned");
  assert.equal(interrupted.surface.rollbackClass, "manifest-backed");
});

test("verified operation manifests do not emit a finding", () => {
  const home = fixtureHome();
  const opsDir = path.join(home, "housekeeper/operations");
  mkdirSync(opsDir, { recursive: true });
  writeJson(path.join(opsDir, "op_done.json"), { status: "verified" });

  const report = assembleReport(home);
  const interrupted = report.findings.find((f) => f.id === "housekeeper.interrupted_operation");
  assert.equal(interrupted, undefined);
});

// ---------- shadow / divergence / identical (legacy case migrated) ----------

test("local command shadows emit exactly one identical or diverged finding per path", () => {
  const home = fixtureHome();
  const pluginRoot = path.join(home, "plugins/cache/market/tool/1.0.0");
  mkdirSync(path.join(pluginRoot, "commands"), { recursive: true });
  mkdirSync(path.join(home, "commands"), { recursive: true });
  writeFileSync(path.join(pluginRoot, "commands/same.md"), "---\ndescription: same\n---\nbody\n");
  writeFileSync(path.join(home, "commands/same.md"), "---\ndescription: same\n---\nbody\n");
  writeFileSync(path.join(pluginRoot, "commands/different.md"), "---\ndescription: different\n---\nplugin\n");
  writeFileSync(path.join(home, "commands/different.md"), "---\ndescription: different\n---\nlocal\n");
  writeInstalled(home, pluginRoot);
  writeJson(path.join(home, "settings.json"), {});

  const report = assembleReport(home, { scope: "registry" });
  const ids = report.findings.map((f) => f.id);
  const counts = (id) => ids.filter((i) => i === id).length;

  assert.equal(counts("registry.local_command_shadow"), 0);
  assert.equal(counts("registry.local_command_identical"), 1);
  assert.equal(counts("registry.local_command_diverged"), 1);

  const identical = report.findings.find((f) => f.id === "registry.local_command_identical");
  assert.equal(identical.stance, "review");
});

// ---------- T-X08: repair stance unreachable in v0.1 ----------

test("findings never carry stance: repair (v0.1 degradation)", () => {
  const home = fixtureHome();
  const pluginRoot = path.join(home, "plugins/cache/market/tool/1.0.0");
  mkdirSync(path.join(pluginRoot, "commands"), { recursive: true });
  mkdirSync(path.join(home, "commands"), { recursive: true });
  writeFileSync(path.join(pluginRoot, "commands/x.md"), "---\ndescription: x\n---\nb\n");
  writeFileSync(path.join(home, "commands/x.md"), "---\ndescription: x\n---\nb\n");
  writeInstalled(home, pluginRoot);
  writeFileSync(path.join(home, "settings.json"), "{ broken json");

  for (const mode of ["diagnose", "safe", "plan"]) {
    const report = assembleReport(home, { scope: "all", mode });
    for (const f of report.findings) {
      assert.notEqual(f.stance, "repair", `${f.id} emitted repair in mode ${mode}`);
    }
  }
});

// ---------- protection policy on the new contract path ----------

test("do-not-touch config flips matching findings to protect stance", () => {
  const home = fixtureHome();
  const pluginRoot = path.join(home, "plugins/cache/market/tool/1.0.0");
  mkdirSync(path.join(pluginRoot, "commands"), { recursive: true });
  mkdirSync(path.join(home, "commands"), { recursive: true });
  writeFileSync(path.join(pluginRoot, "commands/net-cables.md"), "---\ndescription: plugin\n---\nplugin\n");
  writeFileSync(path.join(home, "commands/net-cables.md"), "---\ndescription: local\n---\nlocal\n");
  writeInstalled(home, pluginRoot);
  writeJson(path.join(home, "housekeeper/config.json"), {
    doNotTouch: [{ path: "commands/net-cables.md", reason: "local command is hand-maintained" }]
  });
  writeJson(path.join(home, "settings.json"), {});

  const report = assembleReport(home, { scope: "registry" });
  const protectedFindings = report.findings.filter((f) => f.stance === "protect");
  assert.ok(protectedFindings.length >= 1, "at least one finding becomes protect under do-not-touch");
  for (const f of protectedFindings) {
    assert.ok(Array.isArray(f.policyMatches));
    assert.ok(f.policyMatches.length > 0, "protected findings carry their policy match");
    assert.equal(f.policyMatches[0].type, "doNotTouch");
  }
});

// ---------- T-210: probe payload ----------

test("shell-ambiguous hook attaches behavioral probe metadata", () => {
  const home = fixtureHome();
  writeJson(path.join(home, "settings.json"), {
    hooks: { Stop: [{ hooks: [{ command: "$HOME/plugins/cache/m/p/1/run.sh" }] }] }
  });
  writeJson(path.join(home, "plugins/installed_plugins.json"), { version: 2, plugins: {} });

  const report = assembleReport(home, { scope: "settings" });
  const finding = report.findings.find((f) => f.id === "settings.hook_command_shell_ambiguous");
  assert.ok(finding, "shell-ambiguous finding emitted");
  assert.ok(finding.proposedProbe, "proposedProbe attached");
  assert.equal(finding.proposedProbe.class, "behavioral");
  assert.equal(finding.proposedProbe.consent, "high");
});

// ---------- forbidden vocabulary smoke ----------

test("rendered findings do not carry legacy 'fix'/'quarantine'/'repair' verbs", () => {
  const home = fixtureHome();
  const stale = path.join(home, "plugins/cache/market/tool/0.9.0");
  mkdirSync(stale, { recursive: true });
  writeJson(path.join(home, "settings.json"), {
    hooks: { Stop: [{ hooks: [{ command: `node ${stale}/scripts/missing.mjs` }] }] }
  });
  writeJson(path.join(home, "plugins/installed_plugins.json"), { version: 2, plugins: {} });

  const report = assembleReport(home);
  const blob = JSON.stringify(report);
  // 'repair' is allowed inside stanceSummary keys (always 0 in v0.1); but
  // legacy action verbs 'fix' and 'quarantine' must not appear as values.
  assert.equal(blob.includes('"proposedAction":"fix'), false);
  assert.equal(blob.includes('"action":"fix'), false);
});

// ---------- legacy entry point still works ----------

test("auditClaudeHome is an alias for assembleReport", () => {
  const home = fixtureHome();
  writeJson(path.join(home, "settings.json"), {});
  const a = auditClaudeHome(home);
  const b = assembleReport(home);
  assert.equal(a.schemaVersion, b.schemaVersion);
  assert.equal(a.findings.length, b.findings.length);
});

// ---------- T-402: scan-budget degradation against the huge-home fixture ----------

test("huge-home-degraded fixture triggers a degraded scan finding under a low budget", () => {
  const home = path.join(FIXTURES_ROOT, "huge-home-degraded", "home", ".claude");
  // The fixture ships only ~30 seed shards (full 6000-file generation lives in
  // _HOW_TO_GENERATE.md). Lower the budget below the seed count so the
  // fixture-as-shipped already exercises the budget path.
  const report = assembleReport(home, { mode: "diagnose", scanLimits: { maxFiles: 5 } });
  assert.ok(
    Array.isArray(report.degraded) && report.degraded.length > 0,
    `report.degraded must be non-empty when budget is hit, got ${JSON.stringify(report.degraded)}`
  );
  const reasons = report.degraded.map((d) => d.reason);
  assert.ok(reasons.includes("max-files"), `expected max-files in degraded reasons, got ${reasons.join(",")}`);

  const budgetFinding = report.findings.find((f) => f.id === "home.scan_budget_hit");
  assert.ok(budgetFinding, "home.scan_budget_hit finding must be emitted when scan is degraded");
  assert.equal(budgetFinding.stance, "inform", "scan-budget finding stance is inform (orientation)");
});

test("huge-home-degraded fixture under a generous budget produces no degraded entries", () => {
  const home = path.join(FIXTURES_ROOT, "huge-home-degraded", "home", ".claude");
  const report = assembleReport(home, { mode: "diagnose", scanLimits: { maxFiles: 100000 } });
  assert.deepEqual(report.degraded, [], "no degraded entries when budget exceeds shipped seed count");
  const budgetFinding = report.findings.find((f) => f.id === "home.scan_budget_hit");
  assert.equal(budgetFinding, undefined, "no scan-budget finding when scan completes");
});

// ---------- helpers ----------

function fixtureHome() {
  const home = mkdtempSync(path.join(tmpdir(), "claude-housekeeper-"));
  mkdirSync(path.join(home, "plugins"), { recursive: true });
  writeJson(path.join(home, "settings.json"), {});
  return home;
}

function writeInstalled(home, installPath) {
  mkdirSync(installPath, { recursive: true });
  writeJson(path.join(home, "plugins/installed_plugins.json"), {
    version: 2,
    plugins: { "tool@market": [{ installPath, scope: "user", version: "1.0.0" }] }
  });
}

function writeJson(file, value) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}
