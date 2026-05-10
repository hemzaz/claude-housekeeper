import assert from "node:assert/strict";
import test from "node:test";
import {
  renderHumanReport,
  renderJsonReport,
  renderPlanReport
} from "../scripts/lib/report.mjs";
import {
  makeEvidenceSet,
  makeFinding,
  makeReport,
  makeSurfaceClassification
} from "../scripts/lib/contracts.mjs";

// ---------- shared helpers ----------

function emptyReport(overrides = {}) {
  return makeReport({
    schemaVersion: "0.1-pre",
    mode: "diagnose",
    home: "/home/u/.claude",
    generatedAt: "2026-05-10T00:00:00.000Z",
    ...overrides
  });
}

function makePrepareFinding() {
  return makeFinding({
    id: "settings.hook_path_dangling",
    class: "integrity",
    claimLevel: "finding",
    stance: "prepare",
    summary: "settings hook references a missing direct executable path",
    surface: makeSurfaceClassification({
      surfaceClass: "authored-config",
      ownerClass: "user-owned",
      loadBearingClass: "known-load-bearing",
      sensitivityClass: "private-path",
      executionClass: "inert",
      rollbackClass: "snapshot-possible",
      scopeClass: "in-scope",
      confidence: "medium"
    }),
    evidence: makeEvidenceSet({
      structural: ["settings parsed", "hook command contains an absolute path that does not exist"],
      missing: ["live /hooks view", "hook verification"]
    }),
    nextAllowedStep: "generate a patch preview only",
    blockedActions: ["mutate settings", "delete plugin cache", "claim fixed"]
  });
}

// ---------- T-203: human renderer ----------

test("human renderer: header is exactly 'HOUSEKEEPER REPORT' / 'No files changed.'", () => {
  const out = renderHumanReport(emptyReport());
  const lines = out.split("\n");
  assert.equal(lines[0], "HOUSEKEEPER REPORT");
  assert.equal(lines[1], "No files changed.");
});

test("human renderer: no findings → empty PRIMARY/STANCE/BOUNDARIES/SCAN", () => {
  const out = renderHumanReport(emptyReport());
  assert.match(out, /PRIMARY/);
  assert.match(out, /stance: inform/);
  assert.match(out, /finding: no findings/);
  assert.match(out, /STANCE SUMMARY/);
  assert.match(out, /inform   0/);
  assert.match(out, /BOUNDARIES/);
  assert.match(out, /protected: 0/);
  assert.match(out, /SCAN/);
  assert.match(out, /mode: diagnose/);
  assert.match(out, /degraded: no/);
});

test("human renderer: prepare finding becomes primary", () => {
  const finding = makePrepareFinding();
  const report = emptyReport({
    primary: finding.id,
    stanceSummary: { prepare: 1 },
    findings: [finding]
  });
  const out = renderHumanReport(report);
  assert.match(out, /stance: prepare/);
  assert.match(out, /finding: settings hook references a missing direct executable path/);
  assert.match(out, /next step: generate a patch preview only/);
  assert.match(out, /prepare  1/);
});

test("human renderer: BLOCKED ACTIONS section composed from primary", () => {
  const finding = makePrepareFinding();
  const report = emptyReport({
    primary: finding.id,
    stanceSummary: { prepare: 1 },
    findings: [finding]
  });
  const out = renderHumanReport(report);
  assert.match(out, /BLOCKED ACTIONS/);
  assert.match(out, /mutate settings/);
  assert.match(out, /delete plugin cache/);
  assert.match(out, /claim fixed/);
});

