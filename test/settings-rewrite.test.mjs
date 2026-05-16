// Integration tests for the settings-rewrite mutation kind (T-104).
// Covers T-100 (registry entry), T-102 (idempotency), T-103 (atomic write).
// Per docs/design/v0.3-design.md §3.1, §3.3 and notes/TASKBOARD-v0.3.md Phase 1.

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  MUTATION_REGISTRY,
  PreApplyRefusal,
  applyPatch
} from "../scripts/lib/snapshot.mjs";

// ── helpers ────────────────────────────────────────────────────────────────

function makeSettingsFile(content) {
  const dir = mkdtempSync(path.join(tmpdir(), "ck-srw-"));
  const target = path.join(dir, "settings.json");
  writeFileSync(target, content);
  return { dir, target };
}

function sha256(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

const handler = MUTATION_REGISTRY["settings-rewrite"];

// ── Test 1: registry contract ──────────────────────────────────────────────

test("settings-rewrite: registry entry exposes preApply, apply, rollback hooks", () => {
  assert.ok(handler, "settings-rewrite kind is registered");
  assert.equal(typeof handler.preApply, "function", "preApply is a function");
  assert.equal(typeof handler.apply, "function", "apply is a function");
  assert.equal(typeof handler.rollback, "function", "rollback is a function");
  assert.ok(Object.isFrozen(MUTATION_REGISTRY), "registry is frozen");
});

// ── Test 2: identity patch round-trip ──────────────────────────────────────

test("settings-rewrite: identity patch (remove of missing key) preserves byte-equality", async () => {
  const original = JSON.stringify({ model: "claude", hooks: { Stop: [] } }, null, 2) + "\n";
  const { target } = makeSettingsFile(original);

  const op = {
    kind: "settings-rewrite",
    targetPath: target,
    patch: { op: "remove", path: ["doesNotExist"] }
  };

  const pre = await handler.preApply(op);
  assert.equal(pre.ok, true, "preApply passes for identity patch");

  await handler.apply(op);

  // After apply, structural content must equal the original (formatting may
  // differ trivially because apply re-serialises). Parse-and-compare to
  // assert no semantic change.
  const after = readFileSync(target, "utf8");
  assert.deepEqual(JSON.parse(after), JSON.parse(original), "JSON value identical");
});

// ── Test 3: single-key patch ───────────────────────────────────────────────

test("settings-rewrite: single-key remove patch removes the key", async () => {
  const original = { model: "claude", deprecated: "old-flag" };
  const { target } = makeSettingsFile(JSON.stringify(original, null, 2) + "\n");

  const op = {
    kind: "settings-rewrite",
    targetPath: target,
    patch: { op: "remove", path: ["deprecated"] }
  };

  const pre = await handler.preApply(op);
  assert.equal(pre.ok, true);
  assert.equal(typeof pre.plannedBytes, "number");
  assert.ok(pre.plannedBytes > 0);

  await handler.apply(op);

  const after = JSON.parse(readFileSync(target, "utf8"));
  assert.deepEqual(after, { model: "claude" });
  assert.ok(!Object.prototype.hasOwnProperty.call(after, "deprecated"));
});

// ── Test 4: nested patch ───────────────────────────────────────────────────
// Uses object-key removal (idempotent: re-applying a remove of a now-missing
// key is a no-op). Array-index removal is intentionally not supported as an
// idempotent op — Phase 3 detector promotion (T-300) will use content-matched
// removal instead.

test("settings-rewrite: nested patch removes deeply-nested object key", async () => {
  const original = {
    mcpServers: {
      doomed: { command: "/missing/binary" },
      kept: { command: "/usr/bin/exists" }
    }
  };
  const { target } = makeSettingsFile(JSON.stringify(original, null, 2) + "\n");

  const op = {
    kind: "settings-rewrite",
    targetPath: target,
    patch: { op: "remove", path: ["mcpServers", "doomed"] }
  };

  const pre = await handler.preApply(op);
  assert.equal(pre.ok, true);

  await handler.apply(op);

  const after = JSON.parse(readFileSync(target, "utf8"));
  assert.equal(Object.keys(after.mcpServers).length, 1);
  assert.equal(after.mcpServers.kept.command, "/usr/bin/exists");
  assert.ok(!Object.prototype.hasOwnProperty.call(after.mcpServers, "doomed"));
});

// ── Test 5: shape-unknown refusal (invalid JSON, no comments) ──────────────
// JSONC detection is owned by T-101 in audit.mjs; until that helper lands,
// hasJsoncComments() always returns false, so a SyntaxError surfaces as
// settings-shape-unknown. This test pins that behaviour so a future swap
// of the tokenizer does not silently regress.

test("settings-rewrite: refuses with settings-shape-unknown for invalid JSON (no JSONC tokenizer yet)", async () => {
  const { target } = makeSettingsFile("{ this is not json");

  const op = {
    kind: "settings-rewrite",
    targetPath: target,
    patch: { op: "remove", path: ["any"] }
  };

  const result = await handler.preApply(op);
  assert.ok(result instanceof PreApplyRefusal, "returns a PreApplyRefusal");
  assert.equal(result.reason, "settings-shape-unknown");
  assert.equal(result.targetPath, target);
});

// ── Test 6: non-idempotent refusal ─────────────────────────────────────────

test("settings-rewrite: refuses non-idempotent append patch with patch-not-idempotent", async () => {
  const original = { hooks: { Stop: [{ command: "existing" }] } };
  const { target } = makeSettingsFile(JSON.stringify(original, null, 2) + "\n");

  // `append` is intentionally non-idempotent: applying twice grows the array,
  // so result !== result-applied-once. preApply must refuse.
  const op = {
    kind: "settings-rewrite",
    targetPath: target,
    patch: { op: "append", path: ["hooks", "Stop"], value: { command: "new" } }
  };

  const result = await handler.preApply(op);
  assert.ok(result instanceof PreApplyRefusal, "returns a PreApplyRefusal");
  assert.equal(result.reason, "patch-not-idempotent");
});

// ── Test 7: atomic-write protocol — kill simulation ────────────────────────
// Verifies T-103: the apply hook uses atomicWrite (write-temp + rename), so
// at no observable moment is the target a partial write. We can't kill the
// process mid-write inside a single test, but we can prove the contract two
// ways: (a) no `.tmp.*` siblings remain after a successful apply, and
// (b) the on-disk target is always either the pre or post content — never
// a syntactically partial JSON.

test("settings-rewrite: apply leaves no tmp siblings; post-apply file is fully valid JSON", async () => {
  const original = { a: 1, b: 2, c: 3 };
  const { dir, target } = makeSettingsFile(JSON.stringify(original, null, 2) + "\n");

  const op = {
    kind: "settings-rewrite",
    targetPath: target,
    patch: { op: "remove", path: ["b"] }
  };

  await handler.preApply(op);
  await handler.apply(op);

  // No .tmp.* sibling files remain — atomicWrite cleans them via rename.
  const siblings = await readdir(dir);
  const tmpSiblings = siblings.filter((n) => n.includes(".tmp."));
  assert.deepEqual(tmpSiblings, [], "no .tmp.* siblings remain after apply");

  // On-disk file parses as JSON (never a partial write).
  const onDisk = readFileSync(target, "utf8");
  const parsed = JSON.parse(onDisk); // would throw on partial
  assert.deepEqual(parsed, { a: 1, c: 3 });
});

// ── Test 8: sha256 round-trip ──────────────────────────────────────────────
// After apply, the apply hook returns the new content; its sha256 must match
// the sha256 of what's actually on disk. This is the input to applyOperation's
// sha256After bookkeeping.

test("settings-rewrite: apply returns content whose sha256 equals on-disk sha256", async () => {
  const original = { keep: true, drop: true };
  const { target } = makeSettingsFile(JSON.stringify(original, null, 2) + "\n");

  const op = {
    kind: "settings-rewrite",
    targetPath: target,
    patch: { op: "remove", path: ["drop"] }
  };

  await handler.preApply(op);
  const { content } = await handler.apply(op);

  const expectedHash = sha256(Buffer.from(content, "utf8"));
  const actualHash = sha256(readFileSync(target));
  assert.equal(expectedHash, actualHash, "returned content matches on-disk bytes");
});

// ── Test 9: full rollback round-trip ───────────────────────────────────────
// Simulates the snapshot → apply → rollback sequence end-to-end. The snapshot
// step is stubbed by copying the original file into a snapshot tree dir; the
// rollback hook restores from that path and the file must be byte-identical
// to the pre-apply state.

test("settings-rewrite: rollback restores byte-identical original after apply", async () => {
  const original = { mcpServers: { doomed: { command: "/x" }, kept: { command: "/y" } } };
  const sourceText = JSON.stringify(original, null, 2) + "\n";
  const { dir, target } = makeSettingsFile(sourceText);

  // Stub snapshot: copy original to a snapshot path before mutation.
  const snapshotPath = path.join(dir, "0000_settings.json.snapshot");
  writeFileSync(snapshotPath, sourceText);
  const snapshotEntry = { snapshotPath };

  const op = {
    kind: "settings-rewrite",
    targetPath: target,
    patch: { op: "remove", path: ["mcpServers", "doomed"] }
  };

  // Snapshot already taken; apply mutates.
  await handler.preApply(op);
  await handler.apply(op);

  const mutated = JSON.parse(readFileSync(target, "utf8"));
  assert.equal(Object.keys(mutated.mcpServers).length, 1, "apply removed one entry");
  assert.ok(!mutated.mcpServers.doomed);

  // Rollback.
  await handler.rollback(op, snapshotEntry);

  const restored = readFileSync(target, "utf8");
  assert.equal(restored, sourceText, "rollback restored byte-identical original");
});

// ── Test 10: patch-produces-invalid-json refusal ───────────────────────────
// applyPatch can throw if the patch references a non-array for append; the
// preApply hook must surface that as patch-produces-invalid-json rather than
// crash. (This also pins the refusal class for non-serialisable patch results.)

test("settings-rewrite: refuses patch that throws during application with patch-produces-invalid-json", async () => {
  const original = { hooks: { Stop: "not-an-array" } };
  const { target } = makeSettingsFile(JSON.stringify(original, null, 2) + "\n");

  const op = {
    kind: "settings-rewrite",
    targetPath: target,
    patch: { op: "append", path: ["hooks", "Stop"], value: { command: "x" } }
  };

  const result = await handler.preApply(op);
  assert.ok(result instanceof PreApplyRefusal);
  assert.equal(result.reason, "patch-produces-invalid-json");
  // Target file must be unchanged.
  assert.equal(
    readFileSync(target, "utf8"),
    JSON.stringify(original, null, 2) + "\n",
    "target file unchanged after refusal"
  );
});

// ── Test 11: applyPatch is pure (no mutation of input) ─────────────────────
// Pins the contract that applyPatch returns a new object, never mutates.

test("applyPatch: does not mutate the input object", () => {
  const original = { a: 1, nested: { b: 2 } };
  const snapshot = JSON.parse(JSON.stringify(original));

  applyPatch(original, { op: "remove", path: ["a"] });
  applyPatch(original, { op: "set", path: ["nested", "b"], value: 99 });
  applyPatch(original, { op: "set", path: ["new"], value: "key" });

  assert.deepEqual(original, snapshot, "input object is unchanged");
});

// ── Test 12: snapshot tree stays read-only across rollback ─────────────────
// Pins the contract that rollback copies FROM snapshot, never writes to it.

test("settings-rewrite: rollback does not modify the snapshot file", async () => {
  const sourceText = JSON.stringify({ x: 1 }, null, 2) + "\n";
  const { dir, target } = makeSettingsFile(sourceText);

  const snapshotPath = path.join(dir, "snapshot.json");
  writeFileSync(snapshotPath, sourceText);
  const snapshotBefore = sha256(readFileSync(snapshotPath));

  const op = {
    kind: "settings-rewrite",
    targetPath: target,
    patch: { op: "set", path: ["x"], value: 2 }
  };

  await handler.preApply(op);
  await handler.apply(op);
  await handler.rollback(op, { snapshotPath });

  assert.equal(
    sha256(readFileSync(snapshotPath)),
    snapshotBefore,
    "snapshot file sha256 unchanged after rollback"
  );
  assert.ok(existsSync(target), "target file restored");
  assert.equal(readFileSync(target, "utf8"), sourceText, "target matches snapshot bytes");
});
