import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { auditClaudeHome } from "../scripts/lib/audit.mjs";

test("diagnose finds stale cache versions and dangling hook paths", () => {
  const home = fixtureHome();
  const live = path.join(home, "plugins/cache/market/tool/1.0.0");
  const stale = path.join(home, "plugins/cache/market/tool/0.9.0");
  mkdirSync(live, { recursive: true });
  mkdirSync(stale, { recursive: true });
  writeJson(path.join(home, "plugins/installed_plugins.json"), {
    version: 2,
    plugins: {
      "tool@market": [{ installPath: live, scope: "user", version: "1.0.0" }]
    }
  });
  writeJson(path.join(home, "settings.json"), {
    hooks: {
      Stop: [{ hooks: [{ command: `node ${stale}/scripts/missing.mjs` }] }]
    }
  });

  const report = auditClaudeHome(home);

  assert.equal(count(report, "plugin.stale_versions"), 1);
  assert.equal(count(report, "settings.hook_path_dangling"), 1);
  const dangling = report.checks.find((check) => check.id === "settings.hook_path_dangling");
  assert.equal(dangling.severity, "error");
  assert.equal(dangling.issues[0].confidence, "high");
});

test("diagnose separates identical and diverged local command shadows", () => {
  const home = fixtureHome();
  const pluginRoot = path.join(home, "plugins/cache/market/tool/1.0.0");
  mkdirSync(path.join(pluginRoot, "commands"), { recursive: true });
  mkdirSync(path.join(home, "commands"), { recursive: true });
  writeFileSync(path.join(pluginRoot, "commands/same.md"), "---\ndescription: same\n---\nbody\n");
  writeFileSync(path.join(home, "commands/same.md"), "---\ndescription: same\n---\nbody\n");
  writeFileSync(path.join(pluginRoot, "commands/different.md"), "---\ndescription: different\n---\nplugin\n");
  writeFileSync(path.join(home, "commands/different.md"), "---\ndescription: different\n---\nlocal\n");
  writeInstalled(home, pluginRoot);

  const report = auditClaudeHome(home, { scope: "registry" });

  assert.equal(count(report, "registry.local_command_shadow"), 2);
  assert.equal(count(report, "registry.local_command_identical"), 1);
  assert.equal(count(report, "registry.local_command_diverged"), 1);
});

test("diagnose finds broken frontmatter, corrupt backups, and zombie state", () => {
  const home = fixtureHome();
  mkdirSync(path.join(home, "skills/bad"), { recursive: true });
  writeFileSync(path.join(home, "skills/bad/SKILL.md"), "---\ndescription: missing name\n---\nbody\n");
  writeFileSync(path.join(home, "CLAUDE.md.backup.test"), "too tiny");
  writeJson(path.join(home, "ralph-state.json"), {
    active: true,
    last_checked_at: "2026-01-01T00:00:00.000Z"
  });
  writeInstalled(home, path.join(home, "plugins/cache/market/tool/1.0.0"));

  const report = auditClaudeHome(home);

  assert.equal(count(report, "registry.broken_frontmatter"), 1);
  assert.equal(count(report, "fs.corrupt_backups"), 1);
  assert.equal(count(report, "state.zombie_modes"), 1);
});

test("do-not-touch config marks matching findings as protected", () => {
  const home = fixtureHome();
  const pluginRoot = path.join(home, "plugins/cache/market/tool/1.0.0");
  mkdirSync(path.join(pluginRoot, "commands"), { recursive: true });
  mkdirSync(path.join(home, "commands"), { recursive: true });
  writeFileSync(path.join(pluginRoot, "commands/net-cables.md"), "---\ndescription: plugin\n---\nplugin\n");
  writeFileSync(path.join(home, "commands/net-cables.md"), "---\ndescription: local\n---\nlocal\n");
  writeInstalled(home, pluginRoot);
  writeJson(path.join(home, "housekeeper/config.json"), {
    doNotTouch: [
      {
        path: "commands/net-cables.md",
        reason: "local command is hand-maintained"
      }
    ]
  });

  const report = auditClaudeHome(home, { scope: "registry" });
  const diverged = report.checks.find((check) => check.id === "registry.local_command_diverged");

  assert.equal(report.protectedIssues, 2);
  assert.equal(diverged.issues[0].protected, true);
  assert.equal(diverged.issues[0].risk, "protected");
  assert.equal(diverged.issues[0].proposedAction, "do-not-touch");
  assert.equal(diverged.issues[0].protectionReason, "local command is hand-maintained");
});

function fixtureHome() {
  const home = mkdtempSync(path.join(tmpdir(), "claude-housekeeper-"));
  mkdirSync(path.join(home, "plugins"), { recursive: true });
  writeJson(path.join(home, "settings.json"), {});
  return home;
}

function writeInstalled(home, installPath) {
  mkdirSync(installPath, { recursive: true });
  writeJson(path.join(home, "plugins/installed_plugins.json"), {
    version: 2,
    plugins: {
      "tool@market": [{ installPath, scope: "user", version: "1.0.0" }]
    }
  });
}

function writeJson(file, value) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function count(report, id) {
  return report.checks.find((check) => check.id === id)?.issues.length ?? 0;
}
