// CLI surface tests — --help, --version, unknown-arg hint.
//
// The CLI is the user's primary entry point; running it with --help should
// print usage rather than error out. Regression for the pre-fix behavior
// where `--help` produced `Unknown argument: --help`.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, utimesSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { takeSnapshot } from "../scripts/lib/snapshot.mjs";

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

// ── N4: --target= parse-time validation ──────────────────────────────────────
// Per notes/RELEASE-READINESS-v0.2.0.md §3 N4: unknown --target values should
// fail at parse time with a helpful "Known detector ids: …" message rather
// than only failing later inside composeCleanPlan's refusal classifier.

test("N4: --target=<unknown> exits non-zero with helpful 'Known detector ids' error", () => {
  const result = runCli(["clean", "--confirm", "--yes", "--target=plugin.bogus", "--path=/x"]);
  assert.notEqual(result.status, 0, `expected non-zero exit, got ${result.status}`);
  assert.match(result.stderr, /Unknown --target value: plugin\.bogus/);
  assert.match(result.stderr, /Known detector ids:/);
  // The message should list at least one real id so users can self-correct.
  assert.match(result.stderr, /plugin\.cache_unreferenced/);
});

test("N4: --target=plugin.cache_unreferenced parses fine (no parse error)", () => {
  // Without --path the pair check will fail later, but the --target value
  // itself should NOT trigger the N4 parse-time validation error.
  const result = runCli(["clean", "--confirm", "--yes", "--target=plugin.cache_unreferenced"]);
  assert.doesNotMatch(result.stderr, /Unknown --target value/);
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

// ── T-704 clean handler wiring tests ─────────────────────────────────────────

/**
 * Build a minimal synthetic Claude home with a plugin.cache_unreferenced fixture.
 * Returns { home, cacheDir } where home is the .claude directory root.
 */
function makeSyntheticClaudeHome() {
  const parent = mkdtempSync(path.join(tmpdir(), "ck-cli-test-"));
  const home = path.join(parent, ".claude");
  mkdirSync(home, { recursive: true });
  writeFileSync(path.join(home, "settings.json"), "{}\n");
  const cacheDir = path.join(home, "plugins", "cache", "test-market", "test-tool", "0.9.0");
  mkdirSync(cacheDir, { recursive: true });
  writeFileSync(path.join(cacheDir, "plugin.json"), JSON.stringify({ name: "test-tool", version: "0.9.0" }) + "\n");
  writeFileSync(path.join(cacheDir, "data.txt"), "cache data\n");
  // Force mtime 30 days into the past so audit fires plugin.cache_unreferenced.
  const longAgo = (Date.now() - 30 * 24 * 60 * 60 * 1000) / 1000;
  utimesSync(cacheDir, longAgo, longAgo);
  return { home, cacheDir };
}

function cleanCacheAndCaptureOperation() {
  const { home, cacheDir } = makeSyntheticClaudeHome();
  const clean = runCli([
    "clean", "--confirm", "--yes",
    "--target=plugin.cache_unreferenced",
    `--path=${cacheDir}`,
    `--home=${home}`
  ]);
  assert.equal(clean.status, 0, `clean failed:\nstdout: ${clean.stdout}\nstderr: ${clean.stderr}`);
  const match = clean.stdout.match(/rollback (op_[0-9]{14}_[0-9a-f]{8})/);
  assert.ok(match, `clean output did not include rollback op id:\n${clean.stdout}`);
  return { home, cacheDir, opId: match[1] };
}

async function snapshotCacheAndCaptureOperation() {
  const parent = mkdtempSync(path.join(tmpdir(), "ck-cli-abort-"));
  const home = path.join(parent, ".claude");
  const cacheDir = path.join(home, "plugins", "cache", "test-market", "test-tool", "0.9.0");
  mkdirSync(cacheDir, { recursive: true });
  const pluginJson = path.join(cacheDir, "plugin.json");
  const dataFile = path.join(cacheDir, "data.txt");
  writeFileSync(pluginJson, JSON.stringify({ name: "test-tool", version: "0.9.0" }) + "\n");
  writeFileSync(dataFile, "cache data\n");

  const { opId } = await takeSnapshot(parent, {
    targets: [pluginJson, dataFile],
    command: "clean",
    mode: "confirm",
    consentSummary: "test abort"
  });

  return {
    home,
    cacheDir,
    opId,
    snapshotDir: path.join(home, "housekeeper", "snapshots", opId),
    manifestPath: path.join(home, "housekeeper", "operations", `${opId}.json`)
  };
}

test("clean (no flags) prints dry-run plan and exits 0", () => {
  // No home needed: flag gate fires before existsSync check.
  const result = runCli(["clean"]);
  assert.equal(result.status, 0, `expected exit 0, got ${result.status}: ${result.stderr}`);
  assert.match(result.stdout, /DRY-RUN/);
  assert.match(result.stdout, /--confirm/);
});

test("clean --confirm without --target exits 2 with missing-flag error", () => {
  const { home } = makeSyntheticClaudeHome();
  const result = runCli(["clean", "--confirm", "--yes", `--home=${home}`]);
  assert.equal(result.status, 2, `expected exit 2, got ${result.status}`);
  assert.match(result.stderr, /Missing --target or --path/);
  assert.match(result.stderr, /claude-housekeeper plan/);
});

test("clean --confirm --target=x --path=y without --yes exits 2 with Refusing mutation", () => {
  const { home, cacheDir } = makeSyntheticClaudeHome();
  const result = runCli([
    "clean", "--confirm",
    "--target=plugin.cache_unreferenced",
    `--path=${cacheDir}`,
    `--home=${home}`
  ]);
  assert.equal(result.status, 2, `expected exit 2, got ${result.status}`);
  assert.match(result.stderr, /Refusing mutation/);
  assert.match(result.stderr, /--yes/);
});

test("clean --confirm --yes --target=plugin.expected_orphan exits 2 with no-mutation-mapping-in-v0.2", () => {
  // Build a within-grace cache so audit fires plugin.expected_orphan (not cache_unreferenced).
  const parent = mkdtempSync(path.join(tmpdir(), "ck-cli-orphan-"));
  const home = path.join(parent, ".claude");
  mkdirSync(home, { recursive: true });
  writeFileSync(path.join(home, "settings.json"), "{}\n");
  const cacheDir = path.join(home, "plugins", "cache", "test-market", "fresh-tool", "1.0.0");
  mkdirSync(cacheDir, { recursive: true });
  writeFileSync(path.join(cacheDir, "plugin.json"), JSON.stringify({ name: "fresh-tool", version: "1.0.0" }) + "\n");
  // No utimes — stays fresh, within 7-day grace → fires plugin.expected_orphan.

  const result = runCli([
    "clean", "--confirm", "--yes",
    "--target=plugin.expected_orphan",
    `--path=${cacheDir}`,
    `--home=${home}`
  ]);
  assert.equal(result.status, 2, `expected exit 2, got ${result.status}: ${result.stderr}`);
  assert.match(result.stdout, /no-mutation-mapping-in-v0\.2/);
});

test("clean --confirm --yes --target=plugin.cache_unreferenced happy path: exits 0, DONE and RELOAD HINT, dir gone", () => {
  const { home, cacheDir } = makeSyntheticClaudeHome();
  const result = runCli([
    "clean", "--confirm", "--yes",
    "--target=plugin.cache_unreferenced",
    `--path=${cacheDir}`,
    `--home=${home}`
  ]);
  assert.equal(result.status, 0, `expected exit 0, got ${result.status}:\nstdout: ${result.stdout}\nstderr: ${result.stderr}`);
  assert.match(result.stdout, /DONE\. Operation verified\./);
  assert.match(result.stdout, /RELOAD HINT/);
  assert.match(result.stdout, /\/reload-plugins/);
  assert.match(result.stdout, /To roll back: claude-housekeeper rollback/);
  // The target directory must be gone after clean.
  assert.ok(!existsSync(cacheDir), `cache directory should be deleted: ${cacheDir}`);
});

test("--help shows --target and --path flags under clean", () => {
  const result = runCli(["--help"]);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /--target=/);
  assert.match(result.stdout, /--path=/);
  assert.match(result.stdout, /REQUIRED when clean\s+--confirm is set/);
});

// ── T-800 rollback parser tests ──────────────────────────────────────────────

test("rollback help documents op id, dry-run, confirm, and yes flags", () => {
  const result = runCli(["rollback", "--help"]);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /rollback <id>/);
  assert.match(result.stdout, /op_20260511143022_a1b2c3d4/);
  assert.match(result.stdout, /--dry-run/);
  assert.match(result.stdout, /--abort/);
  assert.match(result.stdout, /--confirm/);
  assert.match(result.stdout, /--yes/);
});

