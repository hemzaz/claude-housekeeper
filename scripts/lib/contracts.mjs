// Contract object factories for Claude Housekeeper.
// Pure functions — return new plain objects matching docs/schemas.md.
// No mutation, no I/O.

export const SCHEMA_VERSION = "0.1";

const STANCE_KEYS = [
  "inform",
  "watch",
  "review",
  "probe",
  "protect",
  "prepare",
  "repair",
  "block"
];

export function makeSurfaceClassification(opts = {}) {
  return {
    surfaceClass: opts.surfaceClass || "unknown",
    ownerClass: opts.ownerClass || "unknown",
    loadBearingClass: opts.loadBearingClass || "unknown",
    sensitivityClass: opts.sensitivityClass || "unknown",
    executionClass: opts.executionClass || "unknown",
    rollbackClass: opts.rollbackClass || "unknown",
    scopeClass: opts.scopeClass || "unknown",
    confidence: opts.confidence || "medium",
    limits: arr(opts.limits)
  };
}

export function makeEvidenceSet(opts = {}) {
  return {
    structural: arr(opts.structural),
    loader: arr(opts.loader),
    behavioral: arr(opts.behavioral),
    ownership: arr(opts.ownership),
    freshness: arr(opts.freshness),
    reversibility: arr(opts.reversibility),
    missing: arr(opts.missing)
  };
}

export function makeFinding(opts = {}) {
  return {
    id: opts.id || "",
    class: opts.class || "integrity",
    claimLevel: opts.claimLevel || "finding",
    stance: opts.stance || "inform",
    summary: opts.summary || "",
    surface: opts.surface ? { ...opts.surface } : makeSurfaceClassification(),
    evidence: opts.evidence ? { ...opts.evidence } : makeEvidenceSet(),
    nextAllowedStep: opts.nextAllowedStep || "none",
    blockedActions: arr(opts.blockedActions)
  };
}

export function makeStance(opts = {}) {
  return {
    stance: opts.stance || "inform",
    why: opts.why || "",
    missingKey: opts.missingKey || null,
    nextAllowedStep: opts.nextAllowedStep || "none",
    notAllowed: opts.notAllowed || "",
    userDecisionNeeded: Boolean(opts.userDecisionNeeded)
  };
}

export function makeReport(opts = {}) {
  return {
    schemaVersion: opts.schemaVersion || SCHEMA_VERSION,
    mode: opts.mode || "diagnose",
    home: opts.home || "",
    generatedAt: opts.generatedAt || new Date(0).toISOString(),
    filesChanged: false,
    primary: opts.primary || null,
    stanceSummary: opts.stanceSummary
      ? { ...emptyStanceSummary(), ...opts.stanceSummary }
      : emptyStanceSummary(),
    findings: arr(opts.findings),
    boundaries: arr(opts.boundaries),
    degraded: arr(opts.degraded)
  };
}

export function makePolicyMatch(opts = {}) {
  return {
    type: opts.type || "doNotTouch",
    pattern: opts.pattern || "",
    path: opts.path || "",
    reason: opts.reason || "",
    scope: opts.scope || "user",
    effect: opts.effect || "stance protect, action none"
  };
}

export function makeScanLimit(opts = {}) {
  return {
    maxFiles: typeof opts.maxFiles === "number" ? opts.maxFiles : 5000,
    maxBytes: typeof opts.maxBytes === "number" ? opts.maxBytes : 1024 * 1024,
    maxWallMs: typeof opts.maxWallMs === "number" ? opts.maxWallMs : 5000
  };
}

function arr(value) {
  return Array.isArray(value) ? [...value] : [];
}

function emptyStanceSummary() {
  const out = {};
  for (const key of STANCE_KEYS) out[key] = 0;
  return out;
}