test("human renderer: PROTECTED section appears when protect findings exist", () => {
  const finding = makeFinding({
    id: "registry.local_command_diverged",
    stance: "protect",
    summary: "local command shadows plugin command",
    surface: makeSurfaceClassification({
      surfaceClass: "authored-config",
      ownerClass: "user-owned",
      sensitivityClass: "private-path",
      scopeClass: "in-scope"
    }),
    evidence: makeEvidenceSet(),
    blockedActions: []
  });
  finding.targetPath = "/home/u/.claude/commands/local-build.md";
  finding.why = "do-not-touch policy: personal command";

  const report = emptyReport({
    findings: [finding],
    primary: finding.id,
    stanceSummary: { protect: 1 },
    boundaries: [{
      type: "protected",
      path: finding.targetPath,
      reason: finding.why,
      findingId: finding.id
    }]
  });
  const out = renderHumanReport(report);
  assert.match(out, /PROTECTED/);
  assert.match(out, /path: \/home\/u\/\.claude\/commands\/local-build\.md/);
  assert.match(out, /BOUNDARIES/);
  assert.match(out, /protected: 1/);
});

test("human renderer: BLOCKED section appears when block findings exist", () => {
  const finding = makeFinding({
    id: "housekeeper.interrupted_operation",
    stance: "block",
    summary: "Housekeeper operation manifest is incomplete",
    surface: makeSurfaceClassification({
      surfaceClass: "housekeeper-owned",
      ownerClass: "housekeeper-owned",
      rollbackClass: "manifest-backed",
      scopeClass: "in-scope"
    }),
    evidence: makeEvidenceSet({
      structural: ["operation id op_001 exists"],
      missing: ["recovery decision for interrupted operation"]
    }),
    nextAllowedStep: "inspect operation record and choose recover, archive, or discard",
    blockedActions: ["start new mutation operation"]
  });
  finding.why = "Housekeeper operation manifest is incomplete";

  const report = emptyReport({
    findings: [finding],
    primary: finding.id,
    stanceSummary: { block: 1 }
  });
  const out = renderHumanReport(report);
  assert.match(out, /BLOCKED/);
  assert.match(out, /allowed now: inspect operation record/);
});

test("human renderer: MISSING KEY section appears for probe primary with missing evidence", () => {
  const finding = makeFinding({
    id: "plugin.cache_unreferenced",
    stance: "probe",
    summary: "plugin cache version is not referenced by known registry evidence",
    surface: makeSurfaceClassification({
      surfaceClass: "claude-app-data",
      ownerClass: "claude-managed",
      scopeClass: "in-scope"
    }),
    evidence: makeEvidenceSet({
      structural: ["installed registry parsed"],
      missing: ["active session, process reference, or retention policy evidence"]
    }),
    blockedActions: ["call unused"]
  });
  const report = emptyReport({
    findings: [finding],
    primary: finding.id,
    stanceSummary: { probe: 1 }
  });
  const out = renderHumanReport(report);
  assert.match(out, /MISSING KEY/);
  assert.match(out, /current stance: probe/);
});

test("human renderer: SCAN DEGRADED section appears when degraded entries present", () => {
  const report = emptyReport({
    degraded: [{
      budget: "max files visited",
      skipped: "~/.claude/projects",
      effect: "project-history findings may be incomplete"
    }]
  });
  const out = renderHumanReport(report);
  assert.match(out, /SCAN DEGRADED/);
  assert.match(out, /budget hit: max files visited/);
  assert.match(out, /degraded: yes/);
});

test("human renderer: mode 'safe' surfaces in SCAN", () => {
  const out = renderHumanReport(emptyReport({ mode: "safe" }));
  assert.match(out, /mode: safe/);
});

// ---------- T-204: JSON renderer ----------

test("json renderer: stable fields are always present", () => {
  const report = emptyReport({ mode: "safe" });
  const json = renderJsonReport(report);

  for (const field of [
    "schemaVersion", "mode", "home", "generatedAt", "filesChanged",
    "primary", "stanceSummary", "findings", "boundaries", "degraded"
  ]) {
    assert.ok(Object.prototype.hasOwnProperty.call(json, field), `missing ${field}`);
  }
  assert.equal(json.filesChanged, false);
  assert.equal(json.mode, "safe");
  assert.equal(json.primary, null);
  for (const k of ["inform", "watch", "review", "probe", "protect", "prepare", "repair", "block"]) {
    assert.equal(typeof json.stanceSummary[k], "number");
  }
});

