import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { classifySurface } from "../scripts/lib/surface.mjs";

const HOME = path.resolve("/home/u/.claude");

test("settings.json → authored-config + inert (positive)", () => {
  const s = classifySurface(path.join(HOME, "settings.json"), { home: HOME });
  assert.equal(s.surfaceClass, "authored-config");
  assert.equal(s.executionClass, "inert");
  assert.equal(s.loadBearingClass, "known-load-bearing");
  assert.equal(s.scopeClass, "in-scope");
});

test("non-settings file is NOT authored-config (negative)", () => {
  const s = classifySurface(path.join(HOME, "random.txt"), { home: HOME });
  assert.notEqual(s.surfaceClass, "authored-config");
});

test("hook command + loaded → executable-surface, runs-hook (positive)", () => {
  const target = path.join(HOME, "plugins/cache/m/p/1.0.0/hook.sh");
  const s = classifySurface(target, { home: HOME, isHookCommand: true, loaded: true });
  assert.equal(s.surfaceClass, "executable-surface");
  assert.equal(s.executionClass, "runs-hook");
  assert.equal(s.loadBearingClass, "known-load-bearing");
});

test("hook command + NOT loaded → executable-surface but inert (negative)", () => {
  const target = "/some/random/script.sh";
  const s = classifySurface(target, { home: HOME, isHookCommand: true, loaded: false });
  assert.equal(s.surfaceClass, "executable-surface");
  assert.equal(s.executionClass, "inert");
});

test("plugin cache version dir → claude-app-data + claude-managed (positive)", () => {
  const target = path.join(HOME, "plugins/cache/market/tool/1.0.0");
  const s = classifySurface(target, { home: HOME });
  assert.equal(s.surfaceClass, "claude-app-data");
  assert.equal(s.ownerClass, "claude-managed");
});

test("not under plugins/cache → not claude-managed via the cache rule (negative)", () => {
  const s = classifySurface(path.join(HOME, "commands/x.md"), { home: HOME });
  assert.notEqual(s.ownerClass, "claude-managed");
});

test(".env path → secret-adjacent surface, secret-content sensitivity, protected scope (positive)", () => {
  const s = classifySurface("/home/u/.env", { home: HOME });
  assert.equal(s.surfaceClass, "secret-adjacent");
  assert.equal(s.sensitivityClass, "secret-content");
  assert.equal(s.scopeClass, "protected");
});

test("secret directory segment marks secret-adjacent (positive)", () => {
  const s = classifySurface("/home/u/secrets/notes.md", { home: HOME });
  assert.equal(s.surfaceClass, "secret-adjacent");
  assert.equal(s.sensitivityClass, "secret-adjacent");
});

test("private key file → secret-content (positive)", () => {
  const s = classifySurface("/home/u/.ssh/id_rsa", { home: HOME });
  assert.equal(s.surfaceClass, "secret-adjacent");
  assert.ok(["secret-adjacent", "secret-content"].includes(s.sensitivityClass));
});

test("non-secret-named markdown file is NOT secret-adjacent (negative)", () => {
  const s = classifySurface("/home/u/notes.md", { home: HOME });
  assert.notEqual(s.surfaceClass, "secret-adjacent");
});

test("housekeeper operation manifest → housekeeper-owned, manifest-backed (positive)", () => {
  const target = path.join(HOME, "housekeeper/operations/op_001.json");
  const s = classifySurface(target, { home: HOME });
  assert.equal(s.surfaceClass, "housekeeper-owned");
  assert.equal(s.ownerClass, "housekeeper-owned");
  assert.equal(s.rollbackClass, "manifest-backed");
});

test("non-manifest file is NOT housekeeper-owned (negative)", () => {
  const s = classifySurface(path.join(HOME, "settings.json"), { home: HOME });
  assert.notEqual(s.surfaceClass, "housekeeper-owned");
});

test("MCP command (loaded) → executable-surface + starts-mcp (positive)", () => {
  const s = classifySurface("/usr/local/bin/mcp-server", {
    home: HOME,
    isMcpCommand: true,
    loaded: true
  });
  assert.equal(s.surfaceClass, "executable-surface");
  assert.equal(s.executionClass, "starts-mcp");
});

test("local commands directory under home → authored-config (positive)", () => {
  const s = classifySurface(path.join(HOME, "commands/local-build.md"), { home: HOME });
  assert.equal(s.surfaceClass, "authored-config");
  assert.equal(s.ownerClass, "user-owned");
});

test("path outside the home → external-reference + out-of-scope (positive)", () => {
  const s = classifySurface("/etc/passwd", { home: HOME });
  assert.equal(s.surfaceClass, "external-reference");
  assert.equal(s.scopeClass, "out-of-scope");
});

test("path inside the home is NOT external-reference (negative)", () => {
  const s = classifySurface(path.join(HOME, "settings.json"), { home: HOME });
  assert.notEqual(s.surfaceClass, "external-reference");
});

test("unknown surface returns full unknown classification (positive default)", () => {
  // No home hint, ambiguous path.
  const s = classifySurface("/tmp/unknown-file");
  assert.equal(s.surfaceClass, "unknown");
  assert.equal(s.ownerClass, "unknown");
});

test("settings.json beats secret rule when filename is settings.json (negative)", () => {
  const s = classifySurface(path.join(HOME, "settings.json"), { home: HOME });
  assert.notEqual(s.surfaceClass, "secret-adjacent");
});

test("plugin cache version dir wins over generic plugins/ classification (positive ordering)", () => {
  const s = classifySurface(
    path.join(HOME, "plugins/cache/market/tool/1.0.0"),
    { home: HOME }
  );
  assert.equal(s.surfaceClass, "claude-app-data");
});
