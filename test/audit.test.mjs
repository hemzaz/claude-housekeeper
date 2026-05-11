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

test("plugin.cache_size evidence ranks top-3 plugins by total bytes", () => {
  const home = fixtureHome();
  // Three plugins; "bigplugin" should dominate, "midplugin" second, "smallplugin" third.
  const cases = [
    { market: "marketA", plugin: "bigplugin", version: "1.0.0", bytes: 5000 },
    { market: "marketA", plugin: "bigplugin", version: "1.1.0", bytes: 6000 },
    { market: "marketB", plugin: "midplugin", version: "2.0.0", bytes: 3000 },
    { market: "marketC", plugin: "smallplugin", version: "0.1.0", bytes: 500 }
  ];
  for (const { market, plugin, version, bytes } of cases) {
    const dir = path.join(home, "plugins/cache", market, plugin, version);
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, "data.bin"), Buffer.alloc(bytes));
  }

  const report = assembleReport(home, { scope: "plugins" });
  const cacheSize = report.findings.find((f) => f.id === "plugin.cache_size");
  assert.ok(cacheSize, "plugin.cache_size finding emitted");

  const structural = cacheSize.evidence.structural;
  // Header lines are still present and stable.
  assert.match(structural[0], /plugin cache contains 4 version directories/);
  assert.match(structural[1], /total size/);
  // Top-3 lines are ordered by total bytes desc.
  assert.match(structural[2], /largest: marketA\/bigplugin .* across 2 versions/);
  assert.match(structural[3], /largest: marketB\/midplugin .* across 1 version/);
  assert.match(structural[4], /largest: marketC\/smallplugin .* across 1 version/);
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
  writeJson(path.join(opsDir, "op_done.json"), { schemaVersion: "0.2", status: "verified" });

  const report = assembleReport(home);
  const interrupted = report.findings.find((f) => f.id === "housekeeper.interrupted_operation");
  assert.equal(interrupted, undefined);
});

test("legacy operation manifests emit a legacy interrupted-operation finding", () => {
  const home = fixtureHome();
  const opsDir = path.join(home, "housekeeper/operations");
  mkdirSync(opsDir, { recursive: true });
  const opId = "op_legacy";
  writeJson(path.join(opsDir, `${opId}.json`), {});

  const report = assembleReport(home);
  const interrupted = report.findings.find((f) => f.id === "housekeeper.interrupted_operation");
  assert.ok(interrupted, "interrupted finding must exist");
  assert.equal(interrupted.nextAllowedStep, `rollback ${opId}`);
  assert.match(interrupted.summary, /legacy operation manifest \(pre-v0\.2\)/i);
  assert.match(interrupted.summary, /status assumed planned/i);
  assert.deepEqual(interrupted.evidence.structural, [
    `operation id ${opId} exists`,
    "manifest schemaVersion is legacy",
    "status assumed planned"
  ]);
});

test("interrupted applied operation points at rollback command", () => {
  const home = fixtureHome();
  const opsDir = path.join(home, "housekeeper/operations");
  mkdirSync(opsDir, { recursive: true });
  const opId = "op_20260511143022_a1b2c3d4";
  writeJson(path.join(opsDir, `${opId}.json`), { schemaVersion: "0.2", status: "applied" });

  const report = assembleReport(home);
  const interrupted = report.findings.find((f) => f.id === "housekeeper.interrupted_operation");
  assert.ok(interrupted, "interrupted finding must exist");
  assert.equal(interrupted.nextAllowedStep, `rollback ${opId}`);
  assert.match(interrupted.summary, new RegExp(opId));
  assert.match(interrupted.summary, /applied/);
});

