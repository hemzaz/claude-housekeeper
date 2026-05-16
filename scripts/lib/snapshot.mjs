// Snapshot and rollback contract factories for Claude Housekeeper v0.2.
// Pure functions (factories) — return new plain objects matching docs/rollback-contracts.md.
// I/O functions (takeSnapshot) — write-temp + rename + fsync-parent atomic protocol.

import { createHash, randomBytes } from "node:crypto";
import {
  mkdir,
  open,
  rename,
  lstat,
  readlink,
  readFile,
  copyFile,
  rm,
  unlink,
  readdir,
  stat
} from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, basename, dirname } from "node:path";
import os from "node:os";
import { loadConfig, pathMatchesProtection } from "./policy.mjs";

// ── Budget constants (T-603) ──────────────────────────────────────────────────

/** Maximum number of files allowed in a single snapshot operation. */
export const MAX_OPERATION_FILES = 50;

/** Maximum total bytes allowed in a single snapshot operation (10 MiB). */
export const MAX_OPERATION_BYTES = 10 * 1024 * 1024;

// ── Named error classes ───────────────────────────────────────────────────────

/**
 * Thrown by takeSnapshot when one or more targets match a doNotTouch/protect
 * policy rule. This is a hard boundary; no caller flag can override it.
 * Per docs/snapshot-architecture.md §7 and docs/mode-doctrine.md §5 Forbidden.
 */
export class SnapshotRefusedError extends Error {
  constructor(blockedByProtection) {
    const paths = blockedByProtection.map((b) => b.path).join(", ");
    super(`Snapshot refused: protected path(s): ${paths}`);
    this.name = "SnapshotRefusedError";
    this.code = "SNAPSHOT_REFUSED_PROTECTED";
    this.reason = "protected-path";
    this.blockedByProtection = blockedByProtection;
  }
}

/**
 * Thrown by takeSnapshot when the target set exceeds the per-operation budget.
 * Per docs/snapshot-architecture.md §9.
 */
export class SnapshotBudgetError extends Error {
  constructor(limit, actual) {
    const filePart = actual.files > limit.files
      ? `${actual.files} files (limit ${limit.files})`
      : null;
    const bytePart = actual.bytes > limit.bytes
      ? `${actual.bytes} bytes (limit ${limit.bytes})`
      : null;
    const detail = [filePart, bytePart].filter(Boolean).join("; ");
    super(`Snapshot refused: budget exceeded — ${detail}`);
    this.name = "SnapshotBudgetError";
    this.code = "SNAPSHOT_REFUSED_BUDGET";
    this.reason = "budget-exceeded";
    this.limit = limit;
    this.actual = actual;
  }
}

export const SCHEMA_VERSION_V2 = "0.2";

// Status enum — matches docs/rollback-contracts.md §4.
export const OPERATION_STATUSES = Object.freeze([
  "planned",
  "snapshot_taken",
  "applied",
  "verified",
  "rolled_back",
  "aborted"
]);

// Terminal statuses: housekeeper.interrupted_operation does NOT fire for these.
export const TERMINAL_STATUSES = Object.freeze(["verified", "rolled_back", "aborted"]);

/**
 * makeFileSnapshot(opts) — one entry in the manifest files[] array.
 *
 * Required fields: seq, originalPath, snapshotPath, sha256Before, mode, size,
 *   isSymlink, symlinkTarget.
 * Optional fields: sha256After, verifyFailure, rollbackSkipped.
 */
export function makeFileSnapshot(opts = {}) {
  return {
    seq: typeof opts.seq === "number" ? opts.seq : 0,
    originalPath: opts.originalPath || "",
    snapshotPath: opts.snapshotPath || "",
    sha256Before: opts.sha256Before || "",
    sha256After: opts.sha256After !== undefined ? opts.sha256After : null,
    mode: opts.mode || "0644",
    size: typeof opts.size === "number" ? opts.size : 0,
    isSymlink: Boolean(opts.isSymlink),
    symlinkTarget:
      opts.symlinkTarget !== undefined ? opts.symlinkTarget : null,
    verifyFailure: Boolean(opts.verifyFailure),
    rollbackSkipped: Boolean(opts.rollbackSkipped)
  };
}

