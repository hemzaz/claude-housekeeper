// Integration tests for the harden-plan pipeline (T-204).
// Covers T-200 (composeHardenPlan), T-201 (validateHardenPlan),
// T-202 (executeHardenPlan), T-203 (refusal taxonomy).
//
// Per docs/design/v0.3-design.md §3.2 (pipeline) and §3.3 (refusal classes).

import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, statSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  composeHardenPlan,
  validateHardenPlan,
  executeHardenPlan,
  HardenPlanRefusal,
  HardenPlanDriftError,
  HardenLockHeldError
} from "../scripts/lib/harden-plan.mjs";

// ── helpers ───────────────────────────────────────────────────────────────

// audit.mjs treats `home` as the .claude dir; snapshot.mjs uses dirname(home)
// as its operations root. Match clean-plan.test.mjs convention exactly.
function makeSyntheticHome() {
  const home = mkdtempSync(path.join(tmpdir(), "ck-hrd-test-"));
  mkdirSync(path.join(home, "plugins"), { recursive: true });
  return home;
}

// Seed settings.json with a hook command pointing at a plugin cache path that
// does not exist. Fires settings.hook_path_dangling (a real detector). Used as
// the canonical hardenable target for Phase 2 testing via __overrideHardenable.
function seedDanglingHookSettings(home, { extraKeys = {} } = {}) {
  const settingsPath = path.join(home, "settings.json");
  const missingCachePath = path.join(home, "plugins", "cache", "ghost-mp", "ghost-plug", "1.0.0", "hook.sh");
  const settings = {
    ...extraKeys,
    hooks: {
      PreToolUse: [{
        matcher: "Bash",
        hooks: [{ type: "command", command: missingCachePath }]
      }]
    }
  };
  writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n");
  return { settingsPath, missingCachePath };
}

const HARDENABLE_OVERRIDE = ["settings.hook_path_dangling"];

// ── T-200 happy path ────────────────────────────────────────────────────

test("composeHardenPlan happy path: hardenable detector → 1 operation, 0 refusals, settings-rewrite kind", async () => {
  const home = makeSyntheticHome();
  const { settingsPath } = seedDanglingHookSettings(home);

  const plan = await composeHardenPlan(home, {
    target: "settings.hook_path_dangling",
    path: settingsPath,
    __overrideHardenable: HARDENABLE_OVERRIDE
  });

  assert.equal(plan.schemaVersion, "0.2");
  assert.equal(plan.refused.length, 0, `unexpected refusals: ${JSON.stringify(plan.refused)}`);
  assert.equal(plan.operations.length, 1);
  assert.equal(plan.operations[0].mutationKind, "settings-rewrite");
  assert.equal(plan.operations[0].detectorId, "settings.hook_path_dangling");
  assert.equal(plan.operations[0].targetPath, settingsPath);
  assert.equal(typeof plan.reportHash, "string");
  assert.ok(plan.reportHash.length > 0);
});

// ── T-203: refusal taxonomy — each new class ────────────────────────────

test("compose refusal: no-finding-for-target when detector emits no findings", async () => {
  const home = makeSyntheticHome();
  // No settings file: the audit emits home.clean / orientation only.
  writeFileSync(path.join(home, "settings.json"), "{}\n");
  const plan = await composeHardenPlan(home, {
    target: "settings.hook_path_dangling",
    path: path.join(home, "settings.json"),
    __overrideHardenable: HARDENABLE_OVERRIDE
  });
  assert.equal(plan.operations.length, 0);
  assert.equal(plan.refused.length, 1);
  assert.equal(plan.refused[0].reason, "no-finding-for-target");
  assert.ok(plan.refused[0].nextStep.length > 0);
});

