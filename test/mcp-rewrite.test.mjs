// T-204: tests for MCP rewrite beyond stripping (Phase 2, T-200..T-204).
//
// Covers: happy path, each of the 3 refusal classes, idempotency,
// snapshot+rollback round-trip, parser-level malformed-value rejection.

import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  chmodSync
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  composeHardenPlan,
  validateHardenPlan,
  executeHardenPlan,
  HardenPlanDriftError
} from "../scripts/lib/harden-plan.mjs";
import {
  composeRollbackPlan,
  validateRollbackPlan,
  executeRollbackPlan
} from "../scripts/lib/rollback-plan.mjs";
import { parseMcpCommandRewrite } from "../scripts/lib/harden-plan.mjs";

// ── helpers ──────────────────────────────────────────────────────────────────

// Create a parent dir with a nested .claude dir, matching rollback-plan.test.mjs
// convention: snapshot.mjs uses dirname(home) as snapshotHome and writes to
// snapshotHome/.claude/housekeeper/..., while composeRollbackPlan(home, opId)
// looks at home/housekeeper/operations/. Both resolve to the same path when
// home = parent/.claude and snapshotHome = parent.
function makeSyntheticHome() {
  const parent = mkdtempSync(path.join(tmpdir(), "ck-mcp-rewrite-"));
  const home = path.join(parent, ".claude");
  mkdirSync(path.join(home, "plugins"), { recursive: true });
  return home;
}

// Create a settings.json with a broken MCP entry whose command does not exist.
// Returns { settingsPath, brokenCommand }.
function seedBrokenMcpSettings(home, brokenCommand) {
  const settingsPath = path.join(home, "settings.json");
  const settings = {
    mcpServers: {
      "my-server": {
        command: brokenCommand,
        args: ["--port", "3000"]
      }
    }
  };
  writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n");
  return { settingsPath };
}

// Create a real executable script under the parent dir (not inside .claude).
// Returns its path.
function makeExecutable(home, name) {
  const parent = path.dirname(home);
  const binDir = path.join(parent, "bin");
  mkdirSync(binDir, { recursive: true });
  const binPath = path.join(binDir, name);
  writeFileSync(binPath, "#!/bin/sh\necho ok\n");
  chmodSync(binPath, 0o755);
  return binPath;
}

// Create a non-executable file. Returns its path.
function makeNonExecutable(home, name) {
  const parent = path.dirname(home);
  const binDir = path.join(parent, "bin");
  mkdirSync(binDir, { recursive: true });
  const binPath = path.join(binDir, name);
  writeFileSync(binPath, "#!/bin/sh\necho ok\n");
  chmodSync(binPath, 0o644);
  return binPath;
}

// A command that does not exist on disk — used as "old" broken command.
function ghostCommand(home) {
  const parent = path.dirname(home);
  return path.join(parent, "bin", "ghost-server-that-does-not-exist");
}

// ── T-200: parser-level malformed-value rejection ────────────────────────────

test("parseMcpCommandRewrite: valid '<old>=<new>' returns { oldPath, newPath }", () => {
  const result = parseMcpCommandRewrite("/old/server=/new/server");
  assert.deepEqual(result, { oldPath: "/old/server", newPath: "/new/server" });
});

test("parseMcpCommandRewrite: splits on first '=' only (new path may contain '=')", () => {
  const result = parseMcpCommandRewrite("/old/server=/new/server=extra");
  assert.deepEqual(result, { oldPath: "/old/server", newPath: "/new/server=extra" });
});

test("parseMcpCommandRewrite: no '=' in value throws Error", () => {
  assert.throws(
    () => parseMcpCommandRewrite("/no-equals-here"),
    /malformed.*=.*old.*new|requires.*=/i
  );
});

test("parseMcpCommandRewrite: empty old side throws Error", () => {
  assert.throws(
    () => parseMcpCommandRewrite("=/new/path"),
    /empty|both.*non-empty|malformed/i
  );
});

test("parseMcpCommandRewrite: empty new side throws Error", () => {
  assert.throws(
    () => parseMcpCommandRewrite("/old/path="),
    /empty|both.*non-empty|malformed/i
  );
});

// ── T-201: happy path — composeHardenPlan with mcpCommandRewrite ─────────────

