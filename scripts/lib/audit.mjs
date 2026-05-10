import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

const DEFAULT_SCOPE = "all";
const LARGE_LOG_BYTES = 1024 * 1024;
const OLD_FILE_HISTORY_DAYS = 30;
const OLD_CACHE_DAYS = 7;
const ZOMBIE_STATE_MS = 60 * 60 * 1000;
const PLAN_LIMIT = 12;

const CHECKS = {
  core: [
    "config.invalid_json"
  ],
  plugins: [
    "plugin.stale_versions",
    "plugin.duplicate_registrations",
    "plugin.hook_path_dangling",
    "plugin.cache_size"
  ],
  registry: [
    "registry.local_skill_shadow",
    "registry.local_command_shadow",
    "registry.broken_frontmatter",
    "registry.tiny_registry_files",
    "registry.local_command_identical",
    "registry.local_command_diverged"
  ],
  state: [
    "state.zombie_modes",
    "state.expired_cancel_signals",
    "state.large_replay_logs"
  ],
  settings: [
    "settings.invalid_json",
    "settings.hook_path_dangling",
    "settings.mcp_command_missing"
  ],
  fs: [
    "fs.large_logs",
    "fs.old_file_history",
    "fs.old_short_lived_cache",
    "fs.corrupt_backups",
    "fs.drift_dirs"
  ]
};

export function auditClaudeHome(home, options = {}) {
  const scope = options.scope || DEFAULT_SCOPE;
  const selected = selectedChecks(scope);
  const context = loadContext(home, options);
  const checks = [];

  add(checks, selected, checkConfig(context));

  add(checks, selected, checkStalePluginVersions(context));
  add(checks, selected, checkDuplicateRegistrations(context));
  add(checks, selected, checkPluginCacheSize(context));
  add(checks, selected, checkDanglingHookPaths(context, "plugin.hook_path_dangling"));

  add(checks, selected, checkLocalSkillShadow(context));
  add(checks, selected, checkLocalCommandShadow(context));
  add(checks, selected, checkBrokenFrontmatter(context));
  add(checks, selected, checkTinyRegistryFiles(context));
  add(checks, selected, checkLocalCommandIdentity(context, true));
  add(checks, selected, checkLocalCommandIdentity(context, false));

  add(checks, selected, checkZombieModes(context));
  add(checks, selected, checkExpiredCancelSignals(context));
  add(checks, selected, checkLargeReplayLogs(context));

  add(checks, selected, checkSettingsJson(context));
  add(checks, selected, checkDanglingHookPaths(context, "settings.hook_path_dangling"));
  add(checks, selected, checkMissingMcpCommands(context));

  add(checks, selected, checkLargeLogs(context));
  add(checks, selected, checkOldFileHistory(context));
  add(checks, selected, checkOldShortLivedCache(context));
  add(checks, selected, checkCorruptBackups(context));
  add(checks, selected, checkDriftDirs(context));

  const visibleChecks = applyProtection(checks.filter((check) => selected.has(check.id)), context);
  return {
    schemaVersion: "0.1-pre",
    filesChanged: false,
    home,
    scope,
    configPath: context.config.file,
    generatedAt: new Date().toISOString(),
    totalIssues: visibleChecks.reduce((sum, check) => sum + check.issues.length, 0),
    protectedIssues: visibleChecks.reduce((sum, check) => sum + check.issues.filter((issue) => issue.protected).length, 0),
    checks: visibleChecks
  };
}

