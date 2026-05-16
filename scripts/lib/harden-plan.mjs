// Harden plan composition, validation, and execution for Claude Housekeeper v0.3.
//
// Mirrors scripts/lib/clean-plan.mjs (composeCleanPlan / validateCleanPlan /
// executeCleanPlan) but routes mutations through
// MUTATION_REGISTRY["settings-rewrite"] from scripts/lib/snapshot.mjs.
//
// Per docs/design/v0.3-design.md §3.2 (pipeline shape) and §3.3 (refusal taxonomy).
//
// Reuses from clean-plan.mjs (do not duplicate): the 12-rule classifier (via
// composeCleanPlan's allowedExecutionClasses parameter, T-099), policy loading,
// and the lock acquire/release/preflight ceremony (re-implemented locally as a
// thin wrapper so harden does not import clean-plan.mjs's private helpers —
// keeps the two pipelines decoupled).

import { createHash } from "node:crypto";
import { open, unlink, mkdir, readFile, copyFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import os from "node:os";
import { assembleReport, hasJsonComments } from "./audit.mjs";
import {
  takeSnapshot,
  applyOperation,
  verify,
  gcSnapshots,
  generateOpId,
  MUTATION_REGISTRY,
  PreApplyRefusal
} from "./snapshot.mjs";
import { composeCleanPlan } from "./clean-plan.mjs";

// ── Error classes (mirror clean-plan.mjs shapes) ────────────────────────────

/**
 * HardenPlanRefusal — structured refusal returned in plan.refused[].
 * Mirrors CleanPlanRefusal so the renderer can format both with the same code.
 */
export class HardenPlanRefusal extends Error {
  constructor({ reason, targetPath, detectorId, message }) {
    super(message || reason);
    this.name = "HardenPlanRefusal";
    this.reason = reason;
    this.targetPath = targetPath || "";
    this.detectorId = detectorId || "";
    this.message = message || reason;
    this.exitCode = 2;
  }
}

/**
 * HardenPlanDriftError — thrown by validateHardenPlan when the report hash
 * changed since composeHardenPlan ran. Same code as PlanDriftError for parity.
 */
export class HardenPlanDriftError extends Error {
  constructor(expected, actual) {
    super("Plan drift detected: report hash changed since harden plan was composed");
    this.name = "HardenPlanDriftError";
    this.code = "plan-drift";
    this.expectedHash = expected;
    this.actualHash = actual;
  }
}

/**
 * HardenLockHeldError — thrown by executeHardenPlan when a live lockfile holds.
 */
export class HardenLockHeldError extends Error {
  constructor(lockManifest) {
    super(`Housekeeper lock is held by pid ${lockManifest.pid} on ${lockManifest.hostname}`);
    this.name = "HardenLockHeldError";
    this.code = "lock-held";
    this.lockManifest = lockManifest;
  }
}

// ── G7: per-refusal-reason recovery hints (design §3.3 + product memo §3) ───

const NEXT_STEP_BY_REASON = Object.freeze({
  "settings-jsonc-detected":
    "Strip comments from settings.json by hand, save as plain JSON, and re-run harden. Housekeeper does not auto-strip comments.",
  "settings-shape-unknown":
    "Compare your settings.json to the documented schema (see https://docs.claude.com/claude-code/settings), restore the expected top-level shape, and re-run harden.",
  "patch-not-idempotent":
    "This is a Housekeeper bug — please file an issue with the contents of your settings.json (redacted as needed). Until a patch lands, remove the broken settings entry by hand.",
  "patch-produces-invalid-json":
    "This is a Housekeeper bug — please file an issue with the contents of your settings.json (redacted as needed). Your settings.json on disk is unchanged.",
  "settings-network-filesystem":
    "Move settings.json onto a local filesystem (atomic rename is not guaranteed on NFS/SMB), then re-run harden.",
  "no-mutation-mapping-in-v0.3":
    "Not hardenable in v0.3. Track the roadmap in CHANGELOG.md; edit settings.json by hand if you accept the risk.",
  "no-finding-for-target":
    "No finding for the requested target/path. Run `claude-housekeeper diagnose` to see current findings, then pick a hardenable one."
});

function nextStepFor(reason) {
  return NEXT_STEP_BY_REASON[reason] || "";
}

// ── v0.3 hardenable detector set (Phase 3 will promote; for now empty) ─────
//
// Phase 3 (T-300..T-302) promotes settings.hook_path_dangling and
// settings.mcp_command_missing into this set. T-200 ships an empty set so the
// pipeline + refusal classifier are exercised by tests without coupling them
// to Phase 3 detector wiring. The classifier raises `no-mutation-mapping-in-v0.3`
// for any detector not in this set — analogous to clean-plan's v0.2 set.

const HARDENABLE_DETECTORS_V03 = new Set([
  // Filled by T-300..T-302 (Phase 3).
]);

// Test seam for Phase 2: lets the harden-plan test file exercise the happy
// path before Phase 3 lands. Callers in production pass nothing here and the
// set above is used as-is. Tests pass an explicit overrideHardenable array
// containing the detector id they want to treat as hardenable. NOT a public
// API — name is prefixed __ to discourage importers.
function effectiveHardenableSet(overrideHardenable) {
  if (!overrideHardenable) return HARDENABLE_DETECTORS_V03;
  return new Set([...HARDENABLE_DETECTORS_V03, ...overrideHardenable]);
}

// ── SHA-256 of report findings for drift detection (parity with clean-plan) ─

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

// ── Patch generator stub ───────────────────────────────────────────────────
//
// Phase 3 (T-300..T-302) implements per-detector patch generation. T-200 ships
// a no-op identity patch so the pipeline can be exercised end-to-end without
// detector promotion. The patch DSL is defined in snapshot.mjs applyPatch.
// When a detector lands in HARDENABLE_DETECTORS_V03, this function must be
// extended to compose a real patch for that detector id.

function generatePatchForFinding(finding) {
  // Identity patch: a remove of a non-existent key is a no-op (per
  // snapshot.mjs applyPatch contract). Reserved key
  // "__housekeeper_harden_identity__" is never present in a real settings.json,
  // so the apply is observable as identity. Phase 3 replaces this with real
  // per-detector patch generation; until then no detector reaches the
  // patch-generation branch because HARDENABLE_DETECTORS_V03 is empty.
  void finding;
  return { op: "remove", path: ["__housekeeper_harden_identity__"] };
}

// ── NFS/SMB detection (design §3.3 settings-network-filesystem) ─────────────
//
// Best-effort heuristic. POSIX provides no portable atomic-rename guarantee on
// network filesystems, so we refuse rather than risk a partial write. The full
// rigorous check requires statfs(2)/getmntent and a curated FS-type allowlist
// (deferred — too platform-specific for v0.3). For now we accept the
// `__forceNetworkFs` test seam and check for an explicit `housekeeper.network`
// marker file in the parent dir, which lets operators force the refusal at a
// known boundary without requiring a real NFS mount in CI.

async function looksLikeNetworkFs(targetPath, opts) {
  if (opts && opts.__forceNetworkFs) return true;
  try {
    const markerPath = join(dirname(targetPath), ".housekeeper-network-fs");
    if (existsSync(markerPath)) return true;
  } catch { /* ignore */ }
  return false;
}

// ── composeHardenPlan ──────────────────────────────────────────────────────

/**
 * composeHardenPlan(home, options) — produce a HardenPlan or refusal set for
 * the requested target + path. Mirrors composeCleanPlan but routes operations
 * through MUTATION_REGISTRY["settings-rewrite"].
 *
 * Required options: target (detector id), path (absolute settings.json path).
 * Optional: mode (default "safe"),
 *           allowedExecutionClasses (default ["inert", "known-execution-context"]
 *             per design §4.2 — wider than clean's default so settings can be
 *             rewritten), __forceNetworkFs (test seam for the
 *             settings-network-filesystem refusal).
 *
 * Reuses composeCleanPlan's 12-rule classifier (T-099) for the
 * non-harden-specific rules (plan-state-error, protected-path, sector-boundary,
 * execution-class, rollback-class, owner). On top of that, runs the
 * settings-rewrite preApply hook to surface the four PreApplyRefusal classes
 * from design §3.3.
 */
export async function composeHardenPlan(home, options = {}) {
  const targetDetectorId = options.target || "";
  const targetPath = options.path || "";
  const mode = options.mode || "safe";
  const allowedExecutionClasses = options.allowedExecutionClasses
    || ["inert", "known-execution-context"];
  const composedAt = new Date().toISOString();

  // Re-run assembleReport so reportHash reflects current state (parity with
  // clean-plan: Q-USER-2 "always re-run for freshness").
  const report = assembleReport(home, { mode });
  const reportHash = hashReport(report);

  const refused = [];
  const operations = [];

  // Filter findings to the requested target/path.
  let candidates = report.findings.filter((f) => f.id === targetDetectorId);
  if (targetPath) {
    candidates = candidates.filter((f) => f.targetPath === targetPath);
  }

  if (candidates.length === 0) {
    refused.push({
      class: "HardenPlanRefusal",
      reason: "no-finding-for-target",
      targetPath,
      detectorId: targetDetectorId,
      message: `No finding for detector "${targetDetectorId}"${targetPath ? ` at ${targetPath}` : ""}`,
      nextStep: nextStepFor("no-finding-for-target"),
      exitCode: 2
    });
    return { schemaVersion: "0.2", home, targetDetectorId, targetPath, operations, refused, composedAt, reportHash };
  }

  // Delegate the 12-rule shared classifier to composeCleanPlan with the widened
  // allowedExecutionClasses set (T-099). Its refusals carry the right reasons
  // for rules 1-9; we re-shape them as HardenPlanRefusal for callers but keep
  // the reason strings identical so renderers can dispatch on reason alone.
  const cleanProbe = await composeCleanPlan(home, {
    target: targetDetectorId,
    path: targetPath,
    mode,
    allowedExecutionClasses
  });

  // Forward every classifier refusal EXCEPT no-mutation-mapping-in-v0.2 — that
  // one is clean-specific. For harden, the equivalent is no-mutation-mapping-in-v0.3
  // gated on HARDENABLE_DETECTORS_V03.
  for (const r of cleanProbe.refused) {
    if (r.reason === "no-mutation-mapping-in-v0.2") continue;
    refused.push({
      class: "HardenPlanRefusal",
      reason: r.reason,
      targetPath: r.targetPath,
      detectorId: r.detectorId,
      message: r.message,
      nextStep: r.nextStep,
      exitCode: 2
    });
  }

  // If any shared-classifier refusal fired, do not proceed to harden-specific
  // checks — the finding is already blocked.
  if (refused.length > 0) {
    return { schemaVersion: "0.2", home, targetDetectorId, targetPath, operations, refused, composedAt, reportHash };
  }

  // Harden-specific: HARDENABLE_DETECTORS_V03 gate.
  const hardenable = effectiveHardenableSet(options.__overrideHardenable);
  if (!hardenable.has(targetDetectorId)) {
    for (const f of candidates) {
      refused.push({
        class: "HardenPlanRefusal",
        reason: "no-mutation-mapping-in-v0.3",
        targetPath: f.targetPath,
        detectorId: f.id,
        message: `Detector "${f.id}" is not hardenable in v0.3`,
        nextStep: nextStepFor("no-mutation-mapping-in-v0.3"),
        exitCode: 2
      });
    }
    return { schemaVersion: "0.2", home, targetDetectorId, targetPath, operations, refused, composedAt, reportHash };
  }

  // For each candidate, run the settings-rewrite preApply hook + NFS/SMB check.
  const handler = MUTATION_REGISTRY["settings-rewrite"];
  for (const finding of candidates) {
    const tp = finding.targetPath;
    if (!tp) continue;

    if (await looksLikeNetworkFs(tp, options)) {
      refused.push({
        class: "HardenPlanRefusal",
        reason: "settings-network-filesystem",
        targetPath: tp,
        detectorId: finding.id,
        message: `Target ${tp} appears to be on a network filesystem (NFS/SMB); harden refuses to write without an atomic-rename guarantee`,
        nextStep: nextStepFor("settings-network-filesystem"),
        exitCode: 2
      });
      continue;
    }

    const patch = generatePatchForFinding(finding);
    const op = { kind: "settings-rewrite", targetPath: tp, patch };

    const preApplyResult = await handler.preApply(op);
    if (preApplyResult instanceof PreApplyRefusal) {
      refused.push({
        class: "HardenPlanRefusal",
        reason: preApplyResult.reason,
        targetPath: tp,
        detectorId: finding.id,
        message: preApplyResult.message,
        nextStep: nextStepFor(preApplyResult.reason),
        exitCode: 2
      });
      continue;
    }

    operations.push({
      detectorId: finding.id,
      targetPath: tp,
      mutationKind: "settings-rewrite",
      mutationOp: op,
      snapshotStrategy: "file-replace",
      estimatedBytes: preApplyResult.plannedBytes || 0,
      expandedFiles: [tp],
      expectedExitState: "verified"
    });
  }

  // v0.3 harden also enforces one operation per plan (parity with clean v0.2);
  // batch ops land in Phase 5.
  if (operations.length > 1) {
    operations.sort((a, b) => {
      if (a.targetPath < b.targetPath) return -1;
      if (a.targetPath > b.targetPath) return 1;
      return 0;
    });
    const [kept, ...rest] = operations;
    for (const op of rest) {
      refused.push({
        class: "HardenPlanRefusal",
        reason: "no-mutation-mapping-in-v0.3",
        targetPath: op.targetPath,
        detectorId: op.detectorId,
        message: "v0.3 hardens one finding per invocation; re-run harden for additional findings",
        nextStep: `Re-run \`harden --confirm --yes --target=${op.detectorId} --path=${op.targetPath}\` to address the remaining findings.`,
        exitCode: 2
      });
    }
    operations.length = 0;
    operations.push(kept);
  }

  return { schemaVersion: "0.2", home, targetDetectorId, targetPath, operations, refused, composedAt, reportHash };
}

// ── validateHardenPlan ─────────────────────────────────────────────────────

/**
 * validateHardenPlan(plan, home) — re-runs assembleReport and throws
 * HardenPlanDriftError if the report hash changed since compose. Also re-runs
 * the preApply hook on each operation to catch any drift in the on-disk JSON
 * shape between compose and execute (the file could have been hand-edited).
 *
 * Returns the plan with a validatedAt ISO timestamp added.
 */
export async function validateHardenPlan(plan, home) {
  const report = assembleReport(home, { mode: "safe" });
  const currentHash = hashReport(report);

  if (currentHash !== plan.reportHash) {
    throw new HardenPlanDriftError(plan.reportHash, currentHash);
  }

  // Re-run preApply for each op — the file may have changed shape (a new
  // JSONC comment, a structural break) between compose and validate. Any
  // preApply refusal becomes a drift signal because the plan can no longer
  // be safely executed.
  const handler = MUTATION_REGISTRY["settings-rewrite"];
  for (const op of plan.operations) {
    const result = await handler.preApply(op.mutationOp);
    if (result instanceof PreApplyRefusal) {
      throw new HardenPlanDriftError(plan.reportHash, currentHash + `:${result.reason}`);
    }
  }

  return { ...plan, validatedAt: new Date().toISOString() };
}

// ── Lockfile helpers (local to harden; parity with clean-plan.mjs) ─────────

const LOCK_STALE_WINDOW_MS = 30 * 60 * 1000; // 30 minutes

async function acquireLock(home) {
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
    fh = await open(lockPath, "wx");
    await fh.writeFile(JSON.stringify(manifest, null, 2) + os.EOL);
    await fh.close();
    return lockPath;
  } catch (err) {
    if (fh) {
      try { await fh.close(); } catch { /* ignore */ }
    }
    if (err.code === "EEXIST") {
      try {
        const raw = await readFile(lockPath, "utf8");
        const existing = JSON.parse(raw);
        throw new HardenLockHeldError(existing);
      } catch (inner) {
        if (inner instanceof HardenLockHeldError) throw inner;
        try { await unlink(lockPath); } catch { /* ignore */ }
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
    /* ignore — already gone */
  }
}

// ── executeHardenPlan ──────────────────────────────────────────────────────

/**
 * executeHardenPlan(validatedPlan, home) — acquires the housekeeper lockfile
 * atomically, runs gcSnapshots, then for each settings-rewrite operation:
 * takeSnapshot → applyOperation (wrapping handler.apply) → verify. The
 * lockfile is always released in the finally block.
 *
 * Returns the final operation manifest (status "verified" on success).
 */
export async function executeHardenPlan(validatedPlan, home) {
  const snapshotHome = dirname(home);
  const lockPath = join(home, "housekeeper", "lock");

  if (existsSync(lockPath)) {
    let stale = false;
    try {
      const raw = await readFile(lockPath, "utf8");
      const existing = JSON.parse(raw);
      const stalenessAt = new Date(existing.stalenessAt).getTime();
      if (Date.now() < stalenessAt) {
        throw new HardenLockHeldError(existing);
      }
      stale = true;
    } catch (err) {
      if (err instanceof HardenLockHeldError) throw err;
      // Unreadable / unparseable lock — treat as stale.
      stale = true;
    }
    if (stale) {
      // Remove the stale lock so acquireLock's O_EXCL succeeds. The two-step
      // (probe → unlink → re-acquire) intentionally races: any concurrent
      // process that wins the re-acquire raises LockHeldError on our side.
      try { await unlink(lockPath); } catch { /* already gone */ }
    }
  }

  const acquiredPath = await acquireLock(home);
  const handler = MUTATION_REGISTRY["settings-rewrite"];

  try {
    await gcSnapshots(snapshotHome);

    let finalManifest;

    for (const op of validatedPlan.operations) {
      const consentSummary = [
        `harden --confirm --yes — rewrite settings file via patch`,
        `  detector: ${op.detectorId}`,
        `  target:   ${op.targetPath}`,
        `  bytes:    ${op.estimatedBytes}`
      ].join("\n");

      const targets = [op.targetPath];

      const { opId } = await takeSnapshot(snapshotHome, {
        targets,
        command: "harden",
        mode: "confirm",
        consentSummary
      });

      // Wrap handler.apply in the apply-callable shape applyOperation expects.
      const ops = targets.map(() => ({
        apply: async () => { await handler.apply(op.mutationOp); }
      }));

      const appliedManifest = await applyOperation(opId, snapshotHome, ops);

      if (appliedManifest.partialApply) {
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

// Re-export the lockfile helpers so test suites that need to seed a stale lock
// can do so without duplicating the file format.
export { acquireLock as __acquireLockForTests, releaseLock as __releaseLockForTests };

// suppress unused-import warnings for symbols only used in JSDoc
void copyFile;
void hasJsonComments;