test("composeHardenPlan with mcpCommandRewrite: produces 1 operation, 0 refusals, json-rewrite kind (T-400)", async () => {
  const home = makeSyntheticHome();
  const brokenCmd = ghostCommand(home);
  const { settingsPath } = seedBrokenMcpSettings(home, brokenCmd);
  const newCmd = makeExecutable(home, "new-server");

  const plan = await composeHardenPlan(home, {
    target: "settings.mcp_command_missing",
    path: settingsPath,
    mcpCommandRewrite: { oldPath: brokenCmd, newPath: newCmd }
  });

  assert.equal(plan.schemaVersion, "0.2");
  assert.equal(plan.refused.length, 0, `unexpected refusals: ${JSON.stringify(plan.refused)}`);
  assert.equal(plan.operations.length, 1);
  assert.equal(plan.operations[0].mutationKind, "json-rewrite"); // T-400: canonical kind
  assert.equal(plan.operations[0].detectorId, "settings.mcp_command_missing");
  assert.equal(plan.operations[0].targetPath, settingsPath);
  // Patch must be a `set` on the command key, not a remove of the whole entry.
  const patch = plan.operations[0].mutationOp.patch;
  assert.equal(patch.op, "set");
  assert.deepEqual(patch.path, ["mcpServers", "my-server", "command"]);
  assert.equal(patch.value, newCmd);
});

// ── T-202: refusal class — mcp-rewrite-target-missing ────────────────────────

test("composeHardenPlan mcpCommandRewrite: mcp-rewrite-target-missing when new path does not exist", async () => {
  const home = makeSyntheticHome();
  const brokenCmd = ghostCommand(home);
  const { settingsPath } = seedBrokenMcpSettings(home, brokenCmd);
  const missingNew = path.join(home, "bin", "does-not-exist");

  const plan = await composeHardenPlan(home, {
    target: "settings.mcp_command_missing",
    path: settingsPath,
    mcpCommandRewrite: { oldPath: brokenCmd, newPath: missingNew }
  });

  assert.equal(plan.operations.length, 0);
  assert.equal(plan.refused.length, 1);
  assert.equal(plan.refused[0].reason, "mcp-rewrite-target-missing");
  assert.ok(plan.refused[0].nextStep.length > 0, "nextStep must be non-empty (G7)");
  assert.ok(
    plan.refused[0].message.includes(missingNew) ||
    plan.refused[0].message.includes("does not exist"),
    "message must reference the missing path or say 'does not exist'"
  );
});

// ── T-202: refusal class — mcp-rewrite-target-not-executable ─────────────────

test("composeHardenPlan mcpCommandRewrite: mcp-rewrite-target-not-executable when new path not +x", async () => {
  const home = makeSyntheticHome();
  const brokenCmd = ghostCommand(home);
  const { settingsPath } = seedBrokenMcpSettings(home, brokenCmd);
  const nonExec = makeNonExecutable(home, "not-exec-server");

  const plan = await composeHardenPlan(home, {
    target: "settings.mcp_command_missing",
    path: settingsPath,
    mcpCommandRewrite: { oldPath: brokenCmd, newPath: nonExec }
  });

  assert.equal(plan.operations.length, 0);
  assert.equal(plan.refused.length, 1);
  assert.equal(plan.refused[0].reason, "mcp-rewrite-target-not-executable");
  assert.ok(plan.refused[0].nextStep.length > 0, "nextStep must be non-empty (G7)");
  assert.ok(
    plan.refused[0].message.includes(nonExec) ||
    plan.refused[0].message.includes("not executable"),
    "message must reference the non-executable path"
  );
});

// ── T-202: refusal class — mcp-rewrite-source-not-found ─────────────────────

test("composeHardenPlan mcpCommandRewrite: mcp-rewrite-source-not-found when old path not in settings", async () => {
  const home = makeSyntheticHome();
  const brokenCmd = ghostCommand(home);
  const { settingsPath } = seedBrokenMcpSettings(home, brokenCmd);
  const newCmd = makeExecutable(home, "new-server");
  // Pass a different old path that doesn't match any entry
  const wrongOld = path.join(home, "bin", "wrong-old-server");

  const plan = await composeHardenPlan(home, {
    target: "settings.mcp_command_missing",
    path: settingsPath,
    mcpCommandRewrite: { oldPath: wrongOld, newPath: newCmd }
  });

  assert.equal(plan.operations.length, 0);
  assert.equal(plan.refused.length, 1);
  assert.equal(plan.refused[0].reason, "mcp-rewrite-source-not-found");
  assert.ok(plan.refused[0].nextStep.length > 0, "nextStep must be non-empty (G7)");
  assert.ok(
    plan.refused[0].message.includes(wrongOld) ||
    plan.refused[0].message.includes("does not match"),
    "message must reference the unmatched source path"
  );
});

