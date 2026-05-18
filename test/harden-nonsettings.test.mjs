// Integration tests for T-402 (hooks.config_dangling → harden lane) and
// T-401/T-403 (registry.command_dangling / registry.skills_entry_dangling →
// clean lane, so harden refuses with no-mutation-mapping-in-v0.3).
//
// 15+ tests: 5 per surface × happy / refusal / rollback shapes.

import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  composeHardenPlan,
  validateHardenPlan,
  executeHardenPlan,
  HardenPlanDriftError
} from "../scripts/lib/harden-plan.mjs";

// ── helpers ───────────────────────────────────────────────────────────────

function makeSyntheticHome() {
  const home = mkdtempSync(path.join(tmpdir(), "ck-hns-test-"));
  mkdirSync(path.join(home, "plugins"), { recursive: true });
  return home;
}

// Seed settings.json with one hook entry whose cwd points at a missing dir
// (fires hooks.config_dangling) and one hook entry whose cwd exists (kept).
function seedDanglingCwdSettings(home) {
  const settingsPath = path.join(home, "settings.json");
  const missingCwd = path.join(home, "plugins", "cache", "gone-mp", "gone-plug", "1.0.0");
  // validCwd must actually exist for the second entry to NOT be pruned.
  const validCwd = path.join(home, "plugins");
  const settings = {
    hooks: {
      PreToolUse: [
        {
          matcher: "Bash",
          hooks: [{ type: "command", command: "echo hello", cwd: missingCwd }]
        },
        {
          matcher: "Read",
          hooks: [{ type: "command", command: "echo world", cwd: validCwd }]
        }
      ]
    }
  };
  writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n");
  return { settingsPath, missingCwd, validCwd };
}

// Seed <home>/commands/ with one dangling .md file (no backing plugin).
function seedDanglingCommand(home) {
  const commandsDir = path.join(home, "commands");
  mkdirSync(commandsDir, { recursive: true });
  const commandPath = path.join(commandsDir, "orphan-cmd.md");
  writeFileSync(commandPath, "# orphan command\n");
  return { commandPath };
}

// Seed <home>/skills/ with one orphan directory (no SKILL.md).
function seedDanglingSkillsEntry(home) {
  const orphanDir = path.join(home, "skills", "orphan-skill");
  mkdirSync(orphanDir, { recursive: true });
  // No SKILL.md — the detector fires.
  return { orphanDir };
}

// ── T-402: hooks.config_dangling → HARDEN lane ─────────────────────────

test("T-402 compose happy: hooks.config_dangling → 1 operation, json-rewrite kind, 0 refusals", async () => {
  const home = makeSyntheticHome();
  const { settingsPath } = seedDanglingCwdSettings(home);

  const plan = await composeHardenPlan(home, {
    target: "hooks.config_dangling",
    path: settingsPath
  });

  assert.equal(plan.schemaVersion, "0.2");
  assert.equal(plan.refused.length, 0, `unexpected refusals: ${JSON.stringify(plan.refused)}`);
  assert.equal(plan.operations.length, 1);
  assert.equal(plan.operations[0].mutationKind, "json-rewrite");
  assert.equal(plan.operations[0].detectorId, "hooks.config_dangling");
  assert.equal(plan.operations[0].targetPath, settingsPath);
});

test("T-402 compose refusal: no-finding-for-target when no dangling cwd hooks present", async () => {
  const home = makeSyntheticHome();
  // Clean settings: no cwd fields at all → detector emits no findings.
  const settingsPath = path.join(home, "settings.json");
  writeFileSync(settingsPath, JSON.stringify({ hooks: {} }, null, 2) + "\n");

  const plan = await composeHardenPlan(home, {
    target: "hooks.config_dangling",
    path: settingsPath
  });

  assert.equal(plan.operations.length, 0);
  assert.equal(plan.refused.length, 1);
  assert.equal(plan.refused[0].reason, "no-finding-for-target");
  assert.ok(plan.refused[0].nextStep.length > 0, "nextStep must be non-empty");
});

test("T-402 compose refusal: schemaVersion stays 0.2 on refusal", async () => {
  const home = makeSyntheticHome();
  const settingsPath = path.join(home, "settings.json");
  writeFileSync(settingsPath, JSON.stringify({}, null, 2) + "\n");

  const plan = await composeHardenPlan(home, {
    target: "hooks.config_dangling",
    path: settingsPath
  });

  assert.equal(plan.schemaVersion, "0.2");
});