test("compose refusal: no-mutation-mapping-in-v0.3 for non-hardenable detector", async () => {
  const home = makeSyntheticHome();
  const { settingsPath } = seedDanglingHookSettings(home);
  // No __overrideHardenable → detector is NOT in the v0.3 set.
  const plan = await composeHardenPlan(home, {
    target: "settings.hook_path_dangling",
    path: settingsPath
  });
  assert.equal(plan.operations.length, 0);
  assert.equal(plan.refused.length, 1);
  assert.equal(plan.refused[0].reason, "no-mutation-mapping-in-v0.3");
  assert.ok(plan.refused[0].nextStep.length > 0);
});

test("compose refusal: settings-jsonc-detected when settings.json contains // comments", async () => {
  const home = makeSyntheticHome();
  const settingsPath = path.join(home, "settings.json");
  // Valid-shape JSONC: a `//` line comment. Strict JSON.parse fails; the
  // tokenizer in audit.mjs hasJsonComments returns true → JSONC refusal.
  // Must ALSO trigger the detector — but settings_invalid_json fires only when
  // strict parse fails AND raw has no comments. We need a non-JSONC dangling-
  // hook source to seed the detector finding. Workaround: seed the detector
  // first, then overwrite the file with JSONC content. The detector hash in
  // composeHardenPlan re-runs assembleReport, so the dangling-hook finding
  // does NOT fire on the JSONC version (JSON.parse fails). Use a different
  // approach: seed JSONC content that StRICT JSON cannot parse and which
  // therefore fires settings.jsonc_detected, then point our hardenable
  // override at that detector.
  writeFileSync(settingsPath, `// hello\n{\n  "hooks": {}\n}\n`);
  const plan = await composeHardenPlan(home, {
    target: "settings.jsonc_detected",
    path: settingsPath,
    __overrideHardenable: ["settings.jsonc_detected"]
  });
  // The detector emits a finding; preApply runs and refuses with JSONC class.
  assert.equal(plan.operations.length, 0);
  assert.equal(plan.refused.length, 1);
  assert.equal(plan.refused[0].reason, "settings-jsonc-detected");
  assert.ok(plan.refused[0].nextStep.includes("Strip comments"));
});

test("compose refusal: settings-shape-unknown when settings.json is malformed without comments", async () => {
  const home = makeSyntheticHome();
  const settingsPath = path.join(home, "settings.json");
  // Unbalanced braces: strict parse fails, no JSONC comments → shape-unknown.
  writeFileSync(settingsPath, `{ "hooks": { "PreToolUse": [\n`);
  const plan = await composeHardenPlan(home, {
    target: "settings.invalid_json",
    path: settingsPath,
    __overrideHardenable: ["settings.invalid_json"]
  });
  assert.equal(plan.operations.length, 0);
  assert.equal(plan.refused.length, 1);
  assert.equal(plan.refused[0].reason, "settings-shape-unknown");
  assert.ok(plan.refused[0].nextStep.includes("documented schema"));
});

test("compose refusal: settings-network-filesystem when __forceNetworkFs is set", async () => {
  const home = makeSyntheticHome();
  const { settingsPath } = seedDanglingHookSettings(home);
  const plan = await composeHardenPlan(home, {
    target: "settings.hook_path_dangling",
    path: settingsPath,
    __overrideHardenable: HARDENABLE_OVERRIDE,
    __forceNetworkFs: true
  });
  assert.equal(plan.operations.length, 0);
  assert.equal(plan.refused.length, 1);
  assert.equal(plan.refused[0].reason, "settings-network-filesystem");
  assert.ok(plan.refused[0].nextStep.includes("local filesystem"));
});

test("compose refusal: settings-network-filesystem when marker file exists in parent", async () => {
  const home = makeSyntheticHome();
  const { settingsPath } = seedDanglingHookSettings(home);
  // Drop the FS marker beside settings.json.
  writeFileSync(path.join(home, ".housekeeper-network-fs"), "");
  const plan = await composeHardenPlan(home, {
    target: "settings.hook_path_dangling",
    path: settingsPath,
    __overrideHardenable: HARDENABLE_OVERRIDE
  });
  assert.equal(plan.refused.length, 1);
  assert.equal(plan.refused[0].reason, "settings-network-filesystem");
});

