// T-404 — Schema stability doc-to-renderer check.
//
// The stable-field table in docs/schema-stability.md is a public contract.
// This test renders a real report and checks that non-nullable stable fields
// documented there are still emitted by renderJsonReport().

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { assembleReport } from "../scripts/lib/audit.mjs";
import { renderJsonReport } from "../scripts/lib/report.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("schema-stability stable fields are present in JSON output", () => {
  const docs = readFileSync(path.join(REPO_ROOT, "docs", "schema-stability.md"), "utf8");
  const fields = stableFieldsFromDocs(docs);
  const report = renderJsonReport(assembleReport(cleanHome(), { mode: "safe" }));

  for (const field of fields) {
    if (field.classes.includes("nullable")) continue;
    assertPathPresent(report, field.path);
  }
});

test("schema-stability documented surface and evidence keys are present", () => {
  const report = renderJsonReport(assembleReport(cleanHome(), { mode: "safe" }));
  assert.ok(report.findings.length > 0, "fixture report has at least one finding");
  const finding = report.findings[0];

  for (const key of [
    "surfaceClass",
    "ownerClass",
    "loadBearingClass",
    "sensitivityClass",
    "executionClass",
    "rollbackClass",
    "scopeClass",
    "confidence",
    "limits"
  ]) {
    assert.ok(Object.hasOwn(finding.surface, key), `surface.${key} is present`);
  }

  for (const key of [
    "structural",
    "loader",
    "behavioral",
    "ownership",
    "freshness",
    "reversibility",
    "missing"
  ]) {
    assert.ok(Object.hasOwn(finding.evidence, key), `evidence.${key} is present`);
    assert.ok(Array.isArray(finding.evidence[key]), `evidence.${key} is an array`);
  }
});

function cleanHome() {
  return path.join(REPO_ROOT, "fixtures", "synthetic-homes", "clean-home", "home", ".claude");
}

function stableFieldsFromDocs(markdown) {
  const rows = [];
  const section = markdown.match(/## Stable Fields For `0\.1`([\s\S]*?)### `findings\[\]\.surface` element shape/);
  assert.ok(section, "schema stability doc has a stable fields section");
  for (const line of section[1].split("\n")) {
    const match = line.match(/^\| `([^`]+)` \| ([^|]+) \|/);
    if (!match) continue;
    const [, fieldPath, classText] = match;
    const classes = classText.split(",").map((s) => s.trim());
    if (!classes.includes("stable")) continue;
    rows.push({ path: fieldPath, classes });
  }
  return rows;
}

function assertPathPresent(root, documentedPath) {
  const normalized = documentedPath.replaceAll("[]", ".0");
  const segments = normalized.split(".");
  let current = root;
  for (const segment of segments) {
    assert.notEqual(current, null, `${documentedPath} parent is present`);
    assert.ok(Object.hasOwn(current, segment), `${documentedPath} is present`);
    current = current[segment];
  }
}
