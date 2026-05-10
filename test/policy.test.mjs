import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  loadConfig,
  matchPolicy,
  normalizeProtectionRules,
  pathMatchesProtection
} from "../scripts/lib/policy.mjs";

// ---------- pathMatchesProtection ----------

test("pathMatchesProtection: '**' suffix matches recursive descendants", () => {
  const home = "/home/u/.claude";
  assert.equal(
    pathMatchesProtection("commands/**", path.join(home, "commands/local-build.md"), home),
    true
  );
  assert.equal(
    pathMatchesProtection("commands/**", path.join(home, "commands/sub/x.md"), home),
    true
  );
  assert.equal(
    pathMatchesProtection("commands/**", path.join(home, "skills/x.md"), home),
    false
  );
});

test("pathMatchesProtection: '*' suffix matches direct children only", () => {
  const home = "/home/u/.claude";
  assert.equal(
    pathMatchesProtection("commands/*", path.join(home, "commands/local.md"), home),
    true
  );
  assert.equal(
    pathMatchesProtection("commands/*", path.join(home, "commands/sub/nested.md"), home),
    false
  );
});

test("pathMatchesProtection: bare path matches exact or prefix", () => {
  const home = "/home/u/.claude";
  assert.equal(
    pathMatchesProtection("commands/local-build.md", path.join(home, "commands/local-build.md"), home),
    true
  );
  assert.equal(
    pathMatchesProtection("commands", path.join(home, "commands/local-build.md"), home),
    true
  );
  assert.equal(
    pathMatchesProtection("commands", path.join(home, "skills/x.md"), home),
    false
  );
});

test("pathMatchesProtection: absolute pattern bypasses home", () => {
  const home = "/home/u/.claude";
  assert.equal(
    pathMatchesProtection("/etc/secret", "/etc/secret", home),
    true
  );
  assert.equal(
    pathMatchesProtection("/etc/secret", "/var/log", home),
    false
  );
});

// ---------- normalizeProtectionRules ----------

test("normalizeProtectionRules: reads doNotTouch + protect arrays", () => {
  const rules = normalizeProtectionRules({
    doNotTouch: [{ path: "commands/local.md", reason: "personal" }],
    protect: [{ check: "registry.local_command_diverged" }]
  });
  assert.equal(rules.length, 2);
  assert.equal(rules[0].path, "commands/local.md");
  assert.equal(rules[0].reason, "personal");
  assert.equal(rules[1].check, "registry.local_command_diverged");
});

test("normalizeProtectionRules: drops rules without path or check", () => {
  const rules = normalizeProtectionRules({ doNotTouch: [{ reason: "no target" }] });
  assert.equal(rules.length, 0);
});

test("normalizeProtectionRules: defaults reason to 'do-not-touch rule'", () => {
  const rules = normalizeProtectionRules({ doNotTouch: [{ path: "x" }] });
  assert.equal(rules[0].reason, "do-not-touch rule");
});

test("normalizeProtectionRules: handles missing or non-object input", () => {
  assert.deepEqual(normalizeProtectionRules(null), []);
  assert.deepEqual(normalizeProtectionRules({}), []);
  assert.deepEqual(normalizeProtectionRules({ doNotTouch: "not-array" }), []);
});

// ---------- loadConfig ----------

test("loadConfig: prefers explicit path", () => {
  const home = mkdtempSync(path.join(tmpdir(), "claude-policy-"));
  const explicit = path.join(home, "custom.json");
  writeJson(explicit, { doNotTouch: [{ path: "x", reason: "explicit" }] });
  writeJson(path.join(home, "housekeeper.json"), { doNotTouch: [{ path: "y", reason: "fallback" }] });
  const cfg = loadConfig(home, explicit);
  assert.equal(cfg.file, explicit);
  assert.equal(cfg.rules[0].path, "x");
  assert.equal(cfg.rules[0].reason, "explicit");
});

