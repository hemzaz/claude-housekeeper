// Phase 2 — report renderer (human + JSON + plan).
//
// T-203: human renderer per docs/report-grammar.md §1.
// T-204: JSON renderer with stable fields per docs/schema-stability.md.
// T-206: plan rendering re-uses the renderer in mode "plan".
// T-209: `mode` is preserved as a top-level JSON field.
// T-210: `proposedProbe` is forwarded into the JSON when present.
// T-408: `--redact` mode and per-finding sensitivityClass-driven redaction
//        run the report through redact.mjs before rendering.

import { redactReport } from "./redact.mjs";

const STANCE_KEYS = ["inform", "watch", "review", "probe", "protect", "prepare", "repair", "block"];

const STANCE_NEXT_STEP = {
  inform: "none",
  watch: "no action now; revisit if it grows or starts affecting behavior",
  review: "decide whether this is intentional before planning changes",
  probe: "run a live probe after consent",
  protect: "none; excluded from action by rule",
  prepare: "generate a patch preview or operation plan",
  repair: "snapshot, apply approved repair, verify",
  block: "resolve missing key or boundary before action"
};

// ---------- T-203: human report ----------

export function renderHumanReport(report, options = {}) {
  const lines = ["HOUSEKEEPER REPORT", "No files changed.", ""];
  const view = applyRedactionLayer(report, options);
  const primary = pickPrimary(view);

  // PRIMARY
  lines.push("PRIMARY");
  if (!primary) {
    lines.push("  stance: inform");
    lines.push("  finding: no findings");
    lines.push("  evidence: none");
    lines.push("  missing key: none");
    lines.push("  next step: none");
  } else {
    lines.push(`  stance: ${primary.stance}`);
    lines.push(`  finding: ${primary.summary || primary.id}`);
    lines.push(`  evidence: ${formatEvidenceShort(primary.evidence)}`);
    lines.push(`  missing key: ${formatMissingKey(primary)}`);
    lines.push(`  next step: ${primary.nextAllowedStep || STANCE_NEXT_STEP[primary.stance] || "none"}`);
  }
  lines.push("");

  // STANCE SUMMARY
  lines.push("STANCE SUMMARY");
  for (const key of STANCE_KEYS) {
    lines.push(`  ${padStance(key)} ${view.stanceSummary?.[key] ?? 0}`);
  }
  lines.push("");

  // BOUNDARIES
  const boundaryCounts = countBoundaries(view);
  lines.push("BOUNDARIES");
  lines.push(`  protected: ${boundaryCounts.protected}`);
  lines.push(`  sector-boundary: ${boundaryCounts.sectorBoundary}`);
  lines.push(`  secret-adjacent skipped: ${boundaryCounts.secretAdjacent}`);
  lines.push("");

  // SCAN
  const degraded = (view.degraded || []).length > 0;
  lines.push("SCAN");
  lines.push(`  mode: ${view.mode || "diagnose"}`);
  lines.push(`  degraded: ${degraded ? "yes" : "no"}`);
  lines.push(`  skipped: ${formatSkipped(view)}`);

  // BLOCKED ACTIONS — composed from the primary finding's blockedActions list.
  const blockedSection = formatBlockedActionsSection(primary);
  if (blockedSection) {
    lines.push("");
    lines.push(...blockedSection);
  }

  // BLOCKED — full block-stance details when present.
  const blockSection = formatBlockSection(view);
  if (blockSection) {
    lines.push("");
    lines.push(...blockSection);
  }

  // PROTECTED — list protected findings.
  const protectedSection = formatProtectedSection(view);
  if (protectedSection) {
    lines.push("");
    lines.push(...protectedSection);
  }

  // MISSING KEY — when the primary's claim wants a key it does not have.
  const missingSection = formatMissingKeySection(primary);
  if (missingSection) {
    lines.push("");
    lines.push(...missingSection);
  }

  // SCAN DEGRADED — when scan budgets were hit.
  const degradedSection = formatScanDegradedSection(view);
  if (degradedSection) {
    lines.push("");
    lines.push(...degradedSection);
  }

  return lines.join("\n");
}