test("rollback rejects invalid op id before checking Claude home", () => {
  const missingHome = path.join(tmpdir(), "ck-missing-home-for-invalid-id");
  const result = runCli(["rollback", "not-an-op-id", `--home=${missingHome}`]);
  assert.equal(result.status, 2, `expected exit 2, got ${result.status}`);
  assert.match(result.stderr, /Invalid rollback operation id/);
  assert.doesNotMatch(result.stderr, /Claude home does not exist/);
});

test("rollback accepts canonical op id and --dry-run before handler implementation", () => {
  const missingHome = path.join(tmpdir(), "ck-missing-home-for-valid-id");
  const result = runCli([
    "rollback",
    "op_20260511143022_a1b2c3d4",
    "--dry-run",
    `--home=${missingHome}`
  ]);
  assert.equal(result.status, 2, `expected exit 2, got ${result.status}`);
  assert.match(result.stderr, /Claude home does not exist/);
  assert.doesNotMatch(result.stderr, /Unknown argument: --dry-run/);
});

test("rollback --dry-run prints restore plan without writing files", () => {
  const { home, cacheDir, opId } = cleanCacheAndCaptureOperation();

  const result = runCli(["rollback", opId, "--dry-run", `--home=${home}`]);

  assert.equal(result.status, 0, `expected exit 0, got ${result.status}:\n${result.stderr}`);
  assert.match(result.stdout, /HOUSEKEEPER ROLLBACK/);
  assert.match(result.stdout, /DRY-RUN/);
  assert.match(result.stdout, new RegExp(opId));
  assert.match(result.stdout, /plugin\.json/);
  assert.equal(existsSync(cacheDir), false, "dry-run must not restore the cache dir");
  const manifest = JSON.parse(readFileSync(path.join(home, "housekeeper", "operations", `${opId}.json`), "utf8"));
  assert.equal(manifest.status, "verified");
});

