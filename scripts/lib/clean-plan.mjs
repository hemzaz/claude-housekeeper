// Clean plan composition, validation, and execution for Claude Housekeeper v0.2.
//
// Three-function pipeline:
//   composeCleanPlan  — pure: re-runs assembleReport, applies the 12-rule classifier,
//                       returns a CleanPlan with operations[] and refused[].
//   validateCleanPlan — pure (plus fs reads): drifts-checks the plan against live state,
//                       throws PlanDriftError if the report hash changed.
//   executeCleanPlan  — effectful: acquires lockfile, snapshots, applies, verifies.
//
// Per docs/design/clean-design.md §7 step 3 (T-704).

import { createHash } from "node:crypto";
import { rm, lstat, readFile, readdir, stat } from "node:fs/promises";
import { existsSync, unlinkSync } from "node:fs";
import { join, basename, dirname } from "node:path";
import { assembleReport } from "./audit.mjs";
import {
  takeSnapshot,
  applyOperation,
  verify,
  gcSnapshots,
  MAX_OPERATION_FILES,
  MAX_OPERATION_BYTES
} from "./snapshot.mjs";
import { loadConfig, pathMatchesProtection } from "./policy.mjs";
import { acquireLock, releaseLock, LockHeldError, LOCK_STALE_WINDOW_MS } from "./lock.mjs";

// suppress unused-import warning for budget constants used in JSDoc
void MAX_OPERATION_FILES;
void MAX_OPERATION_BYTES;

// ── Enums ─────────────────────────────────────────────────────────────────────

/**
 * MUTATION_KINDS — closed enum of four mutation kinds.
 * Only "dir-rmtree" is materialised in v0.2.0; the other three are reserved.
 */
export const MUTATION_KINDS = Object.freeze([
  "dir-rmtree",
  "file-unlink",
  "file-replace",
  "json-fragment-edit"
]);

// ── Error classes ─────────────────────────────────────────────────────────────

/**
 * CleanPlanRefusal — structured refusal returned in plan.refused[].
 * Not thrown; callers inspect plan.refused[].length.
 */
export class CleanPlanRefusal extends Error {
  constructor({ reason, targetPath, detectorId, message }) {
    super(message || reason);
    this.name = "CleanPlanRefusal";
    this.reason = reason;
    this.targetPath = targetPath || "";
    this.detectorId = detectorId || "";
    this.message = message || reason;
    this.exitCode = 2;
  }
}

/**
 * PlanDriftError — thrown by validateCleanPlan when the report hash changed
 * since composeCleanPlan ran, meaning the home state drifted under the plan.
 */
export class PlanDriftError extends Error {
  constructor(expected, actual) {
    super("Plan drift detected: report hash changed since plan was composed");
    this.name = "PlanDriftError";
    this.code = "plan-drift";
    this.expectedHash = expected;
    this.actualHash = actual;
  }
}

// LockHeldError is imported from lock.mjs and re-exported so v0.3 callers see no API change.
export { LockHeldError };

/**
 * NotImplementedError — thrown by MUTATION_REGISTRY for unimplemented kinds.
 */
export class NotImplementedError extends Error {
  constructor(mutationKind) {
    super(`Mutation kind "${mutationKind}" is not implemented in v0.2.0`);
    this.name = "NotImplementedError";
    this.code = "mutation-kind-not-implemented";
    this.mutationKind = mutationKind;
  }
}

// ── Batch constants (T-500..T-504, design C19/C20) ────────────────────────────
//
// Aggregate budget for `clean --batch`: per design C19 the default cap is 10
// pairs, max 50 (matches per-op snapshot budget). Aggregate file/byte limits
// match snapshot.mjs MAX_OPERATION_FILES/BYTES — same plumbing, one manifest.

/** Default number of --target/--path pairs accepted without explicit --batch. */
export const BATCH_DEFAULT_CAP = 10;

/** Hard maximum number of pairs accepted via --batch=N (C19). */
export const BATCH_MAX_PAIRS = 50;

/** Aggregate file budget across all batch ops (matches snapshot MAX_OPERATION_FILES). */
export const BATCH_AGGREGATE_FILE_LIMIT = MAX_OPERATION_FILES;

/** Aggregate byte budget across all batch ops (matches snapshot MAX_OPERATION_BYTES, 10 MiB). */
export const BATCH_AGGREGATE_BYTE_LIMIT = MAX_OPERATION_BYTES;

/**
 * BatchBudgetError — thrown by composeBatchCleanPlan when the aggregate
 * file/byte sum exceeds the v0.3 batch budget. Refusal class
 * `batch-exceeds-aggregate-budget` per design §3.3 / C20.
 */
export class BatchBudgetError extends Error {
  constructor(actual, limit) {
    const parts = [];
    if (actual.files > limit.files) parts.push(`${actual.files} files (limit ${limit.files})`);
    if (actual.bytes > limit.bytes) parts.push(`${actual.bytes} bytes (limit ${limit.bytes})`);
    super(`batch-exceeds-aggregate-budget: ${parts.join("; ")}`);
    this.name = "BatchBudgetError";
    this.code = "batch-exceeds-aggregate-budget";
    this.actual = actual;
    this.limit = limit;
  }
}

// ── MUTATION_REGISTRY ─────────────────────────────────────────────────────────