// ── T10b: refusal class — mcp-rewrite-foreign-owner ──────────────────────────

test("composeHardenPlan mcpCommandRewrite: mcp-rewrite-foreign-owner when new path is owned by a different uid", async (t) => {
  if (process.getuid && process.getuid() === 0) {
    t.skip("test runner is uid 0 — no foreign-uid binary available on this host");
    return;
  }

  const { existsSync, statSync } = await import("node:fs");
  const candidates = ["/bin/sh", "/bin/ls", "/bin/cat", "/usr/bin/env"];
  const selfUid = process.getuid();
  let foreignBinary = null;
  for (const candidate of candidates) {
    if (!existsSync(candidate)) continue;
    let st;
    try {
      st = statSync(candidate);
    } catch {
      continue;
    }
    if (!(st.mode & 0o111)) continue;
    if (typeof st.uid !== "number" || st.uid === selfUid) continue;
    foreignBinary = candidate;
    break;
  }
  if (!foreignBinary) {
    t.skip("no system binary on this host satisfies the foreign-owner precondition");
    return;
  }

  const home = makeSyntheticHome();
  const brokenCmd = ghostCommand(home);
  const { settingsPath } = seedBrokenMcpSettings(home, brokenCmd);

  const plan = await composeHardenPlan(home, {
    target: "settings.mcp_command_missing",
    path: settingsPath,
    mcpCommandRewrite: { oldPath: brokenCmd, newPath: foreignBinary }
  });

  assert.equal(plan.operations.length, 0);
  assert.equal(plan.refused.length, 1);
  assert.equal(plan.refused[0].reason, "mcp-rewrite-foreign-owner");
  assert.ok(plan.refused[0].nextStep.length > 0, "nextStep must be non-empty (G7)");
  assert.ok(
    plan.refused[0].message.includes(foreignBinary) ||
    plan.refused[0].message.includes("owned by uid"),
    "message must reference the foreign-owned path or uid mismatch"
  );
});

// ── Idempotency ───────────────────────────────────────────────────────────────

test("composeHardenPlan mcpCommandRewrite: applying the patch twice yields identical result (idempotency)", async () => {
  const home = makeSyntheticHome();
  const brokenCmd = ghostCommand(home);
  const { settingsPath } = seedBrokenMcpSettings(home, brokenCmd);
  const newCmd = makeExecutable(home, "new-server");

  const plan = await composeHardenPlan(home, {
    target: "settings.mcp_command_missing",
    path: settingsPath,
    mcpCommandRewrite: { oldPath: brokenCmd, newPath: newCmd }
  });

  // Plan must succeed
  assert.equal(plan.refused.length, 0);
  assert.equal(plan.operations.length, 1);

  // The patch is { op: "set", path: [..., "command"], value: newCmd }.
  // A `set` patch applied twice to an already-set value is idempotent by design.
  // preApply in MUTATION_REGISTRY["settings-rewrite"] enforces this via
  // deepEqual(firstApply, secondApply). If it were not idempotent, composeHardenPlan
  // would have emitted a patch-not-idempotent refusal above.
  // Confirm no refusal of that class:
  for (const r of plan.refused) {
    assert.notEqual(r.reason, "patch-not-idempotent", "patch must be idempotent");
  }

  // Re-run compose with the same inputs (simulates re-running after success).
  // The mcpServers entry's command field is still the old broken path on disk
  // (we haven't executed yet), so another compose should produce the same plan.
  const plan2 = await composeHardenPlan(home, {
    target: "settings.mcp_command_missing",
    path: settingsPath,
    mcpCommandRewrite: { oldPath: brokenCmd, newPath: newCmd }
  });
  assert.equal(plan2.refused.length, 0);
  assert.equal(plan2.operations.length, 1);
  assert.deepEqual(plan2.operations[0].mutationOp.patch, plan.operations[0].mutationOp.patch);
});

// ── Snapshot + rollback round-trip ───────────────────────────────────────────