test("loadConfig: falls back to housekeeper/config.json then housekeeper.json", () => {
  const home = mkdtempSync(path.join(tmpdir(), "claude-policy-"));
  writeJson(path.join(home, "housekeeper", "config.json"), {
    doNotTouch: [{ path: "a", reason: "primary" }]
  });
  writeJson(path.join(home, "housekeeper.json"), { doNotTouch: [{ path: "b" }] });
  const cfg = loadConfig(home);
  assert.equal(cfg.rules[0].path, "a");
  assert.equal(cfg.rules[0].reason, "primary");
});

test("loadConfig: no config file → empty rules and null file", () => {
  const home = mkdtempSync(path.join(tmpdir(), "claude-policy-"));
  const cfg = loadConfig(home);
  assert.equal(cfg.file, null);
  assert.deepEqual(cfg.rules, []);
});

test("loadConfig: invalid JSON → returns error and empty rules", () => {
  const home = mkdtempSync(path.join(tmpdir(), "claude-policy-"));
  const file = path.join(home, "housekeeper.json");
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, "{ invalid");
  const cfg = loadConfig(home);
  assert.ok(cfg.error);
  assert.deepEqual(cfg.rules, []);
});

// ---------- matchPolicy ----------

test("matchPolicy: doNotTouch match returns PolicyMatch with reason propagated", () => {
  const home = "/home/u/.claude";
  const policy = {
    home,
    doNotTouch: [{ path: "commands/local-build.md", reason: "intentional override", scope: "user" }]
  };
  const matches = matchPolicy(path.join(home, "commands/local-build.md"), policy);
  assert.equal(matches.length, 1);
  assert.equal(matches[0].type, "doNotTouch");
  assert.equal(matches[0].reason, "intentional override");
  assert.equal(matches[0].scope, "user");
  assert.equal(matches[0].effect, "stance protect, action none");
  assert.equal(matches[0].pattern, "commands/local-build.md");
});

test("matchPolicy: precedence — doNotTouch ranks before allowance and standingConsent", () => {
  const home = "/home/u/.claude";
  const target = path.join(home, "commands/local.md");
  const policy = {
    home,
    standingConsent: [{ path: "commands/**", reason: "consent", maxStance: "prepare" }],
    allowances: [{ path: "commands/local.md", reason: "ok-as-is" }],
    doNotTouch: [{ path: "commands/local.md", reason: "leave it" }]
  };
  const matches = matchPolicy(target, policy);
  assert.equal(matches[0].type, "doNotTouch");
  assert.equal(matches[1].type, "allowance");
  assert.equal(matches[2].type, "standingConsent");
});

test("matchPolicy: narrower patterns win within the same type", () => {
  const home = "/home/u/.claude";
  const target = path.join(home, "commands/local-build.md");
  const policy = {
    home,
    doNotTouch: [
      { path: "commands/**", reason: "broad rule" },
      { path: "commands/local-build.md", reason: "narrow rule" }
    ]
  };
  const matches = matchPolicy(target, policy);
  assert.equal(matches[0].reason, "narrow rule");
  assert.equal(matches[1].reason, "broad rule");
});

test("matchPolicy: non-matching path returns empty array", () => {
  const home = "/home/u/.claude";
  const policy = { home, doNotTouch: [{ path: "skills/local.md", reason: "x" }] };
  assert.deepEqual(matchPolicy(path.join(home, "commands/x.md"), policy), []);
});

test("matchPolicy: rules with no path are silently skipped", () => {
  const home = "/home/u/.claude";
  const policy = { home, doNotTouch: [{ reason: "no path" }] };
  assert.deepEqual(matchPolicy(path.join(home, "commands/x.md"), policy), []);
});

test("matchPolicy: empty path or empty policy returns []", () => {
  assert.deepEqual(matchPolicy("", { doNotTouch: [{ path: "x" }] }), []);
  assert.deepEqual(matchPolicy("/x", null), []);
});

test("matchPolicy: standingConsent reports maxStance in effect", () => {
  const home = "/home/u/.claude";
  const target = path.join(home, "logs/x.log");
  const policy = {
    home,
    standingConsent: [{ path: "logs/**", reason: "rotation", maxStance: "prepare" }]
  };
  const matches = matchPolicy(target, policy);
  assert.equal(matches.length, 1);
  assert.equal(matches[0].effect, "stance up to prepare");
});

function writeJson(file, value) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}