/**
 * MUTATION_REGISTRY — keyed on mutationKind, each value is a factory (args) =>
 * { apply, args }. "dir-rmtree" and "file-unlink" are implemented in v0.2.x;
 * the remaining two kinds throw NotImplementedError when invoked.
 *
 * file-unlink: single-file delete via fs.unlinkSync(args.path). The factory
 * shape matches the user's Phase 10 spec exactly. Args carries `{ path }`
 * (absolute) so executeCleanPlan can pass it into takeSnapshot as a single
 * snapshot target.
 */
export const MUTATION_REGISTRY = Object.freeze({
  "dir-rmtree": (args) => ({
    /**
     * apply(origPath) — deletes origPath and, after all files are gone,
     * removes the parent directory (args.dirPath) recursively.
     */
    apply: async (origPath) => {
      // Remove the individual file or symlink.
      await rm(origPath, { recursive: false, force: false });
      // Attempt to remove the directory itself; will fail (ENOTEMPTY) until the
      // last file is deleted — that is intentional, the final call succeeds.
      if (args && args.dirPath) {
        try {
          await rm(args.dirPath, { recursive: true, force: false });
        } catch {
          // Not yet empty — will succeed on the final file's deletion.
        }
      }
    },
    args
  }),

  "file-unlink": (args) => ({
    apply: () => unlinkSync(args.path),
    args
  }),

  "file-replace": (_args) => {
    throw new NotImplementedError("file-replace");
  },

  "json-fragment-edit": (_args) => {
    throw new NotImplementedError("json-fragment-edit");
  }
});

// ── v0.2.x cleanable detector set ────────────────────────────────────────────
// Phase 10 added "housekeeper.stale_lock" and "registry.local_command_identical".
// Both compose into file-unlink operations. Q-USER-3 keeps "plugin.expected_orphan"
// permanently OUT of this set.

const CLEANABLE_DETECTORS_V02 = new Set([
  "plugin.cache_unreferenced",
  "housekeeper.stale_lock",
  "registry.local_command_identical"
]);

// Detectors whose findings compose into file-unlink (vs dir-rmtree) operations.
const FILE_UNLINK_DETECTORS_V02 = new Set([
  "housekeeper.stale_lock",
  "registry.local_command_identical"
]);

// LOCK_STALE_WINDOW_MS is imported from lock.mjs — used by the
// stale-lock-not-yet-eligible refusal for defense-in-depth.

// ── Sector-boundary path test ─────────────────────────────────────────────────

function isSectorBoundary(targetPath, home) {
  const sep = "/";
  const norm = targetPath.split("\\").join(sep);
  const credRoot = join(home, "credentials");
  if (norm === credRoot || norm.startsWith(credRoot + sep)) return true;
  const base = basename(norm);
  if (base === ".env" || base.startsWith(".env.")) return true;
  for (const part of norm.split(sep)) {
    if (part === "credentials" || part === "secrets") return true;
  }
  return false;
}

// ── SHA-256 of report findings for drift detection ────────────────────────────

function hashReport(report) {
  const stable = JSON.stringify(
    (report.findings || []).map((f) => ({
      id: f.id,
      targetPath: f.targetPath,
      stance: f.stance
    }))
  );
  return createHash("sha256").update(stable).digest("hex");
}

// ── File hash + plugin-command lookup helpers (Phase 10 drift detection) ─────
//
// safeHashFile returns "" on any read error so callers can compare equality
// without try/catch noise. Matches the semantics audit.mjs uses for hashFile
// in safe mode.

async function safeHashFile(filePath) {
  try {
    const buf = await readFile(filePath);
    return createHash("sha256").update(buf).digest("hex");
  } catch {
    return "";
  }
}

// Walk every installed plugin's commands/ dir and return true if any command
// whose basename (without .md) matches `commandName` hashes equal to `wantHash`.
// Mirrors audit.mjs `localCommandIdentityFindings` semantics so compose-time
// drift detection lines up with the audit detector.
async function anyPluginCommandMatchesHash(home, commandName, wantHash) {
  if (!wantHash) return false;
  const installedPath = join(home, "plugins", "installed_plugins.json");
  let installed;
  try {
    installed = JSON.parse(await readFile(installedPath, "utf8"));
  } catch {
    return false;
  }
  const plugins = Array.isArray(installed?.plugins) ? installed.plugins : [];
  for (const record of plugins) {
    if (!record || typeof record !== "object") continue;
    const installPath = record.installPath
      || join(home, "plugins", "cache", record.marketplace || "unknown", record.name || "unknown", record.version || "unknown");
    const commandsDir = join(installPath, "commands");
    if (!existsSync(commandsDir)) continue;
    const candidates = await walkDir(commandsDir);
    for (const file of candidates) {
      if (!file.endsWith(".md")) continue;
      // Match by relative basename so nested command dirs (commands/foo/bar.md)
      // align with audit's name resolution.
      const relName = file.slice(commandsDir.length + 1).replace(/\.md$/, "");
      if (relName !== commandName) continue;
      const pluginHash = await safeHashFile(file);
      if (pluginHash === wantHash) return true;
    }
  }
  return false;
}

// ── Directory walk (files + symlinks, no recursion into symlinks) ─────────────