/**
 * makeRollbackPlan(opts) — summary of what rollback will do for an operation.
 *
 * This object is informational: produced before rollback executes so the user
 * can confirm. It does NOT drive the rollback itself.
 */
export function makeRollbackPlan(opts = {}) {
  return {
    operationId: opts.operationId || "",
    filesToRestore: Array.isArray(opts.filesToRestore)
      ? opts.filesToRestore.map((f) => ({ ...f }))
      : [],
    filesToSkip: Array.isArray(opts.filesToSkip)
      ? opts.filesToSkip.map((f) => ({ ...f }))
      : [],
    estimatedRisk: opts.estimatedRisk || "low",
    requiresConfirmation: Boolean(opts.requiresConfirmation)
  };
}

/**
 * makeOperationManifest(opts) — the top-level operation manifest.
 *
 * Matches the schema in docs/rollback-contracts.md §3.
 * Invalid or unrecognised status values are coerced to "planned".
 */
export function makeOperationManifest(opts = {}) {
  const status = OPERATION_STATUSES.includes(opts.status)
    ? opts.status
    : "planned";

  return {
    schemaVersion: SCHEMA_VERSION_V2,
    id: opts.id || "",
    home: opts.home || "",
    status,
    createdAt: opts.createdAt || new Date(0).toISOString(),
    capturedAt: opts.capturedAt || new Date(0).toISOString(),
    appliedAt: opts.appliedAt !== undefined ? opts.appliedAt : null,
    verifiedAt: opts.verifiedAt !== undefined ? opts.verifiedAt : null,
    rolledBackAt: opts.rolledBackAt !== undefined ? opts.rolledBackAt : null,
    abortedAt: opts.abortedAt !== undefined ? opts.abortedAt : null,
    housekeeperVersion: opts.housekeeperVersion || "0.2.0",
    command: opts.command || "clean",
    mode: opts.mode || "dry-run",
    consentSummary: opts.consentSummary || "",
    files: Array.isArray(opts.files)
      ? opts.files.map((f) => makeFileSnapshot(f))
      : [],
    partialApply: Boolean(opts.partialApply),
    blockedByProtection: Array.isArray(opts.blockedByProtection)
      ? [...opts.blockedByProtection]
      : []
  };
}

// ── I/O helpers ─────────────────────────────────────────────────────────────

/**
 * generateOpId() — returns a new operation id in the format:
 *   op_<YYYYMMDDHHMMSS>_<8hex>
 * Per docs/rollback-contracts.md §1.
 */
export function generateOpId() {
  const now = new Date();
  const pad = (n, w) => String(n).padStart(w, "0");
  const ts =
    pad(now.getUTCFullYear(), 4) +
    pad(now.getUTCMonth() + 1, 2) +
    pad(now.getUTCDate(), 2) +
    pad(now.getUTCHours(), 2) +
    pad(now.getUTCMinutes(), 2) +
    pad(now.getUTCSeconds(), 2);
  const hex = randomBytes(4).toString("hex");
  return `op_${ts}_${hex}`;
}

/**
 * hashFile(filePath) — sha256 hex digest of file bytes.
 * For symlinks, hashes the symlink target string (not dereferenced content).
 * Returns a 64-char lowercase hex string.
 */
export async function hashFile(filePath) {
  const lstats = await lstat(filePath);
  let buf;
  if (lstats.isSymbolicLink()) {
    const target = await readlink(filePath);
    buf = Buffer.from(target, "utf8");
  } else {
    buf = await readFile(filePath);
  }
  return createHash("sha256").update(buf).digest("hex");
}

/**
 * atomicWrite(destPath, content) — write-temp + rename + fsync-parent.
 * Implements the atomic protocol from docs/snapshot-architecture.md §4:
 *   1. Write to <dest>.tmp.<random> (same directory)
 *   2. fsync the tmp file
 *   3. rename tmp → dest (atomic on POSIX)
 *   4. fsync parent directory (ensures rename is durable)
 *
 * content may be a Buffer or string.
 * On failure, unlinks the tmp file before rethrowing.
 */
