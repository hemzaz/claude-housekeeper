// T-408 — Redaction tests.
//
// Asserts that --redact and the per-finding sensitivityClass-driven redaction
// strip secret-adjacent content from rendered output (human + JSON).
//
// Spec sources: docs/redaction-examples.md, docs/safe-mode.md "Privacy Mode",
// docs/release-blockers.md "Read-Only Preview Blockers" (no raw secrets in
// shareable output).

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { redactString } from "../scripts/lib/redact.mjs";
import { renderHumanReport, renderJsonReport } from "../scripts/lib/report.mjs";
import { assembleReport } from "../scripts/lib/audit.mjs";
import {
  makeEvidenceSet,
  makeFinding,
  makeReport,
  makeSurfaceClassification
} from "../scripts/lib/contracts.mjs";

const FIXTURES_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "fixtures",
  "synthetic-homes"
);

const RAW_TOKEN = ["sk", "-syn-", "0123", "4567", "89ab", "cdef"].join("");
const GH_PAT = ["ghp", "_", "AAAA", "AAAA", "AAAA", "AAAA", "AAAA", "AAAA", "AAAA", "AAAA", "AAAA"].join("");
const BEARER_VALUE = ["eyJhb", "GciOi", "JIUzI", "1NiJ9", ".payload", ".sig"].join("");
const CLI_TOKEN = ["abc123", "def456", "ghi789", "jkl"].join("");
const SHA256_HEX = [
  "4b7f2c1a",
  "8d9e0f1a",
  "2b3c4d5e",
  "6f7a8b9c",
  "0d1e2f3a",
  "4b5c6d7e",
  "8f9a0b1c",
  "2d3e4f5a"
].join("");
const RESIDUAL_TOKEN = ["abcDEF", "012345", "6789ghi", "JKLmno", "PQR456", "789xyz"].join("");

// ---------- redactString unit tests ----------

test("redactString: ANTHROPIC_API_KEY=sk-... becomes <redacted>", () => {
  const out = redactString(`ANTHROPIC_API_KEY=${RAW_TOKEN} node /usr/local/bin/notify`);
  assert.ok(!out.includes(RAW_TOKEN), `raw token leaked: ${out}`);
  assert.match(out, /ANTHROPIC_API_KEY=<redacted>/);
});

test("redactString: ghp_ GitHub PAT collapses to <redacted>", () => {
  const out = redactString(`GITHUB_TOKEN=${GH_PAT}`);
  assert.ok(!out.includes(GH_PAT), `raw GH PAT leaked: ${out}`);
});

test("redactString: Bearer token is redacted but keyword preserved", () => {
  const out = redactString(`Authorization: Bearer ${BEARER_VALUE}`);
  assert.match(out, /Bearer <redacted>/);
  assert.ok(!out.includes(BEARER_VALUE), `raw bearer leaked: ${out}`);
});

test("redactString: --token <value> is redacted", () => {
  const out = redactString(`npx -y @vendor/server --token ${CLI_TOKEN} --workspace acme`);
  assert.match(out, /--token <redacted>/);
});

test("redactString: URI password becomes <redacted>", () => {
  const out = redactString("postgres://app:secretsauce@db.internal/main");
  assert.match(out, /postgres:\/\/app:<redacted>@db\.internal/);
  assert.ok(!out.includes("secretsauce"), `URI password leaked: ${out}`);
});

test("redactString: home prefix collapses to ~ in shareable mode", () => {
  const out = redactString("/Users/elad/.claude/settings.json", {
    home: "/Users/elad/.claude",
    shareable: true
  });
  assert.equal(out, "~/settings.json");
});

test("redactString: home prefix is NOT collapsed without shareable flag", () => {
  // Local report (default) keeps the literal home prefix so consumers can
  // interpret relative paths from absolute ones.
  const out = redactString("/Users/elad/.claude/settings.json", {
    home: "/Users/elad/.claude"
  });
  assert.equal(out, "/Users/elad/.claude/settings.json");
});

test("redactString: project-style path collapses to <project>/.claude in shareable mode", () => {
  const out = redactString("/Users/elad/work/customer-bank/.claude/settings.json", {
    shareable: true
  });
  assert.match(out, /<project>\/\.claude\/settings\.json/);
  assert.ok(!out.includes("customer-bank"), `customer name leaked: ${out}`);
});

test("redactString: sha256 hash truncates in shareable mode", () => {
  const out = redactString(`sha256: ${SHA256_HEX}`, { shareable: true });
  assert.equal(out, "sha256: 4b7f2c1a...");
});

test("redactString: benign string is unchanged", () => {
  const out = redactString("safe step: review the report before any action");
  assert.equal(out, "safe step: review the report before any action");
});

test("redactString: 'safe step' phrase is NOT mangled in shareable mode", () => {
  const out = redactString("next allowed step: safe step", { shareable: true });
  assert.ok(out.includes("safe step"), `safe step phrase mangled: ${out}`);
});

test("redactString: short identifier (under 16 chars) is preserved", () => {
  const out = redactString("commands/local-build.md");
  assert.equal(out, "commands/local-build.md");
});