async function walkDir(dirPath) {
  const out = [];
  const stack = [dirPath];
  while (stack.length > 0) {
    const current = stack.pop();
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = join(current, entry.name);
      if (entry.isSymbolicLink()) {
        out.push(full); // record symlink but do not recurse into it
      } else if (entry.isDirectory()) {
        stack.push(full);
      } else if (entry.isFile()) {
        out.push(full);
      }
    }
  }
  return out;
}

// ── Estimated bytes ───────────────────────────────────────────────────────────

async function estimateBytes(paths) {
  let total = 0;
  for (const p of paths) {
    try {
      const s = await lstat(p);
      total += s.size;
    } catch {
      // Unreadable — skip.
    }
  }
  return total;
}

// ── Plugin MCP-server check ───────────────────────────────────────────────────

async function hasMcpServer(targetPath) {
  const candidates = [
    join(targetPath, ".claude-plugin", "plugin.json"),
    join(targetPath, ".mcp.json")
  ];
  for (const p of candidates) {
    if (!existsSync(p)) continue;
    try {
      const raw = await readFile(p, "utf8");
      const parsed = JSON.parse(raw);
      if (
        parsed
        && typeof parsed.mcpServers === "object"
        && parsed.mcpServers !== null
        && Object.keys(parsed.mcpServers).length > 0
      ) {
        return true;
      }
    } catch {
      // Unreadable plugin.json — be conservative and allow clean.
    }
  }
  return false;
}

// ── G7: per-refusal-reason recovery hints ────────────────────────────────────
// Each string completes "Next: ..." rendered under the refusal message in CLI
// plan-mode output and is emitted verbatim in --json output. Hints intentionally
// avoid internal vocabulary (ownerClass, executionClass, rollbackClass) the user
// has not encountered. Keys must stay in sync with the reasons returned by
// classifyFinding below.

const NEXT_STEP_BY_REASON = Object.freeze({
  "plan-state-error":
    "Run `claude-housekeeper rollback <opId>` on the interrupted operation, then re-run `clean`.",
  "protected-path":
    "Remove the path from `doNotTouch` in `<home>/housekeeper/config.json` or pick a different target.",
  "sector-boundary":
    "Housekeeper will not clean credential or secret paths. Delete manually with `rm` only after verifying contents.",
  "execution-class":
    "Surface is not safe to mutate automatically. Review the source manually; no `clean` action is available.",
  "rollback-class":
    "Operation is not reversible by Housekeeper. No automated action; review the source manually.",
  "owner":
    "Files owned by Claude or plugin internals cannot be cleaned; report a false positive if this surprises you.",
  "plugin-symlinked-cache":
    "Resolve the symlink manually and re-run `clean` on the real path.",
  "plugin-cache-referenced-by-hook":
    "Remove the hook entry referencing this path in `<home>/settings.json`, then re-run `clean`.",
  "plugin-cache-has-mcp-server":
    "Uninstall the plugin via `claude plugin uninstall <name> --scope <scope>`; that releases the MCP server cleanly.",
  "stale-lock-not-yet-eligible":
    "Wait for the 30-minute staleness window to elapse, then re-run `clean`.",
  "drift-detected":
    "Local command no longer matches its plugin counterpart. Inspect with `diff` and resolve manually.",
  "no-mutation-mapping-in-v0.2":
    "Not cleanable in v0.2.0. Track the roadmap in CHANGELOG.md; use `rm` only if you accept the risk.",
  "batch-exceeds-aggregate-budget":
    "Reduce the number of --target/--path pairs, or split the batch into multiple invocations.",
  "settings-rewrite-not-batchable":
    "Run `claude-housekeeper harden` for settings-rewrite findings; v0.3 batch only covers dir-rmtree and file-unlink ops.",
  "batch-pair-cap-exceeded":
    "Reduce pair count or raise --batch=N (max 50 per design)."
});

function nextStepFor(reason) {
  return NEXT_STEP_BY_REASON[reason] || "";
}

// ── allowedExecutionClasses default (T-099) ───────────────────────────────────
// `runClean` calls composeCleanPlan with the default — only "inert" surfaces
// pass rule 4. v0.3 `runHarden` will pass `["inert", "known-execution-context"]`
// so settings.json (a non-inert, known-load-bearing config surface) can be
// rewritten. The set is exposed as a parameter so the classifier stays the
// single source of truth for refusal semantics across both commands.
// See docs/design/v0.3-design.md §4.2 and v0.3-architect-memo.md §6.3.
const DEFAULT_ALLOWED_EXECUTION_CLASSES = Object.freeze(["inert"]);

// ── 12-rule classifier (synchronous; async pre-checks done before this call) ─

