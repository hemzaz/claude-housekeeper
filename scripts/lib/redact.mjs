// T-408 — Redaction module.
//
// Pure functions. No I/O. Read-only by design.
//
// Implements the rules from docs/redaction-examples.md:
//   - Path prefixes: home prefix → `~`, project paths under common parent
//     directories → `<project>`.
//   - Env-var values: token-like values after `=` collapse to `<redacted>`.
//   - Token shapes: `sk-...`, `ghp_...`, `Bearer <token>`, generic
//     32+ char alnum after `=` or inside quotes.
//   - URI passwords: `proto://user:pass@host` → `proto://user:<redacted>@host`.
//   - Hashes: sha256 truncated to 8 chars + `...` in shareable output.
//
// Redaction Failure Rule (docs/redaction-examples.md):
//   When a token-shaped pattern survives the structured transformers and the
//   value is on a known-sensitive carrier (e.g. an `evidence.structural` line
//   under a secret-adjacent finding), degrade the entire field to `<redacted>`
//   rather than print partially-cleaned content.
//
// Field NAMES are never rewritten — only VALUES — so JSON consumers parsing
// `findings[].id`, `stance`, `surface.surfaceClass`, etc. see stable keys.

const REDACTED = "<redacted>";
const PROJECT = "<project>";

// ---------- patterns ----------

// Standalone token shapes anywhere in a string. Order matters — match the
// most-specific (provider-prefixed) shapes first so they collapse fully
// before generic alnum rules see them.
const STANDALONE_TOKEN_PATTERNS = [
  /sk-[A-Za-z0-9_-]{8,}/g,
  /ghp_[A-Za-z0-9_-]{8,}/g,
  /github_pat_[A-Za-z0-9_-]{8,}/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bBearer\s+[A-Za-z0-9_.\-+/=]+/g
];

// Env-var values: `KEY=value`. Run AFTER standalone-token replacement so
// `KEY=sk-...` becomes `KEY=<redacted>` cleanly. Match high-entropy alnum
// (16+) on the right of `=` after the standalone pass has already taken
// provider-prefixed shapes.
const ENV_TOKEN_PATTERNS = [
  /\b([A-Z][A-Z0-9_]*)=([A-Za-z0-9_-]{16,})\b/g
];

// CLI flag values: --token <value>, --token=<value>, --password <value>, etc.
const FLAG_VALUE_PATTERNS = [
  /(--(?:token|password|secret|api[-_]?key|auth)(?:=|\s+))(\S+)/gi
];

// URI with credentials: scheme://user:pass@host
const URI_CRED_RE = /\b([a-z][a-z0-9+.\-]*:\/\/[^\s:@/]+):([^\s@]+)@/gi;

// sha256 hex (full length 64).
const SHA256_RE = /\b([a-f0-9]{64})\b/g;

// Token-shaped substring that survived structured transforms — used by the
// failure-rule check. 24+ alnum (no separators) is treated as suspicious.
const RESIDUAL_TOKEN_RE = /[A-Za-z0-9_/+]{24,}/;

// ---------- public API ----------

/**
 * Redact a string per docs/redaction-examples.md.
 *
 * @param {string} input
 * @param {object} [opts]
 * @param {string} [opts.home] - absolute home prefix to collapse to `~`.
 * @param {boolean} [opts.shareable] - if true, sha256 hashes are truncated.
 * @param {boolean} [opts.failClosed] - if true, degrade to `<redacted>` when
 *   a residual token-shape survives structured transforms.
 * @returns {string}
 */
export function redactString(input, opts = {}) {
  if (typeof input !== "string") return input;
  let out = input;

  // 1. Path prefixes — collapse home before token transforms so token
  //    extraction is not confused by absolute paths. Only applied when the
  //    caller wants shareable output (global --redact or sensitive surface).
  if (opts.shareable) {
    out = collapseHomePrefix(out, opts.home);
    out = collapseProjectPaths(out);
  }

  // 2. URI credentials.
  out = out.replace(URI_CRED_RE, (_m, prefix) => `${prefix}:${REDACTED}@`);

  // 3. CLI flag values.
  for (const re of FLAG_VALUE_PATTERNS) {
    out = out.replace(re, (_m, prefix) => `${prefix}${REDACTED}`);
  }

  // 4. Standalone token shapes.
  for (const re of STANDALONE_TOKEN_PATTERNS) {
    out = out.replace(re, (match) => {
      if (/^Bearer\s/i.test(match)) return `Bearer ${REDACTED}`;
      return REDACTED;
    });
  }

  // 5. Env-var token values: `KEY=value`.
  for (const re of ENV_TOKEN_PATTERNS) {
    out = out.replace(re, (_m, key) => `${key}=${REDACTED}`);
  }

  // 6. Hashes.
  if (opts.shareable) {
    out = out.replace(SHA256_RE, (_m, hex) => `${hex.slice(0, 8)}...`);
  }

  // 7. Failure rule: when a residual token-shape survives in fail-closed
  //    mode, degrade the whole string to `<redacted>` rather than guess.
  if (opts.failClosed && hasResidualTokenShape(out, input)) {
    return REDACTED;
  }

  return out;
}

/**
 * Redact a Report or any nested plain-data shape per docs/redaction-examples.md.
 *
 * Field NAMES are preserved literally; only VALUES are transformed. Findings
 * with `surface.sensitivityClass` of `secret-adjacent` or `secret-content`
 * are redacted in fail-closed mode regardless of the global flag, so consumers
 * that opt out of `--redact` still receive a privacy-safe report when the
 * surface is secret-bearing.
 *
 * @param {object} report
 * @param {object} [opts]
 * @param {string} [opts.home] - absolute home prefix.
 * @param {boolean} [opts.redact] - global redaction toggle.
 * @returns {object} new Report-shaped object.
 */