export async function atomicWrite(destPath, content) {
  const dir = destPath.slice(0, destPath.lastIndexOf("/"));
  const tmpPath = `${destPath}.tmp.${randomBytes(4).toString("hex")}`;
  let fh;
  try {
    fh = await open(tmpPath, "w");
    await fh.writeFile(content);
    await fh.sync();
    await fh.close();
    fh = null;
    await rename(tmpPath, destPath);
  } catch (err) {
    if (fh) {
      try { await fh.close(); } catch { /* ignore */ }
    }
    try { await unlink(tmpPath); } catch { /* ignore */ }
    throw err;
  }
  // fsync parent directory to ensure the rename is durable.
  let dirFh;
  try {
    dirFh = await open(dir, "r");
    await dirFh.sync();
    await dirFh.close();
  } catch {
    // fsync on a directory is not supported on all platforms (notably macOS
    // returns EINVAL). Treat failure as a no-op — the rename is already
    // durable on local APFS/HFS+ and ext4 with ordered data mode.
  }
}

/**
 * takeSnapshot(home, opts) — snapshot writer entry point.
 *
 * Implements the full atomic snapshot flow from docs/snapshot-architecture.md §4:
 *   - For each target file: hash, write snapshot copy via atomicWrite
 *   - Write meta.json inside the snapshot dir
 *   - Write operation manifest to operations/<op_id>.json LAST
 *     (its presence signals a complete snapshot)
 *
 * opts.targets  — array of absolute paths to snapshot (required)
 * opts.command  — "clean" | "rollback" | "harden" (default "clean")
 * opts.mode     — "confirm" | "dry-run" (default "confirm")
 * opts.consentSummary — human-readable consent record (default "")
 * opts.housekeeperVersion — semver string (default "0.2.0")
 *
 * Returns { opId, manifest } on success.
 * Throws on any I/O failure; no manifest is written on error.
 *
 * TODO: T-602 protected path check (before any I/O)
 * TODO: T-603 budget enforcement (maxSnapshotFiles=50, maxSnapshotBytes=10MB)
 */