// ── T-203: shared-classifier refusals (rules 1-9 from clean-plan) ───────

test("compose refusal: plan-state-error when interrupted operation manifest exists", async () => {
  const home = makeSyntheticHome();
  const { settingsPath } = seedDanglingHookSettings(home);
  const opsDir = path.join(home, "housekeeper", "operations");
  await mkdir(opsDir, { recursive: true });
  await writeFile(path.join(opsDir, "op_20260101000000_abcd1234.json"), JSON.stringify({
    opId: "op_20260101000000_abcd1234",
    status: "applied",
    startedAt: new Date().toISOString()
  }) + "\n");
  const plan = await composeHardenPlan(home, {
    target: "settings.hook_path_dangling",
    path: settingsPath,
    __overrideHardenable: HARDENABLE_OVERRIDE
  });
  assert.equal(plan.operations.length, 0);
  assert.ok(plan.refused.length > 0);
  assert.equal(plan.refused[0].reason, "plan-state-error");
});

test("compose refusal: protected-path when target is under doNotTouch", async () => {
  const home = makeSyntheticHome();
  const { settingsPath } = seedDanglingHookSettings(home);
  const cfgDir = path.join(home, "housekeeper");
  mkdirSync(cfgDir, { recursive: true });
  writeFileSync(path.join(cfgDir, "config.json"), JSON.stringify({
    doNotTouch: [{ path: settingsPath, reason: "hand-maintained" }]
  }) + "\n");
  const plan = await composeHardenPlan(home, {
    target: "settings.hook_path_dangling",
    path: settingsPath,
    __overrideHardenable: HARDENABLE_OVERRIDE
  });
  assert.equal(plan.operations.length, 0);
  assert.ok(plan.refused.length > 0);
  assert.equal(plan.refused[0].reason, "protected-path");
});

// ── T-201: validateHardenPlan ───────────────────────────────────────────

test("validateHardenPlan happy: no drift → returns plan with validatedAt", async () => {
  const home = makeSyntheticHome();
  const { settingsPath } = seedDanglingHookSettings(home);

  const plan = await composeHardenPlan(home, {
    target: "settings.hook_path_dangling",
    path: settingsPath,
    __overrideHardenable: HARDENABLE_OVERRIDE
  });
  const validated = await validateHardenPlan(plan, home);

  assert.equal(typeof validated.validatedAt, "string");
  assert.ok(validated.validatedAt.length > 0);
  assert.equal(validated.reportHash, plan.reportHash);
  assert.equal(validated.operations.length, 1);
});

test("validateHardenPlan drift: report hash changed after compose → throws HardenPlanDriftError", async () => {
  const home = makeSyntheticHome();
  const { settingsPath } = seedDanglingHookSettings(home);

  const plan = await composeHardenPlan(home, {
    target: "settings.hook_path_dangling",
    path: settingsPath,
    __overrideHardenable: HARDENABLE_OVERRIDE
  });

  // Add a second dangling hook to change the report hash.
  const newCachePath = path.join(home, "plugins", "cache", "ghost-mp2", "p2", "1.0.0", "hook.sh");
  const updatedSettings = {
    hooks: {
      PreToolUse: [{
        matcher: "Bash",
        hooks: [
          { type: "command", command: path.join(home, "plugins", "cache", "ghost-mp", "ghost-plug", "1.0.0", "hook.sh") },
          { type: "command", command: newCachePath }
        ]
      }]
    }
  };
  writeFileSync(settingsPath, JSON.stringify(updatedSettings, null, 2) + "\n");

  await assert.rejects(
    () => validateHardenPlan(plan, home),
    (err) => {
      assert.ok(err instanceof HardenPlanDriftError);
      assert.equal(err.code, "plan-drift");
      assert.equal(err.expectedHash, plan.reportHash);
      return true;
    }
  );
});

