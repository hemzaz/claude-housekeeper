import assert from "node:assert/strict";
import test from "node:test";
import { decideStance } from "../scripts/lib/stance.mjs";
import {
  makeEvidenceSet,
  makePolicyMatch,
  makeSurfaceClassification
} from "../scripts/lib/contracts.mjs";

// ---------- Hard overrides (§5) ----------

test("override: do-not-touch policy → protect", () => {
  const policy = {
    matches: [makePolicyMatch({ type: "doNotTouch", reason: "personal local commands" })]
  };
  const s = decideStance({
    surface: makeSurfaceClassification({ surfaceClass: "authored-config", ownerClass: "user-owned" }),
    policy
  });
  assert.equal(s.stance, "protect");
  assert.match(s.why, /do-not-touch/);
  assert.equal(s.userDecisionNeeded, false);
});

test("override: secret-content sensitivity → protect", () => {
  const s = decideStance({
    surface: makeSurfaceClassification({
      surfaceClass: "secret-adjacent",
      ownerClass: "user-owned",
      sensitivityClass: "secret-content",
      scopeClass: "in-scope"
    })
  });
  assert.equal(s.stance, "protect");
  assert.equal(s.nextAllowedStep, "boundary-notice");
});

test("override: sector boundary → protect", () => {
  const s = decideStance({
    surface: makeSurfaceClassification({
      ownerClass: "user-owned",
      scopeClass: "sector-boundary"
    })
  });
  assert.equal(s.stance, "protect");
});

test("override: parent-contains-boundary → protect", () => {
  const s = decideStance({
    surface: makeSurfaceClassification({
      ownerClass: "user-owned",
      scopeClass: "parent-contains-boundary"
    })
  });
  assert.equal(s.stance, "protect");
});

test("override: out-of-scope → block", () => {
  const s = decideStance({
    surface: makeSurfaceClassification({
      ownerClass: "user-owned",
      scopeClass: "out-of-scope"
    })
  });
  assert.equal(s.stance, "block");
  assert.equal(s.userDecisionNeeded, true);
});

test("override: unknown owner → block", () => {
  const s = decideStance({
    surface: makeSurfaceClassification({
      surfaceClass: "external-reference",
      ownerClass: "unknown",
      scopeClass: "in-scope"
    })
  });
  assert.equal(s.stance, "block");
});

test("override: checkpoint-only rollback → block", () => {
  const s = decideStance({
    surface: makeSurfaceClassification({
      surfaceClass: "authored-config",
      ownerClass: "user-owned",
      rollbackClass: "checkpoint-only",
      scopeClass: "in-scope"
    })
  });
  assert.equal(s.stance, "block");
  assert.match(s.why, /checkpoint/);
});

test("override: conflicting evidence → block", () => {
  const evidence = makeEvidenceSet();
  evidence.conflicting = true;
  const s = decideStance({
    surface: makeSurfaceClassification({
      surfaceClass: "authored-config",
      ownerClass: "user-owned",
      scopeClass: "in-scope"
    }),
    evidence
  });
  assert.equal(s.stance, "block");
  assert.match(s.why, /conflicting/);
});

// ---------- Stance matrix (§6) ----------

test("matrix: no issue, useful inventory → inform", () => {
  const s = decideStance({
    surface: makeSurfaceClassification({
      surfaceClass: "claude-app-data",
      ownerClass: "claude-managed",
      scopeClass: "in-scope"
    })
  });
  assert.equal(s.stance, "inform");
});

test("matrix: expected orphan within grace period → watch", () => {
  const s = decideStance({
    surface: makeSurfaceClassification({
      surfaceClass: "claude-app-data",
      ownerClass: "claude-managed",
      scopeClass: "in-scope"
    }),
    evidence: makeEvidenceSet({ freshness: ["within-grace-period"] })
  });
  assert.equal(s.stance, "watch");
});

test("matrix: possibly load-bearing cache → probe", () => {
  const s = decideStance({
    surface: makeSurfaceClassification({
      surfaceClass: "claude-app-data",
      ownerClass: "claude-managed",
      loadBearingClass: "possibly-load-bearing",
      scopeClass: "in-scope"
    }),
    missingKeys: ["behavioral-key"]
  });
  assert.equal(s.stance, "probe");
});