export async function takeSnapshot(home, opts = {}) {
  const targets = Array.isArray(opts.targets) ? opts.targets : [];
  const command = opts.command || "clean";
  const mode = opts.mode || "confirm";
  const consentSummary = opts.consentSummary || "";
  const housekeeperVersion = opts.housekeeperVersion || "0.2.0";

  // T-603 budget enforcement — checked FIRST (cheaper; avoids policy I/O on
  // oversized requests). File count is O(1); byte sum requires stat() per file.
  if (targets.length > MAX_OPERATION_FILES) {
    // Count-only refusal: skip byte sum — file count already exceeds limit.
    throw new SnapshotBudgetError(
      { files: MAX_OPERATION_FILES, bytes: MAX_OPERATION_BYTES },
      { files: targets.length, bytes: 0 }
    );
  }
  let totalBytes = 0;
  for (const t of targets) {
    const s = await stat(t);
    totalBytes += s.size;
  }
  if (totalBytes > MAX_OPERATION_BYTES) {
    throw new SnapshotBudgetError(
      { files: MAX_OPERATION_FILES, bytes: MAX_OPERATION_BYTES },
      { files: targets.length, bytes: totalBytes }
    );
  }

  // T-602 protected-path check — checked AFTER budget (protection policy load
  // requires config I/O; budget is pure arithmetic). Hard boundary: cannot be
  // overridden by any caller flag per docs/snapshot-architecture.md §7.
  const { rules } = loadConfig(home);
  const blocked = [];
  for (const target of targets) {
    for (const rule of rules) {
      if (rule.path && pathMatchesProtection(rule.path, target, home)) {
        blocked.push({ path: target, rule: rule.path, reason: rule.reason });
        break; // one match per target is sufficient
      }
    }
  }
  if (blocked.length > 0) {
    throw new SnapshotRefusedError(blocked);
  }

  const opId = generateOpId();
  const snapshotDir = join(home, ".claude", "housekeeper", "snapshots", opId);
  const filesDir = join(snapshotDir, "files");
  const operationsDir = join(home, ".claude", "housekeeper", "operations");
  const manifestPath = join(operationsDir, `${opId}.json`);

  // Create snapshot directory structure.
  await mkdir(filesDir, { recursive: true });
  await mkdir(operationsDir, { recursive: true });

  const now = new Date().toISOString();
  const fileEntries = [];

  for (let i = 0; i < targets.length; i++) {
    const origPath = targets[i];
    const lstats = await lstat(origPath);
    const isSymlink = lstats.isSymbolicLink();
    const symlinkTarget = isSymlink ? await readlink(origPath) : null;

    // Read content for snapshot copy.
    let content;
    if (isSymlink) {
      // For symlinks: store the target string as the snapshot content.
      content = Buffer.from(symlinkTarget, "utf8");
    } else {
      content = await readFile(origPath);
    }

    const sha256Before = createHash("sha256").update(content).digest("hex");
    const seq = i;
    const seqStr = String(seq).padStart(4, "0");
    const snapshotFileName = `${seqStr}_${basename(origPath)}`;
    const snapshotFilePath = join(filesDir, snapshotFileName);

    // Atomic write of snapshot file copy.
    await atomicWrite(snapshotFilePath, content);

    // Mode bits as octal string e.g. "0644".
    const modeBits = (lstats.mode & 0o7777).toString(8).padStart(4, "0");

    fileEntries.push(
      makeFileSnapshot({
        seq,
        originalPath: origPath,
        snapshotPath: snapshotFilePath,
        sha256Before,
        sha256After: null,
        mode: modeBits,
        size: lstats.size,
        isSymlink,
        symlinkTarget
      })
    );
  }

  // Write meta.json inside the snapshot dir (before the operation manifest).
  const meta = {
    operationId: opId,
    housekeeperVersion,
    capturedAt: now
  };
  await atomicWrite(join(snapshotDir, "meta.json"), JSON.stringify(meta, null, 2) + os.EOL);

  // Build and write the operation manifest LAST — its presence signals
  // that all snapshot files are complete and durable.
  const manifest = makeOperationManifest({
    id: opId,
    home,
    status: "snapshot_taken",
    createdAt: now,
    capturedAt: now,
    housekeeperVersion,
    command,
    mode,
    consentSummary,
    files: fileEntries
  });

  await atomicWrite(manifestPath, JSON.stringify(manifest, null, 2) + os.EOL);

  return { opId, manifest };
}

// ── v0.2 I/O functions — T-604, T-702, T-703 ─────────────────────────────────

/**
 * Thrown by applyOperation when the manifest is not in the expected status.
 * Prevents invalid state machine transitions.
 */
export class OperationStateError extends Error {
  constructor(id, expected, actual) {
    super(`Operation ${id}: expected status '${expected}', got '${actual}'`);
    this.name = "OperationStateError";
    this.code = "OPERATION_STATE_ERROR";
    this.operationId = id;
    this.expected = expected;
    this.actual = actual;
  }
}

/**
 * Thrown by applyOperation when a file's sha256 no longer matches sha256Before.
 * Means the file was mutated between snapshot and apply; no mutation proceeds.
 */
export class SnapshotDriftError extends Error {
  constructor(filePath, expected, actual) {
    super(`File changed since snapshot was taken: ${filePath}`);
    this.name = "SnapshotDriftError";
    this.code = "SNAPSHOT_DRIFT";
    this.filePath = filePath;
    this.expected = expected;
    this.actual = actual;
  }
}

/**
 * readManifest(home, id) — read and parse an operation manifest from disk.
 * Returns the parsed manifest object. Throws on I/O or JSON parse error.
 */
async function readManifest(home, id) {
  const manifestPath = join(home, ".claude", "housekeeper", "operations", `${id}.json`);
  const raw = await readFile(manifestPath, "utf8");
  return JSON.parse(raw);
}

/**
 * gcSnapshots(home) — Garbage-collect terminal operation manifests and their
 * snapshot directories. Keeps the most recent 10 terminal operations
 * (status in {"verified", "rolled_back"}). Removes older ones.
 *
 * Per Q4 decision: GC MUST NOT be called from diagnose. Call only from
 * clean/rollback paths before taking a new snapshot.
 *
 * Returns { removed: [...op_ids], kept: [...op_ids] }.
 */
