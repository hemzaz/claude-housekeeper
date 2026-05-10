// T-311 — Forbidden-language test.
//
// For every fixture, render the report (human + JSON) and assert the rendered
// text contains no forbidden phrase. Phrase list, case-insensitive substring,
// is the union of avoid-lists across:
//
//   docs/decision-calculus.md §11
//   docs/report-grammar.md §8
//   docs/vocabulary.md §3
//   docs/repair-rollback-spec.md §8
//   docs/loader-semantics.md §10
//
// Important scoping rules:
//
//   1. Phrase-level matching, not word-level. The word "safe" alone is allowed
//      ("safe step", "safe mode"); the phrases "safe to delete" and
//      "safe cleanup" are not. Same for "healthy" — bare "healthy" is flagged
//      unless qualified ("after verification", "live probe").
//
//   2. JSON values, not field NAMES. A finding with `"stance": "inform"` keeps
//      the key "inform" legal; the test scans VALUES only.
//
//   3. The word "unused" is forbidden UNLESS preceded by qualifying language
//      ("not referenced", "candidate", "may be"). This is a soft contextual
//      rule, not a hard substring ban.

import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync, utimesSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { assembleReport } from "../scripts/lib/audit.mjs";
import { renderHumanReport, renderJsonReport } from "../scripts/lib/report.mjs";
import { parseSimpleYaml } from "./fixtures.test.mjs";

const FIXTURES_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "fixtures",
  "synthetic-homes"
);

// ---------- forbidden phrase list ----------
//
// Each phrase is matched case-insensitively as a substring against rendered
// report text. The phrase list reflects the FIVE source documents above.

const FORBIDDEN_PHRASES = [
  // decision-calculus §11
  "safe to delete",
  "safe cleanup",
  "trash",
  "junk",
  "obviously unused",
  "auto-fix",
  "guaranteed rollback",

  // report-grammar §8 (additional)
  "deletion-ready",
  "definitely unused",

  // vocabulary §3 (stricter set)
  "optimized",
  "clean bill of health",
  "fixed everything",

  // repair-rollback-spec §8
  "rollback guaranteed"
];

// Contextual rules: a phrase is forbidden UNLESS preceded by qualifier text
// within an 80-char window. The pipeline emits literals like "call unused" and
// "claim healthy" inside blockedActions — these are descriptions OF disallowed
// claims, not the disallowed claims themselves, so the qualifier list includes
// the verbs that mark these as second-order references.

const CONTEXTUAL_RULES = [
  {
    phrase: "unused",
    allowedPrefixes: ["not referenced", "candidate", "may be", "call ", "say ", "label "]
  },
  {
    phrase: "healthy",
    allowedPrefixes: ["after verification", "live probe", "claim ", "call "]
  }
];

// ---------- entrypoint ----------

for (const fixture of listFixtures()) {
  test(`forbidden-language: ${fixture.id}`, () => {
    applyMtimeOffsets(fixture);

    const home = path.join(fixture.dir, "home", ".claude");
    const mode = firstDeclaredMode(fixture.card);
    const report = assembleReport(home, { mode });

    const human = renderHumanReport(report);
    assertNoForbiddenPhrase(human, `${fixture.id} (human)`);

    // For JSON: scan VALUES only (per scope rule #2). Field names like
    // "stance" stay legal even though they live next to stance literals.
    const json = renderJsonReport(report);
    const jsonValues = collectJsonStringValues(json);
    for (const value of jsonValues) {
      assertNoForbiddenPhrase(value, `${fixture.id} (json value)`);
    }
  });
}

// ---------- negative-test guards ----------
//
// Phrases that LOOK like they could trigger a false positive must be allowed.
// Without these, the test is too lax — they exercise the contextual rules.

test("benign report containing 'safe step' must pass", () => {
  const benign = "Next step: take a safe step toward investigating the cache.";
  assertNoForbiddenPhrase(benign, "benign safe step");
});

test("benign report containing 'safe mode' must pass", () => {
  const benign = "Mode: safe mode is in effect; no live probes will run.";
  assertNoForbiddenPhrase(benign, "benign safe mode");
});

test("benign report containing 'not referenced ... unused' must pass", () => {
  const benign = "This cache is not referenced by registry evidence; unused under our definition.";
  assertNoForbiddenPhrase(benign, "benign qualified unused");
});

test("benign report containing 'after verification ... healthy' must pass", () => {
  const benign = "After verification, this hook is presumed healthy.";
  assertNoForbiddenPhrase(benign, "benign qualified healthy");
});