function classifyFinding(finding, { home, interruptions, symlinkedPaths, mcpPaths, refByHookPaths, doNotTouchRules, freshLockPaths, driftedLocalCommandPaths, allowedExecutionClasses }) {
  const id = finding.id;
  const targetPath = finding.targetPath || "";
  const surface = finding.surface || {};

  // Rule 1: plan-state-error — interrupted_operation exists for this home.
  if (interruptions.size > 0) {
    return {
      refuse: true,
      reason: "plan-state-error",
      message: "Cannot clean: interrupted operation exists. Run rollback first."
    };
  }

  // Rule 2: protected-path — target matches a doNotTouch rule.
  for (const rule of doNotTouchRules) {
    if (rule.path && pathMatchesProtection(rule.path, targetPath, home)) {
      return {
        refuse: true,
        reason: "protected-path",
        message: `Path ${targetPath} is protected by doNotTouch rule "${rule.path}"`
      };
    }
  }
  if (Array.isArray(finding.policyMatches) && finding.policyMatches.length > 0) {
    const match = finding.policyMatches[0];
    return {
      refuse: true,
      reason: "protected-path",
      message: `Path ${targetPath} is protected by rule "${match.pattern}": ${match.reason}`
    };
  }

  // Rule 3: sector-boundary — target is in a sector-boundary path.
  if (targetPath && isSectorBoundary(targetPath, home)) {
    return {
      refuse: true,
      reason: "sector-boundary",
      message: `Path ${targetPath} is inside a sector boundary`
    };
  }

  // Rule 4: execution-class — surface executionClass not in the allowed set.
  // The allowed set is a parameter (T-099) so v0.3 `runHarden` can widen it to
  // include `known-execution-context` for settings rewrites. Default is `inert`
  // only, which matches v0.2 `runClean` semantics exactly.
  // User-facing message avoids the internal "executionClass" token (G7).
  if (surface.executionClass && !allowedExecutionClasses.has(surface.executionClass)) {
    return {
      refuse: true,
      reason: "execution-class",
      message: `Surface at ${targetPath} is executable or active; clean only acts on inert surfaces`
    };
  }

  // Rule 5: rollback-class — surface rollbackClass === "not-applicable".
  // User-facing message avoids the internal "rollbackClass" token (G7).
  if (surface.rollbackClass === "not-applicable") {
    return {
      refuse: true,
      reason: "rollback-class",
      message: `Surface at ${targetPath} is not reversible; clean requires reversible operations`
    };
  }

  // Rule 6: owner — surface ownerClass not in {claude-managed, user-owned}.
  // Phase 10 exception: housekeeper.stale_lock cleans housekeeper's OWN lockfile,
  // so housekeeper-owned is the correct owner for the only path it acts on.
  // User-facing message avoids the internal "ownerClass" token (G7).
  const allowedOwners = new Set(["claude-managed", "user-owned"]);
  const housekeeperSelfCleanup =
    id === "housekeeper.stale_lock" && surface.ownerClass === "housekeeper-owned";
  if (surface.ownerClass && !allowedOwners.has(surface.ownerClass) && !housekeeperSelfCleanup) {
    return {
      refuse: true,
      reason: "owner",
      message: `Surface at ${targetPath} is owned by Claude or plugin internals; clean only acts on claude-managed or user-owned surfaces`
    };
  }

  // Rule 7: plugin-symlinked-cache — lstat shows the target is a symlink.
  if (symlinkedPaths.has(targetPath)) {
    return {
      refuse: true,
      reason: "plugin-symlinked-cache",
      message: `Target path ${targetPath} is a symbolic link; clean refuses symlinked cache directories`
    };
  }

  // Rule 8: plugin-cache-referenced-by-hook — another finding covers this path.
  if (refByHookPaths.has(targetPath)) {
    return {
      refuse: true,
      reason: "plugin-cache-referenced-by-hook",
      message: `Target path ${targetPath} is referenced by a settings hook; clean refused to avoid dangling hook`
    };
  }

  // Rule 9: plugin-cache-has-mcp-server — plugin.json declares mcpServers.
  if (mcpPaths.has(targetPath)) {
    return {
      refuse: true,
      reason: "plugin-cache-has-mcp-server",
      message: `Plugin at ${targetPath} declares an MCP server; clean is refused for safety`
    };
  }

  // Rule 10: stance — finding stance not in {review, prepare}.
  // Applied only to detectors that ARE in the cleanable set; for non-cleanable
  // detectors this check is skipped in favour of rule 12 below.
  // The snapshot+verify pipeline serves as the freshness probe for
  // plugin.cache_unreferenced (Ruling 1, docs/design/clean-tie-breaker.md).

  // Rule 11: missing-key — evidence.missing.length > 0.
  // Like rule 10, only applied to cleanable detectors; for non-cleanable
  // detectors the surface "not cleanable" reason takes precedence (rule 12).

  // Phase 10 — defense-in-depth refusals for the two file-unlink detectors:
  //
  // stale-lock-not-yet-eligible: the audit detector already gates on the
  // 30-min staleness window, but compose re-runs assembleReport (Q-USER-2)
  // and may race with a lockfile written between the detector emission and
  // this classifier call. Refuse cleanly if the lock has been refreshed
  // such that stalenessAt is now in the future.
  if (id === "housekeeper.stale_lock" && freshLockPaths.has(targetPath)) {
    return {
      refuse: true,
      reason: "stale-lock-not-yet-eligible",
      message: `Lockfile at ${targetPath} is not yet stale; the 30 min staleness window has not elapsed`
    };
  }

  // drift-detected: local command file is no longer byte-identical to its
  // plugin counterpart at compose time. The audit detector hashes both files
  // when assembleReport runs, but a race between assembleReport and the
  // classifier (or a partial write) can leave the finding stale. Refuse
  // cleanly rather than delete a divergent file.
  if (id === "registry.local_command_identical" && driftedLocalCommandPaths.has(targetPath)) {
    return {
      refuse: true,
      reason: "drift-detected",
      message: `Local command at ${targetPath} is no longer byte-identical to its plugin counterpart`
    };
  }

  // Rule 12: no-mutation-mapping-in-v0.2 — detector id not in cleanable set.
  // Evaluated last so that cleanable detectors bypass stance/missing-key checks
  // while non-cleanable detectors always surface this reason first.
  if (!CLEANABLE_DETECTORS_V02.has(id)) {
    return {
      refuse: true,
      reason: "no-mutation-mapping-in-v0.2",
      message: `Detector "${id}" is not cleanable in v0.2.0`
    };
  }

  return { refuse: false };
}

