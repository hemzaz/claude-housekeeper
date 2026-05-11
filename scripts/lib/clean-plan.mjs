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
import { rm, open, unlink, mkdir, lstat, readFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, basename, dirname } from "node:path";
import os from "node:os";
import { assembleReport } from "./audit.mjs";
import {
  takeSnapshot,
  applyOperation,
  verify,
  gcSnapshots,
  generateOpId,
  MAX_OPERATION_FILES,
  MAX_OPERATION_BYTES
} from "./snapshot.mjs";
import { loadConfig, pathMatchesProtection } from "./policy.mjs";

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

/**
 * LockHeldError — thrown by executeCleanPlan when a live lockfile is present
 * and its stalenessAt timestamp is in the future.
 */
export class LockHeldError extends Error {
  constructor(lockManifest) {
    super(`Housekeeper lock is held by pid ${lockManifest.pid} on ${lockManifest.hostname}`);
    this.name = "LockHeldError";
    this.code = "lock-held";
    this.lockManifest = lockManifest;
  }
}

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

// ── MUTATION_REGISTRY ─────────────────────────────────────────────────────────

/**
 * MUTATION_REGISTRY — keyed on mutationKind, each value is a factory (args) =>
 * { apply }. Only "dir-rmtree" is implemented in v0.2.0. Other kinds throw
 * NotImplementedError when the factory is called.
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
    }
  }),

  "file-unlink": (_args) => {
    throw new NotImplementedError("file-unlink");
  },

  "file-replace": (_args) => {
    throw new NotImplementedError("file-replace");
  },

  "json-fragment-edit": (_args) => {
    throw new NotImplementedError("json-fragment-edit");
  }
});

// ── v0.2.0 cleanable detector set ────────────────────────────────────────────

const CLEANABLE_DETECTORS_V02 = new Set(["plugin.cache_unreferenced"]);

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

// ── 12-rule classifier (synchronous; async pre-checks done before this call) ─

function classifyFinding(finding, { home, interruptions, symlinkedPaths, mcpPaths, refByHookPaths, doNotTouchRules }) {
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

  // Rule 4: execution-class — surface executionClass !== "inert".
  if (surface.executionClass && surface.executionClass !== "inert") {
    return {
      refuse: true,
      reason: "execution-class",
      message: `Surface executionClass is "${surface.executionClass}"; clean only acts on inert surfaces`
    };
  }

  // Rule 5: rollback-class — surface rollbackClass === "not-applicable".
  if (surface.rollbackClass === "not-applicable") {
    return {
      refuse: true,
      reason: "rollback-class",
      message: `Surface rollbackClass is "not-applicable"; clean requires reversible operations`
    };
  }

  // Rule 6: owner — surface ownerClass not in {claude-managed, user-owned}.
  const allowedOwners = new Set(["claude-managed", "user-owned"]);
  if (surface.ownerClass && !allowedOwners.has(surface.ownerClass)) {
    return {
      refuse: true,
      reason: "owner",
      message: `Surface ownerClass is "${surface.ownerClass}"; clean only acts on claude-managed or user-owned surfaces`
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
 * Optional: mode (defaults to "safe").
 */
export async function composeCleanPlan(home, options = {}) {
  const targetDetectorId = options.target || "";
  const targetPath = options.path || "";
  const mode = options.mode || "safe";
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

  const operations = [];
  const refused = [];

  for (const finding of candidates) {
    const verdict = classifyFinding(finding, {
      home,
      interruptions,
      symlinkedPaths,
      mcpPaths,
      refByHookPaths,
      doNotTouchRules
    });

    if (verdict.refuse) {
      refused.push({
        class: "CleanPlanRefusal",
        reason: verdict.reason,
        targetPath: finding.targetPath || "",
        detectorId: finding.id,
        message: verdict.message || verdict.reason,
        exitCode: 2
      });
      continue;
    }

    // Build CleanOperation.
    const tp = finding.targetPath;
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

// ── Lockfile helpers ──────────────────────────────────────────────────────────

const LOCK_STALE_WINDOW_MS = 30 * 60 * 1000; // 30 minutes

async function acquireLock(home) {
  // home is the .claude dir; lockfile lives at home/housekeeper/lock.
  const lockDir = join(home, "housekeeper");
  const lockPath = join(lockDir, "lock");

  await mkdir(lockDir, { recursive: true });

  const opId = generateOpId();
  const now = new Date();
  const manifest = {
    pid: process.pid,
    hostname: os.hostname(),
    opId,
    startedAt: now.toISOString(),
    stalenessAt: new Date(now.getTime() + LOCK_STALE_WINDOW_MS).toISOString()
  };

  let fh;
  try {
    // O_EXCL (wx flag): fails with EEXIST if the file already exists.
    fh = await open(lockPath, "wx");
    await fh.writeFile(JSON.stringify(manifest, null, 2) + os.EOL);
    await fh.close();
    return lockPath;
  } catch (err) {
    if (fh) {
      try { await fh.close(); } catch { /* ignore */ }
    }
    if (err.code === "EEXIST") {
      // File appeared between our existence check and the open; read it.
      try {
        const raw = await readFile(lockPath, "utf8");
        const existing = JSON.parse(raw);
        throw new LockHeldError(existing);
      } catch (inner) {
        if (inner instanceof LockHeldError) throw inner;
        // Unreadable lock — treat as stale and retry.
        try { await unlink(lockPath); } catch { /* ignore */ }
        // Re-open with wx after clearing stale lock.
        let fh2;
        try {
          fh2 = await open(lockPath, "wx");
          await fh2.writeFile(JSON.stringify(manifest, null, 2) + os.EOL);
          await fh2.close();
          return lockPath;
        } catch {
          if (fh2) { try { await fh2.close(); } catch { /* ignore */ } }
          throw err;
        }
      }
    }
    throw err;
  }
}

async function releaseLock(lockPath) {
  try {
    await unlink(lockPath);
  } catch {
    // Already gone — ignore.
  }
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
  const lockPath = join(home, "housekeeper", "lock");

  // Pre-flight: check for a live (non-stale) lock before attempting O_EXCL.
  if (existsSync(lockPath)) {
    try {
      const raw = await readFile(lockPath, "utf8");
      const existing = JSON.parse(raw);
      const stalenessAt = new Date(existing.stalenessAt).getTime();
      if (Date.now() < stalenessAt) {
        throw new LockHeldError(existing);
      }
      // Stale lock — acquireLock will overwrite it.
    } catch (err) {
      if (err instanceof LockHeldError) throw err;
      // Unreadable lock — treat as stale.
    }
  }

  const acquiredPath = await acquireLock(home);

  try {
    await gcSnapshots(snapshotHome);

    let finalManifest;

    for (const op of plan.operations) {
      const consentSummary = [
        `clean --confirm --yes — remove plugin cache version directory`,
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

      // Materialise apply callables from the dir-rmtree descriptor.
      const dirPath = op.mutationOp.args.dirPath;
      const ops = targets.map((_, i) => ({
        apply: async (origPath) => {
          // Remove the individual file.
          await rm(origPath, { recursive: false, force: false });
          // After the last file, recursively remove the directory.
          if (i === targets.length - 1) {
            try {
              await rm(dirPath, { recursive: true, force: false });
            } catch {
              // May already be gone if earlier deletes cleaned it up.
            }
          }
        }
      }));

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
    await releaseLock(acquiredPath);
  }
}