export function formatScorecard(report) {
  const rows = report.checks
    .filter((check) => check.issues.length > 0 || check.alwaysShow)
    .map((check) => [
      check.id,
      String(check.issues.length),
      scorecardAction(check)
    ]);

  if (rows.length === 0) return "HOUSEKEEPER REPORT\nNo files changed.\nSCORECARD\nNo issues found.";

  const idWidth = Math.max("check".length, ...rows.map((row) => row[0].length));
  const issueWidth = Math.max("issues".length, ...rows.map((row) => row[1].length));
  const lines = [
    "HOUSEKEEPER REPORT",
    "No files changed.",
    `SCORECARD${" ".repeat(Math.max(1, idWidth - 5))}  ${"issues".padStart(issueWidth)}   action`,
    `${"-".repeat(idWidth)}  ${"-".repeat(issueWidth)}   ${"-".repeat(14)}`
  ];

  for (const [id, count, action] of rows) {
    lines.push(`${id.padEnd(idWidth)}  ${count.padStart(issueWidth)}   ${action}`);
  }
  lines.push(`${"-".repeat(idWidth)}  ${"-".repeat(issueWidth)}`);
  lines.push(`${"TOTAL".padEnd(idWidth)}  ${String(report.totalIssues).padStart(issueWidth)}`);
  if (report.protectedIssues > 0) {
    lines.push(`${"PROTECTED".padEnd(idWidth)}  ${String(report.protectedIssues).padStart(issueWidth)}`);
  }
  return lines.join("\n");
}

export function formatPlan(report) {
  const lines = ["HOUSEKEEPER REPORT", "No files changed.", `PLAN for ${report.home}`, ""];
  let wroteAny = false;

  for (const check of report.checks) {
    if (check.issues.length === 0) continue;
    wroteAny = true;
    lines.push(`${check.id} (${check.issues.length})`);
    lines.push(`action: ${check.action || "review"}`);
    for (const issue of check.issues.slice(0, PLAN_LIMIT)) {
      lines.push(`- ${issue.summary}`);
      lines.push(`  risk: ${issue.risk}`);
      if (issue.protected) lines.push(`  protected: ${issue.protectionReason || "do-not-touch rule"}`);
      if (issue.path) lines.push(`  path: ${issue.path}`);
    }
    if (check.issues.length > PLAN_LIMIT) {
      lines.push(`- ... ${check.issues.length - PLAN_LIMIT} more`);
    }
    lines.push("");
  }

  if (!wroteAny) lines.push("No changes needed.");
  else lines.push("No changes have been made. Destructive actions require snapshot support and --confirm.");
  return lines.join("\n").trimEnd();
}

function selectedChecks(scope) {
  if (scope === "all") return new Set(Object.values(CHECKS).flat());
  if (!CHECKS[scope]) throw new Error(`Unknown scope: ${scope}`);
  return new Set([...CHECKS.core, ...CHECKS[scope]]);
}

function add(checks, selected, check) {
  if (selected.has(check.id)) checks.push(check);
}

function scorecardAction(check) {
  if (check.issues.length > 0 && check.issues.every((issue) => issue.protected)) return "protected";
  return check.action || "";
}

function applyProtection(checks, context) {
  if (context.config.error || context.config.rules.length === 0) return checks;
  return checks.map((check) => ({
    ...check,
    issues: check.issues.map((issue) => protectIssue(check, issue, context))
  }));
}

function checkConfig(context) {
  const issues = context.config.error ? [{
    summary: `Housekeeper config is invalid JSON: ${context.config.error}`,
    path: context.config.file
  }] : [];
  return check("config.invalid_json", issues, "review");
}

function protectIssue(check, issue, context) {
  const rule = context.config.rules.find((candidate) => protectionMatches(candidate, check.id, issue.path, context.home));
  if (!rule) return issue;
  return {
    ...issue,
    protected: true,
    actionable: false,
    risk: "protected",
    proposedAction: "do-not-touch",
    protectionReason: rule.reason
  };
}

function protectionMatches(rule, checkId, issuePath, home) {
  if (rule.check && rule.check !== checkId) return false;
  if (!rule.path) return true;
  if (!issuePath) return false;
  return pathMatchesProtection(rule.path, issuePath, home);
}