test("rollback without --confirm prints plan then refuses", () => {
  const { home, opId } = cleanCacheAndCaptureOperation();

  const result = runCli(["rollback", opId, `--home=${home}`]);

  assert.equal(result.status, 2, `expected exit 2, got ${result.status}`);
  assert.match(result.stdout, /HOUSEKEEPER ROLLBACK/);
  assert.match(result.stderr, /Refusing rollback: --confirm not passed/);
});

test("rollback --confirm without --yes refuses after showing plan", () => {
  const { home, opId } = cleanCacheAndCaptureOperation();

  const result = runCli(["rollback", opId, "--confirm", `--home=${home}`]);

  assert.equal(result.status, 2, `expected exit 2, got ${result.status}`);
  assert.match(result.stdout, /HOUSEKEEPER ROLLBACK/);
  assert.match(result.stderr, /Refusing rollback: --yes not passed/);
});

test("rollback --confirm --yes restores files and marks manifest rolled_back", () => {
  const { home, cacheDir, opId } = cleanCacheAndCaptureOperation();

  const result = runCli(["rollback", opId, "--confirm", "--yes", `--home=${home}`]);

  assert.equal(result.status, 0, `expected exit 0, got ${result.status}:\nstdout: ${result.stdout}\nstderr: ${result.stderr}`);
  assert.match(result.stdout, /DONE\. Operation rolled back\./);
  assert.ok(existsSync(cacheDir), "rollback should restore the cache directory");
  assert.ok(existsSync(path.join(cacheDir, "plugin.json")), "rollback should restore plugin.json");
  assert.ok(existsSync(path.join(cacheDir, "data.txt")), "rollback should restore data.txt");
  const manifest = JSON.parse(readFileSync(path.join(home, "housekeeper", "operations", `${opId}.json`), "utf8"));
  assert.equal(manifest.status, "rolled_back");
  assert.ok(manifest.files.every((entry) => entry.rollbackVerified === true));
});

test("rollback --abort --confirm --yes aborts snapshot_taken operation and clears diagnose finding", async () => {
  const { home, opId, snapshotDir, manifestPath } = await snapshotCacheAndCaptureOperation();

  const result = runCli(["rollback", opId, "--abort", "--confirm", "--yes", `--home=${home}`]);

  assert.equal(result.status, 0, `expected exit 0, got ${result.status}:\nstdout: ${result.stdout}\nstderr: ${result.stderr}`);
  assert.match(result.stdout, /DONE\. Operation aborted\./);
  assert.equal(existsSync(snapshotDir), false);
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  assert.equal(manifest.status, "aborted");
  assert.match(manifest.abortedAt, /^\d{4}-\d{2}-\d{2}T/);

  const diagnose = runCli(["diagnose", "--json", `--home=${home}`]);
  assert.equal(diagnose.status, 0, `diagnose failed:\nstdout: ${diagnose.stdout}\nstderr: ${diagnose.stderr}`);
  const report = JSON.parse(diagnose.stdout);
  const interrupted = report.findings.find((finding) => finding.id === "housekeeper.interrupted_operation");
  assert.equal(interrupted, undefined);
});

