// Stance engine per docs/decision-calculus.md §4 (decision order),
// §5 (hard overrides), §6 (stance matrix), §10 (stance payload).
// Pure function. No I/O.

import { makeStance } from "./contracts.mjs";

/**
 * @param {object} args
 * @param {object} [args.surface] - SurfaceClassification.
 * @param {object} [args.evidence] - EvidenceSet (7-key shape from docs/schemas.md §3).
 * @param {string[]} [args.missingKeys] - keys still required to take any further action.
 * @param {object} [args.policy] - { matches: PolicyMatch[] }.
 * @param {string} [args.mode] - "diagnose" | "safe" | "plan".
 * @param {string} [args.findingClass] - finding class (integrity | hygiene | shadow | divergence | ...).
 * @param {boolean} [args.consentGranted] - whether the user has approved a repair plan.
 * @returns {object} Stance payload per §10.
 */
export function decideStance(args = {}) {
  const surface = args.surface || {};
  const evidence = args.evidence || {};
  const missingKeys = Array.isArray(args.missingKeys) ? args.missingKeys : [];
  const policy = args.policy || { matches: [] };
  const mode = args.mode || "diagnose";

  // ---------- §5 Hard overrides (always win) ----------

  // do-not-touch policy match.
  const dnt = (policy.matches || []).find((m) => m && m.type === "doNotTouch");
  if (dnt) {
    return makeStance({
      stance: "protect",
      why: `do-not-touch policy: ${dnt.reason || "user policy"}`,
      missingKey: null,
      nextAllowedStep: "report-only",
      notAllowed: "Do not plan, mutate, or probe.",
      userDecisionNeeded: false
    });
  }

  // Secret-content sensitivity is a hard protect.
  if (surface.sensitivityClass === "secret-content") {
    return makeStance({
      stance: "protect",
      why: "secret content; boundary notice only",
      missingKey: null,
      nextAllowedStep: "boundary-notice",
      notAllowed: "Do not display content, mutate, or probe.",
      userDecisionNeeded: false
    });
  }

  // Sector boundary.
  if (surface.scopeClass === "sector-boundary" || surface.scopeClass === "parent-contains-boundary") {
    return makeStance({
      stance: "protect",
      why: "sector boundary",
      missingKey: null,
      nextAllowedStep: "report-only",
      notAllowed: "Do not act across the boundary without a narrow exception.",
      userDecisionNeeded: false
    });
  }

  // Out-of-scope -> block.
  if (surface.scopeClass === "out-of-scope") {
    return makeStance({
      stance: "block",
      why: "path is outside declared scope",
      missingKey: "scope expansion or owner authorization",
      nextAllowedStep: "user-decision-needed",
      notAllowed: "Do not act on out-of-scope paths.",
      userDecisionNeeded: true
    });
  }

  // Unknown owner -> block (mutation-side default per §5).
  if (surface.ownerClass === "unknown") {
    return makeStance({
      stance: "block",
      why: "unknown owner",
      missingKey: "ownership evidence",
      nextAllowedStep: "user-decision-needed",
      notAllowed: "Do not act without ownership.",
      userDecisionNeeded: true
    });
  }

  // checkpoint-only rollback -> block.
  if (surface.rollbackClass === "checkpoint-only") {
    return makeStance({
      stance: "block",
      why: "rollback would rely on Claude checkpoint only",
      missingKey: "manifest-backed rollback proof",
      nextAllowedStep: "report-only",
      notAllowed: "Do not mutate based on checkpoint-only rollback.",
      userDecisionNeeded: false
    });
  }

  // Conflicting evidence -> block.
  if (evidence && evidence.conflicting === true) {
    return makeStance({
      stance: "block",
      why: "conflicting evidence",
      missingKey: "evidence reconciliation",
      nextAllowedStep: "user-decision-needed",
      notAllowed: "Do not act while evidence disagrees.",
      userDecisionNeeded: true
    });
  }

  // ---------- §4 Decision order: protect → block → probe → review → prepare → repair → watch → inform ----------

  // Protect-by-classification (surface or sensitivity = secret-adjacent).
  if (surface.surfaceClass === "secret-adjacent" || surface.sensitivityClass === "secret-adjacent") {
    return makeStance({
      stance: "protect",
      why: "secret-adjacent surface",
      missingKey: null,
      nextAllowedStep: "report-only",
      notAllowed: "Do not display content or mutate.",
      userDecisionNeeded: false
    });
  }

  // Block: missing rollback proof for a finding that would otherwise mutate.
  if (missingKeys.includes("rollback-proof")) {
    return makeStance({
      stance: "block",
      why: "missing rollback proof",
      missingKey: "rollback-proof",
      nextAllowedStep: "report-only",
      notAllowed: "Do not mutate without rollback evidence.",
      userDecisionNeeded: false
    });
  }

  // Probe: safe mode + live-key requirement.
  if (mode === "safe" && (missingKeys.includes("loader-key") || missingKeys.includes("behavioral-key"))) {
    return makeStance({
      stance: "probe",
      why: "safe mode cannot prove live behavior",
      missingKey: missingKeys.find((k) => k === "loader-key" || k === "behavioral-key"),
      nextAllowedStep: "Run a live probe after consent.",
      notAllowed: "Do not mutate or claim broken without a live key.",
      userDecisionNeeded: true
    });
  }

  // Probe: shell-expansion-risk surface.
  if (surface.executionClass === "shell-expansion-risk") {
    return makeStance({
      stance: "probe",
      why: "shell parse is ambiguous",
      missingKey: "loader or hook debug evidence",
      nextAllowedStep: "Run a live hook probe after consent.",
      notAllowed: "Do not patch or delete based on this string alone.",
      userDecisionNeeded: true
    });
  }

  // Probe: possibly load-bearing surface that needs a behavioral key.
  if (surface.loadBearingClass === "possibly-load-bearing" && missingKeys.includes("behavioral-key")) {
    return makeStance({
      stance: "probe",
      why: "possibly load-bearing; behavioral key not yet collected",
      missingKey: "behavioral-key",
      nextAllowedStep: "Run a live probe after consent.",
      notAllowed: "Do not act on this surface alone.",
      userDecisionNeeded: true
    });
  }

  // Review: shadow / divergence findings or anything where intent matters.
  if (args.findingClass === "shadow" || args.findingClass === "divergence") {
    return makeStance({
      stance: "review",
      why: "user intent may have produced this state",
      missingKey: "user-intent",
      nextAllowedStep: "review-required",
      notAllowed: "Do not mutate without explicit consent.",
      userDecisionNeeded: true
    });
  }

  // Prepare: integrity finding with snapshot-possible rollback and a known patch target.
  if (
    surface.rollbackClass === "snapshot-possible" &&
    args.findingClass === "integrity" &&
    !missingKeys.includes("patch-target")
  ) {
    return makeStance({
      stance: "prepare",
      why: "patch target known and rollback is snapshot-possible",
      missingKey: null,
      nextAllowedStep: "patch-preview",
      notAllowed: "Do not mutate before approval.",
      userDecisionNeeded: true
    });
  }

  // Repair: only when consent has already been granted and rollback is manifest-backed.
  if (args.consentGranted === true && surface.rollbackClass === "manifest-backed") {
    return makeStance({
      stance: "repair",
      why: "consent granted and manifest-backed rollback present",
      missingKey: null,
      nextAllowedStep: "apply-with-snapshot",
      notAllowed: "Do not exceed approved patch.",
      userDecisionNeeded: false
    });
  }

  // Watch: expected orphan within grace period.
  if (Array.isArray(evidence.freshness) && evidence.freshness.includes("within-grace-period")) {
    return makeStance({
      stance: "watch",
      why: "within documented grace period",
      missingKey: null,
      nextAllowedStep: "no-action-now",
      notAllowed: "Do not act yet.",
      userDecisionNeeded: false
    });
  }

  // Inform: anything else.
  return makeStance({
    stance: "inform",
    why: "informational only",
    missingKey: null,
    nextAllowedStep: "no-action-recommended",
    notAllowed: "",
    userDecisionNeeded: false
  });
}
