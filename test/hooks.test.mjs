// SessionStart hook tests.
//
// Exercises hooks/session-start.mjs end-to-end via spawnSync, the same way
// Claude Code invokes it. Verifies:
//   - quiet on a clean home (no stderr)
//   - one-line warning on a home with a block-stance finding
//   - HOUSEKEEPER_SESSION_HOOK=off silences regardless of state
//   - exits 0 in every case (must not block session start)

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const HOOK = path.join(REPO_ROOT, "hooks", "session-start.mjs");
const CLEAN_HOME = path.join(REPO_ROOT, "fixtures", "synthetic-homes", "clean-home", "home", ".claude");
const INTERRUPTED_HOME = path.join(
  REPO_ROOT,
  "fixtures",
  "synthetic-homes",
  "interrupted-housekeeper-operation",
  "home",
  ".claude"
);

function runHook(env = {}) {
  return spawnSync(process.execPath, [HOOK], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    env: { ...process.env, ...env },
    stdio: ["pipe", "pipe", "pipe"],
    input: ""
  });
}

test("SessionStart hook: silent on a clean home", () => {
  const result = runHook({ CLAUDE_HOME: CLEAN_HOME });
  assert.equal(result.status, 0, `expected exit 0; stderr=${result.stderr}`);
  assert.equal(result.stderr, "", `expected silent stderr; got: ${result.stderr}`);
});

test("SessionStart hook: warns on a home with a block finding", () => {
  const result = runHook({ CLAUDE_HOME: INTERRUPTED_HOME });
  assert.equal(result.status, 0, `expected exit 0; stderr=${result.stderr}`);
  assert.match(result.stderr, /\[housekeeper\]/);
  assert.match(result.stderr, /1 block/);
  assert.match(result.stderr, /Run 'claude-housekeeper plan'/);
  assert.match(result.stderr, /interrupted operation op_001/);
  assert.match(result.stderr, /status=planned/);
  assert.match(result.stderr, /age=\d+d/);
});

test("SessionStart hook: HOUSEKEEPER_SESSION_HOOK=off silences a block-state home", () => {
  const result = runHook({
    CLAUDE_HOME: INTERRUPTED_HOME,
    HOUSEKEEPER_SESSION_HOOK: "off"
  });
  assert.equal(result.status, 0);
  assert.equal(result.stderr, "");
});

test("SessionStart hook: exits 0 even when the home does not exist", () => {
  const result = runHook({ CLAUDE_HOME: "/definitely/not/a/real/path/.claude" });
  assert.equal(result.status, 0, `must never fail session start; status=${result.status}`);
});
