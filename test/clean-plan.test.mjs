import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, utimesSync, symlinkSync, existsSync as existsSyncImport } from "node:fs";
import { mkdir, writeFile, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  composeCleanPlan,
  validateCleanPlan,
  executeCleanPlan,
  MUTATION_KINDS,
  MUTATION_REGISTRY,
  PlanDriftError,
  LockHeldError,
  NotImplementedError
} from "../scripts/lib/clean-plan.mjs";

// ── helpers ──────────────────────────────────────────────────────────────────

/**
 * makeSyntheticHome() — creates a temp dir that represents ~/.claude.
 * audit.mjs (assembleReport) treats `home` as the .claude dir directly:
 *   plugins/ settings.json housekeeper/ are all direct children of home.
 * snapshot.mjs treats its `home` argument as the PARENT of .claude.
 * clean-plan.mjs reconciles this by passing path.dirname(home) to snapshot calls.
 */
function makeSyntheticHome() {
  const home = mkdtempSync(path.join(tmpdir(), "ck-plan-test-"));
  mkdirSync(path.join(home, "plugins"), { recursive: true });
  writeFileSync(path.join(home, "settings.json"), "{}\n");
  return home;
}

/**
 * Create a plugin cache version directory that fires plugin.cache_unreferenced.
 * Forces the mtime 30 days into the past (well outside the 7-day grace window).
 */
function addUnreferencedCache(home, { market = "test-market", plugin = "test-tool", version = "0.9.0" } = {}) {
  const cacheDir = path.join(home, "plugins", "cache", market, plugin, version);
  mkdirSync(cacheDir, { recursive: true });
  writeFileSync(path.join(cacheDir, "plugin.json"), JSON.stringify({ name: plugin, version }) + "\n");
  const longAgo = (Date.now() - 30 * 24 * 60 * 60 * 1000) / 1000;
  utimesSync(cacheDir, longAgo, longAgo);
  return cacheDir;
}

