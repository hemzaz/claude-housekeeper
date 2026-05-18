// Learning loop — append-only JSONL helpers for the v0.4 observation surface.
// Writes under <home>/.claude/housekeeper/learning/.
// No runtime dependencies — Node built-ins only.

import { appendFile, mkdir, open, readFile, rename, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import path from "node:path";

export const LEARNING_SCHEMA_VERSION = "0.4";

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function learningDir(home) {
  return path.join(home, ".claude", "housekeeper", "learning");
}

async function ensureDir(dir) {
  await mkdir(dir, { recursive: true });
}

async function appendJsonlLine(filePath, record) {
  const line = JSON.stringify(record) + "\n";
  await appendFile(filePath, line, { encoding: "utf8", flag: "a" });
}

// Read JSONL file; skip malformed lines (log to stderr, do not throw).
async function readJsonlFile(filePath) {
  let text;
  try {
    text = await readFile(filePath, "utf8");
  } catch (err) {
    if (err.code === "ENOENT") return [];
    throw err;
  }

  const records = [];
  const lines = text.split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    try {
      records.push(JSON.parse(trimmed));
    } catch {
      process.stderr.write(
        `[learning] skipping malformed JSONL line in ${filePath}\n`
      );
    }
  }
  return records;
}

// ---------------------------------------------------------------------------
// appendRefusal
// ---------------------------------------------------------------------------

// Append one refusal record to learning/refusals.jsonl.
// refusal shape: { command, target, reason, refusalClass, targetPath?,
//                  opIdRefIfPresent? }
export async function appendRefusal(home, refusal) {
  const dir = learningDir(home);
  await ensureDir(dir);
  const record = {
    learnSchemaVersion: LEARNING_SCHEMA_VERSION,
    ts: new Date().toISOString(),
    command: refusal.command,
    target: refusal.target,
    reason: refusal.reason,
    refusalClass: refusal.refusalClass
  };
  if (refusal.targetPath !== undefined) record.targetPath = refusal.targetPath;
  if (refusal.opIdRefIfPresent !== undefined)
    record.opIdRefIfPresent = refusal.opIdRefIfPresent;
  await appendJsonlLine(path.join(dir, "refusals.jsonl"), record);
}

// ---------------------------------------------------------------------------
// appendApplied
// ---------------------------------------------------------------------------

// Append one applied record to learning/applied.jsonl.
// opManifest shape: { opId, status, command, targets[], filesCount,
//                     partialApply?, durationMs? }
export async function appendApplied(home, opManifest) {
  const dir = learningDir(home);
  await ensureDir(dir);
  const record = {
    learnSchemaVersion: LEARNING_SCHEMA_VERSION,
    ts: new Date().toISOString(),
    opId: opManifest.opId,
    status: opManifest.status,
    command: opManifest.command,
    targets: Array.isArray(opManifest.targets) ? opManifest.targets : [],
    filesCount: opManifest.filesCount
  };
  if (opManifest.partialApply !== undefined)
    record.partialApply = opManifest.partialApply;
  if (opManifest.durationMs !== undefined)
    record.durationMs = opManifest.durationMs;
  await appendJsonlLine(path.join(dir, "applied.jsonl"), record);
}

// ---------------------------------------------------------------------------
// appendRollback
// ---------------------------------------------------------------------------

// Append one rollback record to learning/rollbacks.jsonl.
// opManifest shape: { opId, fromStatus, toStatus, filesRestoredCount }
export async function appendRollback(home, opManifest) {
  const dir = learningDir(home);
  await ensureDir(dir);
  const record = {
    learnSchemaVersion: LEARNING_SCHEMA_VERSION,
    ts: new Date().toISOString(),
    opId: opManifest.opId,
    fromStatus: opManifest.fromStatus,
    toStatus: opManifest.toStatus,
    filesRestoredCount: opManifest.filesRestoredCount
  };
  await appendJsonlLine(path.join(dir, "rollbacks.jsonl"), record);
}

// ---------------------------------------------------------------------------
// readSummary
// ---------------------------------------------------------------------------

