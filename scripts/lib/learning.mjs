// Learning loop — append-only JSONL helpers for the v0.4 observation surface.
// Writes under <home>/.claude/housekeeper/learning/.
// No runtime dependencies — Node built-ins only.

import { appendFile, mkdir, readFile } from "node:fs/promises";
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

  // Read state.json if present
  let falsePositiveCount = 0;
  try {
    const stateText = await readFile(path.join(dir, "state.json"), "utf8");
    const state = JSON.parse(stateText);
    if (typeof state.falsePositives === "number") {
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