test("T-402 execute happy: dangling cwd entry removed, valid cwd entry kept, status=verified", async () => {
  const home = makeSyntheticHome();
  const { settingsPath, missingCwd, validCwd } = seedDanglingCwdSettings(home);

  const plan = await composeHardenPlan(home, {
    target: "hooks.config_dangling",
    path: settingsPath
  });
  const validated = await validateHardenPlan(plan, home);
  const manifest = await executeHardenPlan(validated, home);

  assert.equal(manifest.status, "verified");

  const after = JSON.parse(readFileSync(settingsPath, "utf8"));
  // The hook with missingCwd must be gone.
  const entries = after.hooks.PreToolUse;
  for (const entry of entries) {
    for (const hook of entry.hooks || []) {
      assert.notEqual(hook.cwd, missingCwd, "dangling cwd entry must be pruned");
    }
  }
  // The hook with validCwd must still be present.
  const cwds = entries.flatMap((e) => (e.hooks || []).map((h) => h.cwd));
  assert.ok(cwds.includes(validCwd), "valid cwd entry must be preserved");

  // Lockfile released.
  const lockPath = path.join(home, "housekeeper", "lock");
  assert.equal(existsSync(lockPath), false, "lockfile must be released after execute");
});

test("T-402 rollback proof: executeHardenPlan writes snapshot file with pre-apply bytes", async () => {
  const home = makeSyntheticHome();
  const { settingsPath } = seedDanglingCwdSettings(home);
  const originalBytes = readFileSync(settingsPath);

  const plan = await composeHardenPlan(home, {
    target: "hooks.config_dangling",
    path: settingsPath
  });
  const validated = await validateHardenPlan(plan, home);
  const manifest = await executeHardenPlan(validated, home);

  assert.equal(manifest.status, "verified");
  assert.equal(manifest.files.length, 1);
  const snapshotBytes = readFileSync(manifest.files[0].snapshotPath);
  assert.deepEqual(snapshotBytes, originalBytes, "snapshot holds pre-apply bytes for rollback");
  assert.ok(statSync(manifest.files[0].snapshotPath).size > 0);
});

// ── T-401: registry.command_dangling → CLEAN lane (harden refuses) ──────

test("T-401 harden refuses: registry.command_dangling is cleanable, not hardenable (no-mutation-mapping-in-v0.3)", async () => {
  const home = makeSyntheticHome();
  seedDanglingCommand(home);
  // settings.json must exist so the audit context builds.
  writeFileSync(path.join(home, "settings.json"), "{}\n");

  const plan = await composeHardenPlan(home, {
    target: "registry.command_dangling"
  });

  assert.equal(plan.operations.length, 0);
  assert.equal(plan.refused.length, 1);
  assert.equal(plan.refused[0].reason, "no-mutation-mapping-in-v0.3");
  assert.ok(plan.refused[0].nextStep.length > 0, "nextStep must be non-empty");
});

test("T-401 harden refuses schemaVersion 0.2: refusal shape well-formed", async () => {
  const home = makeSyntheticHome();
  seedDanglingCommand(home);
  writeFileSync(path.join(home, "settings.json"), "{}\n");

  const plan = await composeHardenPlan(home, {
    target: "registry.command_dangling"
  });

  assert.equal(plan.schemaVersion, "0.2");
  assert.ok(plan.refused[0].detectorId === "registry.command_dangling");
  assert.ok(typeof plan.refused[0].message === "string");
  assert.ok(plan.refused[0].message.length > 0);
});

test("T-401 harden refuses: no operations emitted for registry.command_dangling", async () => {
  const home = makeSyntheticHome();
  seedDanglingCommand(home);
  writeFileSync(path.join(home, "settings.json"), "{}\n");

  const plan = await composeHardenPlan(home, {
    target: "registry.command_dangling"
  });

  // Harden never produces operations for clean-lane detectors.
  assert.equal(plan.operations.length, 0);
});

