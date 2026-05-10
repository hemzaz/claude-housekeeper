// T-409 — Self-failure read-only degradation tests.
//
// docs/operational-readiness.md §4 ("read-only mode must degrade around
// Housekeeper self-failure instead of crashing") + docs/state-governance.md
// §4 ("If Housekeeper state is corrupt: report it; block mutation depending
// on it; preserve corrupted file for manual review; do not overwrite").
//
// Tests use synthetic temporary directories to avoid mutating fixtures.
// Cleanup uses os.tmpdir + Date.now to keep each run isolated and avoid
// touching anything outside the system temp tree.

import assert from "node:assert/strict";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  rmSync,
  writeFileSync
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { assembleReport } from "../scripts/lib/audit.mjs";

// Each test writes to its own temp directory under os.tmpdir(). These writes
// are inside the test runner's sandbox; no source-tree fixture is mutated.
function makeTempHome(label) {
  const dir = path.join(
    os.tmpdir(),
    `housekeeper-self-failure-${label}-${process.pid}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`
  );
  mkdirSync(dir, { recursive: true });
  return dir;
}

function cleanup(dir) {
  try {
    // Restore permissions on any chmod-ed subtree before removal so rmSync
    // does not fail to descend.
    try { chmodSync(dir, 0o755); } catch { /* nothing */ }
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // best-effort cleanup; the OS will reclaim eventually
  }
}

// ---------- malformed config ----------

test("self-failure: malformed Housekeeper config emits inform finding and continues", () => {
  const home = makeTempHome("config-invalid");
  try {
    const hkDir = path.join(home, "housekeeper");
    mkdirSync(hkDir, { recursive: true });
    // Write deliberately malformed JSON.
    writeFileSync(path.join(hkDir, "config.json"), "{ this is not valid json", "utf8");
    // Add a settings.json so other detectors have something to look at.
    writeFileSync(path.join(home, "settings.json"), "{}", "utf8");

    const report = assembleReport(home, { mode: "diagnose" });

    // The config_invalid finding must be present with stance `inform`.
    const f = report.findings.find((x) => x.id === "housekeeper.config_invalid");
    assert.ok(
      f,
      `expected housekeeper.config_invalid finding; got: ${report.findings.map((x) => x.id).join(", ")}`
    );
    assert.equal(f.stance, "inform", "stance must be inform");
    assert.equal(f.class, "orientation", "class must be orientation");

    // Audit must NOT have crashed: report shape is intact.
    assert.equal(report.filesChanged, false);
    assert.equal(report.mode, "diagnose");
    assert.ok(Array.isArray(report.findings));
  } finally {
    cleanup(home);
  }
});

// ---------- home not found ----------

test("self-failure: missing home returns home.not_found block finding", () => {
  // Build a path that we KNOW does not exist by appending a unique segment.
  const missing = path.join(
    os.tmpdir(),
    `housekeeper-no-such-home-${process.pid}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`
  );
  assert.ok(!existsSync(missing), "precondition: path must not exist");

  const report = assembleReport(missing, { mode: "diagnose" });

  const f = report.findings.find((x) => x.id === "home.not_found");
  assert.ok(
    f,
    `expected home.not_found finding; got: ${report.findings.map((x) => x.id).join(", ")}`
  );
  assert.equal(f.stance, "block", "stance must be block");

  // Dependent inference is stopped: only the home.not_found finding should appear.
  assert.equal(report.findings.length, 1, "no dependent findings should run");
  assert.equal(report.stanceSummary.block, 1);
  assert.equal(report.primary, "home.not_found");
});

// ---------- operations dir unreadable ----------

test(
  "self-failure: unreadable operations dir produces inform finding and degraded entry",
  { skip: process.platform === "win32" ? "chmod 000 not honored on Windows" : false },
  () => {
    // chmod 0 only takes effect when not running as root.
    if (process.getuid && process.getuid() === 0) {
      return; // skip when uid 0 — root bypasses the deny
    }

    const home = makeTempHome("operations-unreadable");
    try {
      const opsDir = path.join(home, "housekeeper", "operations");
      mkdirSync(opsDir, { recursive: true });
      // Place a manifest inside so a successful read would normally produce a finding.
      writeFileSync(
        path.join(opsDir, "op_001.json"),
        JSON.stringify({ status: "applying" }),
        "utf8"
      );

      // Add a settings.json so the rest of the audit has something to chew on.
      writeFileSync(path.join(home, "settings.json"), "{}", "utf8");

      chmodSync(opsDir, 0o000);

      const report = assembleReport(home, { mode: "diagnose" });

      const unreadable = report.findings.find((x) => x.id === "housekeeper.operations_unreadable");
      assert.ok(
        unreadable,
        `expected housekeeper.operations_unreadable finding; got: ${report.findings.map((x) => x.id).join(", ")}`
      );
      assert.equal(unreadable.stance, "inform");

      // The interrupted_operation detector must NOT have run (degraded behavior).
      const interrupted = report.findings.find((x) => x.id === "housekeeper.interrupted_operation");
      assert.equal(
        interrupted,
        undefined,
        "interrupted_operation detector must skip when ops dir is unreadable"
      );

      // The report's degraded[] array must contain the operations-unreadable entry.
      const degradedEntry = (report.degraded || []).find((d) => d?.reason === "operations-unreadable");
      assert.ok(degradedEntry, "expected degraded entry for operations-unreadable");
    } finally {
      cleanup(home);
    }
  }
);