function pathMatchesProtection(pattern, issuePath, home) {
  const absolutePattern = path.isAbsolute(pattern) ? pattern : path.join(home, pattern);
  const normalizedPattern = path.normalize(absolutePattern);
  const normalizedPath = path.normalize(issuePath);
  if (normalizedPattern.endsWith(`${path.sep}**`)) {
    const prefix = normalizedPattern.slice(0, -3);
    return normalizedPath === prefix || normalizedPath.startsWith(`${prefix}${path.sep}`);
  }
  if (normalizedPattern.endsWith(`${path.sep}*`)) {
    const prefix = normalizedPattern.slice(0, -2);
    return path.dirname(normalizedPath) === prefix;
  }
  return normalizedPath === normalizedPattern || normalizedPath.startsWith(`${normalizedPattern}${path.sep}`);
}

function loadContext(home, options) {
  const pluginsFile = path.join(home, "plugins", "installed_plugins.json");
  const settingsFile = path.join(home, "settings.json");
  const installed = readJson(pluginsFile);
  const settings = readJson(settingsFile);
  const config = loadConfig(home, options.configPath);
  const pluginEntries = flattenPluginEntries(installed.value);
  const pluginResources = collectPluginResources(pluginEntries);
  return {
    home,
    installed,
    settings,
    settingsFile,
    config,
    pluginEntries,
    pluginResources,
    now: Date.now()
  };
}

function loadConfig(home, explicitPath) {
  const candidates = [
    explicitPath,
    path.join(home, "housekeeper", "config.json"),
    path.join(home, "housekeeper.json")
  ].filter(Boolean);
  for (const file of candidates) {
    const parsed = readJson(file);
    if (parsed.ok && !parsed.missing) {
      return { file, rules: normalizeProtectionRules(parsed.value) };
    }
    if (!parsed.ok) {
      return { file, rules: [], error: parsed.error };
    }
  }
  return { file: null, rules: [] };
}

function normalizeProtectionRules(value) {
  const rules = [
    ...(Array.isArray(value?.doNotTouch) ? value.doNotTouch : []),
    ...(Array.isArray(value?.protect) ? value.protect : [])
  ];
  return rules
    .filter((rule) => rule && typeof rule === "object")
    .map((rule) => ({
      check: typeof rule.check === "string" ? rule.check : null,
      path: typeof rule.path === "string" ? rule.path : null,
      reason: typeof rule.reason === "string" ? rule.reason : "do-not-touch rule"
    }))
    .filter((rule) => rule.check || rule.path);
}

function readJson(file) {
  if (!existsSync(file)) return { ok: true, missing: true, value: null, file };
  try {
    return { ok: true, missing: false, value: JSON.parse(readFileSync(file, "utf8")), file };
  } catch (error) {
    return { ok: false, missing: false, value: null, file, error: error.message };
  }
}

function flattenPluginEntries(installed) {
  if (!installed || typeof installed !== "object" || !installed.plugins) return [];
  const entries = [];
  for (const [key, records] of Object.entries(installed.plugins)) {
    if (!Array.isArray(records)) continue;
    for (const record of records) {
      entries.push({ key, ...record });
    }
  }
  return entries;
}

function collectPluginResources(entries) {
  const skills = new Map();
  const commands = new Map();
  for (const entry of entries) {
    if (!entry.installPath || !existsSync(entry.installPath)) continue;
    for (const skill of collectSkills(path.join(entry.installPath, "skills"))) {
      addResource(skills, skill.name, { ...skill, plugin: entry.key });
    }
    for (const command of collectCommands(path.join(entry.installPath, "commands"))) {
      addResource(commands, command.name, { ...command, plugin: entry.key });
    }
  }
  return { skills, commands };
}

function addResource(map, name, value) {
  if (!map.has(name)) map.set(name, []);
  map.get(name).push(value);
}

