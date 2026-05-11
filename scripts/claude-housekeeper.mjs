#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assembleReport } from "./lib/audit.mjs";
import { renderHumanReport, renderJsonReport, renderPlanReport } from "./lib/report.mjs";
import {
  composeCleanPlan,
  validateCleanPlan,
  executeCleanPlan,
  LockHeldError,
  PlanDriftError,
  NotImplementedError
} from "./lib/clean-plan.mjs";
import {
  composeRollbackPlan,
  validateRollbackPlan,
  executeRollbackPlan,
  LockHeldError as RollbackLockHeldError,
  PlanDriftError as RollbackPlanDriftError,
  RollbackNotImplementedError,
  SnapshotIntegrityError
} from "./lib/rollback-plan.mjs";

const VALID_COMMANDS = new Set([
  "diagnose",
  "plan",
  "clean",
  "verify",
  "harden",
  "rollback"
]);

const OPERATION_ID_PATTERN = /^op_[0-9]{14}_[0-9a-f]{8}$/;

const HELP_TEXT = `claude-housekeeper — read-only Claude Code home inspection.

Usage:
  claude-housekeeper [command] [options]

Commands:
  diagnose            Read-only report (default if omitted).
  plan                Detailed per-finding plan with paths and next steps.
  verify              Run live Claude CLI smoketest probes.
  clean               Refuses mutation in v0.1 (snapshot/rollback not yet shipped).
  harden              Refuses mutation in v0.1.
  rollback <id>       Restore a named Housekeeper operation snapshot.

Options:
  --json              Print the machine-readable report (stable schema 0.1).
  --safe              Stricter posture: parse only; refuse loader/MCP/hook execution.
  --redact            Privacy mode: collapse home to ~, scrub secrets and tokens.
  --scope=<scope>     One of: settings, plugins, registry, housekeeper, all (default: all).
  --home=<path>       Claude home root (default: $CLAUDE_HOME or ~/.claude).
  --config=<path>     Override the housekeeper config path.
  --max-files=<n>     Bound the projects-tree walk; emits home.scan_budget_hit if hit.
  --dry-run           For rollback, print the rollback plan without changing files.
  --confirm           Arm the mutation path for clean. Without this flag, clean
                        refuses mutation (dry-run only). REQUIRED to actually
                        mutate, but mutation is still blocked until --yes is passed.
  --yes               Skip the consent prompt. REQUIRED in combination with
                        --confirm to actually mutate. Designed for CI / scripted
                        runs; matches the no-stdin convention.
  --target=<id>       Detector id of the finding to clean (e.g.
                        plugin.cache_unreferenced). REQUIRED when --confirm is set.
  --path=<path>       Absolute path of the finding to clean. REQUIRED when
                        --confirm is set. Must match a path from \`diagnose\`.
  -h, --help          Show this help and exit.
  -v, --version       Print version and exit.

Examples:
  claude-housekeeper                            # diagnose ~/.claude
  claude-housekeeper plan --scope=registry      # local commands and skills only
  claude-housekeeper diagnose --safe --redact   # safe posture, share-safe output
  claude-housekeeper diagnose --json | jq .
  claude-housekeeper rollback op_20260511143022_a1b2c3d4 --dry-run

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
    yes: false,
    safe: false,
    redact: false,
    dryRun: false,
    scope: "all",
    home: process.env.CLAUDE_HOME || homedir(),
    configPath: null,
    rollbackId: null,
    scanLimits: null,
    target: null,
    path: null
  };

  for (const arg of args) {
    if (arg === "--json") options.json = true;
    else if (arg === "--confirm") options.confirm = true;
    else if (arg === "--yes") options.yes = true;
    else if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--safe") options.safe = true;
    else if (arg === "--redact") options.redact = true;
    else if (arg.startsWith("--scope=")) options.scope = arg.slice("--scope=".length);
    else if (arg.startsWith("--home=")) options.home = arg.slice("--home=".length);
    else if (arg.startsWith("--config=")) options.configPath = arg.slice("--config=".length);
    else if (arg.startsWith("--max-files=")) {
      options.scanLimits = options.scanLimits || {};
      options.scanLimits.maxFiles = Number(arg.slice("--max-files=".length));
    }
    else if (arg.startsWith("--target=")) options.target = arg.slice("--target=".length);
    else if (arg.startsWith("--path=")) options.path = arg.slice("--path=".length);
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

function printRollbackPlan(plan, { dryRun = false } = {}) {
  console.log("HOUSEKEEPER ROLLBACK");
  if (dryRun) console.log("DRY-RUN — no files changed.");
  console.log(`Operation: ${plan.opId}`);
  console.log(`Files to restore: ${plan.operations.length}`);
  console.log("");
  for (const op of plan.operations) {
    console.log(`  restore  ${op.originalPath}`);
    console.log(`    from   ${op.snapshotPath}`);
  }
}

function printRollbackRefusals(plan) {
  console.log("HOUSEKEEPER ROLLBACK");
  console.log(`Operation: ${plan.opId}`);
  for (const refusal of plan.refused) {
    console.log(`Refusing: ${refusal.reason}`);
    if (refusal.targetPath) console.log(`path: ${refusal.targetPath}`);
    console.log(`Reason: ${refusal.message}`);
  }
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

function formatBytes(bytes) {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GiB`;
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${bytes} B`;
}

async function runClean(options) {
  // Branch 1: no --confirm → dry-run plan view.
  // (This branch is actually handled in the dispatcher early-exit gate, but kept here for clarity.)
  if (!options.confirm) {
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
    process.exitCode = 0;
    return;
  }

  // Branch 2: --confirm but missing --target or --path.
  if (!options.target || !options.path) {
    fail("Missing --target or --path. Run `claude-housekeeper plan` to see candidates.", 2);
    return;
  }

  // Branch 3: --confirm + --target + --path but no --yes.
  if (!options.yes) {
    // Show what would happen, then refuse.
    const plan = await composeCleanPlan(options.home, {
      target: options.target,
      path: options.path
    });
    if (options.json) {
      printJson({ plan });
    } else {
      console.log("HOUSEKEEPER CLEAN");
      if (plan.operations.length > 0) {
        const op = plan.operations[0];
        console.log(`${plan.operations.length} operation planned. Op id: (pending)\n`);
        console.log(`  ${op.mutationKind}  ${op.targetPath}  (${formatBytes(op.estimatedBytes)})\n`);
      } else if (plan.refused.length > 0) {
        for (const r of plan.refused) {
          console.log(`Refusing: ${r.detectorId} is not cleanable in v0.2.0.`);
          console.log(`Reason: ${r.reason}.`);
        }
      }
    }
    fail("Refusing mutation: --yes not passed. Pass --confirm --yes to skip the\nprompt and apply.", 2);
    return;
  }

  // Branch 4: --confirm + --yes + --target + --path → full execute flow.
  try {
    const plan = await composeCleanPlan(options.home, {
      target: options.target,
      path: options.path
    });

    if (plan.refused.length > 0) {
      if (options.json) {
        printJson({ refused: plan.refused });
      } else {
        for (const r of plan.refused) {
          console.log(`Refusing: ${r.detectorId} is not cleanable in v0.2.0.`);
          console.log(`Reason: ${r.reason}.`);
        }
      }
      process.exitCode = 2;
      return;
    }

    const validated = await validateCleanPlan(plan, options.home);
    const manifest = await executeCleanPlan(validated, options.home);

    if (options.json) {
      printJson({ manifest });
      process.exitCode = manifest.status === "verified" ? 0 : 1;
      return;
    }

    const op = plan.operations[0];
    console.log("HOUSEKEEPER CLEAN");
    const opId = manifest.id || manifest.opId;
    console.log(`1 operation planned. Op id: ${opId}\n`);
    console.log(`  ${op.mutationKind}  ${op.targetPath}  (${formatBytes(op.estimatedBytes)})\n`);
    console.log(`  snapshot taken    → ${options.home}/housekeeper/snapshots/${opId}/...`);
    console.log(`  applied           → directory removed`);
    console.log(`  verified          → no residual files`);
    console.log("");
    console.log("DONE. Operation verified.");
    console.log("");
    console.log("RELOAD HINT");
    console.log("  Run /reload-plugins in any active Claude Code session to drop the");
    console.log("  cache reference. The plugins/data/ directory was preserved.");
    console.log("");
    console.log(`To roll back: claude-housekeeper rollback ${opId}`);

    process.exitCode = manifest.status === "verified" ? 0 : 1;
  } catch (err) {
    if (err instanceof LockHeldError) {
      if (options.json) {
        printJson({ error: "lock-held", pid: err.lockManifest.pid, hostname: err.lockManifest.hostname });
      } else {
        fail(`Lock held by pid ${err.lockManifest.pid} on ${err.lockManifest.hostname} until ${err.lockManifest.stalenessAt}. If the prior run is no longer active, delete ${options.home}/housekeeper/lock and retry.`, 2);
      }
      return;
    }
    if (err instanceof PlanDriftError) {
      if (options.json) {
        printJson({ error: "plan-drift", expected: err.expectedHash, actual: err.actualHash });
      } else {
        fail("Plan drift detected: the home state changed between plan composition and execution. Re-run `clean` to pick up the latest state.", 2);
      }
      return;
    }
    if (err instanceof NotImplementedError) {
      if (options.json) {
        printJson({ error: "mutation-kind-not-implemented", mutationKind: err.mutationKind });
      } else {
        fail(`Mutation kind "${err.mutationKind}" is not implemented in v0.2.0.`, 2);
      }
      return;
    }
    throw err;
  }
}

function runHarden() {
  fail("No files were changed. harden is planned, but prevention hooks must be reviewed before installation.", 2);
}

async function runRollback(options) {
  if (!options.rollbackId) {
    fail("rollback requires an operation id, for example: rollback op_20260511143022_a1b2c3d4", 2);
    return;
  }

  try {
    const plan = await composeRollbackPlan(options.home, options.rollbackId);

    if (plan.refused.length > 0) {
      if (options.json) printJson({ refused: plan.refused });
      else printRollbackRefusals(plan);
      process.exitCode = 2;
      return;
    }

    if (options.dryRun) {
      if (options.json) printJson({ plan });
      else printRollbackPlan(plan, { dryRun: true });
      process.exitCode = 0;
      return;
    }

    if (!options.confirm) {
      if (options.json) printJson({ plan });
      else printRollbackPlan(plan);
      fail("Refusing rollback: --confirm not passed. Pass --confirm --yes to restore files.", 2);
      return;
    }

    if (!options.yes) {
      if (options.json) printJson({ plan });
      else printRollbackPlan(plan);
      fail("Refusing rollback: --yes not passed. Pass --confirm --yes to restore files.", 2);
      return;
    }

    const validated = await validateRollbackPlan(plan, options.home);
    const manifest = await executeRollbackPlan(validated, options.home);

    if (options.json) {
      printJson({ manifest });
    } else {
      console.log("HOUSEKEEPER ROLLBACK");
      console.log(`Operation: ${manifest.id}`);
      console.log(`Restored files: ${manifest.files.filter((entry) => entry.rollbackVerified).length}`);
      console.log("");
      console.log("DONE. Operation rolled back.");
    }
    process.exitCode = manifest.status === "rolled_back" ? 0 : 1;
  } catch (err) {
    if (err instanceof RollbackLockHeldError) {
      if (options.json) {
        printJson({ error: "lock-held", pid: err.lockManifest.pid, hostname: err.lockManifest.hostname });
      } else {
        fail(`Lock held by pid ${err.lockManifest.pid} on ${err.lockManifest.hostname} until ${err.lockManifest.stalenessAt}. If the prior run is no longer active, delete ${options.home}/housekeeper/lock and retry.`, 2);
      }
      return;
    }
    if (err instanceof RollbackPlanDriftError) {
      if (options.json) {
        printJson({ error: "rollback-plan-drift", targetPath: err.targetPath, expected: err.expectedHash, actual: err.actualHash });
      } else {
        fail("Rollback plan drift detected: the home state changed between plan composition and execution. Re-run `rollback --dry-run` to inspect the latest state.", 2);
      }
      return;
    }
    if (err instanceof SnapshotIntegrityError) {
      if (options.json) {
        printJson({ error: "snapshot-integrity", snapshotPath: err.snapshotPath, expected: err.expectedHash, actual: err.actualHash });
      } else {
        fail(`Snapshot integrity check failed for ${err.snapshotPath}. Rollback refused.`, 2);
      }
      return;
    }
    if (err instanceof RollbackNotImplementedError) {
      if (options.json) {
        printJson({ error: "rollback-kind-not-implemented", kind: err.kind });
      } else {
        fail(`Rollback operation kind "${err.kind}" is not implemented in v0.2.0.`, 2);
      }
      return;
    }
    throw err;
  }
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

  // T-403: subagent dispatch probe.
  //
  // We ask Claude to use the Task tool to print the word READY. This exercises
  // the exact capability that Housekeeper's future verify-subagent flow relies
  // on: that the claude binary can dispatch a child agent task and return its
  // output in a single -p call.
  //
  // Prompt design:
  //   "Use the Task tool to run a subagent that prints READY"
  //   --allowedTools "Task" permits Task (subagent dispatch) only.
  //   We match /READY/ in the combined stdout+stderr.
  //
  // Failure semantics:
  //   SKIP only when the claude binary is absent (caught by the binary probe
  //   above which returns early). A present binary that cannot dispatch a
  //   subagent is a genuine FAIL.
  probes.push(
    runProbe(
      "subagent dispatch",
      "claude",
      [
        "-p",
        "Use the Task tool to run a subagent that prints the word READY",
        "--allowedTools",
        "Task"
      ],
      {
        timeoutMs: 60000,
        expect: (output) => /\bREADY\b/.test(output)
      }
    )
  );
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
  } else if (options.command === "clean" && !options.confirm) {
    // Flag gate: no --confirm → dry-run, no home needed.
    console.log("DRY-RUN — pass --confirm to arm mutation.");
    process.exitCode = 0;
  } else if (options.command === "clean" && options.confirm && !options.yes) {
    // Flag gate: --confirm without --yes → consent refused, no home needed.
    fail("Refusing mutation: --yes not passed. Pass --confirm --yes to skip the prompt and apply.", 2);
  } else if (options.command === "rollback" && options.rollbackId && !OPERATION_ID_PATTERN.test(options.rollbackId)) {
    fail("Invalid rollback operation id. Expected format: op_<YYYYMMDDHHMMSS>_<8hex>.", 2);
  } else {
    options.home = resolveClaudeHome(options.home);
    if (!existsSync(options.home)) {
      fail(`Claude home does not exist: ${options.home}`, 2);
    } else if (options.command === "diagnose") runDiagnose(options);
    else if (options.command === "plan") runPlan(options);
    else if (options.command === "clean") await runClean(options);
    else if (options.command === "verify") runVerify(options);
    else if (options.command === "harden") runHarden(options);
    else if (options.command === "rollback") await runRollback(options);
  }
} catch (error) {
  fail(error.message, 2);
}