// Read all 3 JSONL files + state.json and return a summary object.
// options: { windowDays? } — default 30 days for windowed views.
//
// Returns:
//   topRefusals: {reason, count}[]       top 5 over windowDays
//   topCleanedDetectors: {targetDetector, count}[]  top 5 over windowDays
//   recentRollbacks: {opId, ts, fromStatus, toStatus, filesRestoredCount}[]
//                                         last 10, newest-first
//   falsePositiveCount: number           from state.json, default 0
//   counters: {totalRefusals, totalApplied, totalRollbacks}   lifetime
//   windowDays: number
//
// Empty-state: if no files exist, returns zeros/empty without error.
export async function readSummary(home, options = {}) {
  const windowDays = typeof options.windowDays === "number" ? options.windowDays : 30;
  const windowMs = windowDays * 24 * 60 * 60 * 1000;
  const now = Date.now();
  const windowStart = now - windowMs;

  const dir = learningDir(home);

  const [refusals, applied, rollbacks] = await Promise.all([
    readJsonlFile(path.join(dir, "refusals.jsonl")),
    readJsonlFile(path.join(dir, "applied.jsonl")),
    readJsonlFile(path.join(dir, "rollbacks.jsonl"))
  ]);

  // Read state.json if present. Supports both the legacy counter-only shape
  // ({ falsePositives: <number> }) and the current array shape
  // ({ falsePositives: <array> }). Count is array.length in the new shape.
  let falsePositiveCount = 0;
  try {
    const stateText = await readFile(path.join(dir, "state.json"), "utf8");
    const state = JSON.parse(stateText);
    if (Array.isArray(state.falsePositives)) {
      falsePositiveCount = state.falsePositives.length;
    } else if (typeof state.falsePositives === "number") {
      falsePositiveCount = state.falsePositives;
    }
  } catch {
    // Missing or malformed state.json — use default 0
  }

  // Lifetime counters (all records, no window filter)
  const counters = {
    totalRefusals: refusals.length,
    totalApplied: applied.length,
    totalRollbacks: rollbacks.length
  };

  // Windowed views
  const windowedRefusals = refusals.filter((r) => {
    const ts = new Date(r.ts).getTime();
    return !isNaN(ts) && ts >= windowStart;
  });

  const windowedApplied = applied.filter((r) => {
    const ts = new Date(r.ts).getTime();
    return !isNaN(ts) && ts >= windowStart;
  });

  // Top 5 refusal reasons by count
  const reasonCounts = new Map();
  for (const r of windowedRefusals) {
    if (typeof r.reason === "string") {
      reasonCounts.set(r.reason, (reasonCounts.get(r.reason) || 0) + 1);
    }
  }
  const topRefusals = Array.from(reasonCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([reason, count]) => ({ reason, count }));

  // Top 5 cleaned detectors by count (using target field as detector identifier)
  const detectorCounts = new Map();
  for (const r of windowedApplied) {
    const key =
      typeof r.detectorId === "string"
        ? r.detectorId
        : typeof r.target === "string"
          ? r.target
          : "";
    if (key) {
      detectorCounts.set(key, (detectorCounts.get(key) || 0) + 1);
    }
  }
  const topCleanedDetectors = Array.from(detectorCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([targetDetector, count]) => ({ targetDetector, count }));

  // Last 10 rollbacks, newest-first
  const recentRollbacks = rollbacks
    .slice()
    .sort((a, b) => {
      const ta = new Date(a.ts).getTime();
      const tb = new Date(b.ts).getTime();
      return tb - ta;
    })
    .slice(0, 10)
    .map((r) => ({
      opId: r.opId,
      ts: r.ts,
      fromStatus: r.fromStatus,
      toStatus: r.toStatus,
      filesRestoredCount: r.filesRestoredCount
    }));

  return {
    topRefusals,
    topCleanedDetectors,
    recentRollbacks,
    falsePositiveCount,
    counters,
    windowDays
  };
}

// ---------------------------------------------------------------------------
// atomicWrite (inline copy of snapshot.mjs pattern — zero external deps)
// ---------------------------------------------------------------------------