function collectSkills(skillsDir) {
  if (!existsSync(skillsDir)) return [];
  return readdirSafe(skillsDir)
    .map((name) => ({ name, path: path.join(skillsDir, name, "SKILL.md") }))
    .filter((skill) => existsSync(skill.path));
}

function collectCommands(commandsDir) {
  if (!existsSync(commandsDir)) return [];
  return walk(commandsDir)
    .filter((file) => file.endsWith(".md"))
    .map((file) => ({
      name: path.relative(commandsDir, file).replace(/\.md$/, ""),
      path: file
    }));
}

function checkStalePluginVersions(context) {
  const livePaths = new Set(context.pluginEntries.map((entry) => entry.installPath).filter(Boolean));
  const cacheRoot = path.join(context.home, "plugins", "cache");
  const issues = [];
  for (const versionDir of listCacheVersionDirs(cacheRoot)) {
    if (!livePaths.has(versionDir)) {
      issues.push({
        summary: `${path.relative(cacheRoot, versionDir)} is not referenced by installed_plugins.json`,
        path: versionDir
      });
    }
  }
  return check("plugin.stale_versions", issues, "clean --scope=plugins");
}

function listCacheVersionDirs(cacheRoot) {
  if (!existsSync(cacheRoot)) return [];
  const dirs = [];
  for (const market of readdirSafe(cacheRoot)) {
    const marketDir = path.join(cacheRoot, market);
    if (!isDirectory(marketDir)) continue;
    for (const plugin of readdirSafe(marketDir)) {
      const pluginDir = path.join(marketDir, plugin);
      if (!isDirectory(pluginDir)) continue;
      for (const version of readdirSafe(pluginDir)) {
        const versionDir = path.join(pluginDir, version);
        if (isDirectory(versionDir)) dirs.push(versionDir);
      }
    }
  }
  return dirs;
}

function checkDuplicateRegistrations(context) {
  const issues = [];
  const byKey = new Map();
  for (const entry of context.pluginEntries) {
    if (!byKey.has(entry.key)) byKey.set(entry.key, []);
    byKey.get(entry.key).push(entry);
  }
  for (const [key, entries] of byKey.entries()) {
    const scopes = new Set(entries.map((entry) => `${entry.scope || "unknown"}:${entry.projectPath || ""}`));
    if (entries.length > 1 || scopes.size > 1) {
      issues.push({
        summary: `${key} has ${entries.length} registrations across ${scopes.size} scope(s)`
      });
    }
  }
  return check("plugin.duplicate_registrations", issues, "clean --scope=plugins");
}

function checkPluginCacheSize(context) {
  const cacheRoot = path.join(context.home, "plugins", "cache");
  const issues = listCacheVersionDirs(cacheRoot).map((versionDir) => ({
    summary: `${path.relative(cacheRoot, versionDir)} uses ${formatBytes(dirSize(versionDir))}`,
    path: versionDir
  }));
  return check("plugin.cache_size", issues, "diagnose --scope=plugins", true);
}

function checkDanglingHookPaths(context, id) {
  if (!context.settings.ok || !context.settings.value) return check(id, [], "clean --scope=settings");
  const commands = collectHookCommands(context.settings.value);
  const issues = [];
  for (const command of commands) {
    for (const candidate of extractAbsolutePaths(command)) {
      if (candidate.includes(`${path.sep}plugins${path.sep}cache${path.sep}`) && !existsSync(candidate)) {
        issues.push({
          summary: `hook command references missing plugin path: ${candidate}`,
          path: context.settingsFile
        });
      }
    }
  }
  return check(id, dedupeIssues(issues), id.startsWith("plugin.") ? "clean --scope=plugins" : "clean --scope=settings");
}

function collectHookCommands(value) {
  const commands = [];
  const visit = (node) => {
    if (Array.isArray(node)) {
      for (const child of node) visit(child);
    } else if (node && typeof node === "object") {
      if (typeof node.command === "string") commands.push(node.command);
      for (const child of Object.values(node)) visit(child);
    }
  };
  visit(value.hooks);
  return commands;
}

