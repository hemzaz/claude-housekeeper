import assert from "node:assert/strict";
import test from "node:test";
import {
  SCHEMA_VERSION,
  makeEvidenceSet,
  makeFinding,
  makePolicyMatch,
  makeReport,
  makeScanLimit,
  makeStance,
  makeSurfaceClassification
} from "../scripts/lib/contracts.mjs";

test("makeSurfaceClassification fills documented defaults", () => {
  const s = makeSurfaceClassification();
  assert.equal(s.surfaceClass, "unknown");
  assert.equal(s.ownerClass, "unknown");
  assert.equal(s.loadBearingClass, "unknown");
  assert.equal(s.sensitivityClass, "unknown");
  assert.equal(s.executionClass, "unknown");
  assert.equal(s.rollbackClass, "unknown");
  assert.equal(s.scopeClass, "unknown");
  assert.equal(s.confidence, "medium");
  assert.deepEqual(s.limits, []);
});

test("makeSurfaceClassification accepts overrides without mutating input", () => {
  const limits = ["safe-mode-no-loader-key"];
  const s = makeSurfaceClassification({
    surfaceClass: "authored-config",
    ownerClass: "user-owned",
    loadBearingClass: "known-load-bearing",
    sensitivityClass: "private-path",
    executionClass: "inert",
    rollbackClass: "snapshot-possible",
    scopeClass: "in-scope",
    confidence: "high",
    limits
  });
  assert.equal(s.surfaceClass, "authored-config");
  assert.equal(s.confidence, "high");
  assert.deepEqual(s.limits, ["safe-mode-no-loader-key"]);
  // Defensive copy: mutating input does not change result.
  limits.push("extra");
  assert.deepEqual(s.limits, ["safe-mode-no-loader-key"]);
});

test("makeEvidenceSet returns all 7 evidence keys as empty arrays", () => {
  const e = makeEvidenceSet();
  for (const key of [
    "structural",
    "loader",
    "behavioral",
    "ownership",
    "freshness",
    "reversibility",
    "missing"
  ]) {
    assert.ok(Array.isArray(e[key]), `${key} should be array`);
    assert.equal(e[key].length, 0);
  }
});

test("makeEvidenceSet copies provided arrays", () => {
  const structural = [{ kind: "settings.parsed" }];
  const e = makeEvidenceSet({ structural, missing: ["loader-key"] });
  assert.deepEqual(e.structural, [{ kind: "settings.parsed" }]);
  assert.deepEqual(e.missing, ["loader-key"]);
});

test("makeFinding fills all required fields with defaults", () => {
  const f = makeFinding();
  assert.equal(f.id, "");
  assert.equal(f.class, "integrity");
  assert.equal(f.claimLevel, "finding");
  assert.equal(f.stance, "inform");
  assert.equal(f.summary, "");
  assert.ok(f.surface);
  assert.equal(f.surface.surfaceClass, "unknown");
  assert.ok(f.evidence);
  assert.deepEqual(f.evidence.structural, []);
  assert.equal(f.nextAllowedStep, "none");
  assert.deepEqual(f.blockedActions, []);
});

test("makeFinding round-trips an explicit shape", () => {
  const surface = makeSurfaceClassification({ surfaceClass: "authored-config" });
  const evidence = makeEvidenceSet({ missing: ["loader-key"] });
  const f = makeFinding({
    id: "settings.hook_path_dangling",
    class: "integrity",
    claimLevel: "finding",
    stance: "prepare",
    summary: "settings hook references missing direct plugin cache path",
    surface,
    evidence,
    nextAllowedStep: "patch-preview",
    blockedActions: ["mutate-without-consent", "claim-fixed"]
  });
  assert.equal(f.id, "settings.hook_path_dangling");
  assert.equal(f.stance, "prepare");
  assert.equal(f.surface.surfaceClass, "authored-config");
  assert.deepEqual(f.evidence.missing, ["loader-key"]);
  assert.deepEqual(f.blockedActions, ["mutate-without-consent", "claim-fixed"]);
});

