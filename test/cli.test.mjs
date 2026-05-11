// CLI surface tests — --help, --version, unknown-arg hint.
//
// The CLI is the user's primary entry point; running it with --help should
// print usage rather than error out. Regression for the pre-fix behavior
// where `--help` produced `Unknown argument: --help`.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
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

// T-403 regression: the verify command must include a real 'subagent dispatch'
// probe — the legacy SKIP placeholder is replaced. Static source check is
// CI-safe: spawning `verify` requires the Claude CLI which is not installed on
// CI runners and is intentionally returned-early on by runVerify when the
// binary probe fails.
test("verify defines a real 'subagent dispatch' probe (not a SKIP placeholder)", () => {
  const src = readFileSync(CLI, "utf8");
  assert.match(src, /"subagent dispatch"/, "subagent dispatch probe label present");
  assert.match(src, /allowedTools/, "probe configures allowedTools");
  assert.match(src, /\\bREADY\\b|READY/, "probe matches a READY marker");
  assert.doesNotMatch(
    src,
    /label:\s*"subagent dispatch",\s*\n\s*skipped:\s*true/,
    "no SKIP placeholder remains for subagent dispatch"
  );
});

// T-700 / T-701: --confirm and --yes flags
test("--confirm appears in help text with arm-mutation wording", () => {
  const result = runCli(["--help"]);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /--confirm/);
  assert.match(result.stdout, /Arm the mutation path for clean/);
  assert.match(result.stdout, /REQUIRED to actually/);
});

test("--yes appears in help text with consent-gate wording", () => {
  const result = runCli(["--help"]);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /--yes/);
  assert.match(result.stdout, /Skip the consent prompt/);
  assert.match(result.stdout, /no-stdin convention/);
});

test("clean (no flags) exits 0 with DRY-RUN message and --confirm hint", () => {
  // No home needed: flag gate fires before existsSync check.
  const result = runCli(["clean"]);
  assert.equal(result.status, 0, `expected exit 0, got ${result.status}: ${result.stderr}`);
  assert.match(result.stdout, /DRY-RUN/);
  assert.match(result.stdout, /--confirm/);
});

test("clean --confirm (no --yes) exits 2 with Refusing mutation message", () => {
  // No home needed: flag gate fires before existsSync check.
  const result = runCli(["clean", "--confirm"]);
  assert.equal(result.status, 2, `expected exit 2, got ${result.status}`);
  assert.match(result.stderr, /Refusing mutation/);
  assert.match(result.stderr, /--yes/);
});

test("clean --confirm --yes exits 0 with T-704 placeholder", () => {
  const CLEAN_HOME = path.join(REPO_ROOT, "fixtures", "synthetic-homes", "clean-home", "home");
  const result = runCli(["clean", "--confirm", "--yes", `--home=${CLEAN_HOME}`]);
  assert.equal(result.status, 0, `expected exit 0, got ${result.status}: ${result.stderr}`);
  assert.match(result.stdout, /T-704/);
});
