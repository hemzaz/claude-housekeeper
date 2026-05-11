#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assembleReport } from "./lib/audit.mjs";
import { renderHumanReport, renderJsonReport, renderPlanReport } from "./lib/report.mjs";

const VALID_COMMANDS = new Set([
  "diagnose",
  "plan",
  "clean",
  "verify",
  "harden",
  "rollback"
]);

const HELP_TEXT = `claude-housekeeper — read-only Claude Code home inspection.

Usage:
  claude-housekeeper [command] [options]

Commands:
  diagnose            Read-only report (default if omitted).
  plan                Detailed per-finding plan with paths and next steps.
  verify              Run live Claude CLI smoketest probes.
  clean               Refuses mutation in v0.1 (snapshot/rollback not yet shipped).
  harden              Refuses mutation in v0.1.
  rollback <id>       Refuses mutation in v0.1.

Options:
  --json              Print the machine-readable report (stable schema 0.1).
  --safe              Stricter posture: parse only; refuse loader/MCP/hook execution.
  --redact            Privacy mode: collapse home to ~, scrub secrets and tokens.
  --scope=<scope>     One of: settings, plugins, registry, housekeeper, all (default: all).
  --home=<path>       Claude home root (default: $CLAUDE_HOME or ~/.claude).
  --config=<path>     Override the housekeeper config path.
  --max-files=<n>     Bound the projects-tree walk; emits home.scan_budget_hit if hit.
  -h, --help          Show this help and exit.
  -v, --version       Print version and exit.

Examples:
  claude-housekeeper                            # diagnose ~/.claude
  claude-housekeeper plan --scope=registry      # local commands and skills only
  claude-housekeeper diagnose --safe --redact   # safe posture, share-safe output
  claude-housekeeper diagnose --json | jq .

Docs: https://hemzaz.github.io/claude-housekeeper
`;

function loadVersion() {
  try {
    const pkgPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
    return pkg.version || "unknown";
  } catch {
    return "unknown";
  }
}

function parseArgs(argv) {
  const args = [...argv];
  // --help / --version short-circuit before command extraction so they work
  // anywhere on the command line and from any subcommand.
  for (const arg of args) {
    if (arg === "--help" || arg === "-h") return { command: "help" };
    if (arg === "--version" || arg === "-v") return { command: "version" };
  }
  const command = VALID_COMMANDS.has(args[0]) ? args.shift() : "diagnose";
  const options = {
    command,
    json: false,
    confirm: false,
    safe: false,
    redact: false,
    scope: "all",
    home: process.env.CLAUDE_HOME || homedir(),
    configPath: null,
    rollbackId: null,
    scanLimits: null
  };

  for (const arg of args) {
    if (arg === "--json") options.json = true;
    else if (arg === "--confirm") options.confirm = true;
    else if (arg === "--safe") options.safe = true;
    else if (arg === "--redact") options.redact = true;
    else if (arg.startsWith("--scope=")) options.scope = arg.slice("--scope=".length);
    else if (arg.startsWith("--home=")) options.home = arg.slice("--home=".length);
    else if (arg.startsWith("--config=")) options.configPath = arg.slice("--config=".length);
    else if (arg.startsWith("--max-files=")) {
      options.scanLimits = options.scanLimits || {};
      options.scanLimits.maxFiles = Number(arg.slice("--max-files=".length));
    }
    else if (command === "rollback" && !options.rollbackId) options.rollbackId = arg;
    else throw new Error(`Unknown argument: ${arg} — run \`claude-housekeeper --help\` for usage.`);
  }

  return options;
}

function resolveClaudeHome(input) {
  const normalized = path.normalize(input);
  if (path.basename(normalized) === ".claude") return normalized;
  return path.join(normalized, ".claude");
}

// T-X12: JSON `mode` is required and takes the active runtime mode.
// Default `diagnose` for normal runs, `safe` when --safe is set, `plan` for the plan command.
function pickMode(options) {
  if (options.safe) return "safe";
  if (options.command === "plan") return "plan";
  return "diagnose";
}

function fail(message, code = 1) {
  console.error(message);
  process.exitCode = code;
}

function printJson(value) {
  console.log(JSON.stringify(value, null, 2));
}

function runDiagnose(options) {
  const mode = pickMode(options);
  const report = assembleReport(options.home, {
    scope: options.scope,
    configPath: options.configPath,
    mode,
    scanLimits: options.scanLimits
  });
  const renderOpts = { redact: options.redact, home: options.home };
  if (options.json) printJson(renderJsonReport(report, renderOpts));
  else console.log(renderHumanReport(report, renderOpts));
  // Exit non-zero only if the report carries any block findings.
  process.exitCode = (report.stanceSummary?.block || 0) > 0 ? 1 : 0;
}

