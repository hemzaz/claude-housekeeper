// G6 — .claude-plugin/plugin.json validation.
//
// CI previously gated `claude plugin validate` on `command -v claude`, which
// is never true on GitHub-hosted runners, so the plugin manifest was never
// validated in CI. This test exercises the manifest directly via node:test
// so every CI matrix job (Ubuntu/macOS x Node 20/22) verifies its shape.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MANIFEST_PATH = path.join(REPO_ROOT, ".claude-plugin", "plugin.json");

const SEMVER_RE =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(?:(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+[0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*)?$/;

function loadManifest() {
  const text = readFileSync(MANIFEST_PATH, "utf8");
  return { text, value: JSON.parse(text) };
}

test("plugin.json exists and is valid JSON", () => {
  const { value } = loadManifest();
  assert.equal(typeof value, "object");
  assert.ok(value !== null, "manifest is not null");
});

test("plugin.json declares required Claude Code plugin fields", () => {
  const { value } = loadManifest();
  for (const field of ["name", "version", "description", "commands"]) {
    assert.ok(
      Object.prototype.hasOwnProperty.call(value, field),
      `manifest declares required field "${field}"`
    );
  }
});

test("plugin.json name is a non-empty string", () => {
  const { value } = loadManifest();
  assert.equal(typeof value.name, "string", "name is a string");
  assert.ok(value.name.length > 0, "name is non-empty");
  assert.equal(value.name, value.name.trim(), "name has no surrounding whitespace");
});

test("plugin.json description is a non-empty string", () => {
  const { value } = loadManifest();
  assert.equal(typeof value.description, "string", "description is a string");
  assert.ok(value.description.length > 0, "description is non-empty");
});

test("plugin.json version is a valid semver string", () => {
  const { value } = loadManifest();
  assert.equal(typeof value.version, "string", "version is a string");
  assert.match(value.version, SEMVER_RE, "version is valid semver");
});

test("plugin.json version matches package.json version", () => {
  const { value } = loadManifest();
  const pkg = JSON.parse(readFileSync(path.join(REPO_ROOT, "package.json"), "utf8"));
  assert.equal(
    value.version,
    pkg.version,
    "plugin manifest and package.json must stay in lockstep"
  );
});

test("plugin.json commands is an array of non-empty strings", () => {
  const { value } = loadManifest();
  assert.ok(Array.isArray(value.commands), "commands is an array");
  for (const entry of value.commands) {
    assert.equal(typeof entry, "string", "every commands entry is a string");
    assert.ok(entry.length > 0, "every commands entry is non-empty");
  }
});

test("plugin.json keywords (if present) is an array of non-empty strings", () => {
  const { value } = loadManifest();
  if (value.keywords === undefined) return;
  assert.ok(Array.isArray(value.keywords), "keywords is an array");
  for (const keyword of value.keywords) {
    assert.equal(typeof keyword, "string", "every keyword is a string");
    assert.ok(keyword.length > 0, "every keyword is non-empty");
  }
});

test("plugin.json does not contain unknown top-level fields", () => {
  // Locks the manifest shape so accidental typos (e.g. "comands") fail loudly.
  const { value } = loadManifest();
  const allowed = new Set([
    "name",
    "version",
    "description",
    "author",
    "homepage",
    "repository",
    "license",
    "keywords",
    "commands"
  ]);
  for (const key of Object.keys(value)) {
    assert.ok(allowed.has(key), `unexpected top-level field "${key}" in plugin.json`);
  }
});