test("matrix: local override or diverged copy → review", () => {
  const s = decideStance({
    surface: makeSurfaceClassification({
      surfaceClass: "authored-config",
      ownerClass: "user-owned",
      scopeClass: "in-scope"
    }),
    findingClass: "divergence"
  });
  assert.equal(s.stance, "review");
});

test("matrix: user says do-not-touch → protect", () => {
  const s = decideStance({
    surface: makeSurfaceClassification({ ownerClass: "user-owned" }),
    policy: { matches: [makePolicyMatch({ type: "doNotTouch", reason: "user said so" })] }
  });
  assert.equal(s.stance, "protect");
});

test("matrix: secret-adjacent path → protect", () => {
  const s = decideStance({
    surface: makeSurfaceClassification({
      surfaceClass: "secret-adjacent",
      ownerClass: "user-owned",
      sensitivityClass: "secret-adjacent",
      scopeClass: "in-scope"
    })
  });
  assert.equal(s.stance, "protect");
});

test("matrix: malformed settings with exact location → prepare", () => {
  const s = decideStance({
    surface: makeSurfaceClassification({
      surfaceClass: "authored-config",
      ownerClass: "user-owned",
      rollbackClass: "snapshot-possible",
      scopeClass: "in-scope"
    }),
    findingClass: "integrity"
  });
  assert.equal(s.stance, "prepare");
});

test("matrix: malformed settings with approved patch + snapshot + consent → repair", () => {
  const s = decideStance({
    surface: makeSurfaceClassification({
      surfaceClass: "authored-config",
      ownerClass: "user-owned",
      rollbackClass: "manifest-backed",
      scopeClass: "in-scope"
    }),
    findingClass: "integrity",
    consentGranted: true
  });
  assert.equal(s.stance, "repair");
});

test("matrix: missing rollback proof → block", () => {
  const s = decideStance({
    surface: makeSurfaceClassification({
      surfaceClass: "authored-config",
      ownerClass: "user-owned",
      scopeClass: "in-scope"
    }),
    missingKeys: ["rollback-proof"]
  });
  assert.equal(s.stance, "block");
});

test("matrix: checkpoint-only rollback → block", () => {
  const s = decideStance({
    surface: makeSurfaceClassification({
      surfaceClass: "authored-config",
      ownerClass: "user-owned",
      rollbackClass: "checkpoint-only",
      scopeClass: "in-scope"
    })
  });
  assert.equal(s.stance, "block");
});

test("matrix: unknown owner → block", () => {
  const s = decideStance({
    surface: makeSurfaceClassification({ ownerClass: "unknown", scopeClass: "in-scope" })
  });
  assert.equal(s.stance, "block");
});

test("matrix: safe mode + cannot prove live behavior → probe", () => {
  const s = decideStance({
    surface: makeSurfaceClassification({
      surfaceClass: "authored-config",
      ownerClass: "user-owned",
      scopeClass: "in-scope"
    }),
    missingKeys: ["loader-key"],
    mode: "safe"
  });
  assert.equal(s.stance, "probe");
});

// ---------- Payload contract (§10) ----------

test("payload: every stance carries the §10 fields", () => {
  const s = decideStance({});
  for (const k of ["stance", "why", "missingKey", "nextAllowedStep", "notAllowed", "userDecisionNeeded"]) {
    assert.ok(Object.prototype.hasOwnProperty.call(s, k), `missing ${k}`);
  }
});

test("decision-order: do-not-touch beats out-of-scope", () => {
  const s = decideStance({
    surface: makeSurfaceClassification({ ownerClass: "user-owned", scopeClass: "out-of-scope" }),
    policy: { matches: [makePolicyMatch({ type: "doNotTouch", reason: "user-stated" })] }
  });
  assert.equal(s.stance, "protect");
});

test("decision-order: secret-content beats out-of-scope", () => {
  const s = decideStance({
    surface: makeSurfaceClassification({
      ownerClass: "user-owned",
      sensitivityClass: "secret-content",
      scopeClass: "out-of-scope"
    })
  });
  assert.equal(s.stance, "protect");
});

test("shell-expansion-risk → probe", () => {
  const s = decideStance({
    surface: makeSurfaceClassification({
      surfaceClass: "executable-surface",
      ownerClass: "user-owned",
      executionClass: "shell-expansion-risk",
      scopeClass: "in-scope"
    })
  });
  assert.equal(s.stance, "probe");
});