// ---------- positive-test guards ----------
//
// A phrase that IS forbidden must trigger a failure. Wrapped in `assert.throws`
// so a regression in the matcher is loud.

test("matcher catches 'safe to delete'", () => {
  assert.throws(
    () => assertNoForbiddenPhrase("This file is safe to delete.", "regression-check"),
    /safe to delete/i
  );
});

test("matcher catches bare 'healthy' without qualifier", () => {
  assert.throws(
    () => assertNoForbiddenPhrase("This system is healthy.", "regression-check"),
    /healthy/i
  );
});

test("matcher catches bare 'unused' without qualifier", () => {
  assert.throws(
    () => assertNoForbiddenPhrase("This file is unused.", "regression-check"),
    /unused/i
  );
});

// ---------- core matcher ----------

export function assertNoForbiddenPhrase(text, label) {
  if (typeof text !== "string" || text.length === 0) return;
  const lower = text.toLowerCase();

  for (const phrase of FORBIDDEN_PHRASES) {
    const needle = phrase.toLowerCase();
    const idx = lower.indexOf(needle);
    if (idx !== -1) {
      throw new Error(
        `${label}: forbidden phrase "${phrase}" found at index ${idx}: ${snippet(text, idx, needle.length)}`
      );
    }
  }

  for (const rule of CONTEXTUAL_RULES) {
    const needle = rule.phrase.toLowerCase();
    let cursor = 0;
    while (cursor < lower.length) {
      const idx = lower.indexOf(needle, cursor);
      if (idx === -1) break;
      if (!isWordBoundary(lower, idx, needle.length)) {
        cursor = idx + needle.length;
        continue;
      }
      const windowStart = Math.max(0, idx - 80);
      const before = lower.slice(windowStart, idx);
      const allowed = rule.allowedPrefixes.some((prefix) =>
        before.includes(prefix.toLowerCase())
      );
      if (!allowed) {
        throw new Error(
          `${label}: bare "${rule.phrase}" found without qualifier at index ${idx}: ${snippet(text, idx, needle.length)}`
        );
      }
      cursor = idx + needle.length;
    }
  }
}

function isWordBoundary(text, idx, length) {
  const left = idx === 0 ? "" : text[idx - 1];
  const right = idx + length >= text.length ? "" : text[idx + length];
  const isWordChar = (ch) => /[A-Za-z0-9_]/.test(ch);
  return !isWordChar(left) && !isWordChar(right);
}

function snippet(text, idx, length) {
  const start = Math.max(0, idx - 30);
  const end = Math.min(text.length, idx + length + 30);
  return `"${text.slice(start, end).replace(/\n/g, " ")}"`;
}

// ---------- helpers (mirror fixtures.test.mjs to keep test files independent) ----------

function listFixtures() {
  const out = [];
  for (const name of readdirSync(FIXTURES_ROOT)) {
    const dir = path.join(FIXTURES_ROOT, name);
    if (!statSync(dir).isDirectory()) continue;
    const cardPath = path.join(dir, "card.yaml");
    if (!existsSync(cardPath)) continue;
    const card = parseSimpleYaml(readFileSync(cardPath, "utf8"));
    out.push({ id: name, dir, card });
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

function firstDeclaredMode(card) {
  const expectations = card?.mode_expectations;
  if (!expectations || typeof expectations !== "object") return "diagnose";
  const keys = Object.keys(expectations);
  if (keys.length === 0) return "diagnose";
  return keys[0];
}

function applyMtimeOffsets(fixture) {
  const offsetsPath = path.join(fixture.dir, "_mtime.json");
  if (!existsSync(offsetsPath)) return;
  const data = JSON.parse(readFileSync(offsetsPath, "utf8"));
  if (!Array.isArray(data?.paths)) return;
  for (const entry of data.paths) {
    if (!entry?.path || typeof entry.mtimeOffsetDays !== "number") continue;
    const target = path.join(fixture.dir, entry.path);
    if (!existsSync(target)) continue;
    const ts = (Date.now() + entry.mtimeOffsetDays * 24 * 60 * 60 * 1000) / 1000;
    utimesSync(target, ts, ts);
  }
}

function collectJsonStringValues(node, out = []) {
  if (typeof node === "string") {
    out.push(node);
    return out;
  }
  if (Array.isArray(node)) {
    for (const child of node) collectJsonStringValues(child, out);
    return out;
  }
  if (node && typeof node === "object") {
    // Field NAMES are skipped intentionally — only VALUES are scanned.
    for (const value of Object.values(node)) collectJsonStringValues(value, out);
    return out;
  }
  return out;
}