// ── composeCleanPlan ──────────────────────────────────────────────────────────

/**
 * composeCleanPlan(home, options) — re-runs assembleReport (Q-USER-2), applies
 * the 12-rule refusal classifier, and returns a CleanPlan. Pure except for
 * assembleReport and lstat/readFile calls needed by the classifier.
 *
 * Required options: target (detector id), path (absolute path).
 * Optional: mode (defaults to "safe"),
 *           allowedExecutionClasses (defaults to ["inert"]; T-099 hook for
 *           v0.3 harden which passes ["inert", "known-execution-context"]).
 */
export async function composeCleanPlan(home, options = {}) {
  const targetDetectorId = options.target || "";
  const targetPath = options.path || "";
  const mode = options.mode || "safe";
  const allowedExecutionClasses = new Set(
    options.allowedExecutionClasses || DEFAULT_ALLOWED_EXECUTION_CLASSES
  );
  const composedAt = new Date().toISOString();

  // Q-USER-2: always re-run assembleReport to guarantee freshness.
  const report = assembleReport(home, { mode });
  const reportHash = hashReport(report);

  // Collect interrupted-operation finding paths.
  const interruptions = new Set(
    report.findings
      .filter((f) => f.id === "housekeeper.interrupted_operation")
      .map((f) => f.targetPath)
  );

  // Collect paths covered by plugin.cache_referenced_by_hook findings.
  const refByHookPaths = new Set(
    report.findings
      .filter((f) => f.id === "plugin.cache_referenced_by_hook")
      .map((f) => f.targetPath)
  );

  // Load policy for protected-path checks.
  const config = loadConfig(home);
  const doNotTouchRules = config.rules || [];

  // Filter findings to those matching --target (and --path if given).
  let candidates = report.findings.filter((f) => f.id === targetDetectorId);
  if (targetPath) {
    candidates = candidates.filter((f) => f.targetPath === targetPath);
  }

  // Async pre-checks: symlink detection (rule 7) and MCP server (rule 9).
  const symlinkedPaths = new Set();
  const mcpPaths = new Set();
  for (const f of candidates) {
    const tp = f.targetPath;
    if (!tp) continue;
    if (existsSync(tp)) {
      try {
        const st = await lstat(tp);
        if (st.isSymbolicLink()) symlinkedPaths.add(tp);
      } catch {
        // Cannot stat — skip.
      }
      if (await hasMcpServer(tp)) mcpPaths.add(tp);
    }
  }

  // Phase 10 pre-checks for the two file-unlink detectors.
  // freshLockPaths: paths whose stalenessAt is still in the future (race-safe).
  // driftedLocalCommandPaths: local command files that are no longer byte-
  //   identical to ANY plugin counterpart at compose time. Recomputing the
  //   hash here is intentional — assembleReport already ran (Q-USER-2) but
  //   the freshness window is measured per-classifier-call.
  const freshLockPaths = new Set();
  const driftedLocalCommandPaths = new Set();
  const now = Date.now();
  for (const f of candidates) {
    if (f.id === "housekeeper.stale_lock" && f.targetPath && existsSync(f.targetPath)) {
      try {
        const raw = await readFile(f.targetPath, "utf8");
        const manifest = JSON.parse(raw);
        if (typeof manifest.stalenessAt === "string") {
          const stalenessAt = new Date(manifest.stalenessAt).getTime();
          if (Number.isFinite(stalenessAt) && now < stalenessAt) {
            freshLockPaths.add(f.targetPath);
          }
        } else if (typeof manifest.startedAt === "string") {
          // Legacy manifest without stalenessAt — derive from startedAt + 30m.
          const startedAt = new Date(manifest.startedAt).getTime();
          if (Number.isFinite(startedAt) && now < startedAt + LOCK_STALE_WINDOW_MS) {
            freshLockPaths.add(f.targetPath);
          }
        }
      } catch {
        // Unreadable / unparseable lock — fall through to audit's detector
        // semantics. Audit emits stale_lock for unreadable locks too, so the
        // user can clean them.
      }
    }
    if (f.id === "registry.local_command_identical" && f.targetPath && existsSync(f.targetPath)) {
      const localHash = await safeHashFile(f.targetPath);
      const matched = await anyPluginCommandMatchesHash(home, basename(f.targetPath, ".md"), localHash);
      if (!matched) driftedLocalCommandPaths.add(f.targetPath);
    }
  }

  const operations = [];
  const refused = [];

  for (const finding of candidates) {
    const verdict = classifyFinding(finding, {
      home,
      interruptions,
      symlinkedPaths,
      mcpPaths,
      refByHookPaths,
      doNotTouchRules,
      freshLockPaths,
      driftedLocalCommandPaths,
      allowedExecutionClasses
    });

    if (verdict.refuse) {
      refused.push({
        class: "CleanPlanRefusal",
        reason: verdict.reason,
        targetPath: finding.targetPath || "",
        detectorId: finding.id,
        message: verdict.message || verdict.reason,
        nextStep: nextStepFor(verdict.reason),
        exitCode: 2
      });
      continue;
    }

    // Build CleanOperation. Phase 10: branch on detector id — file-unlink
    // detectors snapshot a single file; dir-rmtree detectors walk a directory.
    const tp = finding.targetPath;
    if (FILE_UNLINK_DETECTORS_V02.has(finding.id)) {
      let estBytes = 0;
      if (existsSync(tp)) {
        try { estBytes = (await stat(tp)).size; } catch { estBytes = 0; }
      }
      operations.push({
        detectorId: finding.id,
        targetPath: tp,
        mutationKind: "file-unlink",
        mutationOp: { kind: "file-unlink", args: { path: tp } },
        snapshotStrategy: "file-unlink",
        estimatedBytes: estBytes,
        expandedFiles: [tp],
        expectedExitState: "verified"
      });
    } else {
      let expandedFiles = [];
      let estBytes = 0;
      if (existsSync(tp)) {
        expandedFiles = await walkDir(tp);
        estBytes = await estimateBytes(expandedFiles);
      }
      operations.push({
        detectorId: finding.id,
        targetPath: tp,
        mutationKind: "dir-rmtree",
        mutationOp: { kind: "dir-rmtree", args: { dirPath: tp } },
        snapshotStrategy: "dir-rmtree",
        estimatedBytes: estBytes,
        expandedFiles,
        expectedExitState: "verified"
      });
    }
  }

  // Enforce one operation per plan (v0.2 constraint per §1.6).
  // Tie-break: smallest estimatedBytes; then lexicographic targetPath (Q-USER-1).
  if (operations.length > 1) {
    operations.sort((a, b) => {
      const diff = a.estimatedBytes - b.estimatedBytes;
      if (diff !== 0) return diff;
      if (a.targetPath < b.targetPath) return -1;
      if (a.targetPath > b.targetPath) return 1;
      return 0;
    });
    const [kept, ...rest] = operations;
    for (const op of rest) {
      refused.push({
        class: "CleanPlanRefusal",
        reason: "no-mutation-mapping-in-v0.2",
        targetPath: op.targetPath,
        detectorId: op.detectorId,
        message: "v0.2 cleans one finding per invocation; re-run clean to address this one",
        nextStep: `Re-run \`clean --confirm --yes --target=${op.detectorId} --path=${op.targetPath}\` to address the remaining findings.`,
        exitCode: 2
      });
    }
    operations.length = 0;
    operations.push(kept);
  }

  return {
    schemaVersion: "0.2",
    home,
    targetDetectorId,
    targetPath,
    operations,
    refused,
    composedAt,
    reportHash
  };
}

