// CLI surface tests — --help, --version, unknown-arg hint.
//
// The CLI is the user's primary entry point; running it with --help should
// print usage rather than error out. Regression for the pre-fix behavior
// where `--help` produced `Unknown argument: --help`.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CLI = path.join(REPO_ROOT, "scripts", "claude-housekeeper.mjs");

function runCli(args) {
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd: REPO_ROOT,
    encoding: "utf8"
  });
}

test("--help prints usage and exits 0", () => {
  const result = runCli(["--help"]);
  assert.equal(result.status, 0, `expected exit 0, got ${result.status}: ${result.stderr}`);
  assert.match(result.stdout, /Usage:\s+claude-housekeeper/);
  assert.match(result.stdout, /Commands:/);
  assert.match(result.stdout, /diagnose/);
  assert.match(result.stdout, /--safe/);
  assert.match(result.stdout, /--redact/);
});

test("-h is an alias for --help", () => {
  const result = runCli(["-h"]);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /Usage:/);
});

test("--version prints the package version and exits 0", () => {
  const result = runCli(["--version"]);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /^claude-housekeeper \d+\.\d+\.\d+/);
});

test("-v is an alias for --version", () => {
  const result = runCli(["-v"]);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /^claude-housekeeper \d+\.\d+\.\d+/);
});

test("unknown argument exits non-zero and points at --help", () => {
  const result = runCli(["--no-such-flag"]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Unknown argument: --no-such-flag/);
  assert.match(result.stderr, /run `claude-housekeeper --help`/);
});

test("--help short-circuits a real subcommand (works after `diagnose`)", () => {
  const result = runCli(["diagnose", "--help"]);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /Usage:/);
});
