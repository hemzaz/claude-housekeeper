// T-406 — Support issue template guard.
//
// Public support templates must ask for redacted, versioned evidence rather
// than raw Claude home content. This pins the release-blocker templates.

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TEMPLATE_ROOT = path.join(REPO_ROOT, ".github", "ISSUE_TEMPLATE");

const REQUIRED_TEMPLATES = [
  "compatibility-report.md",
  "damaged-environment.md",
  "false-positive.md",
  "loader-semantics.md"
];

test("required public support templates exist", () => {
  for (const file of REQUIRED_TEMPLATES) {
    assert.ok(existsSync(path.join(TEMPLATE_ROOT, file)), `${file} exists`);
  }
});

test("required templates ask for redacted reports and environment versions", () => {
  for (const file of REQUIRED_TEMPLATES) {
    const text = readFileSync(path.join(TEMPLATE_ROOT, file), "utf8");
    assert.match(text, /Housekeeper version/i, `${file} asks for Housekeeper version`);
    assert.match(text, /Claude Code version/i, `${file} asks for Claude Code version`);
    assert.match(text, /(Operating system|OS)/i, `${file} asks for OS`);
    assert.match(text, /Redacted report JSON/i, `${file} asks for redacted report JSON`);
    assert.match(text, /Do not paste/i, `${file} warns against unsafe raw data`);
  }
});

test("diagnostic templates ask for v0.1 operation id and Node version", () => {
  for (const file of [
    "compatibility-report.md",
    "damaged-environment.md",
    "loader-semantics.md"
  ]) {
    const text = readFileSync(path.join(TEMPLATE_ROOT, file), "utf8");
    assert.match(text, /Operation id/i, `${file} asks for operation id`);
    assert.match(text, /Always `none` in v0\.1/i, `${file} documents v0.1 operation id default`);
    assert.match(text, /Node version/i, `${file} asks for Node version`);
  }
});