test("json renderer: stripped Finding has stable fields, no internal annotations", () => {
  const finding = makePrepareFinding();
  finding.why = "internal stance annotation";
  finding.userDecisionNeeded = true;
  finding.targetPath = "/internal/path";
  const report = emptyReport({
    findings: [finding],
    primary: finding.id,
    stanceSummary: { prepare: 1 }
  });
  const json = renderJsonReport(report);
  const f = json.findings[0];
  for (const stable of ["id", "class", "claimLevel", "stance", "summary", "surface", "evidence", "blockedActions"]) {
    assert.ok(Object.prototype.hasOwnProperty.call(f, stable), `missing ${stable}`);
  }
  // Internal fields stripped to keep the public schema stable.
  assert.equal(f.why, undefined);
  assert.equal(f.userDecisionNeeded, undefined);
  assert.equal(f.targetPath, undefined);
});

test("json renderer: proposedProbe forwarded when present (T-210)", () => {
  const finding = makePrepareFinding();
  finding.proposedProbe = {
    reference: "claude --debug hooks",
    class: "behavioral",
    mayExecute: "may run hooks",
    consent: "high"
  };
  const report = emptyReport({
    findings: [finding],
    primary: finding.id,
    stanceSummary: { prepare: 1 }
  });
  const json = renderJsonReport(report);
  assert.ok(json.findings[0].proposedProbe);
  assert.equal(json.findings[0].proposedProbe.class, "behavioral");
  assert.equal(json.findings[0].proposedProbe.consent, "high");
});

test("json renderer: schemaVersion is forwarded as 0.1-pre during pre-release", () => {
  const json = renderJsonReport(emptyReport());
  assert.equal(json.schemaVersion, "0.1-pre");
});

// ---------- T-206: plan renderer ----------

test("plan renderer: header + per-finding next step + blocked actions", () => {
  const finding = makePrepareFinding();
  const report = emptyReport({
    findings: [finding],
    primary: finding.id,
    stanceSummary: { prepare: 1 }
  });
  const out = renderPlanReport(report);
  assert.match(out, /HOUSEKEEPER REPORT/);
  assert.match(out, /No files changed\./);
  assert.match(out, /PLAN for /);
  assert.match(out, /settings\.hook_path_dangling — stance: prepare/);
  assert.match(out, /next step: generate a patch preview only/);
  assert.match(out, /blocked actions: mutate settings, delete plugin cache, claim fixed/);
});

test("plan renderer: probe finding emits proposedProbe line when present", () => {
  const finding = makePrepareFinding();
  finding.id = "settings.hook_command_shell_ambiguous";
  finding.stance = "probe";
  finding.proposedProbe = {
    reference: "claude --debug hooks",
    class: "behavioral",
    mayExecute: "may run hooks",
    consent: "high"
  };
  const report = emptyReport({
    findings: [finding],
    primary: finding.id,
    stanceSummary: { probe: 1 }
  });
  const out = renderPlanReport(report);
  assert.match(out, /proposed probe: claude --debug hooks/);
  assert.match(out, /class: behavioral/);
  assert.match(out, /consent: high/);
});

test("plan renderer: empty report says 'No findings.'", () => {
  const out = renderPlanReport(emptyReport());
  assert.match(out, /No findings\./);
});

// ---------- T-X12: per-fixture mode round-trip ----------

test("renderer pins mode through both human and JSON output", () => {
  for (const mode of ["safe", "diagnose", "plan"]) {
    const human = renderHumanReport(emptyReport({ mode }));
    const json = renderJsonReport(emptyReport({ mode }));
    assert.match(human, new RegExp(`mode: ${mode}`), `human renderer should show mode: ${mode}`);
    assert.equal(json.mode, mode);
  }
});