function extractAbsolutePaths(command) {
  const matches = command.match(/(?:['"])?(\/[^\s'"`|;&)]+)/g) || [];
  return matches.map((match) => match.replace(/^['"]|['"]$/g, ""));
}

function checkLocalSkillShadow(context) {
  const localDir = path.join(context.home, "skills");
  const issues = collectSkills(localDir)
    .filter((skill) => context.pluginResources.skills.has(skill.name))
    .map((skill) => ({
      summary: `${skill.name} shadows plugin skill from ${pluginsFor(context.pluginResources.skills, skill.name)}`,
      path: skill.path
    }));
  return check("registry.local_skill_shadow", issues, "clean --scope=registry");
}

function checkLocalCommandShadow(context) {
  const localDir = path.join(context.home, "commands");
  const issues = collectCommands(localDir)
    .filter((command) => context.pluginResources.commands.has(command.name))
    .map((command) => ({
      summary: `${command.name} shadows plugin command from ${pluginsFor(context.pluginResources.commands, command.name)}`,
      path: command.path
    }));
  return check("registry.local_command_shadow", issues, "plan --scope=registry");
}

function checkBrokenFrontmatter(context) {
  const files = [
    ...collectSkills(path.join(context.home, "skills")).map((item) => ({ ...item, type: "skill" })),
    ...collectCommands(path.join(context.home, "commands")).map((item) => ({ ...item, type: "command" }))
  ];
  const issues = files.filter((file) => {
    const frontmatter = parseFrontmatter(readText(file.path));
    if (!frontmatter) return true;
    return file.type === "skill" ? !frontmatter.name : !frontmatter.description;
  }).map((file) => ({
    summary: `${file.name} has missing or incomplete YAML frontmatter`,
    path: file.path
  }));
  return check("registry.broken_frontmatter", issues, "clean --scope=registry");
}

function checkTinyRegistryFiles(context) {
  const files = [
    ...collectSkills(path.join(context.home, "skills")),
    ...collectCommands(path.join(context.home, "commands"))
  ];
  const issues = files.filter((file) => size(file.path) < 32).map((file) => ({
    summary: `${file.name} is under 32 bytes`,
    path: file.path
  }));
  return check("registry.tiny_registry_files", issues, "clean --scope=registry");
}

function checkLocalCommandIdentity(context, identical) {
  const localDir = path.join(context.home, "commands");
  const issues = [];
  for (const command of collectCommands(localDir)) {
    const pluginCommands = context.pluginResources.commands.get(command.name) || [];
    if (pluginCommands.length === 0) continue;
    const localHash = hashFile(command.path);
    const hasIdentical = pluginCommands.some((pluginCommand) => hashFile(pluginCommand.path) === localHash);
    if (identical === hasIdentical) {
      issues.push({
        summary: `${command.name} is ${identical ? "byte-identical to" : "diverged from"} plugin version`,
        path: command.path
      });
    }
  }
  return check(
    identical ? "registry.local_command_identical" : "registry.local_command_diverged",
    issues,
    identical ? "clean --scope=registry" : "plan --scope=registry"
  );
}

function checkZombieModes(context) {
  const roots = [context.home, path.join(path.dirname(context.home), ".omc")];
  const issues = [];
  for (const root of roots) {
    for (const file of walk(root).filter((item) => item.endsWith("-state.json"))) {
      const parsed = readJson(file);
      if (!parsed.ok || !parsed.value || parsed.value.active !== true) continue;
      const checkedAt = Date.parse(parsed.value.last_checked_at || parsed.value.lastCheckedAt || "");
      if (Number.isNaN(checkedAt) || context.now - checkedAt <= ZOMBIE_STATE_MS) continue;
      issues.push({
        summary: `${path.basename(file)} is active but stale`,
        path: file
      });
    }
  }
  return check("state.zombie_modes", issues, "clean --scope=state");
}

function checkExpiredCancelSignals(context) {
  const issues = [];
  for (const file of walk(context.home).filter((item) => /cancel.*\.json$/i.test(path.basename(item)))) {
    const parsed = readJson(file);
    if (!parsed.ok || !parsed.value || !parsed.value.expires_at) continue;
    const expiresAt = Date.parse(parsed.value.expires_at);
    if (!Number.isNaN(expiresAt) && expiresAt < context.now) {
      issues.push({ summary: `${path.basename(file)} expired`, path: file });
    }
  }
  return check("state.expired_cancel_signals", issues, "clean --scope=state");
}

function checkLargeReplayLogs(context) {
  const issues = walk(context.home)
    .filter((file) => /agent-replay-.*\.jsonl$/.test(path.basename(file)) && size(file) > LARGE_LOG_BYTES)
    .map((file) => ({ summary: `${path.basename(file)} uses ${formatBytes(size(file))}`, path: file }));
  return check("state.large_replay_logs", issues, "clean --scope=state");
}

function checkSettingsJson(context) {
  const issues = context.settings.ok ? [] : [{
    summary: `settings.json is invalid JSON: ${context.settings.error}`,
    path: context.settingsFile
  }];
  return check("settings.invalid_json", issues, "review");
}

function checkMissingMcpCommands(context) {
  if (!context.settings.ok || !context.settings.value?.mcpServers) {
    return check("settings.mcp_command_missing", [], "clean --scope=settings");
  }
  const issues = [];
  for (const [name, server] of Object.entries(context.settings.value.mcpServers)) {
    if (!server || typeof server.command !== "string") continue;
    if (server.command.startsWith("/") && !existsSync(server.command)) {
      issues.push({
        summary: `mcpServers.${name}.command does not exist: ${server.command}`,
        path: context.settingsFile
      });
    }
  }
  return check("settings.mcp_command_missing", issues, "clean --scope=settings");
}

function checkLargeLogs(context) {
  const issues = readdirSafe(context.home)
    .filter((name) => name.endsWith(".log"))
    .map((name) => path.join(context.home, name))
    .filter((file) => size(file) > LARGE_LOG_BYTES)
    .map((file) => ({ summary: `${path.basename(file)} uses ${formatBytes(size(file))}`, path: file }));
  return check("fs.large_logs", issues, "clean --scope=fs");
}

function checkOldFileHistory(context) {
  const root = path.join(context.home, "file-history");
  const cutoff = context.now - days(OLD_FILE_HISTORY_DAYS);
  const issues = readdirSafe(root)
    .map((name) => path.join(root, name))
    .filter((item) => isDirectory(item) && mtimeMs(item) < cutoff)
    .map((item) => ({ summary: `${path.basename(item)} is older than ${OLD_FILE_HISTORY_DAYS} days`, path: item }));
  return check("fs.old_file_history", issues, "clean --scope=fs");
}

function checkOldShortLivedCache(context) {
  const roots = ["paste-cache", "shell-snapshots", "session-data", "sessions"].map((name) => path.join(context.home, name));
  const cutoff = context.now - days(OLD_CACHE_DAYS);
  const issues = [];
  for (const root of roots) {
    for (const item of readdirSafe(root).map((name) => path.join(root, name))) {
      if (mtimeMs(item) < cutoff) {
        issues.push({ summary: `${path.relative(context.home, item)} is older than ${OLD_CACHE_DAYS} days`, path: item });
      }
    }
  }
  return check("fs.old_short_lived_cache", issues, "clean --scope=fs");
}

function checkCorruptBackups(context) {
  const issues = readdirSafe(context.home)
    .filter((name) => name.includes(".backup."))
    .map((name) => path.join(context.home, name))
    .filter((file) => size(file) < 32)
    .map((file) => ({ summary: `${path.basename(file)} is under 32 bytes`, path: file }));
  return check("fs.corrupt_backups", issues, "clean --scope=fs");
}

function checkDriftDirs(context) {
  const driftNames = new Set(["_archive", "_old", "_tmp", "_diverged"]);
  const issues = walkDirs(context.home)
    .filter((dir) => driftNames.has(path.basename(dir)))
    .map((dir) => ({ summary: `${path.relative(context.home, dir)} looks like manual drift`, path: dir }));
  return check("fs.drift_dirs", issues, "plan --scope=fs");
}

function pluginsFor(map, name) {
  return (map.get(name) || []).map((item) => item.plugin).join(", ");
}

function parseFrontmatter(text) {
  if (!text.startsWith("---\n")) return null;
  const end = text.indexOf("\n---", 4);
  if (end === -1) return null;
  const data = {};
  for (const line of text.slice(4, end).split("\n")) {
    const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (match) data[match[1]] = match[2].replace(/^["']|["']$/g, "");
  }
  return data;
}

function check(id, issues, action, alwaysShow = false) {
  const metadata = issueMetadata(id);
  return {
    id,
    severity: metadata.severity,
    risk: metadata.risk,
    confidence: metadata.confidence,
    actionable: metadata.actionable,
    issues: issues.map((issue) => ({ ...metadata, ...issue })),
    action,
    alwaysShow
  };
}

function issueMetadata(id) {
  if (id === "plugin.cache_size") {
    return {
      severity: "info",
      risk: "none",
      confidence: "high",
      actionable: false,
      proposedAction: "review"
    };
  }
  if (id.endsWith("_diverged") || id.endsWith("_shadow") || id === "fs.drift_dirs") {
    return {
      severity: "warning",
      risk: "review-required",
      confidence: "medium",
      actionable: true,
      proposedAction: "review"
    };
  }
  if (id.includes("dangling") || id.includes("invalid_json")) {
    return {
      severity: "error",
      risk: "none",
      confidence: "high",
      actionable: true,
      proposedAction: "none"
    };
  }
  return {
    severity: "warning",
    risk: "reversible-cleanup",
    confidence: "medium",
    actionable: true,
    proposedAction: "none"
  };
}

function dedupeIssues(issues) {
  const seen = new Set();
  return issues.filter((issue) => {
    const key = `${issue.summary}\0${issue.path || ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function readText(file) {
  try {
    return readFileSync(file, "utf8");
  } catch {
    return "";
  }
}

function hashFile(file) {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

function readdirSafe(dir) {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

function walk(root) {
  if (!existsSync(root)) return [];
  const out = [];
  const stack = [root];
  while (stack.length > 0) {
    const current = stack.pop();
    for (const name of readdirSafe(current)) {
      const fullPath = path.join(current, name);
      if (isDirectory(fullPath)) stack.push(fullPath);
      else out.push(fullPath);
    }
  }
  return out;
}

function walkDirs(root) {
  if (!existsSync(root)) return [];
  const out = [];
  const stack = [root];
  while (stack.length > 0) {
    const current = stack.pop();
    for (const name of readdirSafe(current)) {
      const fullPath = path.join(current, name);
      if (!isDirectory(fullPath)) continue;
      out.push(fullPath);
      stack.push(fullPath);
    }
  }
  return out;
}

function isDirectory(file) {
  try {
    return statSync(file).isDirectory();
  } catch {
    return false;
  }
}

function size(file) {
  try {
    return statSync(file).size;
  } catch {
    return 0;
  }
}

function dirSize(root) {
  return walk(root).reduce((sum, file) => sum + size(file), 0);
}

function mtimeMs(file) {
  try {
    return statSync(file).mtimeMs;
  } catch {
    return Date.now();
  }
}

function days(value) {
  return value * 24 * 60 * 60 * 1000;
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
}
