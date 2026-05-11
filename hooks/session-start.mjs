#!/usr/bin/env node
// SessionStart hook for Claude Code.
//
// Runs `claude-housekeeper diagnose --safe --json` and prints a one-line
// stderr summary if any `block` or `probe` findings are present so the
// user notices before a session goes wrong.
//
// Quiet by default for routine inform/watch/review findings.
// Always exits 0 — a slow or failed Housekeeper run must NEVER block
// session start.
//
// Opt-out: set HOUSEKEEPER_SESSION_HOOK=off in the environment.
//
// Per docs/mode-doctrine.md §"Prevention mode": this script must be
// installed by the user explicitly in settings.json. Auto-installing
// SessionStart hooks is forbidden.

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const TIMEOUT_MS = 5000;
const TERMINAL_STATUSES = new Set(["verified", "rolled_back", "aborted"]);

if (process.env.HOUSEKEEPER_SESSION_HOOK === "off") {
  process.exit(0);
}

// Drain stdin if Claude Code sent hook context, so the writer doesn't block.
// We don't currently use the context payload; conservative posture per
// docs/research-plan.md item 116 (SessionStart hook stdout/context behavior
// is still under research).
if (!process.stdin.isTTY) {
  process.stdin.resume();
  process.stdin.on("data", () => {});
}

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.resolve(HERE, "..", "scripts", "claude-housekeeper.mjs");

function resolveClaudeHome(input) {
  const normalized = path.normalize(input || homedir());
  if (path.basename(normalized) === ".claude") return normalized;
  return path.join(normalized, ".claude");
}

function formatAge(manifest, manifestPath) {
  const timestamp = manifest.createdAt || manifest.capturedAt;
  const time = timestamp ? Date.parse(timestamp) : Number.NaN;
  let startedAt = time;
  if (Number.isNaN(startedAt)) {
    try {
      startedAt = statSync(manifestPath).mtimeMs;
    } catch {
      startedAt = Date.now();
    }
  }
  const days = Math.max(0, Math.floor((Date.now() - startedAt) / (24 * 60 * 60 * 1000)));
  return `${days}d`;
}

function interruptedOperations(home) {
  const operationsDir = path.join(home, "housekeeper", "operations");
  if (!existsSync(operationsDir)) return [];

  let names;
  try {
    names = readdirSync(operationsDir);
  } catch {
    return [];
  }

  const operations = [];
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    const manifestPath = path.join(operationsDir, name);
    let manifest;
    try {
      manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    } catch {
      continue;
    }

    const legacy = manifest.schemaVersion !== "0.2";
    const status = legacy ? "planned" : (manifest.status || "unknown");
    if (!legacy && TERMINAL_STATUSES.has(status)) continue;
    operations.push({
      id: path.basename(name, ".json"),
      status,
      age: formatAge(manifest, manifestPath)
    });
  }
  return operations;
}

if (!existsSync(CLI)) {
  // Housekeeper not installed at the expected path — silent.
  process.exit(0);
}

const result = spawnSync(process.execPath, [CLI, "diagnose", "--safe", "--json"], {
  encoding: "utf8",
  timeout: TIMEOUT_MS,
  stdio: ["ignore", "pipe", "pipe"]
});

if (result.error || !result.stdout) {
  // Housekeeper itself failed to produce output — silent (per self-failure
  // read-only degradation rule from docs/operational-readiness.md §4;
  // SessionStart is the worst place to chatter about Housekeeper's own state).
  // NOTE: a non-zero exit status from diagnose just signals "block findings
  // exist" (see scripts/claude-housekeeper.mjs runDiagnose), so we don't
  // gate on it — the JSON stdout is the source of truth.
  process.exit(0);
}

let report;
try {
  report = JSON.parse(result.stdout);
} catch {
  process.exit(0);
}

const stance = report.stanceSummary || {};
const block = stance.block || 0;
const probe = stance.probe || 0;

if (block === 0 && probe === 0) {
  process.exit(0);
}

const parts = [];
if (block > 0) parts.push(`${block} block`);
if (probe > 0) parts.push(`${probe} probe`);

process.stderr.write(
  `[housekeeper] ${parts.join(", ")} finding(s) need attention before session. ` +
  `Run 'claude-housekeeper plan' to inspect, or set HOUSEKEEPER_SESSION_HOOK=off to silence.\n`
);
for (const operation of interruptedOperations(resolveClaudeHome(process.env.CLAUDE_HOME))) {
  process.stderr.write(
    `[housekeeper] interrupted operation ${operation.id} status=${operation.status} age=${operation.age}\n`
  );
}
process.exit(0);
