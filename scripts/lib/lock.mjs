// Consolidated lock protocol for Claude Housekeeper.
//
// Single source of truth for the lockfile acquire/release ceremony that was
// previously duplicated across clean-plan.mjs, harden-plan.mjs, and
// rollback-plan.mjs. Adds an append-only lock.history JSONL log per N6
// (RELEASE-READINESS-v0.2.0.md carry-over, v0.4-architect-memo.md §8.4).
//
// Exports:
//   acquireLock(home, options?)  → LockHandle
//   releaseLock(handle, reason)  → void
//   LockHeldError                — thrown when a live lock is present
//   LOCK_STALE_WINDOW_MS         — 30 minutes in milliseconds

import { open, unlink, mkdir, readFile, appendFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import os from "node:os";
import { generateOpId } from "./snapshot.mjs";

// ── Constants ────────────────────────────────────────────────────────────────

/** Staleness window: a lock older than this is eligible for unlink-and-retry. */
export const LOCK_STALE_WINDOW_MS = 30 * 60 * 1000; // 30 minutes

// ── Error class ───────────────────────────────────────────────────────────────

/**
 * LockHeldError — thrown by acquireLock when a live (non-stale) lockfile is
 * present. Callers inspect err.lockManifest for pid / hostname / stalenessAt.
 */
export class LockHeldError extends Error {
  constructor(lockManifest) {
    super(`Housekeeper lock is held by pid ${lockManifest.pid} on ${lockManifest.hostname}`);
    this.name = "LockHeldError";
    this.code = "lock-held";
    this.lockManifest = lockManifest;
  }
}

// ── lock.history append helpers ───────────────────────────────────────────────

/**
 * appendHistoryLine(home, record) — appends one JSON line to
 * <home>/.claude/housekeeper/lock.history using O_APPEND mode.
 * O_APPEND writes are atomic on POSIX for sizes ≤ PIPE_BUF (4096 bytes);
 * one JSONL line is well under that ceiling.
 * Errors are silently swallowed — history is observability, not safety-critical.
 */
async function appendHistoryLine(home, record) {
  const histPath = join(home, "housekeeper", "lock.history");
  try {
    await appendFile(histPath, JSON.stringify(record) + "\n", { flag: "a" });
  } catch {
    // Observation failure must not block mutation.
  }
}

// ── acquireLock ───────────────────────────────────────────────────────────────

/**
 * acquireLock(home) — opens <home>/housekeeper/lock with O_EXCL (wx flag).
 *
 * On EEXIST:
 *   - reads the existing manifest and checks stalenessAt.
 *   - if stale (or unreadable): unlinks and retries once.
 *   - if fresh: throws LockHeldError.
 *
 * On success: appends one "acquire" line to lock.history and returns a
 * LockHandle { lockPath, manifest } for use with releaseLock.
 *
 * @param {string} home — path to the .claude home directory.
 * @returns {Promise<{lockPath: string, manifest: object}>} LockHandle.
 */
export async function acquireLock(home) {
  const lockDir = join(home, "housekeeper");
  const lockPath = join(lockDir, "lock");

  await mkdir(lockDir, { recursive: true });

  const opId = generateOpId();
  const now = new Date();
  const manifest = {
    pid: process.pid,
    hostname: os.hostname(),
    opId,
    startedAt: now.toISOString(),
    stalenessAt: new Date(now.getTime() + LOCK_STALE_WINDOW_MS).toISOString()
  };

  const written = await _openExcl(lockPath, manifest);
  if (!written) {
    // EEXIST — inspect the existing lock.
    let existing;
    try {
      const raw = await readFile(lockPath, "utf8");
      existing = JSON.parse(raw);
    } catch {
      existing = null;
    }

    if (existing !== null) {
      // Check staleness.
      let stalenessAt = NaN;
      if (typeof existing.stalenessAt === "string") {
        stalenessAt = new Date(existing.stalenessAt).getTime();
      } else if (typeof existing.startedAt === "string") {
        stalenessAt = new Date(existing.startedAt).getTime() + LOCK_STALE_WINDOW_MS;
      }
      if (Number.isFinite(stalenessAt) && Date.now() < stalenessAt) {
        throw new LockHeldError(existing);
      }
    }

    // Stale or unreadable — unlink and retry once.
    try { await unlink(lockPath); } catch { /* already gone */ }
    const retried = await _openExcl(lockPath, manifest);
    if (!retried) {
      // Lost the race; read what beat us.
      let racer;
      try {
        racer = JSON.parse(await readFile(lockPath, "utf8"));
      } catch {
        racer = { pid: "unknown", hostname: "unknown" };
      }
      throw new LockHeldError(racer);
    }
  }

  // Append acquire event to lock.history.
  await appendHistoryLine(home, {
    ts: new Date().toISOString(),
    pid: process.pid,
    action: "acquire",
    holder: { pid: manifest.pid, hostname: manifest.hostname, startedAt: manifest.startedAt }
  });

  return { lockPath, manifest };
}

/**
 * _openExcl(lockPath, manifest) — try to open lockPath with O_EXCL.
 * Returns true on success, false on EEXIST, rethrows other errors.
 */
async function _openExcl(lockPath, manifest) {
  let fh;
  try {
    fh = await open(lockPath, "wx");
    await fh.writeFile(JSON.stringify(manifest, null, 2) + os.EOL);
    await fh.close();
    return true;
  } catch (err) {
    if (fh) { try { await fh.close(); } catch { /* ignore */ } }
    if (err.code === "EEXIST") return false;
    throw err;
  }
}

// ── releaseLock ───────────────────────────────────────────────────────────────

/**
 * releaseLock(handle, releaseReason) — unlinks the lockfile, then appends one
 * "release" line to lock.history.
 *
 * @param {{ lockPath: string, manifest: object }} handle — returned by acquireLock.
 * @param {string} releaseReason — e.g. "verified", "rolled_back", "process-exit".
 */
export async function releaseLock(handle, releaseReason) {
  const { lockPath, manifest } = handle;
  try {
    await unlink(lockPath);
  } catch {
    // Already gone — ignore.
  }

  // Derive home from lockPath: <home>/housekeeper/lock → <home>
  const home = join(lockPath, "..", "..");

  await appendHistoryLine(home, {
    ts: new Date().toISOString(),
    pid: process.pid,
    action: "release",
    holder: { pid: manifest.pid, hostname: manifest.hostname, startedAt: manifest.startedAt },
    releaseReason: releaseReason || null
  });
}
