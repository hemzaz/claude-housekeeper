// T-402 — bounded observation primitives.
//
// Read-only directory walk that honors a ScanLimit. Stops cleanly when any
// budget is hit and reports which one in `degraded[]`.
//
// Defaults per docs/safe-mode.md "Scan Budgets" and notes/TASKBOARD.md T-402:
//   maxFiles: 5000
//   maxBytes: 1 MiB (per-JSON read cap; not enforced here, used by JSON readers)
//   maxWallMs: 5000
//
// Symlinks are NOT followed by default (per notes/MODULE-BOUNDARIES.md "observe"
// Forbidden, and docs/safe-mode.md "Scan Budgets"). The link is recorded as
// kind: "symlink" with the literal name, not the target.
//
// Forbidden in this module: writes, symlink dereference, content reads,
// process spawn. Asserted by test/no-mutation.test.mjs.

import { readdirSync, lstatSync } from "node:fs";
import path from "node:path";

export const DEFAULT_MAX_FILES = 5000;
export const DEFAULT_MAX_BYTES = 1024 * 1024;
export const DEFAULT_MAX_WALL_MS = 5000;

// walkBounded(root, limits) → { entries, degraded, stopped }
//
// entries: [{ path, kind, sizeBytes, mtimeMs }]
//   kind is "file" | "directory" | "symlink" | "other".
//
// degraded: [{ kind: "scan-degraded", reason, path, budget? }]
//   reason is one of: "max-files", "max-wall-ms", "unreadable-directory".
//
// stopped: boolean — true if traversal aborted on a budget hit.
export function walkBounded(root, limits = {}) {
  const maxFiles = numberOr(limits.maxFiles, DEFAULT_MAX_FILES);
  const maxWallMs = numberOr(limits.maxWallMs, DEFAULT_MAX_WALL_MS);
  const startMs = Date.now();
  const entries = [];
  const degraded = [];
  let stopped = false;

  if (!safeIsDirectory(root)) {
    return { entries, degraded, stopped };
  }

  const stack = [root];
  while (stack.length > 0) {
    if (entries.length >= maxFiles) {
      degraded.push({
        kind: "scan-degraded",
        reason: "max-files",
        path: root,
        budget: `maxFiles=${maxFiles}`
      });
      stopped = true;
      break;
    }
    if (Date.now() - startMs >= maxWallMs) {
      degraded.push({
        kind: "scan-degraded",
        reason: "max-wall-ms",
        path: root,
        budget: `maxWallMs=${maxWallMs}`
      });
      stopped = true;
      break;
    }

    const current = stack.pop();
    let names;
    try {
      names = readdirSync(current);
    } catch {
      degraded.push({
        kind: "scan-degraded",
        reason: "unreadable-directory",
        path: current
      });
      continue;
    }
    for (const name of names) {
      if (entries.length >= maxFiles) {
        degraded.push({
          kind: "scan-degraded",
          reason: "max-files",
          path: root,
          budget: `maxFiles=${maxFiles}`
        });
        stopped = true;
        break;
      }
      const full = path.join(current, name);
      const stat = safeLstat(full);
      if (!stat) continue;
      if (stat.isSymbolicLink()) {
        // Record but never traverse.
        entries.push({
          path: full,
          kind: "symlink",
          sizeBytes: stat.size || 0,
          mtimeMs: stat.mtimeMs || 0
        });
        continue;
      }
      if (stat.isDirectory()) {
        entries.push({
          path: full,
          kind: "directory",
          sizeBytes: 0,
          mtimeMs: stat.mtimeMs || 0
        });
        stack.push(full);
        continue;
      }
      if (stat.isFile()) {
        entries.push({
          path: full,
          kind: "file",
          sizeBytes: stat.size || 0,
          mtimeMs: stat.mtimeMs || 0
        });
        continue;
      }
      entries.push({
        path: full,
        kind: "other",
        sizeBytes: 0,
        mtimeMs: stat.mtimeMs || 0
      });
    }
    if (stopped) break;
  }

  return { entries, degraded, stopped };
}

function numberOr(value, fallback) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}

function safeLstat(file) {
  try { return lstatSync(file); }
  catch { return null; }
}

function safeIsDirectory(file) {
  try { return lstatSync(file).isDirectory(); }
  catch { return false; }
}