export function redactReport(report, opts = {}) {
  if (!report || typeof report !== "object") return report;
  const home = opts.home || report.home || "";
  const globalRedact = Boolean(opts.redact);

  const findings = Array.isArray(report.findings)
    ? report.findings.map((f) => redactFinding(f, { home, globalRedact }))
    : report.findings;

  const ctx = { home, shareable: globalRedact, failClosed: globalRedact };

  const boundaries = Array.isArray(report.boundaries)
    ? report.boundaries.map((b) => redactPlain(b, ctx))
    : report.boundaries;

  const degraded = Array.isArray(report.degraded)
    ? report.degraded.map((d) => redactPlain(d, ctx))
    : report.degraded;

  // Top-level `home` field collapses to `~` only when global redaction is on.
  // Without --redact, the literal home path is part of the report (consumers
  // need it to interpret relative paths in findings).
  const homeOut = globalRedact ? "~" : report.home;

  return {
    ...report,
    home: homeOut,
    findings,
    boundaries,
    degraded
  };
}

// ---------- internal helpers ----------

function redactFinding(finding, ctx) {
  if (!finding || typeof finding !== "object") return finding;
  const sc = finding.surface?.sensitivityClass;
  const findingShareable = ctx.globalRedact || sc === "secret-adjacent" || sc === "secret-content";
  const findingFailClosed = ctx.globalRedact || sc === "secret-adjacent" || sc === "secret-content";

  const redactCtx = {
    home: ctx.home,
    shareable: findingShareable,
    failClosed: findingFailClosed
  };

  const out = { ...finding };

  if (typeof finding.summary === "string") out.summary = redactString(finding.summary, redactCtx);
  if (typeof finding.nextAllowedStep === "string") out.nextAllowedStep = redactString(finding.nextAllowedStep, redactCtx);
  if (typeof finding.targetPath === "string") out.targetPath = redactString(finding.targetPath, redactCtx);
  if (typeof finding.why === "string") out.why = redactString(finding.why, redactCtx);
  if (typeof finding.missingKey === "string") out.missingKey = redactString(finding.missingKey, redactCtx);
  if (typeof finding.notAllowed === "string") out.notAllowed = redactString(finding.notAllowed, redactCtx);

  // Surface stays structural; no string fields hold secret content. Copy so
  // callers cannot mutate the original.
  if (finding.surface) out.surface = { ...finding.surface };

  // Evidence is a 7-list shape with arrays of strings + a `missing` array.
  if (finding.evidence) {
    out.evidence = redactEvidence(finding.evidence, redactCtx);
  }

  if (Array.isArray(finding.blockedActions)) {
    out.blockedActions = finding.blockedActions.map((s) => redactString(s, redactCtx));
  }

  // PolicyMatches carry pattern + reason text the user authored.
  if (Array.isArray(finding.policyMatches)) {
    out.policyMatches = finding.policyMatches.map((m) => redactPlain(m, redactCtx));
  }

  // Probe metadata is structural; mayExecute / consent are catalog strings.
  if (finding.proposedProbe) {
    out.proposedProbe = redactPlain(finding.proposedProbe, redactCtx);
  }

  return out;
}

function redactEvidence(evidence, ctx) {
  const out = { ...evidence };
  for (const key of ["structural", "loader", "behavioral", "ownership", "freshness", "reversibility", "missing"]) {
    if (Array.isArray(evidence[key])) {
      out[key] = evidence[key].map((entry) => redactString(entry, ctx));
    }
  }
  return out;
}

// Plain-data redactor: walks an object and applies redactString to every
// string VALUE (never to keys). Arrays recurse element-wise.
function redactPlain(value, ctx) {
  if (typeof value === "string") return redactString(value, ctx);
  if (Array.isArray(value)) return value.map((v) => redactPlain(v, ctx));
  if (value && typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = redactPlain(v, ctx);
    }
    return out;
  }
  return value;
}

function collapseHomePrefix(input, home) {
  if (!input || typeof input !== "string") return input;
  if (!home) return input;
  const h = home.endsWith("/") ? home.slice(0, -1) : home;
  if (!h) return input;
  if (input.startsWith(h)) return "~" + input.slice(h.length);
  const idx = input.indexOf(h);
  if (idx === -1) return input;
  return input.slice(0, idx) + "~" + input.slice(idx + h.length);
}

// Detect common project-path prefixes that look like absolute work directories
// containing a `.claude/` subtree. Rule from docs/redaction-examples.md "Path
// Prefixes": `/Users/<user>/work/<repo>/.claude/...` → `<project>/.claude/...`.
const PROJECT_PATH_RES = [
  /\/Users\/[^/\s'"`]+\/[^/\s'"`]+\/[^/\s'"`]+\/\.claude\b/g,
  /\/home\/[^/\s'"`]+\/[^/\s'"`]+\/[^/\s'"`]+\/\.claude\b/g
];

function collapseProjectPaths(input) {
  let out = input;
  for (const re of PROJECT_PATH_RES) {
    out = out.replace(re, `${PROJECT}/.claude`);
  }
  return out;
}

// True when a residual token-shaped substring survives structured transforms
// in a string that was already the subject of redaction. Anchors the failure
// rule: only triggers if the input had a token-shape AND structured transforms
// did not collapse it.
function hasResidualTokenShape(redacted, original) {
  if (!RESIDUAL_TOKEN_RE.test(original)) return false;
  if (redacted.includes(REDACTED)) return false;
  return RESIDUAL_TOKEN_RE.test(redacted);
}

// Re-exports for tests.
export const __internal = {
  REDACTED,
  PROJECT,
  collapseHomePrefix,
  collapseProjectPaths,
  hasResidualTokenShape
};
