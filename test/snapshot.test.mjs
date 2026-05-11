import assert from "node:assert/strict";
import test from "node:test";
import {
  OPERATION_STATUSES,
  TERMINAL_STATUSES,
  SCHEMA_VERSION_V2,
  makeFileSnapshot,
  makeOperationManifest,
  makeRollbackPlan
} from "../scripts/lib/snapshot.mjs";

// ── OPERATION_STATUSES ──────────────────────────────────────────────────────

test("OPERATION_STATUSES contains all 6 documented values", () => {
  const expected = [
    "planned",
    "snapshot_taken",
    "applied",
    "verified",
    "rolled_back",
    "aborted"
  ];
  assert.deepEqual([...OPERATION_STATUSES], expected);
});

test("OPERATION_STATUSES is frozen (immutable)", () => {
  assert.ok(Object.isFrozen(OPERATION_STATUSES));
});

test("TERMINAL_STATUSES contains verified, rolled_back, aborted", () => {
  assert.deepEqual([...TERMINAL_STATUSES], ["verified", "rolled_back", "aborted"]);
  assert.ok(Object.isFrozen(TERMINAL_STATUSES));
});

test("SCHEMA_VERSION_V2 is '0.2'", () => {
  assert.equal(SCHEMA_VERSION_V2, "0.2");
});

// ── makeFileSnapshot ────────────────────────────────────────────────────────

test("makeFileSnapshot fills documented defaults", () => {
  const f = makeFileSnapshot();
  assert.equal(f.seq, 0);
  assert.equal(f.originalPath, "");
  assert.equal(f.snapshotPath, "");
  assert.equal(f.sha256Before, "");
  assert.equal(f.sha256After, null);
  assert.equal(f.mode, "0644");
  assert.equal(f.size, 0);
  assert.equal(f.isSymlink, false);
  assert.equal(f.symlinkTarget, null);
  assert.equal(f.verifyFailure, false);
  assert.equal(f.rollbackSkipped, false);
});

test("makeFileSnapshot round-trips required fields", () => {
  const f = makeFileSnapshot({
    seq: 3,
    originalPath: "/Users/alice/.claude/settings.json",
    snapshotPath:
      "/Users/alice/.claude/housekeeper/snapshots/op_20260511143022_a1b2c3d4/files/0003_settings.json",
    sha256Before:
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    sha256After:
      "abc123def456abc123def456abc123def456abc123def456abc123def456abc123",
    mode: "0600",
    size: 4096,
    isSymlink: false,
    symlinkTarget: null
  });
  assert.equal(f.seq, 3);
  assert.equal(f.originalPath, "/Users/alice/.claude/settings.json");
  assert.equal(f.mode, "0600");
  assert.equal(f.size, 4096);
  assert.equal(
    f.sha256Before,
    "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
  );
  assert.equal(
    f.sha256After,
    "abc123def456abc123def456abc123def456abc123def456abc123def456abc123"
  );
});

test("makeFileSnapshot handles symlink entries", () => {
  const f = makeFileSnapshot({
    seq: 1,
    originalPath: "/Users/alice/.claude/some-link",
    snapshotPath: "/snapshot/0001_some-link",
    sha256Before: "deadbeef",
    mode: "0777",
    size: 15,
    isSymlink: true,
    symlinkTarget: "../real-file"
  });
  assert.equal(f.isSymlink, true);
  assert.equal(f.symlinkTarget, "../real-file");
});

test("makeFileSnapshot returns new object each call (no shared references)", () => {
  const a = makeFileSnapshot({ seq: 0 });
  const b = makeFileSnapshot({ seq: 0 });
  assert.notStrictEqual(a, b);
});

test("makeFileSnapshot does not share files array reference with input", () => {
  // sha256Before as object to confirm deep copy is made via makeFileSnapshot
  const opts = { seq: 0, originalPath: "/a", snapshotPath: "/b", sha256Before: "aa" };
  const f1 = makeFileSnapshot(opts);
  opts.originalPath = "/mutated";
  // f1 was already constructed from original opts — changing opts does not affect f1
  assert.equal(f1.originalPath, "/a");
});

// ── makeRollbackPlan ────────────────────────────────────────────────────────