// ── validateCleanPlan ─────────────────────────────────────────────────────────

/**
 * validateCleanPlan(plan, home) — re-runs assembleReport, computes reportHash,
 * and throws PlanDriftError if it differs from plan.reportHash. Also re-checks
 * each operation's target for policy drift and new MCP server declarations.
 * Returns the plan with a validatedAt ISO timestamp added.
 *
 * NOTE (Q-USER-1): if operations is empty but multiple findings matched at compose
 * time, the lexicographically smallest targetPath was already selected. That
 * invariant is preserved here — no reselection occurs.
 */
export async function validateCleanPlan(plan, home) {
  const report = assembleReport(home, { mode: "safe" });
  const currentHash = hashReport(report);

  if (currentHash !== plan.reportHash) {
    throw new PlanDriftError(plan.reportHash, currentHash);
  }

  // Re-check live state for each operation.
  const config = loadConfig(home);
  const doNotTouchRules = config.rules || [];

  for (const op of plan.operations) {
    const tp = op.targetPath;

    // Protection policy re-check.
    for (const rule of doNotTouchRules) {
      if (rule.path && pathMatchesProtection(rule.path, tp, home)) {
        throw new PlanDriftError(plan.reportHash, currentHash + ":policy-changed");
      }
    }

    // MCP server re-check.
    if (existsSync(tp) && await hasMcpServer(tp)) {
      throw new PlanDriftError(plan.reportHash, currentHash + ":mcp-gained");
    }
  }

  return { ...plan, validatedAt: new Date().toISOString() };
}

// ── executeCleanPlan ──────────────────────────────────────────────────────────

/**
 * executeCleanPlan(plan, home) — acquires the housekeeper lockfile atomically,
 * runs gcSnapshots, then for each CleanOperation: takeSnapshot → applyOperation
 * → verify. The lockfile is always released in the finally block.
 * Returns the final operation manifest (status "verified" on success).
 */
