// T-310 — Fixture-driven test runner.
//
// Walks fixtures/synthetic-homes/*/, parses each card.yaml, runs assembleReport
// against the fixture's home, and asserts the card's expectations against the
// pipeline's output (per notes/PLAN.md §3 Phase 3).
//
// Read-only: no fixture file is mutated. Mtime offsets from _mtime.json are
// applied via utimesSync to directories Git cannot preserve mtimes for.
//
// Comparison strategy (per PLAN Risk #2):
//   - Semantic per-section comparison, NOT byte-equal whole-file diff.
//   - The card is the contract; the rendered report.txt is a reference for
//     section presence and field-level shape.

import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync, utimesSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { assembleReport } from "../scripts/lib/audit.mjs";
import { renderHumanReport, renderJsonReport } from "../scripts/lib/report.mjs";
import { SCHEMA_VERSION } from "../scripts/lib/contracts.mjs";

const FIXTURES_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "fixtures",
  "synthetic-homes"
);

// Fixtures whose card-declared primary stance is reachable by detectors that
// exist in the v0.1 pipeline today. Strict stance-presence and missing-key /
// blocked-action intersection assertions run against this set. Other fixtures
// are still walked and validated for shape (mode, schemaVersion, filesChanged,
// evidence presence) but skip the strict card-match assertion. As detectors
// land (rollback.checkpoint_only, policy.protected_path, scan-budget, etc.),
// add their fixture id here. New fixtures from TDD-B's parallel work pick up
// shape validation automatically.
const STRICT_STANCE_FIXTURES = new Set([
  "broken-hook-simple",
  "broken-hook-shell-ambiguous",
  "expected-orphan-cache",
  "candidate-stale-cache",
  "invalid-settings"
]);

// ---------- entrypoint: one test per fixture ----------