test("rollback --abort without --confirm refuses without changing snapshot_taken operation", async () => {
  const { home, opId, snapshotDir, manifestPath } = await snapshotCacheAndCaptureOperation();

  const result = runCli(["rollback", opId, "--abort", `--home=${home}`]);

  assert.equal(result.status, 2, `expected exit 2, got ${result.status}`);
  assert.match(result.stderr, /Refusing abort: --confirm not passed/);
  assert.equal(existsSync(snapshotDir), true);
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  assert.equal(manifest.status, "snapshot_taken");
});

// G15: --timeout is documented in help so users discover it.
test("--timeout appears in help text with deadline wording", () => {
  const result = runCli(["--help"]);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /--timeout=<seconds>/);
  assert.match(result.stdout, /exits 124/);
});

// G15: invalid --timeout values must be caught at parse time, not after work begins.
test("clean --timeout=invalid exits non-zero with parse error (G15)", () => {
  const result = runCli(["clean", "--timeout=not-a-number"]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr + result.stdout, /Invalid --timeout value/);
});

test("clean --timeout=-5 is refused as non-positive (G15)", () => {
  const result = runCli(["clean", "--timeout=-5"]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr + result.stdout, /Invalid --timeout value/);
});

// ── T-400..T-403 harden CLI wiring tests ────────────────────────────────────

/**
 * Build a minimal synthetic Claude home with a settings.json that contains a
 * hook command pointing at a missing plugin-cache path — triggers the real
 * settings.hook_path_dangling detector (hardenable in v0.3).
 *
 * Returns { home, settingsPath, missingHookPath } where `home` is the .claude
 * directory (CLI expects basename `.claude` per resolveClaudeHome).
 */
function makeHardenableClaudeHome() {
  const parent = mkdtempSync(path.join(tmpdir(), "ck-harden-cli-"));
  const home = path.join(parent, ".claude");
  mkdirSync(path.join(home, "plugins"), { recursive: true });
  const settingsPath = path.join(home, "settings.json");
  const missingHookPath = path.join(home, "plugins", "cache", "ghost-mp", "ghost-plug", "1.0.0", "hook.sh");
  // Also seed a healthy hook so we can prove harden left it in place.
  const okHookPath = path.join(home, "real-hook.sh");
  writeFileSync(okHookPath, "#!/bin/sh\necho ok\n");
  const settings = {
    hooks: {
      PreToolUse: [{
        matcher: "Bash",
        hooks: [
          { type: "command", command: okHookPath },
          { type: "command", command: missingHookPath }
        ]
      }]
    }
  };
  writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n");
  return { home, settingsPath, missingHookPath, okHookPath };
}

// T-400/T-403 #1 — help text mentions harden in command list (already present
// indirectly via the Commands block; this test pins it explicitly so future
// help edits cannot silently drop it).
test("harden appears in --help command list with rewrite wording", () => {
  const result = runCli(["--help"]);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /^\s*harden\s+/m, "harden listed under Commands");
  assert.match(result.stdout, /settings\.json rewrite|Snapshot-backed settings/);
});

// T-403 #2 — `harden` with no flags prints a plan view and exits 0.
test("harden (no flags) prints plan/diagnose output and exits 0", () => {
  const { home } = makeHardenableClaudeHome();
  const result = runCli(["harden", `--home=${home}`]);
  assert.equal(result.status, 0, `expected exit 0, got ${result.status}: ${result.stderr}`);
  // Plan output begins with the HOUSEKEEPER banner from renderPlanReport.
  assert.match(result.stdout, /HOUSEKEEPER|hook_path_dangling/);
});

// T-403 #3 — `harden --confirm` without --yes exits 2 with Refusing mutation.
test("harden --confirm without --yes exits 2 with Refusing mutation", () => {
  const { home, settingsPath } = makeHardenableClaudeHome();
  const result = runCli([
    "harden", "--confirm",
    "--target=settings.hook_path_dangling",
    `--path=${settingsPath}`,
    `--home=${home}`
  ]);
  assert.equal(result.status, 2, `expected exit 2, got ${result.status}`);
  assert.match(result.stderr, /Refusing mutation/);
  assert.match(result.stderr, /--yes/);
  // The plan preview should be printed to stdout before the refusal.
  assert.match(result.stdout, /HOUSEKEEPER HARDEN/);
});