export async function executeCleanPlan(plan, home) {
  // home is the .claude dir (audit convention); snapshot functions expect the
  // parent directory, so derive snapshotHome = dirname(home) for those calls.
  // The lockfile lives at home/housekeeper/lock (= ~/.claude/housekeeper/lock).
  const snapshotHome = dirname(home);

  const lockHandle = await acquireLock(home);

  try {
    await gcSnapshots(snapshotHome);

    let finalManifest;

    for (const op of plan.operations) {
      const consentLabel = op.mutationKind === "file-unlink"
        ? "remove single file"
        : "remove plugin cache version directory";
      const consentSummary = [
        `clean --confirm --yes — ${consentLabel}`,
        `  detector: ${op.detectorId}`,
        `  target:   ${op.targetPath}`,
        `  files:    ${op.expandedFiles ? op.expandedFiles.length : 0}`,
        `  bytes:    ${op.estimatedBytes}`
      ].join("\n");

      const targets = op.expandedFiles && op.expandedFiles.length > 0
        ? op.expandedFiles
        : [];

      const { opId } = await takeSnapshot(snapshotHome, {
        targets,
        command: "clean",
        mode: "confirm",
        consentSummary
      });

      // Materialise apply callables. Phase 10: dispatch on mutationOp.kind.
      let ops;
      if (op.mutationOp.kind === "file-unlink") {
        // One target, one apply — straight unlink.
        ops = targets.map(() => ({
          apply: async (origPath) => {
            await rm(origPath, { recursive: false, force: false });
          }
        }));
      } else {
        // dir-rmtree: per-file unlink, then rmdir on the last entry.
        const dirPath = op.mutationOp.args.dirPath;
        ops = targets.map((_, i) => ({
          apply: async (origPath) => {
            await rm(origPath, { recursive: false, force: false });
            if (i === targets.length - 1) {
              try {
                await rm(dirPath, { recursive: true, force: false });
              } catch {
                // May already be gone if earlier deletes cleaned it up.
              }
            }
          }
        }));
      }

      const appliedManifest = await applyOperation(opId, snapshotHome, ops);

      if (appliedManifest.partialApply) {
        // Q5: partial apply surfaces via housekeeper.interrupted_operation.
        finalManifest = appliedManifest;
        break;
      }

      finalManifest = await verify(opId, snapshotHome);
    }

    return finalManifest;
  } finally {
    await releaseLock(lockHandle, "verified");
  }
}

// ── Batch compose + execute (T-500..T-504) ────────────────────────────────────
//
// Per design §2.3 Q3 ruling: manifest-atomic verification, NO auto-rollback.
// One snapshot manifest covers all ops in the batch. On any per-op verify
// failure the manifest stays at `applied` with partialApply=true and
// housekeeper.interrupted_operation surfaces it on next diagnose.
//
// Per C6: v0.3 batch EXCLUDES `settings-rewrite` ops. Only `dir-rmtree` and
// `file-unlink` are batchable; settings-rewrite findings get a per-pair
// `settings-rewrite-not-batchable` refusal so the operator routes them to
// `harden` (Phase 4).

/**
 * composeBatchCleanPlan(home, options) — aggregate N findings into one batch
 * plan. Reuses composeCleanPlan per pair, collects ops + refusals, then
 * enforces:
 *   1. pair count ≤ batchCap (default BATCH_DEFAULT_CAP, max BATCH_MAX_PAIRS)
 *   2. settings-rewrite kinds → per-pair refusal (C6)
 *   3. aggregate file/byte sum ≤ snapshot budget (C20)
 *
 * Returns { schemaVersion, home, operations, refused, pairs, composedAt,
 * reportHash, batchCap }. Throws BatchBudgetError when the aggregate
 * file/byte sum exceeds the snapshot budget (handler converts to refusal +
 * exit 2).
 */