test("validateHardenPlan drift: settings file became invalid → throws HardenPlanDriftError", async () => {
  const home = makeSyntheticHome();
  const { settingsPath } = seedDanglingHookSettings(home);

  const plan = await composeHardenPlan(home, {
    target: "settings.hook_path_dangling",
    path: settingsPath,
    __overrideHardenable: HARDENABLE_OVERRIDE
  });

  // Corrupt the file between compose and validate. Report hash WILL change too
  // (different findings), so PlanDriftError fires on report-hash mismatch.
  writeFileSync(settingsPath, "{ broken\n");

  await assert.rejects(
    () => validateHardenPlan(plan, home),
    HardenPlanDriftError
  );
});

// ── T-202: executeHardenPlan ────────────────────────────────────────────

test("executeHardenPlan happy: manifest reaches verified, lockfile released, settings still valid JSON", async () => {
  const home = makeSyntheticHome();
  const { settingsPath } = seedDanglingHookSettings(home);

  const plan = await composeHardenPlan(home, {
    target: "settings.hook_path_dangling",
    path: settingsPath,
    __overrideHardenable: HARDENABLE_OVERRIDE
  });
  const validated = await validateHardenPlan(plan, home);
  const manifest = await executeHardenPlan(validated, home);

  assert.equal(manifest.status, "verified");

  // settings.json must still be valid JSON after harden (identity patch in
  // Phase 2 — Phase 3 detector promotion will produce real mutations).
  const after = readFileSync(settingsPath, "utf8");
  assert.doesNotThrow(() => JSON.parse(after));

  // Lockfile released.
  const lockPath = path.join(home, "housekeeper", "lock");
  assert.equal(existsSync(lockPath), false, "lockfile must be released after execute");
});

test("executeHardenPlan: fresh lockfile present → throws HardenLockHeldError", async () => {
  const home = makeSyntheticHome();
  const { settingsPath } = seedDanglingHookSettings(home);

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

  const plan = await composeHardenPlan(home, {
    target: "settings.hook_path_dangling",
    path: settingsPath,
    __overrideHardenable: HARDENABLE_OVERRIDE
  });

  await assert.rejects(
    () => executeHardenPlan(plan, home),
    (err) => {
      assert.ok(err instanceof HardenLockHeldError);
      assert.equal(err.code, "lock-held");
      assert.ok(err.lockManifest);
      return true;
    }
  );
});

test("executeHardenPlan: stale lockfile → proceeds and overwrites", async () => {
  const home = makeSyntheticHome();
  const { settingsPath } = seedDanglingHookSettings(home);

  const lockDir = path.join(home, "housekeeper");
  await mkdir(lockDir, { recursive: true });
  const lockPath = path.join(lockDir, "lock");
  // staleness in the past → not held.
  const past = new Date(Date.now() - 60 * 60 * 1000);
  await writeFile(lockPath, JSON.stringify({
    pid: 99998,
    hostname: "old-host",
    opId: "op_19700101000000_deadbeef",
    startedAt: past.toISOString(),
    stalenessAt: past.toISOString()
  }) + "\n");

  const plan = await composeHardenPlan(home, {
    target: "settings.hook_path_dangling",
    path: settingsPath,
    __overrideHardenable: HARDENABLE_OVERRIDE
  });
  const validated = await validateHardenPlan(plan, home);
  const manifest = await executeHardenPlan(validated, home);
  assert.equal(manifest.status, "verified");
  // Lock released after run.
  assert.equal(existsSync(lockPath), false);
});

// ── G7: nextStep present on every refusal ───────────────────────────────