// ---------- T-204: JSON report ----------

export function renderJsonReport(report, options = {}) {
  const view = applyRedactionLayer(report, options);
  const findings = (view.findings || []).map(stripFindingForJson);
  return {
    schemaVersion: view.schemaVersion,
    mode: view.mode || "diagnose",
    home: view.home,
    generatedAt: view.generatedAt,
    filesChanged: false,
    primary: view.primary || null,
    stanceSummary: ensureStanceSummary(view.stanceSummary),
    findings,
    boundaries: view.boundaries || [],
    degraded: view.degraded || []
  };
}

// ---------- T-206: plan rendering ----------

export function renderPlanReport(report, options = {}) {
  const view = applyRedactionLayer(report, options);
  const lines = ["HOUSEKEEPER REPORT", "No files changed.", ""];
  lines.push(`PLAN for ${view.home || "<home>"}`);
  lines.push(`mode: ${view.mode || "plan"}`);
  lines.push("");

  if (!view.findings || view.findings.length === 0) {
    lines.push("No findings.");
    return lines.join("\n");
  }

  for (const finding of view.findings) {
    lines.push(`${finding.id} — stance: ${finding.stance}`);
    if (finding.summary) lines.push(`  finding: ${finding.summary}`);
    if (finding.targetPath) lines.push(`  path: ${finding.targetPath}`);
    lines.push(`  next step: ${finding.nextAllowedStep || STANCE_NEXT_STEP[finding.stance] || "none"}`);
    if (finding.blockedActions && finding.blockedActions.length > 0) {
      lines.push(`  blocked actions: ${finding.blockedActions.join(", ")}`);
    }
    if (finding.proposedProbe) {
      lines.push(`  proposed probe: ${finding.proposedProbe.reference} (class: ${finding.proposedProbe.class}, consent: ${finding.proposedProbe.consent})`);
    }
    lines.push("");
  }

  return lines.join("\n").trimEnd();
}

// T-408: route the report through redact.mjs whenever any field needs
// redaction. Per-finding sensitivityClass-driven redaction always runs (the
// redactor decides per-finding whether to fail-closed); the global flag adds
// home-prefix collapse and shareable-mode hash truncation across everything.
function applyRedactionLayer(report, options) {
  if (!report) return report;
  const redact = Boolean(options && options.redact);
  return redactReport(report, { redact, home: options?.home || report.home });
}

// ---------- helpers ----------

function pickPrimary(report) {
  if (!report.findings || report.findings.length === 0) return null;
  if (report.primary) {
    const found = report.findings.find((f) => f.id === report.primary);
    if (found) return found;
  }
  return report.findings[0];
}

function padStance(key) {
  // Match the §1 layout: 8-character stance label.
  return (key + "       ").slice(0, 8);
}

function formatEvidenceShort(evidence) {
  if (!evidence) return "none";
  const parts = [];
  for (const key of ["structural", "loader", "behavioral", "ownership", "freshness", "reversibility"]) {
    if (Array.isArray(evidence[key])) parts.push(...evidence[key]);
  }
  if (parts.length === 0) return "none";
  return parts.join("; ");
}

function formatMissingKey(finding) {
  const missing = finding.evidence?.missing;
  if (Array.isArray(missing) && missing.length > 0) return missing.join("; ");
  if (finding.missingKey) return finding.missingKey;
  return "none";
}

function countBoundaries(report) {
  const counts = { protected: 0, sectorBoundary: 0, secretAdjacent: 0 };
  for (const b of report.boundaries || []) {
    if (b.type === "sector-boundary") counts.sectorBoundary += 1;
    else if (b.type === "secret-adjacent") counts.secretAdjacent += 1;
    else counts.protected += 1;
  }
  return counts;
}