for (const fixture of listFixtures()) {
  test(`fixture: ${fixture.id}`, () => {
    applyMtimeOffsets(fixture);

    const mode = firstDeclaredMode(fixture.card);
    const home = path.join(fixture.dir, "home", ".claude");
    const report = assembleReport(home, { mode });

    // ---- shape invariants ----
    assert.equal(report.filesChanged, false, "report.filesChanged must be false");
    assert.equal(report.mode, mode, `report.mode must echo declared mode (${mode})`);
    assert.equal(
      report.schemaVersion,
      SCHEMA_VERSION,
      "report.schemaVersion matches the runtime constant"
    );

    // Every finding has structural evidence or a missing key. No empty findings.
    for (const finding of report.findings) {
      const evidenceKeys = ["structural", "loader", "behavioral", "ownership", "freshness", "reversibility"];
      const hasEvidence = evidenceKeys.some(
        (key) => Array.isArray(finding.evidence?.[key]) && finding.evidence[key].length > 0
      );
      const hasMissing = Array.isArray(finding.evidence?.missing) && finding.evidence.missing.length > 0;
      assert.ok(
        hasEvidence || hasMissing,
        `finding ${finding.id} must have at least one evidence key or missing key`
      );
    }

    // ---- card-derived expectations (when pipeline can satisfy them) ----
    if (STRICT_STANCE_FIXTURES.has(fixture.id)) {
      const cardFindings = collectCardFindings(fixture.card);
      for (const cardFinding of cardFindings) {
        if (!cardFinding.stance) continue;
        assert.ok(
          report.stanceSummary[cardFinding.stance] >= 1,
          `expected at least one ${cardFinding.stance} stance for fixture ${fixture.id}`
        );
      }

      // When the card declares missing keys, at least one finding emitted by
      // the pipeline must also declare missing keys (presence check, not text
      // equality — card text and pipeline text are allowed to diverge as long
      // as both signal that evidence is incomplete).
      const cardMissing = (fixture.card?.evidence?.missing || []).filter(Boolean);
      if (cardMissing.length > 0 && report.findings.length > 0) {
        const someFindingDeclaresMissing = report.findings.some(
          (f) => Array.isArray(f.evidence?.missing) && f.evidence.missing.length > 0
        );
        assert.ok(
          someFindingDeclaresMissing,
          `fixture ${fixture.id} declares missing keys; at least one finding must also declare missing keys`
        );
      }

      // Same shape for blocked_actions: presence check rather than text match.
      const cardBlocked = (fixture.card?.blocked_actions || []).filter(Boolean);
      if (cardBlocked.length > 0 && report.findings.length > 0) {
        const someFindingBlocks = report.findings.some(
          (f) => Array.isArray(f.blockedActions) && f.blockedActions.length > 0
        );
        assert.ok(
          someFindingBlocks,
          `fixture ${fixture.id} declares blocked actions; at least one finding must also declare blocked actions`
        );
      }
    }

    // ---- rendered report shape ----
    const human = renderHumanReport(report);
    assert.ok(human.startsWith("HOUSEKEEPER REPORT\nNo files changed.\n"), "human report header");
    assert.match(human, /\nPRIMARY\n/, "PRIMARY section present");
    assert.match(human, /\nSTANCE SUMMARY\n/, "STANCE SUMMARY section present");
    assert.match(human, /\nBOUNDARIES\n/, "BOUNDARIES section present");
    assert.match(human, /\nSCAN\n/, "SCAN section present");

    const json = renderJsonReport(report);
    assert.equal(json.filesChanged, false, "json filesChanged false");
    assert.equal(json.mode, mode, "json mode matches");
    assert.equal(json.schemaVersion, SCHEMA_VERSION, "json schemaVersion matches");
    assert.ok(Array.isArray(json.findings), "json findings is array");
    assert.ok(Array.isArray(json.boundaries), "json boundaries is array");
    assert.ok(Array.isArray(json.degraded), "json degraded is array");

    // If a golden report.json is present, assert its declared schemaVersion
    // matches what the runtime emits (T-507 will flip both at tag time).
    const goldenJsonPath = path.join(fixture.dir, "report.json");
    if (existsSync(goldenJsonPath)) {
      const golden = JSON.parse(readFileSync(goldenJsonPath, "utf8"));
      assert.equal(
        golden.schemaVersion,
        SCHEMA_VERSION,
        `fixture golden schemaVersion (${golden.schemaVersion}) must match runtime ${SCHEMA_VERSION}`
      );
    }
  });
}

// ---------- helpers ----------

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