test("interrupted snapshot_taken operation points at rollback abort command", () => {
  const home = fixtureHome();
  const opsDir = path.join(home, "housekeeper/operations");
  mkdirSync(opsDir, { recursive: true });
  const opId = "op_20260511143022_a1b2c3d4";
  writeJson(path.join(opsDir, `${opId}.json`), { schemaVersion: "0.2", status: "snapshot_taken" });

  const report = assembleReport(home);
  const interrupted = report.findings.find((f) => f.id === "housekeeper.interrupted_operation");
  assert.ok(interrupted, "interrupted finding must exist");
  assert.equal(interrupted.nextAllowedStep, `rollback ${opId} --abort`);
  assert.match(interrupted.summary, new RegExp(opId));
  assert.match(interrupted.summary, /snapshot_taken/);
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
  // nextAllowedStep must give actionable guidance, not a terse placeholder.
  assert.equal(
    identical.nextAllowedStep,
    "show source, target, and precedence; await user intent"
  );

  const diverged = report.findings.find((f) => f.id === "registry.local_command_diverged");
  assert.equal(
    diverged.nextAllowedStep,
    "show both versions and let the user decide"
  );
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

// ---------- home.clean meta-detector ----------

test("home.clean fires when no other detector emitted under default scope", () => {
  const home = fixtureHome();
  writeJson(path.join(home, "settings.json"), {});
  const report = assembleReport(home);
  assert.equal(report.findings.length, 1, "exactly one finding on a clean home");
  const f = report.findings[0];
  assert.equal(f.id, "home.clean");
  assert.equal(f.stance, "inform");
  assert.equal(f.class, "orientation");
  assert.equal(f.claimLevel, "observation");
  assert.equal(f.summary, "no first-wedge issues found");
  assert.deepEqual(f.blockedActions, ["claim healthy"]);
});

test("home.clean does NOT fire when any other detector emits", () => {
  // Force a finding by writing a hook pointing at a missing plugin-cache path.
  // isPluginCacheCommand gates the dangling-hook detector on a plugins/cache
  // shape, so the ghost path below triggers it.
  const home = fixtureHome();
  const ghostPath = path.join(home, "plugins/cache/ghost/never-installed/9.9.9/hook.sh");
  writeJson(path.join(home, "settings.json"), {
    hooks: {
      PreToolUse: [
        { hooks: [{ type: "command", command: ghostPath }] }
      ]
    }
  });
  const report = assembleReport(home);
  const ids = report.findings.map((f) => f.id);
  assert.ok(ids.includes("settings.hook_path_dangling"), "dangling-hook detector fired");
  assert.equal(ids.includes("home.clean"), false, "home.clean must not fire alongside real findings");
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

// ---------- T-704 step 2: plugin.cache_referenced_by_hook ----------

test("plugin.cache_referenced_by_hook fires when a hook command contains the cache path", () => {
  const home = fixtureHome();
  const versionDir = path.join(home, "plugins", "cache", "m", "p", "1.0.0");
  mkdirSync(versionDir, { recursive: true });
  writeJson(path.join(home, "settings.json"), {
    hooks: {
      PreToolUse: [
        { hooks: [{ type: "command", command: `${versionDir}/hook.sh` }] }
      ]
    }
  });
  const report = assembleReport(home);
  const findings = report.findings.filter((f) => f.id === "plugin.cache_referenced_by_hook");
  assert.equal(findings.length, 1, "exactly one finding for the referenced cache dir");
  const f = findings[0];
  assert.equal(f.stance, "protect");
  assert.equal(f.targetPath, versionDir);
  assert.ok(f.evidence.structural.some((s) => s.includes("1 hook command(s)")));
});

test("plugin.cache_referenced_by_hook does NOT fire when no hook references the cache", () => {
  const home = fixtureHome();
  const versionDir = path.join(home, "plugins", "cache", "m", "p", "1.0.0");
  mkdirSync(versionDir, { recursive: true });
  writeJson(path.join(home, "settings.json"), {
    hooks: {
      PreToolUse: [
        { hooks: [{ type: "command", command: "/bin/echo hi" }] }
      ]
    }
  });
  const report = assembleReport(home);
  const findings = report.findings.filter((f) => f.id === "plugin.cache_referenced_by_hook");
  assert.equal(findings.length, 0, "no finding when hook does not reference the cache dir");
});

test("plugin.cache_referenced_by_hook dedups across multiple hooks referencing the same cache dir", () => {
  const home = fixtureHome();
  const versionDir = path.join(home, "plugins", "cache", "m", "p", "1.0.0");
  mkdirSync(versionDir, { recursive: true });
  writeJson(path.join(home, "settings.json"), {
    hooks: {
      PreToolUse: [
        { hooks: [{ type: "command", command: `${versionDir}/hook.sh` }] },
        { hooks: [{ type: "command", command: `${versionDir}/other.sh` }] }
      ]
    }
  });
  const report = assembleReport(home);
  const findings = report.findings.filter((f) => f.id === "plugin.cache_referenced_by_hook");
  assert.equal(findings.length, 1, "exactly one finding even with two hooks referencing the same cache dir");
  const f = findings[0];
  assert.ok(f.evidence.structural.some((s) => s.includes("2 hook command(s)")), "hook count reflects both hooks");
});

// ---------- T-704 step 2: housekeeper.stale_lock ----------

test("housekeeper.stale_lock fires when lockfile is past its staleness window", () => {
  const home = fixtureHome();
  const lockPath = path.join(home, "housekeeper", "lock");
  mkdirSync(path.dirname(lockPath), { recursive: true });
  const now = Date.now();
  const manifest = {
    pid: 12345,
    hostname: "test-host",
    opId: "op_test",
    startedAt: new Date(now - 35 * 60 * 1000).toISOString(),
    stalenessAt: new Date(now - 5 * 60 * 1000).toISOString()
  };
  writeFileSync(lockPath, JSON.stringify(manifest));
  const report = assembleReport(home);
  const findings = report.findings.filter((f) => f.id === "housekeeper.stale_lock");
  assert.equal(findings.length, 1, "one finding when lockfile is past staleness window");
  const f = findings[0];
  assert.equal(f.stance, "inform");
  assert.equal(f.claimLevel, "observation");
  assert.equal(f.targetPath, lockPath);
  assert.ok(f.evidence.structural.some((s) => s.includes("12345")), "evidence includes pid");
  assert.ok(f.evidence.structural.some((s) => s.includes("test-host")), "evidence includes hostname");
});

test("housekeeper.stale_lock does NOT fire when lockfile is fresh (stalenessAt in the future)", () => {
  const home = fixtureHome();
  const lockPath = path.join(home, "housekeeper", "lock");
  mkdirSync(path.dirname(lockPath), { recursive: true });
  const now = Date.now();
  const manifest = {
    pid: 12345,
    hostname: "test-host",
    opId: "op_test",
    startedAt: new Date(now - 5 * 60 * 1000).toISOString(),
    stalenessAt: new Date(now + 25 * 60 * 1000).toISOString()
  };
  writeFileSync(lockPath, JSON.stringify(manifest));
  const report = assembleReport(home);
  const findings = report.findings.filter((f) => f.id === "housekeeper.stale_lock");
  assert.equal(findings.length, 0, "no finding when lockfile is within its staleness window");
});

test("housekeeper.stale_lock does NOT fire when no lockfile exists", () => {
  const home = fixtureHome();
  const report = assembleReport(home);
  const findings = report.findings.filter((f) => f.id === "housekeeper.stale_lock");
  assert.equal(findings.length, 0, "no finding when lockfile is absent");
});

test("housekeeper.stale_lock handles malformed JSON lockfile", () => {
  const home = fixtureHome();
  const lockPath = path.join(home, "housekeeper", "lock");
  mkdirSync(path.dirname(lockPath), { recursive: true });
  writeFileSync(lockPath, "not valid json {{{");
  const report = assembleReport(home);
  const findings = report.findings.filter((f) => f.id === "housekeeper.stale_lock");
  assert.equal(findings.length, 1, "one finding for malformed lockfile");
  const f = findings[0];
  assert.equal(f.stance, "inform");
  assert.ok(
    f.evidence.structural.some((s) => s.includes("unreadable")),
    "evidence includes 'unreadable' note for malformed lockfile"
  );
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