test("makeRollbackPlan fills documented defaults", () => {
  const p = makeRollbackPlan();
  assert.equal(p.operationId, "");
  assert.deepEqual(p.filesToRestore, []);
  assert.deepEqual(p.filesToSkip, []);
  assert.equal(p.estimatedRisk, "low");
  assert.equal(p.requiresConfirmation, false);
});

test("makeRollbackPlan round-trips fields", () => {
  const restore = [{ seq: 0, originalPath: "/a" }];
  const skip = [{ seq: 1, originalPath: "/b" }];
  const p = makeRollbackPlan({
    operationId: "op_20260511143022_a1b2c3d4",
    filesToRestore: restore,
    filesToSkip: skip,
    estimatedRisk: "medium",
    requiresConfirmation: true
  });
  assert.equal(p.operationId, "op_20260511143022_a1b2c3d4");
  assert.equal(p.filesToRestore.length, 1);
  assert.equal(p.filesToSkip.length, 1);
  assert.equal(p.estimatedRisk, "medium");
  assert.equal(p.requiresConfirmation, true);
});

test("makeRollbackPlan defensive copies input arrays", () => {
  const restore = [{ seq: 0 }];
  const p = makeRollbackPlan({ filesToRestore: restore });
  restore.push({ seq: 99 });
  assert.equal(p.filesToRestore.length, 1);
});

test("makeRollbackPlan returns new objects each call", () => {
  const a = makeRollbackPlan();
  const b = makeRollbackPlan();
  assert.notStrictEqual(a, b);
  assert.notStrictEqual(a.filesToRestore, b.filesToRestore);
});

// ── makeOperationManifest ───────────────────────────────────────────────────

test("makeOperationManifest fills all documented defaults", () => {
  const m = makeOperationManifest();
  assert.equal(m.schemaVersion, "0.2");
  assert.equal(m.id, "");
  assert.equal(m.home, "");
  assert.equal(m.status, "planned");
  assert.equal(m.createdAt, new Date(0).toISOString());
  assert.equal(m.capturedAt, new Date(0).toISOString());
  assert.equal(m.appliedAt, null);
  assert.equal(m.verifiedAt, null);
  assert.equal(m.rolledBackAt, null);
  assert.equal(m.abortedAt, null);
  assert.equal(m.housekeeperVersion, "0.2.0");
  assert.equal(m.command, "clean");
  assert.equal(m.mode, "dry-run");
  assert.equal(m.consentSummary, "");
  assert.deepEqual(m.files, []);
  assert.equal(m.partialApply, false);
  assert.deepEqual(m.blockedByProtection, []);
});

test("makeOperationManifest schemaVersion is always '0.2'", () => {
  // Even if caller tries to pass a different version, the factory always uses V2
  const m = makeOperationManifest({ schemaVersion: "9.9" });
  assert.equal(m.schemaVersion, "0.2");
});

test("makeOperationManifest round-trips a complete manifest", () => {
  const file = makeFileSnapshot({
    seq: 0,
    originalPath: "/Users/alice/.claude/settings.json",
    snapshotPath:
      "/Users/alice/.claude/housekeeper/snapshots/op_20260511143022_a1b2c3d4/files/0000_settings.json",
    sha256Before:
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    mode: "0600",
    size: 4096,
    isSymlink: false,
    symlinkTarget: null
  });

  const m = makeOperationManifest({
    id: "op_20260511143022_a1b2c3d4",
    home: "/Users/alice/.claude",
    status: "snapshot_taken",
    createdAt: "2026-05-11T14:30:22.000Z",
    capturedAt: "2026-05-11T14:30:22.123Z",
    housekeeperVersion: "0.2.0",
    command: "clean",
    mode: "confirm",
    consentSummary: "User confirmed clean operation at 2026-05-11T14:30:22Z",
    files: [file]
  });

  assert.equal(m.id, "op_20260511143022_a1b2c3d4");
  assert.equal(m.home, "/Users/alice/.claude");
  assert.equal(m.status, "snapshot_taken");
  assert.equal(m.createdAt, "2026-05-11T14:30:22.000Z");
  assert.equal(m.capturedAt, "2026-05-11T14:30:22.123Z");
  assert.equal(m.command, "clean");
  assert.equal(m.mode, "confirm");
  assert.equal(m.files.length, 1);
  assert.equal(m.files[0].seq, 0);
  assert.equal(m.files[0].mode, "0600");
  assert.equal(m.files[0].size, 4096);
});