test("G7 nextStep: every harden refusal carries a non-empty nextStep", async () => {
  const home = makeSyntheticHome();
  const { settingsPath } = seedDanglingHookSettings(home);
  // Use a non-hardenable detector to fire no-mutation-mapping-in-v0.3.
  const plan = await composeHardenPlan(home, {
    target: "settings.hook_path_dangling",
    path: settingsPath
  });
  assert.ok(plan.refused.length > 0);
  for (const r of plan.refused) {
    assert.equal(typeof r.nextStep, "string", `refusal ${r.reason} must have a string nextStep`);
    assert.ok(r.nextStep.length > 0, `refusal ${r.reason} must have non-empty nextStep`);
    assert.equal(r.class, "HardenPlanRefusal");
    assert.equal(r.exitCode, 2);
  }
});

// ── T-203: HardenPlanRefusal class shape ────────────────────────────────

test("HardenPlanRefusal: error class shape (name, reason, exitCode)", () => {
  const r = new HardenPlanRefusal({
    reason: "settings-jsonc-detected",
    targetPath: "/tmp/x/settings.json",
    detectorId: "settings.hook_path_dangling",
    message: "test"
  });
  assert.equal(r.name, "HardenPlanRefusal");
  assert.equal(r.reason, "settings-jsonc-detected");
  assert.equal(r.targetPath, "/tmp/x/settings.json");
  assert.equal(r.exitCode, 2);
  assert.ok(r instanceof Error);
});

// ── T-203: HardenPlanDriftError / HardenLockHeldError shapes ────────────

test("HardenPlanDriftError: code and hashes are surfaced", () => {
  const err = new HardenPlanDriftError("a", "b");
  assert.equal(err.code, "plan-drift");
  assert.equal(err.expectedHash, "a");
  assert.equal(err.actualHash, "b");
  assert.ok(err instanceof Error);
});

test("HardenLockHeldError: code and lockManifest are surfaced", () => {
  const manifest = { pid: 1, hostname: "h", opId: "o" };
  const err = new HardenLockHeldError(manifest);
  assert.equal(err.code, "lock-held");
  assert.equal(err.lockManifest, manifest);
  assert.ok(err instanceof Error);
});

// ── Idempotency: re-running compose+validate is safe ─────────────────────

test("compose is idempotent: re-running yields the same reportHash", async () => {
  const home = makeSyntheticHome();
  const { settingsPath } = seedDanglingHookSettings(home);

  const plan1 = await composeHardenPlan(home, {
    target: "settings.hook_path_dangling",
    path: settingsPath,
    __overrideHardenable: HARDENABLE_OVERRIDE
  });
  const plan2 = await composeHardenPlan(home, {
    target: "settings.hook_path_dangling",
    path: settingsPath,
    __overrideHardenable: HARDENABLE_OVERRIDE
  });

  assert.equal(plan1.reportHash, plan2.reportHash);
  assert.equal(plan1.operations.length, plan2.operations.length);
});

// ── Lock contention vs. release: lock is released even on inner failure ───

test("executeHardenPlan releases lockfile even when apply fails", async () => {
  const home = makeSyntheticHome();
  const { settingsPath } = seedDanglingHookSettings(home);

  const plan = await composeHardenPlan(home, {
    target: "settings.hook_path_dangling",
    path: settingsPath,
    __overrideHardenable: HARDENABLE_OVERRIDE
  });
  const validated = await validateHardenPlan(plan, home);

  // Make the settings file unreadable mid-flight by replacing the validated
  // plan's targetPath with a path that disappears after snapshot. Simpler
  // approach: delete the file between validate and execute. applyOperation's
  // pre-apply drift check will throw before any mutation.
  // The snapshot step takes a snapshot first; sha256Before will be captured.
  // Then applyOperation re-hashes — but the file would be gone, so hashFile
  // throws ENOENT. That throw bubbles out of executeHardenPlan and the
  // finally{} block must still release the lock.
  // Sequence: snapshot (file exists, hashed) → delete → applyOperation throws.
  // To trigger a throw AFTER snapshot, we override the validated plan's
  // mutationOp targetPath to a non-writeable path during apply. The cleanest
  // hook is to inject a path that disappears between snapshot and apply by
  // using a fixture where the snapshot path is read-only.
  // Easier: corrupt the validated plan by zeroing its operations array AFTER
  // a successful snapshot would have run. We instead point at an already-
  // missing target — takeSnapshot itself throws (ENOENT in lstat) → finally
  // releases.
  const badPlan = {
    ...validated,
    operations: validated.operations.map((op) => ({
      ...op,
      targetPath: path.join(home, "does-not-exist.json"),
      mutationOp: { ...op.mutationOp, targetPath: path.join(home, "does-not-exist.json") }
    }))
  };

  let threw = false;
  try {
    await executeHardenPlan(badPlan, home);
  } catch {
    threw = true;
  }
  assert.ok(threw, "executeHardenPlan should throw on inner failure");

  const lockPath = path.join(home, "housekeeper", "lock");
  assert.equal(existsSync(lockPath), false, "lockfile must be released even after failure");
});