async function atomicWrite(filePath, content) {
  const hex = randomBytes(4).toString("hex");
  const tmp = `${filePath}.tmp.${hex}`;
  const fh = await open(tmp, "w");
  try {
    await fh.writeFile(content, "utf8");
    await fh.datasync();
  } finally {
    await fh.close();
  }
  await rename(tmp, filePath);
}

// ---------------------------------------------------------------------------
// pruneLearningFiles
// ---------------------------------------------------------------------------

// Remove records older than olderThanDays from all three JSONL files.
// Rewrites each file atomically. If a file does not exist, it is skipped.
// olderThanDays must be a positive integer (validated by the caller).
export async function pruneLearningFiles(home, olderThanDays) {
  const dir = learningDir(home);
  const cutoff = Date.now() - olderThanDays * 24 * 60 * 60 * 1000;
  const files = ["refusals.jsonl", "applied.jsonl", "rollbacks.jsonl"];
  for (const name of files) {
    const filePath = path.join(dir, name);
    const records = await readJsonlFile(filePath);
    if (records.length === 0) continue; // file absent or empty — skip
    const kept = records.filter((r) => {
      const ts = new Date(r.ts).getTime();
      return !isNaN(ts) && ts >= cutoff;
    });
    const content = kept.map((r) => JSON.stringify(r)).join("\n") + (kept.length > 0 ? "\n" : "");
    await atomicWrite(filePath, content);
  }
}

// ---------------------------------------------------------------------------
// markFalsePositive
// ---------------------------------------------------------------------------

// Record a false-positive marker in state.json for the given opId.
// Looks up the op in applied.jsonl to extract the detector id and target path,
// then appends a structured marker entry. If the op is not found in
// applied.jsonl, records the marker with the provided hint fields (if any).
//
// opts: { targetDetector?: string, targetPath?: string } — caller-supplied hints
// used when applied.jsonl lookup fails or is absent.
//
// Backwards-compatible: if state.json has the old counter-only shape
// ({ falsePositives: <number> }), it is migrated to the array shape on first write.
//
// opId format is validated by the caller (CLI layer).
export async function markFalsePositive(home, opId, opts = {}) {
  const dir = learningDir(home);
  await ensureDir(dir);
  const stateFile = path.join(dir, "state.json");

  // Look up the op in applied.jsonl to get detector + targetPath.
  let targetDetector = opts.targetDetector || null;
  let targetPath = opts.targetPath || null;
  try {
    const appliedRecords = await readJsonlFile(path.join(dir, "applied.jsonl"));
    const match = appliedRecords.find((r) => r.opId === opId);
    if (match) {
      if (match.detectorId) targetDetector = match.detectorId;
      if (match.targetPath) targetPath = match.targetPath;
    }
  } catch {
    // applied.jsonl absent or unreadable — proceed with hint fields only
  }

  // Read existing state.json, migrating the legacy counter-only shape.
  let state = { learnSchemaVersion: LEARNING_SCHEMA_VERSION, falsePositives: [] };
  try {
    const text = await readFile(stateFile, "utf8");
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed.falsePositives)) {
      // Current array shape — use as-is.
      state = parsed;
      state.learnSchemaVersion = LEARNING_SCHEMA_VERSION;
    } else if (typeof parsed.falsePositives === "number") {
      // Legacy counter-only shape — migrate silently. The counter is discarded
      // because the new array carries the same information (array.length).
      state = {
        learnSchemaVersion: LEARNING_SCHEMA_VERSION,
        falsePositives: []
      };
    }
  } catch {
    // absent or malformed — start fresh
  }

  // Idempotent: if this opId is already marked, update in place (no-op on identical entry).
  const existingIdx = state.falsePositives.findIndex((m) => m.opId === opId);
  const marker = {
    opId,
    markedAt: new Date().toISOString(),
    targetDetector,
    targetPath
  };
  if (existingIdx >= 0) {
    state.falsePositives[existingIdx] = marker;
  } else {
    state.falsePositives.push(marker);
  }

  await atomicWrite(stateFile, JSON.stringify(state) + "\n");
}
