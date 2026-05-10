// Policy module — canonical home for protection-rule loading and matching.
// loadConfig / normalizeProtectionRules / pathMatchesProtection are extracted
// from scripts/lib/audit.mjs unchanged in behavior. The originals stay in
// audit.mjs for now (Phase 2 will switch the import and delete duplicates).

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { makePolicyMatch } from "./contracts.mjs";

export function loadConfig(home, explicitPath) {
  const candidates = [
    explicitPath,
    path.join(home, "housekeeper", "config.json"),
    path.join(home, "housekeeper.json")
  ].filter(Boolean);
  for (const file of candidates) {
    const parsed = readJson(file);
    if (parsed.ok && !parsed.missing) {
      return { file, rules: normalizeProtectionRules(parsed.value) };
    }
    if (!parsed.ok) {
      return { file, rules: [], error: parsed.error };
    }
  }
  return { file: null, rules: [] };
}

export function normalizeProtectionRules(value) {
  const rules = [
    ...(Array.isArray(value?.doNotTouch) ? value.doNotTouch : []),
    ...(Array.isArray(value?.protect) ? value.protect : [])
  ];
  return rules
    .filter((rule) => rule && typeof rule === "object")
    .map((rule) => ({
      check: typeof rule.check === "string" ? rule.check : null,
      path: typeof rule.path === "string" ? rule.path : null,
      reason: typeof rule.reason === "string" ? rule.reason : "do-not-touch rule",
      scope: typeof rule.scope === "string" ? rule.scope : "user"
    }))
    .filter((rule) => rule.check || rule.path);
}

export function pathMatchesProtection(pattern, issuePath, home) {
  const absolutePattern = path.isAbsolute(pattern) ? pattern : path.join(home, pattern);
  const normalizedPattern = path.normalize(absolutePattern);
  const normalizedPath = path.normalize(issuePath);
  if (normalizedPattern.endsWith(`${path.sep}**`)) {
    const prefix = normalizedPattern.slice(0, -3);
    return normalizedPath === prefix || normalizedPath.startsWith(`${prefix}${path.sep}`);
  }
  if (normalizedPattern.endsWith(`${path.sep}*`)) {
    const prefix = normalizedPattern.slice(0, -2);
    return path.dirname(normalizedPath) === prefix;
  }
  return normalizedPath === normalizedPattern || normalizedPath.startsWith(`${normalizedPattern}${path.sep}`);
}

/**
 * Return all policy matches for a given path. Order follows policy-grammar.md §2:
 * doNotTouch ranks before allowance, allowance before standingConsent. Within a
 * type, narrower patterns rank first (longer normalized pattern wins).
 *
 * @param {string} targetPath - absolute path to test.
 * @param {object} policy - { home, doNotTouch?, allowances?, retention?, standingConsent? }.
 * @returns {object[]} PolicyMatch[] in shape from docs/schemas.md.
 */
export function matchPolicy(targetPath, policy = {}) {
  if (!targetPath || !policy) return [];
  const home = policy.home || "";
  const out = [];

  for (const rule of arr(policy.doNotTouch)) {
    if (!rule || !rule.path) continue;
    if (pathMatchesProtection(rule.path, targetPath, home)) {
      out.push(makePolicyMatch({
        type: "doNotTouch",
        pattern: rule.path,
        path: targetPath,
        reason: rule.reason || "do-not-touch rule",
        scope: rule.scope || "user",
        effect: "stance protect, action none"
      }));
    }
  }

  for (const rule of arr(policy.allowances)) {
    if (!rule || !rule.path) continue;
    if (pathMatchesProtection(rule.path, targetPath, home)) {
      out.push(makePolicyMatch({
        type: "allowance",
        pattern: rule.path,
        path: targetPath,
        reason: rule.reason || "allowed by policy",
        scope: rule.scope || "user",
        effect: "stance review, action none"
      }));
    }
  }

  for (const rule of arr(policy.standingConsent)) {
    if (!rule || !rule.path) continue;
    if (pathMatchesProtection(rule.path, targetPath, home)) {
      out.push(makePolicyMatch({
        type: "standingConsent",
        pattern: rule.path,
        path: targetPath,
        reason: rule.reason || "standing consent",
        scope: rule.scope || "user",
        effect: `stance up to ${rule.maxStance || "prepare"}`
      }));
    }
  }

  out.sort((a, b) => typeOrder(a.type) - typeOrder(b.type) || b.pattern.length - a.pattern.length);
  return out;
}

function typeOrder(t) {
  if (t === "doNotTouch") return 0;
  if (t === "allowance") return 1;
  if (t === "standingConsent") return 2;
  return 3;
}

function arr(v) {
  return Array.isArray(v) ? v : [];
}

function readJson(file) {
  if (!existsSync(file)) return { ok: true, missing: true, value: null, file };
  try {
    return { ok: true, missing: false, value: JSON.parse(readFileSync(file, "utf8")), file };
  } catch (error) {
    return { ok: false, missing: false, value: null, file, error: error.message };
  }
}