export async function gcSnapshots(home) {
  const operationsDir = join(home, ".claude", "housekeeper", "operations");

  // Read all manifest files; ignore directory if absent.
  let entries;
  try {
    entries = await readdir(operationsDir);
  } catch {
    return { removed: [], kept: [] };
  }

  const jsonEntries = entries.filter((e) => e.endsWith(".json"));

  // Parse each manifest; skip unreadable files gracefully.
  const manifests = [];
  for (const filename of jsonEntries) {
    const id = filename.slice(0, -5); // strip ".json"
    try {
      const raw = await readFile(join(operationsDir, filename), "utf8");
      const manifest = JSON.parse(raw);
      manifests.push({ id, manifest });
    } catch {
      // Unreadable or corrupt manifest — leave for the interrupted-op detector.
    }
  }

  // Separate terminal from non-terminal. Only terminal ones are GC candidates.
  const GC_TERMINAL = new Set(["verified", "rolled_back"]);
  const terminal = manifests.filter((m) => GC_TERMINAL.has(m.manifest.status));
  const nonTerminal = manifests.filter((m) => !GC_TERMINAL.has(m.manifest.status));

  // Sort terminal manifests chronologically by op id (timestamp prefix gives order).
  terminal.sort((a, b) => {
    if (a.id < b.id) return -1;
    if (a.id > b.id) return 1;
    return 0;
  });

  // Keep the most recent 10; remove anything older.
  const KEEP_COUNT = 10;
  const toKeep = terminal.slice(-KEEP_COUNT);
  const toRemove = terminal.slice(0, terminal.length - KEEP_COUNT);

  const removed = [];
  for (const { id } of toRemove) {
    // Delete snapshot directory recursively.
    const snapshotDir = join(home, ".claude", "housekeeper", "snapshots", id);
    try {
      await rm(snapshotDir, { recursive: true, force: true });
    } catch {
      // Directory may not exist if snapshot write failed; ignore.
    }
    // Delete the manifest file.
    try {
      await unlink(join(operationsDir, `${id}.json`));
    } catch {
      // Already gone; ignore.
    }
    removed.push(id);
  }

  const kept = [
    ...nonTerminal.map((m) => m.id),
    ...toKeep.map((m) => m.id)
  ];

  return { removed, kept };
}

/**
 * applyOperation(id, home, ops) — apply caller-provided mutation functions to
 * each snapshotted file and record sha256After in the manifest.
 *
 * Pre-condition: manifest.status === "snapshot_taken". Throws OperationStateError
 * otherwise.
 *
 * Pre-apply drift check: re-hashes each file before calling ops[i].apply(). If
 * the hash no longer matches sha256Before, throws SnapshotDriftError and halts
 * without mutating any file.
 *
 * Per-file failure: if ops[i].apply() throws, sets partialApply: true on the
 * manifest and marks that file's applied: false. Continues with remaining files.
 * Per Q5 decision: does NOT trigger rollback — that is deferred to T-704.
 *
 * Status transitions snapshot_taken → applied on completion.
 *
 * Returns the updated manifest object.
 */