function formatSkipped(report) {
  const list = [];
  if ((report.mode || "diagnose") === "safe") list.push("live Claude probes");
  if ((report.degraded || []).length > 0) list.push("degraded subtree");
  return list.join(", ") || "none";
}

function formatBlockedActionsSection(primary) {
  if (!primary || !Array.isArray(primary.blockedActions) || primary.blockedActions.length === 0) {
    return null;
  }
  const lines = ["BLOCKED ACTIONS"];
  for (const action of primary.blockedActions) lines.push(`  ${action}`);
  return lines;
}

function formatBlockSection(report) {
  const blocking = (report.findings || []).filter((f) => f.stance === "block");
  if (blocking.length === 0) return null;
  const f = blocking[0];
  const lines = ["BLOCKED"];
  lines.push(`  action: ${f.summary || f.id}`);
  lines.push(`  reason: ${f.why || "policy or evidence boundary"}`);
  if (f.missingKey || formatMissingKey(f) !== "none") {
    lines.push(`  missing key: ${formatMissingKey(f)}`);
  }
  lines.push(`  allowed now: ${f.nextAllowedStep || "report-only"}`);
  if (Array.isArray(f.blockedActions) && f.blockedActions.length > 0) {
    lines.push(`  not allowed: ${f.blockedActions.join(", ")}`);
  }
  return lines;
}

function formatProtectedSection(report) {
  const protectedFindings = (report.findings || []).filter((f) => f.stance === "protect");
  if (protectedFindings.length === 0) return null;
  const lines = ["PROTECTED"];
  for (const f of protectedFindings) {
    lines.push(`  path: ${f.targetPath || "(no path)"}`);
    lines.push(`  reason: ${f.why || "do-not-touch rule"}`);
    if (f.summary) lines.push(`  visible because: ${f.summary}`);
    lines.push(`  action: none`);
  }
  return lines;
}

function formatMissingKeySection(primary) {
  if (!primary) return null;
  if (primary.stance !== "probe" && primary.stance !== "block") return null;
  const missing = primary.evidence?.missing;
  if (!Array.isArray(missing) || missing.length === 0) return null;
  const lines = ["MISSING KEY"];
  lines.push(`  claim wanted: ${primary.summary || primary.id}`);
  lines.push(`  current evidence: ${formatEvidenceShort(primary.evidence)}`);
  lines.push(`  missing evidence: ${missing.join("; ")}`);
  lines.push(`  current stance: ${primary.stance}`);
  return lines;
}

function formatScanDegradedSection(report) {
  if (!report.degraded || report.degraded.length === 0) return null;
  const lines = ["SCAN DEGRADED"];
  for (const entry of report.degraded) {
    if (typeof entry === "string") lines.push(`  ${entry}`);
    else if (entry && typeof entry === "object") {
      if (entry.budget) lines.push(`  budget hit: ${entry.budget}`);
      if (entry.skipped) lines.push(`  skipped: ${entry.skipped}`);
      if (entry.effect) lines.push(`  effect: ${entry.effect}`);
      if (entry.nextStep) lines.push(`  next step: ${entry.nextStep}`);
    }
  }
  return lines;
}

function stripFindingForJson(finding) {
  const out = {
    id: finding.id,
    class: finding.class,
    claimLevel: finding.claimLevel,
    stance: finding.stance,
    summary: finding.summary,
    targetPath: finding.targetPath || "",
    surface: finding.surface,
    evidence: finding.evidence,
    nextAllowedStep: finding.nextAllowedStep,
    blockedActions: finding.blockedActions || []
  };
  if (finding.proposedProbe) out.proposedProbe = finding.proposedProbe;
  return out;
}

function ensureStanceSummary(summary) {
  const out = {};
  for (const key of STANCE_KEYS) out[key] = summary?.[key] ?? 0;
  return out;
}