test("execute mcpCommandRewrite happy path: settings.json rewritten; rollback restores original", async () => {
  const home = makeSyntheticHome();
  const brokenCmd = ghostCommand(home);
  const { settingsPath } = seedBrokenMcpSettings(home, brokenCmd);
  const originalContent = readFileSync(settingsPath, "utf8");
  const newCmd = makeExecutable(home, "new-server");

  const plan = await composeHardenPlan(home, {
    target: "settings.mcp_command_missing",
    path: settingsPath,
    mcpCommandRewrite: { oldPath: brokenCmd, newPath: newCmd }
  });

  assert.equal(plan.refused.length, 0);
  assert.equal(plan.operations.length, 1);

  const validated = await validateHardenPlan(plan, home);
  const manifest = await executeHardenPlan(validated, home);

  assert.equal(manifest.status, "verified");

  // settings.json must now have the new command
  const written = JSON.parse(readFileSync(settingsPath, "utf8"));
  assert.equal(written.mcpServers["my-server"].command, newCmd);
  // Other fields must be preserved
  assert.deepEqual(written.mcpServers["my-server"].args, ["--port", "3000"]);

  // Rollback
  const rollbackPlan = await composeRollbackPlan(home, manifest.id);
  assert.equal(rollbackPlan.refused.length, 0, "rollback plan must have no refusals");

  const validatedRollback = await validateRollbackPlan(rollbackPlan, home);
  const rollbackManifest = await executeRollbackPlan(validatedRollback, home);
  assert.equal(rollbackManifest.status, "rolled_back");

  // settings.json must be back to original
  const restored = readFileSync(settingsPath, "utf8");
  assert.equal(restored, originalContent);
});

// ── Without mcpCommandRewrite: strip behavior preserved ─────────────────────

test("composeHardenPlan without mcpCommandRewrite: strips the broken MCP entry (v0.3 behavior)", async () => {
  const home = makeSyntheticHome();
  const brokenCmd = ghostCommand(home);
  const { settingsPath } = seedBrokenMcpSettings(home, brokenCmd);

  const plan = await composeHardenPlan(home, {
    target: "settings.mcp_command_missing",
    path: settingsPath
    // no mcpCommandRewrite
  });

  assert.equal(plan.refused.length, 0);
  assert.equal(plan.operations.length, 1);
  // The strip patch replaces the whole mcpServers object (removing the broken entry)
  const patch = plan.operations[0].mutationOp.patch;
  assert.equal(patch.op, "set");
  assert.deepEqual(patch.path, ["mcpServers"]);
  // The value must not include the broken server
  assert.ok(!Object.prototype.hasOwnProperty.call(patch.value, "my-server"),
    "strip mode must remove the broken entry from mcpServers");
});

// ── validateHardenPlan: still enforces pre-snapshot checks ──────────────────

test("validateHardenPlan with mcpCommandRewrite plan: passes when file unchanged", async () => {
  const home = makeSyntheticHome();
  const brokenCmd = ghostCommand(home);
  const { settingsPath } = seedBrokenMcpSettings(home, brokenCmd);
  const newCmd = makeExecutable(home, "new-server");

  const plan = await composeHardenPlan(home, {
    target: "settings.mcp_command_missing",
    path: settingsPath,
    mcpCommandRewrite: { oldPath: brokenCmd, newPath: newCmd }
  });

  assert.equal(plan.refused.length, 0);

  // validateHardenPlan must not throw when the file has not changed
  const validated = await validateHardenPlan(plan, home);
  assert.ok(validated.validatedAt, "validatedAt must be set after successful validation");
});

test("validateHardenPlan: throws HardenPlanDriftError when settings.json changes between compose and validate", async () => {
  const home = makeSyntheticHome();
  const brokenCmd = ghostCommand(home);
  const { settingsPath } = seedBrokenMcpSettings(home, brokenCmd);
  const newCmd = makeExecutable(home, "new-server");

  const plan = await composeHardenPlan(home, {
    target: "settings.mcp_command_missing",
    path: settingsPath,
    mcpCommandRewrite: { oldPath: brokenCmd, newPath: newCmd }
  });

  // Mutate the file to force drift
  writeFileSync(settingsPath, JSON.stringify({ mcpServers: {} }, null, 2) + "\n");

  await assert.rejects(
    () => validateHardenPlan(plan, home),
    HardenPlanDriftError
  );
});