export async function applyOperation(id, home, ops) {
  const manifest = await readManifest(home, id);

  if (manifest.status !== "snapshot_taken") {
    throw new OperationStateError(id, "snapshot_taken", manifest.status);
  }

  // Pre-apply drift check: verify all files before mutating any.
  // Per docs/snapshot-architecture.md §5: abort if any file changed.
  for (let i = 0; i < manifest.files.length; i++) {
    const entry = manifest.files[i];
    const currentHash = await hashFile(entry.originalPath);
    if (currentHash !== entry.sha256Before) {
      throw new SnapshotDriftError(entry.originalPath, entry.sha256Before, currentHash);
    }
  }

  // Apply mutations file by file, tolerating per-file failures.
  let hadFailure = false;
  for (let i = 0; i < manifest.files.length; i++) {
    const entry = manifest.files[i];
    try {
      await ops[i].apply(entry.originalPath);
      // If the path no longer exists after apply, this was an intended deletion.
      // Leave sha256After = null to signal deletion; do not call hashFile.
      if (existsSync(entry.originalPath)) {
        entry.sha256After = await hashFile(entry.originalPath);
      } else {
        entry.sha256After = null;
      }
      entry.applied = true;
    } catch {
      hadFailure = true;
      manifest.partialApply = true;
      entry.applied = false;
    }
  }

  // Suppress unused-variable warning — hadFailure drives partialApply already set above.
  void hadFailure;

  manifest.status = "applied";
  manifest.appliedAt = new Date().toISOString();

  const manifestPath = join(home, ".claude", "housekeeper", "operations", `${id}.json`);
  await atomicWrite(manifestPath, JSON.stringify(manifest, null, 2) + os.EOL);

  return manifest;
}

/**
 * verify(id, home) — verify that each applied file's current sha256 matches
 * sha256After recorded in the manifest.
 *
 * Pre-condition: manifest.status === "applied". Throws OperationStateError otherwise.
 *
 * On all-match: transitions status to "verified" and writes the manifest.
 * On any mismatch: sets verifyFailure: true on the affected file entries;
 *   status remains "applied" (surfaces via interrupted_operation detector).
 *
 * Returns the updated manifest object.
 */
export async function verify(id, home) {
  const manifest = await readManifest(home, id);

  if (manifest.status !== "applied") {
    throw new OperationStateError(id, "applied", manifest.status);
  }

  let allMatch = true;
  for (const entry of manifest.files) {
    if (entry.sha256After === null || entry.sha256After === undefined) {
      // Intended deletion: the file must no longer exist.
      if (existsSync(entry.originalPath)) {
        // Deletion silently failed — the file is still present.
        entry.verifyFailure = true;
        allMatch = false;
      }
      continue;
    }
    const actual = await hashFile(entry.originalPath);
    if (actual !== entry.sha256After) {
      entry.verifyFailure = true;
      allMatch = false;
    }
  }

  if (allMatch) {
    manifest.status = "verified";
    manifest.verifiedAt = new Date().toISOString();
  }

  const manifestPath = join(home, ".claude", "housekeeper", "operations", `${id}.json`);
  await atomicWrite(manifestPath, JSON.stringify(manifest, null, 2) + os.EOL);

  return manifest;
}

// ── MUTATION_REGISTRY — settings-rewrite (T-100..T-103) ─────────────────────
//
// Per docs/design/v0.3-design.md §3.1. The clean-plan.mjs MUTATION_REGISTRY is
// a *delete-only* registry (factory → { apply, args }); the v0.3 settings-rewrite
// kind needs a three-hook contract (preApply / apply / rollback), so it lives in
// its own registry here adjacent to atomicWrite + hashFile.
//
// Op shape (per design §3.1):
//   { kind: "settings-rewrite", targetPath: <abs path>, patch: <opaque> }
//
// The `patch` is opaque to this layer; the operator runs `applyPatch(parsed, patch)`
// which is exported so callers (and tests) can compose patches without depending
// on a specific patch DSL. v0.3 uses a minimal { op, path, value? } shape; the
// full patch DSL is TBD by Phase 3 detector promotion (T-300..T-302).

/**
 * PreApplyRefusal — structured refusal returned by preApply hooks.
 * Not thrown; callers inspect the returned object's `ok` field.
 * Matches the refusal-set pattern used by clean-plan.mjs CleanPlanRefusal.
 *
 * Reasons (per design §3.3):
 *   - "settings-jsonc-detected"     — comment tokens outside string context
 *   - "patch-produces-invalid-json" — patched object fails JSON round-trip
 *   - "patch-not-idempotent"        — apply-twice ≠ apply-once
 *   - "settings-shape-unknown"      — strict JSON.parse failed AND no JSONC comments
 */
export class PreApplyRefusal extends Error {
  constructor({ reason, targetPath, message }) {
    super(message || reason);
    this.name = "PreApplyRefusal";
    this.reason = reason;
    this.targetPath = targetPath || "";
    this.message = message || reason;
  }
}

