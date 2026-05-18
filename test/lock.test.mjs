// Tests for scripts/lib/lock.mjs — consolidated lock protocol + lock.history JSONL.
//
// Mandatory T-099a criterion: acquire + release 3 times; read lock.history;
// assert 6 lines in correct alternating order.

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  acquireLock,
  releaseLock,
  LockHeldError,
  LOCK_STALE_WINDOW_MS
} from "../scripts/lib/lock.mjs";

// ── helpers ─────────────────────────────────────────────────────────────────

async function makeTmpHome() {
  const parent = await mkdtemp(path.join(tmpdir(), "ck-lock-"));
  const home = path.join(parent, ".claude");
  await mkdir(home, { recursive: true });
  return home;
}

function readHistoryLines(home) {
  const histPath = path.join(home, "housekeeper", "lock.history");
  if (!existsSync(histPath)) return [];
  return readFileSync(histPath, "utf8")
    .split("\n")
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l));
}

// ── T-099a mandatory criterion ───────────────────────────────────────────────

test("T-099a: acquire+release 3 times → 6 ordered lines in lock.history", async () => {
  const home = await makeTmpHome();
  const histPath = path.join(home, "housekeeper", "lock.history");

  for (let i = 0; i < 3; i++) {
    const handle = await acquireLock(home);
    await releaseLock(handle, "verified");
  }

  // File must exist.
  assert.ok(existsSync(histPath), "lock.history must exist after 3 cycles");

  const lines = readHistoryLines(home);

  // Exactly 6 lines.
  assert.strictEqual(lines.length, 6, `expected 6 lines, got ${lines.length}`);

  // Alternating acquire / release.
  for (let i = 0; i < 6; i++) {
    const expected = i % 2 === 0 ? "acquire" : "release";
    assert.strictEqual(
      lines[i].action,
      expected,
      `line ${i}: expected action="${expected}", got "${lines[i].action}"`
    );
  }

  // All lines have a valid ISO 8601 timestamp.
  for (let i = 0; i < lines.length; i++) {
    const ts = lines[i].ts;
    assert.ok(typeof ts === "string" && !Number.isNaN(Date.parse(ts)),
      `line ${i}: ts must be a valid ISO 8601 string, got ${JSON.stringify(ts)}`);
  }

  // All lines have pid (number) and action (string).
  for (const line of lines) {
    assert.strictEqual(typeof line.pid, "number", "pid must be a number");
    assert.ok(line.action === "acquire" || line.action === "release",
      `action must be "acquire" or "release", got ${JSON.stringify(line.action)}`);
  }

  // Release lines carry the releaseReason we passed.
  for (let i = 1; i < 6; i += 2) {
    assert.strictEqual(lines[i].releaseReason, "verified",
      `release line ${i}: releaseReason must be "verified"`);
  }

  // Acquire lines have a holder object with pid.
  for (let i = 0; i < 6; i += 2) {
    const holder = lines[i].holder;
    assert.ok(holder && typeof holder === "object",
      `acquire line ${i}: holder must be an object`);
    assert.strictEqual(typeof holder.pid, "number",
      `acquire line ${i}: holder.pid must be a number`);
  }
});

// ── stale lock: unlink and retry ─────────────────────────────────────────────

test("stale lock is unlinked and acquire succeeds", async () => {
  const home = await makeTmpHome();
  const lockDir = path.join(home, "housekeeper");
  const lockPath = path.join(lockDir, "lock");

  // Seed a stale lock: startedAt 31 minutes ago.
  const { mkdirSync, writeFileSync } = await import("node:fs");
  mkdirSync(lockDir, { recursive: true });
  const staleStart = new Date(Date.now() - 31 * 60 * 1000);
  writeFileSync(
    lockPath,
    JSON.stringify({
      pid: 9999,
      hostname: "old-host",
      opId: "op_stale",
      startedAt: staleStart.toISOString(),
      stalenessAt: new Date(staleStart.getTime() + LOCK_STALE_WINDOW_MS).toISOString()
    }) + "\n"
  );

  // acquireLock should succeed by unlinking the stale lock.
  const handle = await acquireLock(home);
  assert.ok(existsSync(lockPath), "lock file must exist after successful acquire");
  await releaseLock(handle, "verified");
  assert.ok(!existsSync(lockPath), "lock file must be removed after release");
});

// ── fresh lock throws LockHeldError ─────────────────────────────────────────

test("fresh lock throws LockHeldError", async () => {
  const home = await makeTmpHome();

  const handle = await acquireLock(home);
  try {
    await assert.rejects(
      () => acquireLock(home),
      (err) => {
        assert.ok(err instanceof LockHeldError,
          `expected LockHeldError, got ${err.constructor.name}`);
        assert.strictEqual(err.code, "lock-held");
        return true;
      }
    );
  } finally {
    await releaseLock(handle, "verified");
  }
});

// ── parent directory creation ────────────────────────────────────────────────

test("acquireLock creates the housekeeper directory if absent", async () => {
  const home = await makeTmpHome();
  // housekeeper dir does not exist yet.
  const lockDir = path.join(home, "housekeeper");
  assert.ok(!existsSync(lockDir), "pre-condition: housekeeper dir must not exist");

  const handle = await acquireLock(home);
  assert.ok(existsSync(lockDir), "housekeeper dir must be created");
  await releaseLock(handle, "verified");
});

// ── atomic-write of history: no partial lines ────────────────────────────────

test("lock.history contains no partial lines (each line is valid JSON)", async () => {
  const home = await makeTmpHome();

  for (let i = 0; i < 5; i++) {
    const handle = await acquireLock(home);
    await releaseLock(handle, i % 2 === 0 ? "verified" : "rolled_back");
  }

  const raw = readFileSync(path.join(home, "housekeeper", "lock.history"), "utf8");
  const lines = raw.split("\n").filter((l) => l.trim().length > 0);
  for (let i = 0; i < lines.length; i++) {
    let parsed;
    assert.doesNotThrow(
      () => { parsed = JSON.parse(lines[i]); },
      `line ${i} must be valid JSON`
    );
    assert.ok(parsed && typeof parsed === "object",
      `line ${i} must parse to an object`);
  }
});