export async function composeBatchCleanPlan(home, options = {}) {
  const pairs = Array.isArray(options.pairs) ? options.pairs : [];
  const batchCap = Number.isInteger(options.batchCap) && options.batchCap > 0
    ? Math.min(options.batchCap, BATCH_MAX_PAIRS)
    : BATCH_DEFAULT_CAP;
  const allowedExecutionClasses = options.allowedExecutionClasses;

  // C19: pair-count cap. Fires before any per-pair compose so we don't pay
  // assembleReport N times for a doomed batch.
  if (pairs.length > batchCap) {
    return {
      schemaVersion: "0.2",
      home,
      operations: [],
      refused: [{
        class: "CleanPlanRefusal",
        reason: "batch-pair-cap-exceeded",
        targetPath: "",
        detectorId: "",
        message: `Got ${pairs.length} pairs; batch cap is ${batchCap}`,
        nextStep: nextStepFor("batch-pair-cap-exceeded"),
        exitCode: 2
      }],
      pairs,
      composedAt: new Date().toISOString(),
      reportHash: "",
      batchCap
    };
  }

  const operations = [];
  const refused = [];
  let reportHash = "";
  const composedAt = new Date().toISOString();

  for (const pair of pairs) {
    const perPlan = await composeCleanPlan(home, {
      target: pair.target,
      path: pair.path,
      allowedExecutionClasses
    });
    // Hash freshness — every per-pair compose re-runs assembleReport so all
    // hashes should agree. We capture the first one for drift detection.
    if (!reportHash) reportHash = perPlan.reportHash;

    for (const op of perPlan.operations) {
      // C6: settings-rewrite excluded from batch. Convert to refusal so the
      // operator routes to harden. Use a synthetic detectorId for visibility.
      if (op.mutationKind === "settings-rewrite") {
        refused.push({
          class: "CleanPlanRefusal",
          reason: "settings-rewrite-not-batchable",
          targetPath: op.targetPath,
          detectorId: op.detectorId,
          message: "v0.3 batch excludes settings-rewrite operations (design C6)",
          nextStep: nextStepFor("settings-rewrite-not-batchable"),
          exitCode: 2
        });
        continue;
      }
      operations.push(op);
    }
    for (const r of perPlan.refused) {
      refused.push(r);
    }
  }

  // C20: aggregate budget. Sum across all operations' expandedFiles + bytes.
  let totalFiles = 0;
  let totalBytes = 0;
  for (const op of operations) {
    totalFiles += (op.expandedFiles && op.expandedFiles.length) || 0;
    totalBytes += op.estimatedBytes || 0;
  }
  if (
    totalFiles > BATCH_AGGREGATE_FILE_LIMIT
    || totalBytes > BATCH_AGGREGATE_BYTE_LIMIT
  ) {
    // Convert to refusal-set (mirrors per-pair pattern); empty operations.
    return {
      schemaVersion: "0.2",
      home,
      operations: [],
      refused: [
        ...refused,
        {
          class: "CleanPlanRefusal",
          reason: "batch-exceeds-aggregate-budget",
          targetPath: "",
          detectorId: "",
          message: `Aggregate batch budget exceeded: ${totalFiles} files / ${totalBytes} bytes (limit ${BATCH_AGGREGATE_FILE_LIMIT} files / ${BATCH_AGGREGATE_BYTE_LIMIT} bytes)`,
          nextStep: nextStepFor("batch-exceeds-aggregate-budget"),
          exitCode: 2
        }
      ],
      pairs,
      composedAt,
      reportHash,
      batchCap
    };
  }

  return {
    schemaVersion: "0.2",
    home,
    operations,
    refused,
    pairs,
    composedAt,
    reportHash,
    batchCap
  };
}

/**
 * executeBatchCleanPlan(plan, home) — acquire lock, take ONE snapshot of every
 * file across every operation, apply per-file with mutation-kind dispatch,
 * verify per-file. Per Q3: status reaches `verified` only when EVERY file
 * verifies; on any failure the manifest stays at `applied` with
 * partialApply=true.
 *
 * Returns the final manifest. Releases the lock in finally.
 */
export async function executeBatchCleanPlan(plan, home) {
  const snapshotHome = dirname(home);

  const lockHandle = await acquireLock(home);

  try {
    await gcSnapshots(snapshotHome);

    // Flatten every op's expandedFiles into one snapshot target list with a
    // parallel per-file dispatch table that knows which mutation kind owns it.
    // Order is preserved so per-file dispatch lines up with manifest.files[i].
    const targets = [];
    const dispatchByIndex = []; // { kind: "dir-rmtree" | "file-unlink", dirPath?, isLastInDir }
    const dirLastIndex = new Map(); // dirPath -> last flat index, to fire rmdir once

    for (const op of plan.operations) {
      const expanded = (op.expandedFiles && op.expandedFiles.length > 0)
        ? op.expandedFiles
        : [];
      for (const f of expanded) {
        targets.push(f);
        if (op.mutationKind === "file-unlink") {
          dispatchByIndex.push({ kind: "file-unlink" });
        } else {
          // dir-rmtree
          const dirPath = op.mutationOp?.args?.dirPath || op.targetPath;
          dispatchByIndex.push({ kind: "dir-rmtree", dirPath });
          dirLastIndex.set(dirPath, targets.length - 1);
        }
      }
    }

    if (targets.length === 0) {
      // Nothing to snapshot — return a synthetic manifest. (Caller filters this
      // earlier; defensive guard for empty operations after refusals strip them.)
      return {
        schemaVersion: "0.2",
        id: "",
        status: "verified",
        partialApply: false,
        files: []
      };
    }

    const consentSummary = [
      `clean --batch --confirm --yes — ${plan.operations.length} operation(s)`,
      ...plan.operations.map((op) => `  ${op.mutationKind}  ${op.targetPath}  (${op.estimatedBytes}B)`)
    ].join("\n");

    const { opId } = await takeSnapshot(snapshotHome, {
      targets,
      command: "clean",
      mode: "confirm",
      consentSummary
    });

    // Build per-file apply callables matching the dispatch table.
    const ops = targets.map((_, idx) => ({
      apply: async (origPath) => {
        const d = dispatchByIndex[idx];
        await rm(origPath, { recursive: false, force: false });
        if (d.kind === "dir-rmtree" && dirLastIndex.get(d.dirPath) === idx) {
          try {
            await rm(d.dirPath, { recursive: true, force: false });
          } catch {
            // Already gone or non-empty due to a per-file apply failure earlier
            // in the same dir. Either way the verify pass surfaces residuals.
          }
        }
      }
    }));

    const applied = await applyOperation(opId, snapshotHome, ops);

    // Q3 ruling: if any per-file apply failed, manifest stays `applied` with
    // partialApply=true and we do NOT call verify (status would not advance).
    if (applied.partialApply) return applied;

    const verified = await verify(opId, snapshotHome);
    return verified;
  } finally {
    await releaseLock(lockHandle, "verified");
  }
}
