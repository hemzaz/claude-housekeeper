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
import { copyFile } from "node:fs/promises";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join, dirname, sep as pathSep } from "node:path";
import { assembleReport, hasJsonComments } from "./audit.mjs";
import {
  takeSnapshot,
  applyOperation,
  verify,
  gcSnapshots,
  MUTATION_REGISTRY,
  PreApplyRefusal
} from "./snapshot.mjs";
import { composeCleanPlan } from "./clean-plan.mjs";
import { acquireLock, releaseLock, LockHeldError as _LockHeldError } from "./lock.mjs";
import { appendRefusal, appendApplied } from "./learning.mjs";

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
    "No finding for the requested target/path. Run `claude-housekeeper diagnose` to see current findings, then pick a hardenable one.",
  // T-202 — MCP rewrite refusal classes
  "mcp-rewrite-target-missing":
    "Confirm the correct path to your MCP server binary or script, then re-run harden with the corrected --mcp-command-rewrite value.",
  "mcp-rewrite-target-not-executable":
    "Run chmod +x <new-path> and then re-run harden, or confirm you have passed the correct path.",
  "mcp-rewrite-source-not-found":
    "Run diagnose to see the exact command path recorded in the failing MCP entry, then pass that exact string as the source side of --mcp-command-rewrite=<source>=<new-path>."
});

// ── T-200: parseMcpCommandRewrite ─────────────────────────────────────────────
//
// Parses a `--mcp-command-rewrite=<old>=<new>` flag value. Splits on the FIRST
// `=` so the new path may contain `=` characters. Both sides must be non-empty.
// Throws on malformed input (error surfaces as parse-time refusal per T-200).

export function parseMcpCommandRewrite(value) {
  const eqIdx = value.indexOf("=");
  if (eqIdx === -1) {
    throw new Error(
      `--mcp-command-rewrite requires the format <old-path>=<new-path>. Got: "${value}"`
    );
  }
  const oldPath = value.slice(0, eqIdx);
  const newPath = value.slice(eqIdx + 1);
  if (!oldPath || !newPath) {
    throw new Error(
      `--mcp-command-rewrite: both <old-path> and <new-path> must be non-empty. Got: "${value}"`
    );
  }
  return { oldPath, newPath };
}

function nextStepFor(reason) {
  return NEXT_STEP_BY_REASON[reason] || "";
}

// ── v0.3 hardenable detector registry (T-300..T-302) ───────────────────────
//
// Each entry maps a detector id to a patch-builder `(finding) => patch`. The
// builder reads the live settings.json at finding.targetPath, derives a
// minimal patch that removes the broken entry (or, for invalid_json, returns
// the identity sentinel that lets preApply refuse with settings-shape-unknown
// per design §3.4 + Q1 ruling §2.1).
//
// Per design §3.4, builders are side-effect-free aside from a single sync
// read of the target file. They must be deterministic for a given on-disk
// state so the idempotency check in MUTATION_REGISTRY.preApply holds.
//
// The Map shape (rather than Set + side function) is per the user task brief:
// "HARDENABLE_DETECTORS_V03 entry maps the detector id to a (finding) => patch
// function that builds the settings-rewrite op payload".

const HARDENABLE_DETECTORS_V03 = new Map([
  // T-300 — remove all hooks.<event>[].hooks[] entries whose command points
  // at a missing plugin-cache path. A single `set` patch replacing the entire
  // hooks tree is naturally idempotent (a second apply re-derives the same
  // cleaned tree from the already-cleaned source).
  ["settings.hook_path_dangling", buildHookPathDanglingPatch],
  // T-301 — remove the mcpServers.<name> entry whose command path is missing.
  // Same `set`-on-`["mcpServers"]` strategy as T-300 for the same idempotency
  // reason.
  ["settings.mcp_command_missing", buildMcpCommandMissingPatch],
  // T-302 — NO patch. The detector self-flags hardenable: true so it appears
  // in plan output as a candidate, but the identity-marker patch routes the
  // preApply hook through strict JSON.parse which fails (the file is invalid
  // JSON), surfacing settings-shape-unknown refusal per Q1 ruling.
  ["settings.invalid_json", buildInvalidJsonSentinel],
  // T-402 — remove all hooks entries whose `cwd` field references a directory
  // that does not exist on disk. Same `set`-on-`["hooks"]` strategy as T-300.
  ["hooks.config_dangling", buildHooksConfigDanglingPatch]
]);