// T-403 #4 — `harden --confirm --yes` without --target/--path exits 2.
test("harden --confirm --yes without --target/--path exits 2 with missing-flag error", () => {
  const { home } = makeHardenableClaudeHome();
  const result = runCli(["harden", "--confirm", "--yes", `--home=${home}`]);
  assert.equal(result.status, 2, `expected exit 2, got ${result.status}`);
  assert.match(result.stderr, /Missing --target or --path/);
  assert.match(result.stderr, /claude-housekeeper plan/);
});

// T-403 #5 — full happy path: harden mutates settings.json and prints RELOAD HINT.
test("harden --confirm --yes --target=... happy path: exits 0, mutates settings, prints RELOAD HINT", () => {
  const { home, settingsPath, missingHookPath, okHookPath } = makeHardenableClaudeHome();
  const result = runCli([
    "harden", "--confirm", "--yes",
    "--target=settings.hook_path_dangling",
    `--path=${settingsPath}`,
    `--home=${home}`
  ]);
  assert.equal(
    result.status, 0,
    `expected exit 0, got ${result.status}:\nstdout: ${result.stdout}\nstderr: ${result.stderr}`
  );
  assert.match(result.stdout, /HOUSEKEEPER HARDEN/);
  assert.match(result.stdout, /DONE: 1 operation verified, op_id=op_/);
  // C11 RELOAD HINT lines (exact wording from design §3.6).
  assert.match(result.stdout, /RELOAD HINT: Claude does not document hot-reload of settings\.json\./);
  assert.match(result.stdout, /Restart your Claude session for the change to take effect\./);
  assert.match(result.stdout, /To roll back: claude-housekeeper rollback op_/);
  // settings.json was mutated — the dangling hook is gone; the healthy one survives.
  const after = JSON.parse(readFileSync(settingsPath, "utf8"));
  const commands = (after.hooks?.PreToolUse?.[0]?.hooks || []).map((h) => h.command);
  assert.ok(!commands.includes(missingHookPath), "dangling hook must be removed");
  assert.ok(commands.includes(okHookPath), "healthy hook must survive");
  // The operation manifest must exist on disk and be in 'verified' state.
  const opIdMatch = result.stdout.match(/op_id=(op_[0-9]{14}_[0-9a-f]{8})/);
  assert.ok(opIdMatch, "stdout should expose op id");
  const manifestPath = path.join(home, "housekeeper", "operations", `${opIdMatch[1]}.json`);
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  assert.equal(manifest.status, "verified");
});

// T-403 #6 — rollback round-trip: capture op id from harden, then rollback
// restores settings.json byte-for-byte to its pre-harden state.
test("harden then rollback restores settings.json byte-for-byte", () => {
  const { home, settingsPath } = makeHardenableClaudeHome();
  const before = readFileSync(settingsPath, "utf8");

  const hardened = runCli([
    "harden", "--confirm", "--yes",
    "--target=settings.hook_path_dangling",
    `--path=${settingsPath}`,
    `--home=${home}`
  ]);
  assert.equal(hardened.status, 0, `harden failed:\n${hardened.stdout}\n${hardened.stderr}`);
  const opIdMatch = hardened.stdout.match(/op_id=(op_[0-9]{14}_[0-9a-f]{8})/);
  assert.ok(opIdMatch, "harden output should expose op id");
  const opId = opIdMatch[1];
  // Sanity: settings.json changed.
  const mid = readFileSync(settingsPath, "utf8");
  assert.notEqual(mid, before, "harden should have mutated settings.json");

  const rolledBack = runCli([
    "rollback", opId, "--confirm", "--yes", `--home=${home}`
  ]);
  assert.equal(
    rolledBack.status, 0,
    `rollback failed:\nstdout: ${rolledBack.stdout}\nstderr: ${rolledBack.stderr}`
  );
  assert.match(rolledBack.stdout, /DONE\. Operation rolled back\./);
  const after = readFileSync(settingsPath, "utf8");
  assert.equal(after, before, "rollback must restore settings.json byte-for-byte");
});

// T-402 — harden surfaces --timeout in --help and rejects invalid values at parse time.
test("harden --timeout=invalid exits non-zero with parse error (T-402)", () => {
  const result = runCli(["harden", "--timeout=not-a-number"]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr + result.stdout, /Invalid --timeout value/);
});