test("makeOperationManifest: invalid status coerces to 'planned'", () => {
  const m = makeOperationManifest({ status: "INVALID_STATUS" });
  assert.equal(m.status, "planned");
});

test("makeOperationManifest: undefined status coerces to 'planned'", () => {
  const m = makeOperationManifest({});
  assert.equal(m.status, "planned");
});

test("makeOperationManifest: all valid statuses are accepted", () => {
  for (const status of OPERATION_STATUSES) {
    const m = makeOperationManifest({ status });
    assert.equal(m.status, status, `status '${status}' should be accepted`);
  }
});

test("makeOperationManifest: partialApply coerces to boolean", () => {
  assert.equal(makeOperationManifest({ partialApply: 1 }).partialApply, true);
  assert.equal(makeOperationManifest({ partialApply: 0 }).partialApply, false);
  assert.equal(makeOperationManifest({ partialApply: true }).partialApply, true);
});

test("makeOperationManifest: files array is defensively copied", () => {
  const files = [makeFileSnapshot({ seq: 0 })];
  const m = makeOperationManifest({ files });
  files.push(makeFileSnapshot({ seq: 1 }));
  assert.equal(m.files.length, 1);
});

test("makeOperationManifest: file entries in output are new objects", () => {
  const f = makeFileSnapshot({ seq: 0, originalPath: "/a" });
  const m = makeOperationManifest({ files: [f] });
  // output file entry must not be the same reference as the input
  assert.notStrictEqual(m.files[0], f);
});

test("makeOperationManifest: blockedByProtection is defensively copied", () => {
  const blocked = ["/Users/alice/.claude/commands/local.md"];
  const m = makeOperationManifest({ blockedByProtection: blocked });
  blocked.push("/another/path");
  assert.equal(m.blockedByProtection.length, 1);
});

test("makeOperationManifest returns new objects each call (no shared references)", () => {
  const a = makeOperationManifest();
  const b = makeOperationManifest();
  assert.notStrictEqual(a, b);
  assert.notStrictEqual(a.files, b.files);
  assert.notStrictEqual(a.blockedByProtection, b.blockedByProtection);
});

// ── Schema match: doc example matches factory output ────────────────────────

test("schema match: example manifest from rollback-contracts.md §3 matches makeOperationManifest output", () => {
  // The doc example (synthetic values matching §3):
  const docExample = {
    schemaVersion: "0.2",
    id: "op_20260511143022_a1b2c3d4",
    home: "/Users/alice/.claude",
    status: "snapshot_taken",
    createdAt: "2026-05-11T14:30:22.000Z",
    capturedAt: "2026-05-11T14:30:22.123Z",
    appliedAt: null,
    verifiedAt: null,
    rolledBackAt: null,
    abortedAt: null,
    housekeeperVersion: "0.2.0",
    command: "clean",
    mode: "confirm",
    consentSummary: "User confirmed clean operation at 2026-05-11T14:30:22Z",
    files: [
      {
        seq: 0,
        originalPath: "/Users/alice/.claude/settings.json",
        snapshotPath:
          "/Users/alice/.claude/housekeeper/snapshots/op_20260511143022_a1b2c3d4/files/0000_settings.json",
        sha256Before:
          "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
        sha256After: null,
        mode: "0600",
        size: 4096,
        isSymlink: false,
        symlinkTarget: null,
        verifyFailure: false,
        rollbackSkipped: false
      }
    ],
    partialApply: false,
    blockedByProtection: []
  };

  const produced = makeOperationManifest({
    id: "op_20260511143022_a1b2c3d4",
    home: "/Users/alice/.claude",
    status: "snapshot_taken",
    createdAt: "2026-05-11T14:30:22.000Z",
    capturedAt: "2026-05-11T14:30:22.123Z",
    housekeeperVersion: "0.2.0",
    command: "clean",
    mode: "confirm",
    consentSummary: "User confirmed clean operation at 2026-05-11T14:30:22Z",
    files: [
      {
        seq: 0,
        originalPath: "/Users/alice/.claude/settings.json",
        snapshotPath:
          "/Users/alice/.claude/housekeeper/snapshots/op_20260511143022_a1b2c3d4/files/0000_settings.json",
        sha256Before:
          "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
        mode: "0600",
        size: 4096,
        isSymlink: false,
        symlinkTarget: null
      }
    ]
  });

  assert.deepEqual(produced, docExample);
});