// Test seam: callers may inject extra detector ids that should be treated as
// hardenable for the scope of one compose call. Each injected id gets the
// identity-marker patch (no real mutation; preApply's idempotency check still
// runs but a remove-of-non-existent-key is a no-op). This preserves the Phase
// 2 test contract for non-promoted detectors (e.g. settings.jsonc_detected).
function effectiveHardenableRegistry(overrideHardenable) {
  if (!overrideHardenable || overrideHardenable.length === 0) {
    return HARDENABLE_DETECTORS_V03;
  }
  const merged = new Map(HARDENABLE_DETECTORS_V03);
  for (const id of overrideHardenable) {
    if (!merged.has(id)) merged.set(id, buildIdentityMarkerPatch);
  }
  return merged;
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

// ── Patch builders (T-300..T-302) ──────────────────────────────────────────
//
// Each builder is invoked at compose time and receives the audit finding for a
// single hardenable detector. Builders read the live settings.json via a sync
// read (file size is small, ~KiB; no async benefit), parse JSON, compute the
// cleaned subtree, and return a single { op, path, value? } patch matching the
// DSL in snapshot.mjs applyPatch.
//
// If a builder cannot construct a clean patch (file unreadable, JSON malformed,
// etc.) it returns the identity-marker patch — preApply will then surface the
// real underlying refusal (settings-shape-unknown, etc.) consistently.

function generatePatchForFinding(finding, registry) {
  const builder = registry.get(finding.id);
  if (!builder) return buildIdentityMarkerPatch();
  try {
    return builder(finding);
  } catch {
    // Unexpected builder failure → fall back to identity. preApply re-runs
    // strict JSON parsing and surfaces the canonical refusal.
    return buildIdentityMarkerPatch();
  }
}

// Identity-marker patch: a remove of a reserved key that is never present in a
// real settings.json. Apply is observable as identity; preApply's idempotency
// check passes (remove-of-missing is a no-op repeated).
function buildIdentityMarkerPatch() {
  return { op: "remove", path: ["__housekeeper_harden_identity__"] };
}

// T-300 — settings.hook_path_dangling
//
// Returns a `set` patch on ["hooks"] whose value is the parsed hooks tree with
// every hooks.<event>[i].hooks[j] entry removed if its command references a
// missing absolute plugin-cache path. The shell-ambiguous check matches the
// audit detector exactly so the two reasoning paths stay aligned.
function buildHookPathDanglingPatch(finding) {
  const parsed = parseSettingsSync(finding.targetPath);
  if (!parsed || typeof parsed !== "object" || !parsed.hooks) {
    return buildIdentityMarkerPatch();
  }
  const cleanedHooks = pruneDanglingHooks(parsed.hooks);
  return { op: "set", path: ["hooks"], value: cleanedHooks };
}

// T-301 — settings.mcp_command_missing
//
// Returns a `set` patch on ["mcpServers"] whose value is the parsed mcpServers
// object minus any server whose .command is an absolute path that does not
// exist on disk. Mirrors detectMcpCommandMissing's existsSync semantics so the
// patch removes exactly the set of entries audit flagged.
function buildMcpCommandMissingPatch(finding) {
  const parsed = parseSettingsSync(finding.targetPath);
  if (!parsed || typeof parsed !== "object" || !parsed.mcpServers) {
    return buildIdentityMarkerPatch();
  }
  const cleanedServers = {};
  for (const [name, server] of Object.entries(parsed.mcpServers)) {
    if (!server || typeof server !== "object") continue;
    const command = typeof server.command === "string" ? server.command : "";
    if (command && command.startsWith("/") && !existsSync(command)) continue;
    cleanedServers[name] = server;
  }
  return { op: "set", path: ["mcpServers"], value: cleanedServers };
}

// T-302 — settings.invalid_json
//
// NO patch. Returns the identity sentinel. preApply runs strict JSON.parse
// first; it will fail on the broken file and (since no JSONC comments exist
// per the two-phase rule in audit.detectSettingsInvalidJson) emit a
// PreApplyRefusal with reason "settings-shape-unknown" — exactly the Q1
// outcome required by design §2.1.
function buildInvalidJsonSentinel(finding) {
  void finding;
  return buildIdentityMarkerPatch();
}

// T-402 — hooks.config_dangling
//
// Returns a `set` patch on ["hooks"] whose value is the parsed hooks tree with
// every entry removed whose `cwd` field references a directory that does not
// exist on disk. Mirrors detectHooksConfigDangling's existsSync semantics.
// Same `set`-on-`["hooks"]` idempotency strategy as T-300.
function buildHooksConfigDanglingPatch(finding) {
  const parsed = parseSettingsSync(finding.targetPath);
  if (!parsed || typeof parsed !== "object" || !parsed.hooks) {
    return buildIdentityMarkerPatch();
  }
  const cleanedHooks = pruneDanglingCwdHooks(parsed.hooks);
  return { op: "set", path: ["hooks"], value: cleanedHooks };
}

// T-201 — MCP rewrite patch builder.
//
// Returns a `set` patch on ["mcpServers", <name>, "command"] replacing the
// broken command with the validated new path. Per design §3.2 P2 and
// constraint: "patch shape is {op: 'set', path: ['mcpServers', '<name>',
// 'command'], value: '<new-path>'}". A `set` patch is idempotent by the
// MUTATION_REGISTRY preApply invariant (second apply yields identical object).
function buildMcpCommandRewritePatch(finding, newPath) {
  const parsed = parseSettingsSync(finding.targetPath);
  if (!parsed || typeof parsed !== "object" || !parsed.mcpServers) {
    return buildIdentityMarkerPatch();
  }
  // Find the server whose command matches the finding. The finding's evidence
  // carries the broken command; we match against the live settings.json to
  // ensure the patch targets the right server name.
  for (const [name, server] of Object.entries(parsed.mcpServers)) {
    if (!server || typeof server !== "object") continue;
    const command = typeof server.command === "string" ? server.command : "";
    if (command && command.startsWith("/") && !existsSync(command)) {
      // This is a broken entry — use its server name for the patch.
      return { op: "set", path: ["mcpServers", name, "command"], value: newPath };
    }
  }
  // No broken entry found; identity patch lets preApply surface an appropriate
  // refusal via the standard JSON-validation path.
  return buildIdentityMarkerPatch();
}

// Internal — sync settings.json parse used by the patch builders. Returns the
// parsed object or null. Never throws; on any error the builder falls back to
// the identity sentinel and preApply surfaces the real refusal.
function parseSettingsSync(filePath) {
  try {
    const raw = readFileSync(filePath, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

// Internal — walk the hooks tree and drop any { command } leaf whose command
// references an absolute path inside a plugin cache subtree that does not
// exist on disk. Mirrors detectHookPathDangling's filter exactly (shell-
// ambiguous commands are left in place — the detector for those is a separate
// stance and not hardenable in v0.3). Pure: returns a new tree, never mutates
// the input.
function pruneDanglingHooks(hooksTree) {
  if (Array.isArray(hooksTree)) {
    const out = [];
    for (const item of hooksTree) {
      const child = pruneDanglingHooks(item);
      if (child !== null) out.push(child);
    }
    return out;
  }
  if (hooksTree && typeof hooksTree === "object") {
    // A leaf entry shaped { type: "command", command: "<abs path>" }.
    if (typeof hooksTree.command === "string") {
      if (isHookCommandDangling(hooksTree.command)) return null;
      return { ...hooksTree };
    }
    const out = {};
    for (const [key, child] of Object.entries(hooksTree)) {
      const pruned = pruneDanglingHooks(child);
      if (pruned !== null) out[key] = pruned;
    }
    return out;
  }
  return hooksTree;
}

// T-402 — walk the hooks tree and drop any object entry whose `cwd` field
// is an absolute path that does not exist on disk. Mirrors
// detectHooksConfigDangling's existsSync semantics exactly. Pure: returns a
// new tree, never mutates the input.
function pruneDanglingCwdHooks(hooksTree) {
  if (Array.isArray(hooksTree)) {
    const out = [];
    for (const item of hooksTree) {
      const child = pruneDanglingCwdHooks(item);
      if (child !== null) out.push(child);
    }
    return out;
  }
  if (hooksTree && typeof hooksTree === "object") {
    // Leaf entry: if it has a cwd that is a missing absolute path, prune it.
    if (typeof hooksTree.cwd === "string" && hooksTree.cwd.startsWith("/")) {
      if (!existsSync(hooksTree.cwd)) return null;
    }
    const out = {};
    for (const [key, child] of Object.entries(hooksTree)) {
      const pruned = pruneDanglingCwdHooks(child);
      if (pruned !== null) out[key] = pruned;
    }
    return out;
  }
  return hooksTree;
}

// Match audit.mjs looksShellAmbiguous + extractAbsolutePaths +
// isPluginCacheCommand semantics. A hook command is "dangling" iff it contains
// at least one absolute plugin-cache path that does not exist AND the command
// is not shell-ambiguous (which we cannot reason about without execution).
function isHookCommandDangling(command) {
  if (looksShellAmbiguousLocal(command)) return false;
  const matches = command.match(/(?:['"])?(\/[^\s'"`|;&)]+)/g) || [];
  for (const m of matches) {
    const candidate = m.replace(/^['"]|['"]$/g, "");
    if (!candidate.includes(`${pathSep}plugins${pathSep}cache${pathSep}`)) continue;
    if (!existsSync(candidate)) return true;
  }
  return false;
}

function looksShellAmbiguousLocal(command) {
  return /\$\{?[A-Z_]/.test(command) || /`[^`]+`/.test(command) || /\$\([^)]+\)/.test(command);
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

// ── Learning helpers ─────────────────────────────────────────────────────────

// Best-effort appendRefusal; logs to stderr on failure (learning surface is
// observational, not load-bearing per v0.4-design.md §3 P1).
async function safeAppendRefusal(home, detectorId, reason, targetPath) {
  try {
    await appendRefusal(home, {
      command: "harden",
      target: detectorId,
      reason,
      refusalClass: reason,
      targetPath: targetPath || ""
    });
  } catch (err) {
    process.stderr.write(`[harden-plan] appendRefusal failed: ${err && err.message}\n`);
  }
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
    await safeAppendRefusal(home, targetDetectorId, "no-finding-for-target", targetPath);
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
    await safeAppendRefusal(home, r.detectorId, r.reason, r.targetPath);
  }

  // If any shared-classifier refusal fired, do not proceed to harden-specific
  // checks — the finding is already blocked.
  if (refused.length > 0) {
    return { schemaVersion: "0.2", home, targetDetectorId, targetPath, operations, refused, composedAt, reportHash };
  }

  // Harden-specific: HARDENABLE_DETECTORS_V03 gate.
  const hardenable = effectiveHardenableRegistry(options.__overrideHardenable);
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
      await safeAppendRefusal(home, f.id, "no-mutation-mapping-in-v0.3", f.targetPath);
    }
    return { schemaVersion: "0.2", home, targetDetectorId, targetPath, operations, refused, composedAt, reportHash };
  }

  // For each candidate, run the json-rewrite preApply hook + NFS/SMB check.
  // T-400: "json-rewrite" is the canonical kind; "settings-rewrite" is an alias.
  const handler = MUTATION_REGISTRY["json-rewrite"];
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
      await safeAppendRefusal(home, finding.id, "settings-network-filesystem", tp);
      continue;
    }

    // T-201/T-202 — MCP rewrite mode: when options.mcpCommandRewrite is set,
    // run the three pre-snapshot refusal checks then build a `set` patch on
    // the command key instead of the strip patch. Per design §3.2 P2.
    if (options.mcpCommandRewrite && finding.id === "settings.mcp_command_missing") {
      const { oldPath, newPath } = options.mcpCommandRewrite;

      // T-202a: new path must exist on disk.
      if (!existsSync(newPath)) {
        refused.push({
          class: "HardenPlanRefusal",
          reason: "mcp-rewrite-target-missing",
          targetPath: tp,
          detectorId: finding.id,
          message: `--mcp-command-rewrite new path "${newPath}" does not exist on disk; harden will not write a path that cannot be verified`,
          nextStep: nextStepFor("mcp-rewrite-target-missing"),
          exitCode: 2
        });
        await safeAppendRefusal(home, finding.id, "mcp-rewrite-target-missing", tp);
        continue;
      }

      // T-202b: new path must be executable (+x bit set).
      let newStat;
      try {
        newStat = statSync(newPath);
      } catch {
        newStat = null;
      }
      if (!newStat || !(newStat.mode & 0o111)) {
        refused.push({
          class: "HardenPlanRefusal",
          reason: "mcp-rewrite-target-not-executable",
          targetPath: tp,
          detectorId: finding.id,
          message: `--mcp-command-rewrite new path "${newPath}" exists but is not executable; harden will not write a non-executable MCP server command`,
          nextStep: nextStepFor("mcp-rewrite-target-not-executable"),
          exitCode: 2
        });
        await safeAppendRefusal(home, finding.id, "mcp-rewrite-target-not-executable", tp);
        continue;
      }

      // T-202c: old path must match a broken mcpServers entry whose command
      // equals oldPath. The finding tells us an entry is broken, but we must
      // confirm that the specific server the user named matches.
      const parsed = parseSettingsSync(tp);
      let sourceServerName = null;
      if (parsed && typeof parsed === "object" && parsed.mcpServers) {
        for (const [name, server] of Object.entries(parsed.mcpServers)) {
          if (server && typeof server.command === "string" && server.command === oldPath) {
            sourceServerName = name;
            break;
          }
        }
      }
      if (!sourceServerName) {
        refused.push({
          class: "HardenPlanRefusal",
          reason: "mcp-rewrite-source-not-found",
          targetPath: tp,
          detectorId: finding.id,
          message: `--mcp-command-rewrite source path "${oldPath}" does not match the command field of any mcpServers entry in settings.json`,
          nextStep: nextStepFor("mcp-rewrite-source-not-found"),
          exitCode: 2
        });
        await safeAppendRefusal(home, finding.id, "mcp-rewrite-source-not-found", tp);
        continue;
      }

      // All checks passed — build the `set` patch on the specific server's command key.
      const rewritePatch = {
        op: "set",
        path: ["mcpServers", sourceServerName, "command"],
        value: newPath
      };
      const op = { kind: "json-rewrite", targetPath: tp, patch: rewritePatch };

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
        await safeAppendRefusal(home, finding.id, preApplyResult.reason, tp);
        continue;
      }

      operations.push({
        detectorId: finding.id,
        targetPath: tp,
        mutationKind: "json-rewrite",
        mutationOp: op,
        snapshotStrategy: "file-replace",
        estimatedBytes: preApplyResult.plannedBytes || 0,
        expandedFiles: [tp],
        expectedExitState: "verified"
      });
      continue;
    }

    const patch = generatePatchForFinding(finding, hardenable);
    const op = { kind: "json-rewrite", targetPath: tp, patch };

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
      await safeAppendRefusal(home, finding.id, preApplyResult.reason, tp);
      continue;
    }

    operations.push({
      detectorId: finding.id,
      targetPath: tp,
      mutationKind: "json-rewrite",
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
      await safeAppendRefusal(home, op.detectorId, "no-mutation-mapping-in-v0.3", op.targetPath);
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
  const handler = MUTATION_REGISTRY["json-rewrite"];
  for (const op of plan.operations) {
    const result = await handler.preApply(op.mutationOp);
    if (result instanceof PreApplyRefusal) {
      throw new HardenPlanDriftError(plan.reportHash, currentHash + `:${result.reason}`);
    }
  }

  return { ...plan, validatedAt: new Date().toISOString() };
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

  // acquireLock handles stale-lock detection and O_EXCL; throws LockHeldError
  // from lock.mjs — re-throw as HardenLockHeldError to preserve the public API.
  let lockHandle;
  try {
    lockHandle = await acquireLock(home);
  } catch (err) {
    if (err && err.code === "lock-held") {
      throw new HardenLockHeldError(err.lockManifest);
    }
    throw err;
  }

  const handler = MUTATION_REGISTRY["json-rewrite"];

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
        try {
          await appendApplied(home, {
            opId: appliedManifest.id,
            status: appliedManifest.status,
            command: "harden",
            targets: [op.targetPath],
            filesCount: op.expandedFiles ? op.expandedFiles.length : 0,
            partialApply: true
          });
        } catch (err) {
          process.stderr.write(`[harden-plan] appendApplied failed: ${err && err.message}\n`);
        }
        break;
      }

      finalManifest = await verify(opId, snapshotHome);
      try {
        await appendApplied(home, {
          opId: finalManifest.id,
          status: finalManifest.status,
          command: "harden",
          targets: [op.targetPath],
          filesCount: op.expandedFiles ? op.expandedFiles.length : 0
        });
      } catch (err) {
        process.stderr.write(`[harden-plan] appendApplied failed: ${err && err.message}\n`);
      }
    }

    return finalManifest;
  } finally {
    await releaseLock(lockHandle, "verified");
  }
}

// Re-export the lockfile helpers so test suites that need to seed a stale lock
// can do so without duplicating the file format.
export { acquireLock as __acquireLockForTests, releaseLock as __releaseLockForTests };

// suppress unused-import warnings for symbols only used in JSDoc
void copyFile;
void hasJsonComments;