test("makeStance defaults match decision-calculus.md §10 payload shape", () => {
  const s = makeStance();
  assert.equal(s.stance, "inform");
  assert.equal(s.why, "");
  assert.equal(s.missingKey, null);
  assert.equal(s.nextAllowedStep, "none");
  assert.equal(s.notAllowed, "");
  assert.equal(s.userDecisionNeeded, false);
});

test("makeStance round-trips a probe stance", () => {
  const s = makeStance({
    stance: "probe",
    why: "shell parsing is ambiguous",
    missingKey: "loader or hook debug evidence",
    nextAllowedStep: "Run a live hook probe after consent.",
    notAllowed: "Do not patch or delete based on this string alone.",
    userDecisionNeeded: true
  });
  assert.equal(s.stance, "probe");
  assert.equal(s.userDecisionNeeded, true);
  assert.equal(s.missingKey, "loader or hook debug evidence");
});

test("makeReport defaults include schemaVersion, filesChanged, stanceSummary", () => {
  const r = makeReport();
  assert.equal(r.schemaVersion, SCHEMA_VERSION);
  assert.equal(r.mode, "diagnose");
  assert.equal(r.filesChanged, false);
  assert.equal(r.primary, null);
  for (const k of [
    "inform",
    "watch",
    "review",
    "probe",
    "protect",
    "prepare",
    "repair",
    "block"
  ]) {
    assert.equal(r.stanceSummary[k], 0, `${k} default should be 0`);
  }
  assert.deepEqual(r.findings, []);
  assert.deepEqual(r.boundaries, []);
  assert.deepEqual(r.degraded, []);
});

test("makeReport schemaVersion default is '0.1-pre'", () => {
  assert.equal(makeReport().schemaVersion, "0.1-pre");
});

test("makeReport accepts mode override and merges stanceSummary", () => {
  const r = makeReport({
    mode: "safe",
    home: "/home/user/.claude",
    primary: "settings.hook_path_dangling",
    stanceSummary: { prepare: 1, inform: 2 }
  });
  assert.equal(r.mode, "safe");
  assert.equal(r.home, "/home/user/.claude");
  assert.equal(r.primary, "settings.hook_path_dangling");
  assert.equal(r.stanceSummary.prepare, 1);
  assert.equal(r.stanceSummary.inform, 2);
  assert.equal(r.stanceSummary.protect, 0);
});

test("makePolicyMatch defaults match policy-grammar.md §3 shape", () => {
  const m = makePolicyMatch();
  assert.equal(m.type, "doNotTouch");
  assert.equal(m.pattern, "");
  assert.equal(m.path, "");
  assert.equal(m.reason, "");
  assert.equal(m.scope, "user");
  assert.equal(m.effect, "stance protect, action none");
});

test("makePolicyMatch round-trips an allowance match", () => {
  const m = makePolicyMatch({
    type: "allowance",
    pattern: "~/.claude/commands/local-build.md",
    path: "/home/u/.claude/commands/local-build.md",
    reason: "intentional override",
    scope: "user",
    effect: "stance review, action none"
  });
  assert.equal(m.type, "allowance");
  assert.equal(m.reason, "intentional override");
});

test("makeScanLimit defaults match docs/schemas.md scan budget", () => {
  const l = makeScanLimit();
  assert.equal(l.maxFiles, 5000);
  assert.equal(l.maxBytes, 1024 * 1024);
  assert.equal(l.maxWallMs, 5000);
});

test("makeScanLimit accepts numeric overrides", () => {
  const l = makeScanLimit({ maxFiles: 10, maxBytes: 100, maxWallMs: 250 });
  assert.equal(l.maxFiles, 10);
  assert.equal(l.maxBytes, 100);
  assert.equal(l.maxWallMs, 250);
});

test("factories return new objects every call (no shared references)", () => {
  const a = makeReport();
  const b = makeReport();
  assert.notStrictEqual(a, b);
  assert.notStrictEqual(a.stanceSummary, b.stanceSummary);
  assert.notStrictEqual(a.findings, b.findings);
});