async function fileExists(p) {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

// ── MUTATION_KINDS ────────────────────────────────────────────────────────────

test("MUTATION_KINDS exports the four documented kinds", () => {
  assert.deepEqual([...MUTATION_KINDS], [
    "dir-rmtree",
    "file-unlink",
    "file-replace",
    "json-fragment-edit"
  ]);
  assert.ok(Object.isFrozen(MUTATION_KINDS));
});

// ── MUTATION_REGISTRY ─────────────────────────────────────────────────────────

// Test 13: dir-rmtree + file-unlink factories return apply callables; the
// remaining two kinds still throw NotImplementedError in v0.2.x.
test("MUTATION_REGISTRY: implemented kinds return apply; unimplemented kinds throw NotImplementedError", () => {
  for (const kind of ["dir-rmtree", "file-unlink"]) {
    const factory = MUTATION_REGISTRY[kind];
    const op = factory(kind === "dir-rmtree" ? { dirPath: "/tmp/fake" } : { path: "/tmp/fake" });
    assert.equal(typeof op.apply, "function");
    assert.ok(op.args);
  }

  for (const kind of ["file-replace", "json-fragment-edit"]) {
    assert.throws(
      () => MUTATION_REGISTRY[kind]({}),
      (err) => {
        assert.ok(err instanceof NotImplementedError);
        assert.equal(err.code, "mutation-kind-not-implemented");
        assert.equal(err.mutationKind, kind);
        return true;
      }
    );
  }
});

// Test 13b: MUTATION_REGISTRY["file-unlink"]({ path }).apply() removes the file.
test("MUTATION_REGISTRY file-unlink: apply() removes the file at args.path", async () => {
  const home = mkdtempSync(path.join(tmpdir(), "ck-fu-"));
  const target = path.join(home, "doomed.txt");
  writeFileSync(target, "doomed\n");
  assert.ok(existsSyncImport(target), "precondition: file exists");
  const factory = MUTATION_REGISTRY["file-unlink"];
  const op = factory({ path: target });
  await op.apply();
  assert.ok(!existsSyncImport(target), "file should be unlinked");
});

// ── composeCleanPlan — happy path ─────────────────────────────────────────────

// Test 1: single plugin.cache_unreferenced finding → 1 operation, 0 refusals, mutationKind dir-rmtree.
test("composeCleanPlan happy path: cache_unreferenced → 1 operation (dir-rmtree), 0 refusals", async () => {
  const home = makeSyntheticHome();
  addUnreferencedCache(home);

  const plan = await composeCleanPlan(home, { target: "plugin.cache_unreferenced" });

  assert.equal(plan.schemaVersion, "0.2");
  assert.equal(plan.operations.length, 1);
  assert.equal(plan.refused.length, 0);
  assert.equal(plan.operations[0].mutationKind, "dir-rmtree");
  assert.equal(plan.operations[0].detectorId, "plugin.cache_unreferenced");
  assert.equal(typeof plan.reportHash, "string");
  assert.ok(plan.reportHash.length > 0);
});

// ── composeCleanPlan — refusals ───────────────────────────────────────────────

// Test 2: plugin.expected_orphan → refused with no-mutation-mapping-in-v0.2.
test("composeCleanPlan refusal: plugin.expected_orphan → reason no-mutation-mapping-in-v0.2", async () => {
  const home = makeSyntheticHome();
  // Within-grace cache: fresh mtime so it fires plugin.expected_orphan, not cache_unreferenced.
  const cacheDir = path.join(home, "plugins", "cache", "test-market", "test-tool", "0.9.0");
  mkdirSync(cacheDir, { recursive: true });
  writeFileSync(path.join(cacheDir, "plugin.json"), JSON.stringify({ name: "test-tool", version: "0.9.0" }) + "\n");
  // No utimes — mtime stays recent, within 7-day grace → plugin.expected_orphan fires.

  const plan = await composeCleanPlan(home, { target: "plugin.expected_orphan" });

  assert.equal(plan.operations.length, 0);
  assert.equal(plan.refused.length, 1);
  assert.equal(plan.refused[0].reason, "no-mutation-mapping-in-v0.2");
  assert.equal(plan.refused[0].detectorId, "plugin.expected_orphan");
  assert.equal(plan.refused[0].exitCode, 2);
});

// Test 3: protected path → reason protected-path.
test("composeCleanPlan refusal: doNotTouch protected path → reason protected-path", async () => {
  const home = makeSyntheticHome();
  const cacheDir = addUnreferencedCache(home);

  // Write home/housekeeper/config.json using doNotTouch (normalizeProtectionRules format).
  const configDir = path.join(home, "housekeeper");
  mkdirSync(configDir, { recursive: true });
  writeFileSync(path.join(configDir, "config.json"), JSON.stringify({
    doNotTouch: [{ path: cacheDir, reason: "test protection" }]
  }) + "\n");

  const plan = await composeCleanPlan(home, {
    target: "plugin.cache_unreferenced",
    path: cacheDir
  });

  assert.equal(plan.operations.length, 0);
  assert.equal(plan.refused.length, 1);
  assert.equal(plan.refused[0].reason, "protected-path");
});

// Test 4: symlinked target → reason plugin-symlinked-cache.
test("composeCleanPlan refusal: symlinked cache dir → reason plugin-symlinked-cache", async () => {
  const home = makeSyntheticHome();

  // Create a real directory to symlink to.
  const realDir = mkdtempSync(path.join(tmpdir(), "ck-real-"));
  const longAgo = (Date.now() - 30 * 24 * 60 * 60 * 1000) / 1000;
  utimesSync(realDir, longAgo, longAgo);

  // Place a symlink at the cache version path.
  const cacheParent = path.join(home, "plugins", "cache", "test-market", "test-tool");
  mkdirSync(cacheParent, { recursive: true });
  const symlinkPath = path.join(cacheParent, "0.9.0");
  symlinkSync(realDir, symlinkPath);
  utimesSync(symlinkPath, longAgo, longAgo);

  const plan = await composeCleanPlan(home, { target: "plugin.cache_unreferenced" });

  assert.equal(plan.operations.length, 0);
  assert.equal(plan.refused.length, 1);
  assert.equal(plan.refused[0].reason, "plugin-symlinked-cache");
});

// Test 5: plugin.json declares mcpServers → reason plugin-cache-has-mcp-server.
test("composeCleanPlan refusal: plugin.json with mcpServers → reason plugin-cache-has-mcp-server", async () => {
  const home = makeSyntheticHome();
  const cacheDir = addUnreferencedCache(home);

  // hasMcpServer checks .claude-plugin/plugin.json or .mcp.json inside the cache dir.
  const mcpPluginDir = path.join(cacheDir, ".claude-plugin");
  mkdirSync(mcpPluginDir, { recursive: true });
  writeFileSync(path.join(mcpPluginDir, "plugin.json"), JSON.stringify({
    name: "test-tool",
    version: "0.9.0",
    mcpServers: { "my-server": { command: "node", args: ["server.js"] } }
  }) + "\n");
  // Re-set mtime so the dir stays outside grace window after writing the new files.
  const longAgoMcp = (Date.now() - 30 * 24 * 60 * 60 * 1000) / 1000;
  utimesSync(cacheDir, longAgoMcp, longAgoMcp);

  const plan = await composeCleanPlan(home, {
    target: "plugin.cache_unreferenced",
    path: cacheDir
  });

  assert.equal(plan.operations.length, 0);
  assert.equal(plan.refused.length, 1);
  assert.equal(plan.refused[0].reason, "plugin-cache-has-mcp-server");
});

// Test 6: plugin.cache_referenced_by_hook for the same path → reason plugin-cache-referenced-by-hook.
test("composeCleanPlan refusal: cache_referenced_by_hook finding → reason plugin-cache-referenced-by-hook", async () => {
  const home = makeSyntheticHome();
  const cacheDir = addUnreferencedCache(home);

  // Write settings.json with a hook command that contains the cache dir path.
  writeFileSync(path.join(home, "settings.json"), JSON.stringify({
    hooks: {
      PostToolUse: [{
        matcher: "Bash",
        hooks: [{ type: "command", command: `node ${cacheDir}/run.js` }]
      }]
    }
  }) + "\n");

  const plan = await composeCleanPlan(home, {
    target: "plugin.cache_unreferenced",
    path: cacheDir
  });

  assert.equal(plan.operations.length, 0);
  assert.equal(plan.refused.length, 1);
  assert.equal(plan.refused[0].reason, "plugin-cache-referenced-by-hook");
});

// Test 7: interrupted operation manifest exists → reason plan-state-error.
test("composeCleanPlan refusal: interrupted operation manifest → reason plan-state-error", async () => {
  const home = makeSyntheticHome();
  addUnreferencedCache(home);

  // Create a fake applied (interrupted) operation manifest.
  // audit.mjs probeOperationsDir reads home/housekeeper/operations/*.json flat files.
  // snapshot.mjs writes operations/<opId>.json directly (not a subdir).
  const opsDir = path.join(home, "housekeeper", "operations");
  await mkdir(opsDir, { recursive: true });
  const opId = "op_20260101000000_abcd1234";
  await writeFile(path.join(opsDir, `${opId}.json`), JSON.stringify({
    opId,
    status: "applied",
    startedAt: new Date().toISOString()
  }) + "\n");

  const plan = await composeCleanPlan(home, { target: "plugin.cache_unreferenced" });

  assert.equal(plan.operations.length, 0);
  assert.equal(plan.refused.length, 1);
  assert.equal(plan.refused[0].reason, "plan-state-error");
});

// ── validateCleanPlan ─────────────────────────────────────────────────────────

// Test 9: no drift → returns plan with validatedAt.
test("validateCleanPlan happy: no drift → returns plan with validatedAt", async () => {
  const home = makeSyntheticHome();
  addUnreferencedCache(home);

  const plan = await composeCleanPlan(home, { target: "plugin.cache_unreferenced" });
  const validated = await validateCleanPlan(plan, home);

  assert.equal(typeof validated.validatedAt, "string");
  assert.ok(validated.validatedAt.length > 0);
  assert.equal(validated.reportHash, plan.reportHash);
  assert.equal(validated.operations.length, 1);
});

// Test 8: home state changes after compose → throws PlanDriftError.
test("validateCleanPlan drift: home state changes after compose → throws PlanDriftError", async () => {
  const home = makeSyntheticHome();
  addUnreferencedCache(home);

  const plan = await composeCleanPlan(home, { target: "plugin.cache_unreferenced" });

  // Add a second unreferenced cache to change the report hash.
  addUnreferencedCache(home, { plugin: "other-tool", version: "1.0.0" });

  await assert.rejects(
    () => validateCleanPlan(plan, home),
    (err) => {
      assert.ok(err instanceof PlanDriftError);
      assert.equal(err.code, "plan-drift");
      assert.equal(err.expectedHash, plan.reportHash);
      return true;
    }
  );
});

// ── executeCleanPlan ──────────────────────────────────────────────────────────

// Test 10: full snapshot → apply → verify cycle.
test("executeCleanPlan happy: manifest reaches verified, target dir gone, lockfile unlinked", async () => {
  const home = makeSyntheticHome();
  // Write extra file before setting mtime so addUnreferencedCache's utimes call
  // covers both the dir and its contents (writing data.txt after would reset the dir mtime).
  const cacheParent = path.join(home, "plugins", "cache", "test-market", "test-tool", "0.9.0");
  mkdirSync(cacheParent, { recursive: true });
  writeFileSync(path.join(cacheParent, "plugin.json"), JSON.stringify({ name: "test-tool", version: "0.9.0" }) + "\n");
  writeFileSync(path.join(cacheParent, "data.txt"), "cache data\n");
  const longAgoSec = (Date.now() - 30 * 24 * 60 * 60 * 1000) / 1000;
  utimesSync(cacheParent, longAgoSec, longAgoSec);
  const cacheDir = cacheParent;

  const plan = await composeCleanPlan(home, { target: "plugin.cache_unreferenced" });
  const validated = await validateCleanPlan(plan, home);
  const manifest = await executeCleanPlan(validated, home);

  assert.equal(manifest.status, "verified");

  const dirGone = !(await fileExists(cacheDir));
  assert.ok(dirGone, "cache directory should be deleted after execute");

  // Lockfile lives at home/housekeeper/lock (home = .claude dir).
  const lockPath = path.join(home, "housekeeper", "lock");
  const lockGone = !(await fileExists(lockPath));
  assert.ok(lockGone, "lockfile should be released after execute");
});

// Test 11: fresh lockfile present → throws LockHeldError.
test("executeCleanPlan refused-by-lock: fresh lockfile → throws LockHeldError", async () => {
  const home = makeSyntheticHome();
  addUnreferencedCache(home);

  // Lockfile at home/housekeeper/lock (home = .claude dir convention).
  const lockDir = path.join(home, "housekeeper");
  await mkdir(lockDir, { recursive: true });
  const lockPath = path.join(lockDir, "lock");
  const now = new Date();
  await writeFile(lockPath, JSON.stringify({
    pid: 99999,
    hostname: "test-host",
    opId: "op_20260101000000_ffffffff",
    startedAt: now.toISOString(),
    stalenessAt: new Date(now.getTime() + 30 * 60 * 1000).toISOString()
  }) + "\n");

  const plan = await composeCleanPlan(home, { target: "plugin.cache_unreferenced" });

  await assert.rejects(
    () => executeCleanPlan(plan, home),
    (err) => {
      assert.ok(err instanceof LockHeldError);
      assert.equal(err.code, "lock-held");
      assert.ok(err.lockManifest);
      return true;
    }
  );
});

// Test 12: executeCleanPlan releases lockfile even when inner step fails.
test("executeCleanPlan releases lockfile after inner failure", async () => {
  const home = makeSyntheticHome();
  const cacheDir = addUnreferencedCache(home);

  const plan = await composeCleanPlan(home, { target: "plugin.cache_unreferenced" });

  // Point expandedFiles at a nonexistent path to trigger a failure inside execute.
  const badPlan = {
    ...plan,
    operations: plan.operations.map((op) => ({
      ...op,
      expandedFiles: [path.join(cacheDir, "nonexistent-ghost-file.txt")]
    }))
  };

  let threw = false;
  try {
    await executeCleanPlan(badPlan, home);
  } catch {
    threw = true;
  }
  assert.ok(threw, "executeCleanPlan should throw on inner failure");

  const lockPath = path.join(home, "housekeeper", "lock");
  const lockGone = !(await fileExists(lockPath));
  assert.ok(lockGone, "lockfile must be released even after failure");
});

// ── Phase 10 helpers: file-unlink cleanable detectors ────────────────────────

function addStaleLock(home, { stalenessIso } = {}) {
  const lockDir = path.join(home, "housekeeper");
  mkdirSync(lockDir, { recursive: true });
  const lockPath = path.join(lockDir, "lock");
  const staleAt = stalenessIso || new Date(Date.now() - 60 * 60 * 1000).toISOString();
  writeFileSync(
    lockPath,
    JSON.stringify({ pid: 99999, hostname: "test", opId: "op_stale", startedAt: staleAt, stalenessAt: staleAt }) + "\n"
  );
  return lockPath;
}

function addLocalCommandIdentical(home, { market = "test-market", plugin = "test-plug", version = "1.0.0", name = "shared-cmd", body = "# shared command\n" } = {}) {
  const localDir = path.join(home, "commands");
  mkdirSync(localDir, { recursive: true });
  const localPath = path.join(localDir, `${name}.md`);
  writeFileSync(localPath, body);
  const pluginCmdDir = path.join(home, "plugins", "cache", market, plugin, version, "commands");
  mkdirSync(pluginCmdDir, { recursive: true });
  writeFileSync(path.join(pluginCmdDir, `${name}.md`), body);
  writeFileSync(
    path.join(home, "plugins", "cache", market, plugin, version, "plugin.json"),
    JSON.stringify({ name: plugin, version }) + "\n"
  );
  // Register the plugin so collectPluginResources walks its commands dir.
  // flattenPluginEntries defaults installPath to <home>/plugins/cache/<m>/<p>/<v>.
  const registryPath = path.join(home, "plugins", "installed_plugins.json");
  const registry = { plugins: [{ marketplace: market, name: plugin, version }] };
  writeFileSync(registryPath, JSON.stringify(registry, null, 2) + "\n");
  return localPath;
}

// ── Phase 10 tests ───────────────────────────────────────────────────────────

test("Phase 10 compose: housekeeper.stale_lock → 1 file-unlink operation", async () => {
  const home = makeSyntheticHome();
  const lockPath = addStaleLock(home);
  const plan = await composeCleanPlan(home, {
    target: "housekeeper.stale_lock",
    path: lockPath
  });
  assert.equal(plan.refused.length, 0, `unexpected refusals: ${JSON.stringify(plan.refused)}`);
  assert.equal(plan.operations.length, 1);
  assert.equal(plan.operations[0].mutationKind, "file-unlink");
  assert.equal(plan.operations[0].mutationOp.args.path, lockPath);
});

test("Phase 10 compose: registry.local_command_identical → 1 file-unlink operation", async () => {
  const home = makeSyntheticHome();
  const localPath = addLocalCommandIdentical(home);
  const plan = await composeCleanPlan(home, {
    target: "registry.local_command_identical",
    path: localPath
  });
  assert.equal(plan.refused.length, 0, `unexpected refusals: ${JSON.stringify(plan.refused)}`);
  assert.equal(plan.operations.length, 1);
  assert.equal(plan.operations[0].mutationKind, "file-unlink");
  assert.equal(plan.operations[0].mutationOp.args.path, localPath);
});

test("Phase 10 compose: registry.local_command_identical under doNotTouch → protected-path", async () => {
  const home = makeSyntheticHome();
  const localPath = addLocalCommandIdentical(home, { name: "protected-cmd" });
  const cfgDir = path.join(home, "housekeeper");
  mkdirSync(cfgDir, { recursive: true });
  const config = { doNotTouch: [{ path: "commands/protected-cmd.md", reason: "hand-maintained" }] };
  writeFileSync(path.join(cfgDir, "config.json"), JSON.stringify(config) + "\n");
  const plan = await composeCleanPlan(home, {
    target: "registry.local_command_identical",
    path: localPath
  });
  assert.equal(plan.operations.length, 0);
  assert.equal(plan.refused.length, 1);
  assert.equal(plan.refused[0].reason, "protected-path");
});

test("Phase 10 execute: registry.local_command_identical → file deleted, manifest verified", async () => {
  const home = makeSyntheticHome();
  const localPath = addLocalCommandIdentical(home);
  const plan = await composeCleanPlan(home, {
    target: "registry.local_command_identical",
    path: localPath
  });
  const validated = await validateCleanPlan(plan, home);
  const result = await executeCleanPlan(validated, home);
  assert.equal(result.status, "verified");
  assert.equal(existsSyncImport(localPath), false, "local command file should be deleted");
});