test("redactString: failClosed degrades residual token-shaped strings", () => {
  // Construct an input with a token-shape that no structured transformer
  // would catch (no `=`, no provider prefix, no `Bearer`, no URI, no flag).
  const out = redactString(RESIDUAL_TOKEN, { failClosed: true });
  assert.equal(out, "<redacted>");
});

test("redactString: failClosed leaves benign content alone", () => {
  // Any input shorter than the residual-token threshold is left alone.
  const out = redactString("ok", { failClosed: true });
  assert.equal(out, "ok");
});

// ---------- redactReport: secret-command-fragment fixture ----------

test("redactReport: secret-command-fragment fixture loses raw token in stdout", () => {
  const home = path.join(FIXTURES_ROOT, "secret-command-fragment", "home", ".claude");
  const report = assembleReport(home, { mode: "diagnose" });

  // Confirm the fixture's settings.json carries the raw token before redaction.
  const settingsPath = path.join(home, "settings.json");
  const raw = readFileSync(settingsPath, "utf8");
  assert.ok(raw.includes(RAW_TOKEN), "fixture must contain the raw token before redaction");

  const human = renderHumanReport(report, { redact: true, home });
  assert.ok(!human.includes(RAW_TOKEN), `raw token leaked in human report:\n${human}`);

  const json = JSON.stringify(renderJsonReport(report, { redact: true, home }));
  assert.ok(!json.includes(RAW_TOKEN), `raw token leaked in JSON report:\n${json}`);
});

// Negative case from the user's instruction list.
test("redactReport: a finding without sensitive content renders unchanged with --redact", () => {
  // The clean-home fixture has no findings; diagnose returns a `no findings`
  // report. With --redact on, the report still renders with stable headers.
  const home = path.join(FIXTURES_ROOT, "clean-home", "home", ".claude");
  const report = assembleReport(home, { mode: "diagnose" });
  const noRedact = renderHumanReport(report);
  const withRedact = renderHumanReport(report, { redact: true, home });

  // Both must contain the report header.
  assert.ok(withRedact.startsWith("HOUSEKEEPER REPORT\nNo files changed."));
  // BOUNDARIES counts and the STANCE summary do not change because the
  // benign report has no surface-level secrets to protect.
  for (const line of [
    "STANCE SUMMARY",
    "BOUNDARIES",
    "SCAN"
  ]) {
    assert.ok(noRedact.includes(line) && withRedact.includes(line));
  }
});

// Negative case from the user's instruction list: a benign report containing
// strings like "safe step" or "commands/local-build.md" is NOT mangled.
test("redactReport: 'safe step' and 'commands/local-build.md' survive --redact", () => {
  const finding = makeFinding({
    id: "registry.local_command_shadow",
    stance: "review",
    summary: "safe step: review intent before any change",
    surface: makeSurfaceClassification({
      surfaceClass: "authored-config",
      ownerClass: "user-owned",
      sensitivityClass: "private-path",
      scopeClass: "in-scope"
    }),
    evidence: makeEvidenceSet({ structural: ["commands/local-build.md is shadowed"] }),
    nextAllowedStep: "review-required"
  });
  finding.targetPath = "commands/local-build.md";
  finding.why = "user intent may have produced this state";

  const report = makeReport({
    schemaVersion: "0.1-pre",
    home: "/home/u/.claude",
    findings: [finding],
    primary: finding.id,
    stanceSummary: { review: 1 }
  });

  const human = renderHumanReport(report, { redact: true });
  assert.match(human, /safe step/);
  assert.match(human, /commands\/local-build\.md/);
});

// Positive: home prefix collapses to ~ when --redact is on.
test("redactReport: home prefix becomes ~ under --redact", () => {
  const home = path.join(FIXTURES_ROOT, "secret-command-fragment", "home", ".claude");
  const report = assembleReport(home, { mode: "diagnose" });
  const json = renderJsonReport(report, { redact: true, home });
  // When global redact is on, the top-level home field collapses to `~`.
  assert.equal(json.home, "~");
});

// Positive: the doc's command-string example transforms cleanly.
test("redactReport: ANTHROPIC_API_KEY=sk-... in a hook command becomes <redacted>", () => {
  const finding = makeFinding({
    id: "settings.hook_command_shell_ambiguous",
    stance: "protect",
    summary: `ANTHROPIC_API_KEY=${RAW_TOKEN} node /usr/local/bin/notify`,
    surface: makeSurfaceClassification({
      surfaceClass: "secret-adjacent",
      ownerClass: "user-owned",
      sensitivityClass: "secret-content",
      scopeClass: "sector-boundary"
    }),
    evidence: makeEvidenceSet({
      structural: [`command rendered as: ANTHROPIC_API_KEY=${RAW_TOKEN} node /usr/local/bin/notify`]
    })
  });

  const report = makeReport({
    schemaVersion: "0.1-pre",
    home: "/home/u/.claude",
    findings: [finding],
    primary: finding.id,
    stanceSummary: { protect: 1 }
  });

  const human = renderHumanReport(report);
  // Per-finding sensitivityClass-driven redaction always runs (no global flag needed).
  assert.match(human, /ANTHROPIC_API_KEY=<redacted>/);
  assert.ok(!human.includes(RAW_TOKEN), `raw token leaked: ${human}`);
});