/**
 * hasJsoncComments(source) — placeholder for the lex-aware tokenizer scan
 * (T-101, owned by Team 2 in audit.mjs). Until that helper lands, this stub
 * always returns false, so a JSON.parse SyntaxError will surface as
 * `settings-shape-unknown` rather than `settings-jsonc-detected`. The wiring
 * point stays explicit so Team 2's exported helper can drop in with a single
 * import swap.
 *
 * TODO(T-101): replace with import from audit.mjs.
 */
function hasJsoncComments(_source) {
  return false;
}

/**
 * applyPatch(obj, patch) — minimal patch DSL for v0.3.
 * Pure function: returns a NEW object, never mutates `obj`.
 *
 * Supported ops (closed enum for v0.3):
 *   { op: "remove", path: [...keys] }    — delete a nested key/index; missing is no-op (→ idempotent)
 *   { op: "set",    path: [...keys], value: <json> } — set a nested key (→ idempotent)
 *   { op: "append", path: [...keys], value: <json> } — push to an array (→ NON-idempotent; for tests)
 *
 * Returns a deep-cloned object with the patch applied. Throws TypeError on
 * unknown op kinds. The deep clone uses structuredClone, which preserves
 * arrays/objects/primitives — sufficient for settings.json values.
 */
export function applyPatch(obj, patch) {
  if (!patch || typeof patch !== "object") {
    throw new TypeError("applyPatch: patch must be an object");
  }
  const next = structuredClone(obj);
  const segs = Array.isArray(patch.path) ? patch.path : [];

  if (patch.op === "remove") {
    if (segs.length === 0) return next;
    let cursor = next;
    for (let i = 0; i < segs.length - 1; i++) {
      if (cursor == null || typeof cursor !== "object") return next;
      cursor = cursor[segs[i]];
    }
    if (cursor == null || typeof cursor !== "object") return next;
    const last = segs[segs.length - 1];
    if (Array.isArray(cursor) && typeof last === "number") {
      if (last >= 0 && last < cursor.length) cursor.splice(last, 1);
    } else if (Object.prototype.hasOwnProperty.call(cursor, last)) {
      delete cursor[last];
    }
    return next;
  }

  if (patch.op === "set") {
    if (segs.length === 0) {
      // Replace root only for object values; otherwise return new object as-is.
      return patch.value;
    }
    let cursor = next;
    for (let i = 0; i < segs.length - 1; i++) {
      const key = segs[i];
      if (cursor[key] == null || typeof cursor[key] !== "object") {
        cursor[key] = {};
      }
      cursor = cursor[key];
    }
    cursor[segs[segs.length - 1]] = structuredClone(patch.value);
    return next;
  }

  if (patch.op === "append") {
    let cursor = next;
    for (const key of segs) {
      if (cursor == null || typeof cursor !== "object") {
        throw new TypeError(`applyPatch append: path ${segs.join(".")} not navigable`);
      }
      cursor = cursor[key];
    }
    if (!Array.isArray(cursor)) {
      throw new TypeError(`applyPatch append: target at ${segs.join(".")} is not an array`);
    }
    cursor.push(structuredClone(patch.value));
    return next;
  }

  throw new TypeError(`applyPatch: unknown op "${patch.op}"`);
}

/**
 * deepEqual(a, b) — structural equality via JSON canonicalisation. Sufficient
 * for the patched-twice idempotency check: both sides went through JSON.parse +
 * applyPatch, so neither contains Dates, RegExps, or other non-JSON values.
 */
function deepEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * MUTATION_REGISTRY — settings-rewrite contract for v0.3 harden pipeline.
 * Per docs/design/v0.3-design.md §3.1.
 *
 * Each registered kind is an object with three async hooks:
 *   preApply(op) → { ok: true, plannedBytes } | PreApplyRefusal
 *   apply(op)    → { content: <new bytes> }
 *   rollback(op, snapshotEntry) → void (copyFile snapshot → target)
 *
 * The hooks are deterministic and stateless: they take the operation payload
 * plus (for rollback) the matching snapshot entry, and return a value or refusal.
 * No global state, no fs mutations outside the documented paths.
 */