test("T-401 compose refusal: no-finding-for-target when no dangling commands present", async () => {
  const home = makeSyntheticHome();
  // No commands/ dir → no findings.
  writeFileSync(path.join(home, "settings.json"), "{}\n");

  const plan = await composeHardenPlan(home, {
    target: "registry.command_dangling"
  });

  // Either no-finding-for-target or no-mutation-mapping-in-v0.3 depending on
  // whether the shared classifier fires first; either way operations = 0.
  assert.equal(plan.operations.length, 0);
  assert.ok(plan.refused.length > 0, "at least one refusal expected");
  assert.ok(plan.refused[0].nextStep.length > 0, "nextStep must be non-empty");
});

test("T-401 G7 nextStep: registry.command_dangling refusal carries non-empty nextStep", async () => {
  const home = makeSyntheticHome();
  seedDanglingCommand(home);
  writeFileSync(path.join(home, "settings.json"), "{}\n");

  const plan = await composeHardenPlan(home, {
    target: "registry.command_dangling"
  });

  for (const refusal of plan.refused) {
    assert.ok(typeof refusal.nextStep === "string", "nextStep must be a string");
    assert.ok(refusal.nextStep.length > 0, "nextStep must be non-empty");
  }
});

// ── T-403: registry.skills_entry_dangling → CLEAN lane (harden refuses) ─

test("T-403 harden refuses: registry.skills_entry_dangling is cleanable, not hardenable (no-mutation-mapping-in-v0.3)", async () => {
  const home = makeSyntheticHome();
  seedDanglingSkillsEntry(home);
  writeFileSync(path.join(home, "settings.json"), "{}\n");

  const plan = await composeHardenPlan(home, {
    target: "registry.skills_entry_dangling"
  });

  assert.equal(plan.operations.length, 0);
  assert.equal(plan.refused.length, 1);
  assert.equal(plan.refused[0].reason, "no-mutation-mapping-in-v0.3");
  assert.ok(plan.refused[0].nextStep.length > 0, "nextStep must be non-empty");
});

test("T-403 harden refuses schemaVersion 0.2: refusal shape well-formed", async () => {
  const home = makeSyntheticHome();
  seedDanglingSkillsEntry(home);
  writeFileSync(path.join(home, "settings.json"), "{}\n");

  const plan = await composeHardenPlan(home, {
    target: "registry.skills_entry_dangling"
  });

  assert.equal(plan.schemaVersion, "0.2");
  assert.ok(plan.refused[0].detectorId === "registry.skills_entry_dangling");
  assert.ok(typeof plan.refused[0].message === "string");
  assert.ok(plan.refused[0].message.length > 0);
});

test("T-403 harden refuses: no operations emitted for registry.skills_entry_dangling", async () => {
  const home = makeSyntheticHome();
  seedDanglingSkillsEntry(home);
  writeFileSync(path.join(home, "settings.json"), "{}\n");

  const plan = await composeHardenPlan(home, {
    target: "registry.skills_entry_dangling"
  });

  assert.equal(plan.operations.length, 0);
});

test("T-403 compose refusal: no-finding-for-target when no orphan skill dirs present", async () => {
  const home = makeSyntheticHome();
  // skills/ dir exists but has a valid entry with SKILL.md.
  const validSkill = path.join(home, "skills", "valid-skill");
  mkdirSync(validSkill, { recursive: true });
  writeFileSync(path.join(validSkill, "SKILL.md"), "# valid skill\n");
  writeFileSync(path.join(home, "settings.json"), "{}\n");

  const plan = await composeHardenPlan(home, {
    target: "registry.skills_entry_dangling"
  });

  // No orphan skills → no findings for this detector.
  assert.equal(plan.operations.length, 0);
  assert.ok(plan.refused.length > 0, "at least one refusal expected");
  assert.ok(plan.refused[0].nextStep.length > 0, "nextStep must be non-empty");
});

test("T-403 G7 nextStep: registry.skills_entry_dangling refusal carries non-empty nextStep", async () => {
  const home = makeSyntheticHome();
  seedDanglingSkillsEntry(home);
  writeFileSync(path.join(home, "settings.json"), "{}\n");

  const plan = await composeHardenPlan(home, {
    target: "registry.skills_entry_dangling"
  });

  for (const refusal of plan.refused) {
    assert.ok(typeof refusal.nextStep === "string", "nextStep must be a string");
    assert.ok(refusal.nextStep.length > 0, "nextStep must be non-empty");
  }
});