// ── Snapshot proof: after executeHardenPlan, a snapshot file exists with
//    the original content for rollback ────────────────────────────────────

test("executeHardenPlan writes a snapshot manifest that records the pre-apply file", async () => {
  const home = makeSyntheticHome();
  const { settingsPath } = seedDanglingHookSettings(home);
  const originalBytes = readFileSync(settingsPath);

  const plan = await composeHardenPlan(home, {
    target: "settings.hook_path_dangling",
    path: settingsPath,
    __overrideHardenable: HARDENABLE_OVERRIDE
  });
  const validated = await validateHardenPlan(plan, home);
  const manifest = await executeHardenPlan(validated, home);

  assert.equal(manifest.status, "verified");
  assert.equal(manifest.files.length, 1);
  const fileEntry = manifest.files[0];
  // sha256Before recorded matches the pre-apply file content.
  const beforeBytes = readFileSync(fileEntry.snapshotPath);
  assert.deepEqual(beforeBytes, originalBytes, "snapshot file holds the pre-apply bytes");
  assert.ok(statSync(fileEntry.snapshotPath).size > 0);
});

// ── Plan shape: schemaVersion is "0.2" (no bump per design §C12) ────────

test("HardenPlan: schemaVersion stays at '0.2' (no schema bump in v0.3)", async () => {
  const home = makeSyntheticHome();
  const { settingsPath } = seedDanglingHookSettings(home);
  const plan = await composeHardenPlan(home, {
    target: "settings.hook_path_dangling",
    path: settingsPath,
    __overrideHardenable: HARDENABLE_OVERRIDE
  });
  assert.equal(plan.schemaVersion, "0.2");
});

// ── allowedExecutionClasses default ──────────────────────────────────────

test("composeHardenPlan default allowedExecutionClasses includes inert + known-execution-context", async () => {
  const home = makeSyntheticHome();
  const { settingsPath } = seedDanglingHookSettings(home);
  // Just exercises the default: passing nothing must not surface an
  // execution-class refusal for settings.json (classified as inert).
  const plan = await composeHardenPlan(home, {
    target: "settings.hook_path_dangling",
    path: settingsPath,
    __overrideHardenable: HARDENABLE_OVERRIDE
  });
  const execClass = plan.refused.filter((r) => r.reason === "execution-class");
  assert.equal(execClass.length, 0, "default set must permit settings.json executionClass");
});

// ── Reused refusal: rule 8 (cache referenced by hook) is NOT applicable
//    to settings targets — sanity-check it does not fire spuriously ──────

test("compose does not spuriously fire plugin-cache-referenced-by-hook for settings targets", async () => {
  const home = makeSyntheticHome();
  const { settingsPath } = seedDanglingHookSettings(home);
  const plan = await composeHardenPlan(home, {
    target: "settings.hook_path_dangling",
    path: settingsPath,
    __overrideHardenable: HARDENABLE_OVERRIDE
  });
  const wrong = plan.refused.filter((r) => r.reason === "plugin-cache-referenced-by-hook");
  assert.equal(wrong.length, 0);
});