function collectCardFindings(card) {
  const out = [];
  if (card?.finding) out.push(card.finding);
  if (Array.isArray(card?.findings)) {
    for (const f of card.findings) out.push(f);
  }
  return out;
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

// ---------- minimal YAML reader ----------
//
// Cards are flat: top-level scalars, lists of scalars, lists of objects, and
// nested object blocks. Indentation is two spaces. This reader handles that
// shape only.

export function parseSimpleYaml(text) {
  const lines = text.split("\n").filter((line) => !line.startsWith("#"));
  const root = {};
  parseBlock(lines, 0, 0, root);
  return root;
}

function parseBlock(lines, startIndex, indent, target) {
  let i = startIndex;
  while (i < lines.length) {
    const raw = lines[i];
    if (raw.trim() === "") {
      i += 1;
      continue;
    }
    const lineIndent = countIndent(raw);
    if (lineIndent < indent) return i;
    if (lineIndent > indent) {
      i += 1;
      continue;
    }
    const trimmed = raw.slice(indent);
    if (trimmed.startsWith("- ")) {
      return i;
    }
    const colonIndex = trimmed.indexOf(":");
    if (colonIndex === -1) {
      i += 1;
      continue;
    }
    const key = trimmed.slice(0, colonIndex).trim();
    const after = trimmed.slice(colonIndex + 1).trim();
    if (after === "") {
      const next = peekNextNonBlank(lines, i + 1);
      if (next === -1) {
        target[key] = null;
        i += 1;
        continue;
      }
      const childIndent = countIndent(lines[next]);
      if (childIndent <= indent) {
        target[key] = null;
        i += 1;
        continue;
      }
      const childTrim = lines[next].slice(childIndent);
      if (childTrim.startsWith("- ")) {
        const list = [];
        i = parseList(lines, next, childIndent, list);
        target[key] = list;
      } else {
        const childObj = {};
        i = parseBlock(lines, next, childIndent, childObj);
        target[key] = childObj;
      }
    } else {
      target[key] = unquote(after);
      i += 1;
    }
  }
  return i;
}

function parseList(lines, startIndex, indent, target) {
  let i = startIndex;
  while (i < lines.length) {
    const raw = lines[i];
    if (raw.trim() === "") {
      i += 1;
      continue;
    }
    const lineIndent = countIndent(raw);
    if (lineIndent < indent) return i;
    if (lineIndent > indent) {
      i += 1;
      continue;
    }
    const trimmed = raw.slice(indent);
    if (!trimmed.startsWith("- ")) return i;
    const itemBody = trimmed.slice(2);
    const colonIndex = itemBody.indexOf(":");
    if (colonIndex === -1) {
      target.push(unquote(itemBody.trim()));
      i += 1;
      continue;
    }
    // Object list item — first key is on the dash line; remaining keys at indent+2.
    const item = {};
    const firstKey = itemBody.slice(0, colonIndex).trim();
    const firstVal = itemBody.slice(colonIndex + 1).trim();
    if (firstVal === "") {
      const next = peekNextNonBlank(lines, i + 1);
      if (next !== -1 && countIndent(lines[next]) > indent) {
        const nestedIndent = countIndent(lines[next]);
        const nestedTrim = lines[next].slice(nestedIndent);
        if (nestedTrim.startsWith("- ")) {
          const list = [];
          i = parseList(lines, next, nestedIndent, list);
          item[firstKey] = list;
        } else {
          const obj = {};
          i = parseBlock(lines, next, nestedIndent, obj);
          item[firstKey] = obj;
        }
      } else {
        item[firstKey] = null;
        i += 1;
      }
    } else {
      item[firstKey] = unquote(firstVal);
      i += 1;
    }
    const childIndent = indent + 2;
    while (i < lines.length) {
      const peek = lines[i];
      if (peek.trim() === "") {
        i += 1;
        continue;
      }
      const pi = countIndent(peek);
      if (pi < childIndent) break;
      if (pi > childIndent) {
        i += 1;
        continue;
      }
      const pt = peek.slice(childIndent);
      if (pt.startsWith("- ")) break;
      const ci = pt.indexOf(":");
      if (ci === -1) {
        i += 1;
        continue;
      }
      const k = pt.slice(0, ci).trim();
      const v = pt.slice(ci + 1).trim();
      if (v === "") {
        const next = peekNextNonBlank(lines, i + 1);
        if (next !== -1 && countIndent(lines[next]) > childIndent) {
          const nestedIndent = countIndent(lines[next]);
          const nestedTrim = lines[next].slice(nestedIndent);
          if (nestedTrim.startsWith("- ")) {
            const list = [];
            i = parseList(lines, next, nestedIndent, list);
            item[k] = list;
          } else {
            const obj = {};
            i = parseBlock(lines, next, nestedIndent, obj);
            item[k] = obj;
          }
        } else {
          item[k] = null;
          i += 1;
        }
      } else {
        item[k] = unquote(v);
        i += 1;
      }
    }
    target.push(item);
  }
  return i;
}

function countIndent(line) {
  let count = 0;
  while (count < line.length && line[count] === " ") count += 1;
  return count;
}

function peekNextNonBlank(lines, from) {
  for (let i = from; i < lines.length; i += 1) {
    if (lines[i].trim() !== "") return i;
  }
  return -1;
}

function unquote(value) {
  if (value.length >= 2) {
    const first = value[0];
    const last = value[value.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return value.slice(1, -1);
    }
  }
  return value;
}