function runPlan(options) {
  const mode = pickMode(options);
  const report = assembleReport(options.home, {
    scope: options.scope,
    configPath: options.configPath,
    mode,
    scanLimits: options.scanLimits
  });
  const renderOpts = { redact: options.redact, home: options.home };
  if (options.json) printJson(renderJsonReport(report, renderOpts));
  else console.log(renderPlanReport(report, renderOpts));
}

function runClean(options) {
  const mode = pickMode(options);
  const report = assembleReport(options.home, {
    scope: options.scope,
    configPath: options.configPath,
    mode,
    scanLimits: options.scanLimits
  });
  const renderOpts = { redact: options.redact, home: options.home };
  if (!options.confirm) {
    console.log(renderPlanReport(report, renderOpts));
    fail("\nNo files were changed. clean is planned, but this version is read-only.", 2);
    return;
  }
  fail("No files were changed. clean requires snapshot, quarantine, and rollback support before it can mutate.", 2);
}

function runHarden() {
  fail("No files were changed. harden is planned, but prevention hooks must be reviewed before installation.", 2);
}

function runRollback(options) {
  if (!options.rollbackId) {
    fail("rollback requires a backup id, for example: rollback 2026-05-09-plugin-cleanup", 2);
    return;
  }
  fail("No files were changed. rollback is planned, and this version has not recorded any cleanups.", 2);
}

function runProbe(label, command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    timeout: options.timeoutMs || 30000,
    env: process.env
  });
  const output = `${result.stdout || ""}${result.stderr || ""}`.trim();
  const ok = result.status === 0 && (!options.expect || options.expect(output));
  return {
    label,
    ok,
    command: [command, ...args].join(" "),
    status: result.status,
    output
  };
}

function runVerify() {
  const probes = [];
  probes.push(
    runProbe("binary", "claude", ["--version"], {
      expect: (output) => /claude/i.test(output)
    })
  );
  if (!probes.at(-1).ok) return printVerify(probes);

  probes.push(runProbe("plugin list", "claude", ["plugin", "list"]));
  if (!probes.at(-1).ok) return printVerify(probes);

  probes.push(
    runProbe("bare session", "claude", ["-p", "echo X", "--bare"], {
      expect: (output) => /\bX\b/.test(output)
    })
  );
  if (!probes.at(-1).ok) return printVerify(probes);

  probes.push(
    runProbe("full registry session", "claude", ["-p", "reply ok", "--model", "haiku"], {
      expect: (output) => /\bok\b/i.test(output)
    })
  );
  if (!probes.at(-1).ok) return printVerify(probes);

  probes.push(
    runProbe("tool use", "claude", [
      "-p",
      "use Bash to echo Y",
      "--allowedTools",
      "Bash(echo:*)"
    ], {
      expect: (output) => /\bY\b/.test(output)
    })
  );
  if (!probes.at(-1).ok) return printVerify(probes);

  // T-403: subagent dispatch is opt-in for live probes; v0.1 keeps live probes
  // minimal per docs/safe-mode.md and docs/truth-probe-catalog.md. Emit a
  // documented SKIP rather than a misleading FAIL, and do NOT set non-zero
  // exit when prior probes all passed.
  probes.push({
    label: "subagent dispatch",
    skipped: true,
    command: "claude subagent probe",
    status: null,
    output: "not implemented in v0.1; run `claude --help` manually"
  });
  printVerify(probes);
}

function printVerify(probes) {
  for (const probe of probes) {
    if (probe.skipped) {
      console.log(`SKIP ${probe.label} (${probe.output})`);
      continue;
    }
    console.log(`${probe.ok ? "PASS" : "FAIL"} ${probe.label}`);
    if (!probe.ok) {
      console.log(`command: ${probe.command}`);
      if (probe.output) console.log(probe.output);
      process.exitCode = 1;
      return;
    }
  }
  process.exitCode = 0;
}

try {
  const options = parseArgs(process.argv.slice(2));
  if (options.command === "help") {
    process.stdout.write(HELP_TEXT);
    process.exitCode = 0;
  } else if (options.command === "version") {
    console.log(`claude-housekeeper ${loadVersion()}`);
    process.exitCode = 0;
  } else {
    options.home = resolveClaudeHome(options.home);
    if (!existsSync(options.home)) {
      fail(`Claude home does not exist: ${options.home}`, 2);
    } else if (options.command === "diagnose") runDiagnose(options);
    else if (options.command === "plan") runPlan(options);
    else if (options.command === "clean") runClean(options);
    else if (options.command === "verify") runVerify(options);
    else if (options.command === "harden") runHarden(options);
    else if (options.command === "rollback") runRollback(options);
  }
} catch (error) {
  fail(error.message, 2);
}