export const MUTATION_REGISTRY = Object.freeze({
  "settings-rewrite": Object.freeze({
    /**
     * preApply — runs BEFORE takeSnapshot. Five steps per design §3.1:
     *   1. Strict JSON.parse the file at op.targetPath
     *   2. On SyntaxError, run JSONC tokenizer; emit `settings-jsonc-detected`
     *      if comments found, else `settings-shape-unknown`
     *   3. Apply op.patch in-memory → result
     *   4. JSON.stringify(result) and JSON.parse the output (round-trip).
     *      On failure: `patch-produces-invalid-json`
     *   5. Apply patch again to `result` → result2.
     *      If !deepEqual(result, result2): `patch-not-idempotent`
     *   Return { ok: true, plannedBytes: <bytes after step 4> }
     */
    preApply: async (op) => {
      const source = await readFile(op.targetPath, "utf8");

      let parsed;
      try {
        parsed = JSON.parse(source);
      } catch {
        const reason = hasJsoncComments(source)
          ? "settings-jsonc-detected"
          : "settings-shape-unknown";
        return new PreApplyRefusal({ reason, targetPath: op.targetPath });
      }

      let firstApply;
      try {
        firstApply = applyPatch(parsed, op.patch);
      } catch (err) {
        return new PreApplyRefusal({
          reason: "patch-produces-invalid-json",
          targetPath: op.targetPath,
          message: `Patch threw during application: ${err.message}`
        });
      }

      // JSON round-trip — catches non-serialisable values (Infinity, NaN,
      // undefined, functions, symbols, circular refs).
      let plannedSource;
      try {
        plannedSource = JSON.stringify(firstApply, null, 2);
        if (plannedSource === undefined) {
          throw new TypeError("Patch result is not JSON-serialisable");
        }
        JSON.parse(plannedSource);
      } catch (err) {
        return new PreApplyRefusal({
          reason: "patch-produces-invalid-json",
          targetPath: op.targetPath,
          message: err.message
        });
      }

      // Idempotency: apply twice in-memory; the second application against
      // the already-patched object must yield an identical result.
      let secondApply;
      try {
        secondApply = applyPatch(firstApply, op.patch);
      } catch (err) {
        return new PreApplyRefusal({
          reason: "patch-not-idempotent",
          targetPath: op.targetPath,
          message: `Second apply threw: ${err.message}`
        });
      }
      if (!deepEqual(firstApply, secondApply)) {
        return new PreApplyRefusal({
          reason: "patch-not-idempotent",
          targetPath: op.targetPath
        });
      }

      return { ok: true, plannedBytes: Buffer.byteLength(plannedSource, "utf8") };
    },

    /**
     * apply — read original → parse → applyPatch → JSON.stringify → atomicWrite.
     * Returns { content } so the caller can compute sha256After.
     *
     * Re-reads + re-parses on every call so this is safe to invoke after a
     * snapshot in the canonical sequence: preApply → snapshot → apply → verify.
     * If preApply already passed, parse will not throw here barring concurrent
     * mutation (which the upstream drift check in applyOperation catches).
     */
    apply: async (op) => {
      const source = await readFile(op.targetPath, "utf8");
      const parsed = JSON.parse(source);
      const result = applyPatch(parsed, op.patch);
      const out = JSON.stringify(result, null, 2) + os.EOL;
      await atomicWrite(op.targetPath, out);
      return { content: out };
    },

    /**
     * rollback — identical to the file-restore-from-snapshot rollback path in
     * scripts/lib/rollback-plan.mjs: copy the snapshot file back onto the
     * target. Idempotent under repeated invocation; the snapshot tree is
     * read-only after takeSnapshot returns.
     *
     * `snapshotEntry` is the matching makeFileSnapshot entry from the manifest;
     * carries snapshotPath which is the absolute source for the restore.
     */
    rollback: async (op, snapshotEntry) => {
      await mkdir(dirname(op.targetPath), { recursive: true });
      await copyFile(snapshotEntry.snapshotPath, op.targetPath);
    }
  })
});
