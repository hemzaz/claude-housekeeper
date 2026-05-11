// Phase 2 — stance-first audit pipeline.
//
// Detectors return raw `DetectorOutput` objects (no severity/risk/action).
// `assembleReport()` runs every detector, classifies surfaces, fills evidence,
// applies policy, and runs the stance engine to produce a `Report`
// (per docs/schemas.md §1).

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import {
  SCHEMA_VERSION,
  makeEvidenceSet,
  makeFinding,
  makeReport,
  makeSurfaceClassification
} from "./contracts.mjs";
import { classifySurface } from "./surface.mjs";
import { decideStance } from "./stance.mjs";
import { loadConfig, pathMatchesProtection } from "./policy.mjs";
import {
  walkBounded,
  DEFAULT_MAX_FILES,
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_WALL_MS
} from "./observe.mjs";

// PLUGIN_ORPHAN_GRACE_DAYS — sourced from docs/loader-semantics.md §2 + §7
// ("orphaned previous versions are removed automatically about 7 days later").
// Single constant per T-X06 recommendation.
export const PLUGIN_ORPHAN_GRACE_DAYS = 7;
const PLUGIN_ORPHAN_GRACE_MS = PLUGIN_ORPHAN_GRACE_DAYS * 24 * 60 * 60 * 1000;

const DEFAULT_SCOPE = "all";

// v0.1 detector ids per notes/PLAN.md §3 Phase 2 detector remap table.
// Hygiene/state ids deferred per §6B C5 are intentionally absent here.
const SCOPE_TO_DETECTORS = {
  settings: [
    "settings.invalid_json",
    "settings.hook_path_dangling",
    "settings.hook_command_shell_ambiguous",
    "settings.mcp_command_missing"
  ],
  plugins: [
    "plugin.expected_orphan",
    "plugin.cache_unreferenced",
    "plugin.duplicate_registration",
    "plugin.cache_size",
    "settings.hook_path_dangling",
    "settings.hook_command_shell_ambiguous"
  ],
  registry: [
    "registry.local_skill_shadow",
    "registry.local_command_identical",
    "registry.local_command_diverged",
    "registry.broken_frontmatter"
  ],
  housekeeper: [
    "housekeeper.interrupted_operation",
    "housekeeper.config_invalid",
    "housekeeper.operations_unreadable"
  ]
};

// Cross-cutting detectors that always run regardless of `--scope`.
// Self-failure detectors (T-409) live here because they describe Housekeeper's
// own state and must never be filtered by scope.
const ALWAYS_ON_DETECTORS = new Set([
  "housekeeper.interrupted_operation",
  "housekeeper.config_invalid",
  "housekeeper.operations_unreadable",
  "home.not_found",
  "home.scan_budget_hit"
]);

// ---------- entry points ----------

export function auditClaudeHome(home, options = {}) {
  return assembleReport(home, options);
}

export function assembleReport(home, options = {}) {
  const scope = options.scope || DEFAULT_SCOPE;
  const mode = options.mode || "diagnose";
  const scanLimits = pickScanLimits(options.scanLimits);
  const selected = selectedDetectors(scope);

  // T-409: home-not-found is the first self-failure gate. If <home>/.claude
  // does not exist (or is not a directory), emit a `block` finding and stop
  // dependent inference. Required by docs/operational-readiness.md §4.
  const homeMissing = !existsSync(home) || !isDirectory(home);
  if (homeMissing) {
    return earlyReport(home, mode, [detectHomeNotFound(home)]);
  }

  const context = loadContext(home, { ...options, mode, scanLimits });
  const policyMatchesFor = (target) => collectPolicyMatches(target, context);

  const detectorOutputs = [];
  // T-409: self-failure detectors run BEFORE everything else so they appear
  // in the report even when downstream detectors crash on the same state.
  push(detectorOutputs, selected, detectHousekeeperConfigInvalid(context));
  push(detectorOutputs, selected, detectHousekeeperOperationsUnreadable(context));

  push(detectorOutputs, selected, detectSettingsInvalidJson(context));
  pushAll(detectorOutputs, selected, detectHookPathDangling(context));
  pushAll(detectorOutputs, selected, detectHookCommandShellAmbiguous(context));
  pushAll(detectorOutputs, selected, detectMcpCommandMissing(context));

  pushAll(detectorOutputs, selected, detectPluginExpectedOrphan(context));
  pushAll(detectorOutputs, selected, detectPluginCacheUnreferenced(context));
  pushAll(detectorOutputs, selected, detectPluginDuplicateRegistration(context));
  push(detectorOutputs, selected, detectPluginCacheSize(context));

  pushAll(detectorOutputs, selected, detectLocalSkillShadow(context));
  pushAll(detectorOutputs, selected, detectLocalCommandIdentical(context));
  pushAll(detectorOutputs, selected, detectLocalCommandDiverged(context));
  pushAll(detectorOutputs, selected, detectRegistryBrokenFrontmatter(context));

  push(detectorOutputs, selected, detectInterruptedOperation(context));

  // T-402: scan-budget orientation finding for the bounded projects walk.
  push(detectorOutputs, selected, detectScanBudget(context));

  const findings = detectorOutputs.map((raw) => buildFinding(raw, { home, mode, policyMatchesFor }));

  const stanceSummary = countStances(findings);
  const boundaries = collectBoundaries(findings);
  const primary = pickPrimary(findings);

  return makeReport({
    schemaVersion: SCHEMA_VERSION,
    mode,
    home,
    generatedAt: new Date().toISOString(),
    primary: primary ? primary.id : null,
    stanceSummary,
    findings,
    boundaries,
    degraded: context.degraded
  });
}

function pickScanLimits(overrides) {
  const o = overrides || {};
  return {
    maxFiles: typeof o.maxFiles === "number" ? o.maxFiles : DEFAULT_MAX_FILES,
    maxBytes: typeof o.maxBytes === "number" ? o.maxBytes : DEFAULT_MAX_BYTES,
    maxWallMs: typeof o.maxWallMs === "number" ? o.maxWallMs : DEFAULT_MAX_WALL_MS
  };
}

// ---------- detector dispatch helpers ----------

function push(out, selected, detectorOutput) {
  if (!detectorOutput) return;
  if (!selected.has(detectorOutput.id)) return;
  out.push(detectorOutput);
}

function pushAll(out, selected, detectorOutputs) {
  if (!Array.isArray(detectorOutputs)) return;
  for (const item of detectorOutputs) push(out, selected, item);
}

function selectedDetectors(scope) {
  if (scope === "all") {
    const all = new Set([...ALWAYS_ON_DETECTORS]);
    for (const ids of Object.values(SCOPE_TO_DETECTORS)) for (const id of ids) all.add(id);
    return all;
  }
  if (!SCOPE_TO_DETECTORS[scope]) throw new Error(`Unknown scope: ${scope}`);
  return new Set([...SCOPE_TO_DETECTORS[scope], ...ALWAYS_ON_DETECTORS]);
}

// ---------- finding assembly (T-202) ----------

function buildFinding(raw, { home, mode, policyMatchesFor }) {
  const baseSurface = raw.surface
    || classifySurface(raw.targetPath || "", { ...(raw.surfaceHints || {}), home });
  const surface = applySafeModeLimits(baseSurface, mode);
  const evidence = makeEvidenceSet({ ...(raw.evidence || {}), missing: raw.missingKeys || [] });
  const matches = raw.targetPath ? policyMatchesFor(raw.targetPath) : [];
  const stance = decideStance({
    surface,
    evidence,
    missingKeys: raw.missingKeys || [],
    policy: { matches },
    findingClass: raw.class || raw.findingClass || null,
    mode
  });

  // T-208 force: interrupted-operation finding must always render `block`.
  let stanceValue = raw.forceStance || stance.stance;

  // v0.1 repair degradation: stance.mjs can only emit `repair` with consent,
  // which v0.1 never grants. Belt-and-braces downgrade.
  if (stanceValue === "repair") stanceValue = "prepare";

  const blockedActions = raw.blockedActions || defaultBlockedActions(raw.id, stanceValue);
  const finding = makeFinding({
    id: raw.id,
    class: raw.class || "integrity",
    claimLevel: raw.claimLevel || (stanceValue === "inform" ? "observation" : "finding"),
    stance: stanceValue,
    summary: raw.summary || raw.hint || "",
    surface,
    evidence,
    nextAllowedStep: raw.nextAllowedStep || stance.nextAllowedStep || "none",
    blockedActions
  });

  // Annotate with stance metadata for the renderer (and tests).
  finding.why = stance.why;
  finding.missingKey = stance.missingKey;
  finding.notAllowed = stance.notAllowed;
  finding.userDecisionNeeded = stance.userDecisionNeeded;
  finding.targetPath = raw.targetPath || "";
  finding.policyMatches = matches;

  // T-210: attach probe metadata when the next step references a live probe.
  const probe = pickProbeMetadata(finding);
  if (probe) finding.proposedProbe = probe;

  return finding;
}

// Apply mode-driven surface.limits per docs/schemas.md and the fixture goldens.
// In safe mode, every surface carries `safe-mode-no-loader-key` so consumers
// know loader-side evidence (e.g. live /hooks output) was not collected.
function applySafeModeLimits(surface, mode) {
  if (mode !== "safe") return surface;
  const existing = Array.isArray(surface?.limits) ? surface.limits : [];
  if (existing.includes("safe-mode-no-loader-key")) return surface;
  return { ...surface, limits: [...existing, "safe-mode-no-loader-key"] };
}

function defaultBlockedActions(id, stance) {
  if (stance === "block") return ["mutate-without-consent", "claim-fixed"];
  if (stance === "protect") return [];
  if (stance === "prepare") return ["mutate-without-consent", "claim-fixed"];
  if (stance === "probe") return ["mutate-without-consent", "claim-fixed"];
  if (id.startsWith("plugin.")) return ["call unused", "delete", "quarantine"];
  return [];
}

function countStances(findings) {
  const counts = {
    inform: 0, watch: 0, review: 0, probe: 0,
    protect: 0, prepare: 0, repair: 0, block: 0
  };
  for (const f of findings) {
    if (counts[f.stance] != null) counts[f.stance] += 1;
  }
  return counts;
}

function collectBoundaries(findings) {
  const boundaries = [];
  for (const f of findings) {
    if (f.stance !== "protect") continue;
    boundaries.push({
      type: pickBoundaryType(f),
      path: f.targetPath || "",
      reason: f.why || "boundary",
      findingId: f.id
    });
  }
  return boundaries;
}

function pickBoundaryType(finding) {
  const sc = finding.surface?.scopeClass;
  if (sc === "sector-boundary" || sc === "parent-contains-boundary") return "sector-boundary";
  if (
    finding.surface?.sensitivityClass === "secret-adjacent"
    || finding.surface?.sensitivityClass === "secret-content"
  ) {
    return "secret-adjacent";
  }
  return "protected";
}

// Primary finding selection per docs/report-grammar.md §2:
// 1. current breakage (block)
// 2. executable/lifecycle impact (prepare on integrity)
// 3. load-bearing confidence (probe)
// 4. user-facing confusion (review)
// 5. number of dependent findings
// 6. lowest safe next step (watch/inform last)
const PRIMARY_PRIORITY = ["block", "prepare", "probe", "review", "protect", "watch", "inform"];
function pickPrimary(findings) {
  if (findings.length === 0) return null;
  for (const stance of PRIMARY_PRIORITY) {
    const match = findings.find((f) => f.stance === stance);
    if (match) return match;
  }
  return findings[0];
}

// ---------- T-210 probe metadata ----------

const PROBE_CATALOG = {
  "/hooks": {
    class: "loader",
    mayExecute: "Claude session load, hook registry load",
    consent: "medium"
  },
  "/doctor": {
    class: "loader",
    mayExecute: "Claude session load",
    consent: "medium"
  },
  "/mcp": {
    class: "loader",
    mayExecute: "may start or contact MCP depending behavior",
    consent: "high"
  },
  "/skills": {
    class: "loader",
    mayExecute: "Claude session load, skill registry load",
    consent: "medium"
  },
  "claude --debug hooks": {
    class: "behavioral",
    mayExecute: "may run hooks",
    consent: "high"
  },
  "claude --debug mcp": {
    class: "behavioral",
    mayExecute: "may start MCP servers",
    consent: "high"
  }
};

function pickProbeMetadata(finding) {
  // Shell-ambiguous hook commands recommend `claude --debug hooks` (catalog: behavioral, consent high).
  if (finding.id === "settings.hook_command_shell_ambiguous") {
    return { reference: "claude --debug hooks", ...PROBE_CATALOG["claude --debug hooks"] };
  }
  if (finding.id === "settings.mcp_command_missing") {
    return { reference: "/mcp", ...PROBE_CATALOG["/mcp"] };
  }
  const stepText = `${finding.nextAllowedStep || ""} ${finding.missingKey || ""} ${finding.why || ""}`;
  for (const [key, meta] of Object.entries(PROBE_CATALOG)) {
    if (stepText.includes(key)) return { reference: key, ...meta };
  }
  return null;
}

// ---------- detectors (T-201, T-205, T-205a, T-208) ----------
// Each detector returns DetectorOutput | null | DetectorOutput[].
// DetectorOutput = {
//   id, class, surfaceHints, surface?, evidence, missingKeys,
//   summary, targetPath, blockedActions?, nextAllowedStep?, claimLevel?, forceStance?
// }

function detectSettingsInvalidJson(context) {
  if (context.settings.ok) return null;
  return {
    id: "settings.invalid_json",
    class: "integrity",
    targetPath: context.settingsFile,
    surfaceHints: {},
    evidence: {
      structural: [`parser error: ${context.settings.error}`]
    },
    missingKeys: ["valid settings required before hook or MCP inference"],
    summary: "settings.json is invalid JSON",
    nextAllowedStep: "generate patch preview or edit manually",
    blockedActions: ["dependent hook and MCP inference"]
  };
}

function detectHookPathDangling(context) {
  if (!context.settings.ok || !context.settings.value) return [];
  const out = [];
  const seen = new Set();
  for (const command of collectHookCommands(context.settings.value)) {
    if (looksShellAmbiguous(command)) continue;
    for (const candidate of extractAbsolutePaths(command)) {
      if (!isPluginCacheCommand(candidate)) continue;
      if (existsSync(candidate)) continue;
      const dedupe = `${context.settingsFile}|${candidate}`;
      if (seen.has(dedupe)) continue;
      seen.add(dedupe);
      out.push({
        id: "settings.hook_path_dangling",
        class: "integrity",
        targetPath: context.settingsFile,
        surfaceHints: {},
        evidence: {
          structural: [
            "settings parsed",
            "hook command contains an absolute path that does not exist"
          ]
        },
        missingKeys: ["live /hooks view", "hook verification"],
        summary: "settings hook references a missing direct executable path",
        nextAllowedStep: "generate a patch preview only",
        blockedActions: ["mutate settings", "delete plugin cache", "claim fixed"]
      });
    }
  }
  return out;
}

function detectHookCommandShellAmbiguous(context) {
  if (!context.settings.ok || !context.settings.value) return [];
  const out = [];
  const seen = new Set();
  for (const command of collectHookCommands(context.settings.value)) {
    if (!looksShellAmbiguous(command)) continue;
    if (!mentionsPluginCache(command)) continue;
    if (seen.has(command)) continue;
    seen.add(command);
    out.push({
      id: "settings.hook_command_shell_ambiguous",
      class: "integrity",
      targetPath: context.settingsFile,
      surface: makeSurfaceClassification({
        surfaceClass: "executable-surface",
        ownerClass: "user-owned",
        loadBearingClass: "possibly-load-bearing",
        sensitivityClass: "private-path",
        executionClass: "shell-expansion-risk",
        rollbackClass: "snapshot-possible",
        scopeClass: "in-scope",
        confidence: "medium"
      }),
      evidence: {
        structural: ["settings parsed", "command string references plugin cache text"]
      },
      missingKeys: ["shell parse certainty", "consented hook debug trace"],
      summary: "hook command contains a plugin-cache-looking path inside shell syntax",
      nextAllowedStep: "run a live hook debug probe after consent",
      blockedActions: ["patch command string", "call hook broken with certainty", "claim fixed"]
    });
  }
  return out;
}

function detectMcpCommandMissing(context) {
  if (!context.settings.ok || !context.settings.value?.mcpServers) return [];
  const out = [];
  for (const [name, server] of Object.entries(context.settings.value.mcpServers)) {
    if (!server || typeof server.command !== "string") continue;
    const command = server.command;
    if (!command.startsWith("/")) continue;
    // T-401: in safe mode, refuse the existsSync probe when the path crosses
    // a sector boundary (per docs/safe-mode.md "Hard Rules"). Reading the
    // string from settings is fine; checking the filesystem under a secret
    // sector is not. Emit nothing rather than a misleading partial finding.
    if (context.mode === "safe" && isSectorBoundaryPath(command, context)) continue;
    if (existsSync(command)) continue;
    out.push({
      id: "settings.mcp_command_missing",
      class: "integrity",
      targetPath: context.settingsFile,
      surfaceHints: {},
      evidence: {
        structural: [
          "settings parsed",
          `mcpServers.${name}.command does not exist: ${command}`
        ]
      },
      missingKeys: ["MCP server start verification"],
      summary: `MCP server "${name}" references a missing absolute command path`,
      nextAllowedStep: "generate a patch preview; do not start the server",
      blockedActions: ["start MCP server", "claim fixed"]
    });
  }
  return out;
}

// T-205a: split plugin.stale_versions into expected_orphan (within grace, watch)
// vs cache_unreferenced (outside grace, probe).
function detectPluginExpectedOrphan(context) {
  return pluginCacheOrphans(context).filter((entry) => entry.withinGrace).map((entry) => ({
    id: "plugin.expected_orphan",
    class: "hygiene",
    targetPath: entry.path,
    surfaceHints: { isPluginCacheVersionDir: true },
    evidence: {
      structural: ["installed registry parsed", "version not referenced by installed registry"],
      freshness: ["within-grace-period"]
    },
    missingKeys: ["live active-session reference check"],
    summary: "old plugin cache version appears to be an expected orphan",
    nextAllowedStep: "no action now",
    blockedActions: ["call unused", "quarantine", "delete"]
  }));
}

function detectPluginCacheUnreferenced(context) {
  return pluginCacheOrphans(context).filter((entry) => !entry.withinGrace).map((entry) => ({
    id: "plugin.cache_unreferenced",
    class: "hygiene",
    targetPath: entry.path,
    surfaceHints: { isPluginCacheVersionDir: true },
    evidence: {
      structural: [
        "installed registry parsed",
        "version directory is outside known references"
      ]
    },
    missingKeys: [
      "active session, process reference, or retention policy evidence",
      "behavioral-key"
    ],
    summary: "plugin cache version is not referenced by known registry evidence",
    nextAllowedStep: "run freshness probe or review manually",
    blockedActions: ["call unused", "delete", "quarantine without Housekeeper rollback proof"]
  }));
}

function pluginCacheOrphans(context) {
  const livePaths = new Set(context.pluginEntries.map((entry) => entry.installPath).filter(Boolean));
  const cacheRoot = path.join(context.home, "plugins", "cache");
  const out = [];
  for (const versionDir of listCacheVersionDirs(cacheRoot)) {
    if (livePaths.has(versionDir)) continue;
    const ageMs = context.now - mtimeMs(versionDir);
    out.push({ path: versionDir, withinGrace: ageMs <= PLUGIN_ORPHAN_GRACE_MS });
  }
  return out;
}

function detectPluginDuplicateRegistration(context) {
  const out = [];
  const byKey = new Map();
  for (const entry of context.pluginEntries) {
    if (!byKey.has(entry.key)) byKey.set(entry.key, []);
    byKey.get(entry.key).push(entry);
  }
  for (const [key, entries] of byKey.entries()) {
    const scopes = new Set(entries.map((entry) => `${entry.scope || "unknown"}:${entry.projectPath || ""}`));
    if (entries.length > 1 || scopes.size > 1) {
      out.push({
        id: "plugin.duplicate_registration",
        class: "divergence",
        targetPath: path.join(context.home, "plugins", "installed_plugins.json"),
        surfaceHints: {},
        evidence: {
          structural: [
            `${key} has ${entries.length} registrations across ${scopes.size} scope(s)`
          ]
        },
        missingKeys: ["user-intent"],
        summary: `${key} is registered in multiple scopes`,
        nextAllowedStep: "review intent before any change",
        blockedActions: ["mutate registry without intent confirmation"]
      });
    }
  }
  return out;
}

function detectPluginCacheSize(context) {
  const cacheRoot = path.join(context.home, "plugins", "cache");
  const sizes = listCacheVersionDirs(cacheRoot).map((versionDir) => ({
    path: versionDir,
    sizeBytes: dirSize(versionDir)
  }));
  if (sizes.length === 0) return null;
  const total = sizes.reduce((sum, item) => sum + item.sizeBytes, 0);

  // Group by `<market>/<plugin>` so the user can see which plugins own the
  // bulk of the cache budget. Rank by total bytes, take the top 3.
  const grouped = new Map();
  for (const entry of sizes) {
    const rel = path.relative(cacheRoot, entry.path).split(path.sep);
    if (rel.length < 2) continue;
    const key = `${rel[0]}/${rel[1]}`;
    const prior = grouped.get(key) || { totalBytes: 0, versionCount: 0 };
    grouped.set(key, {
      totalBytes: prior.totalBytes + entry.sizeBytes,
      versionCount: prior.versionCount + 1
    });
  }
  const top = [...grouped.entries()]
    .sort((a, b) => b[1].totalBytes - a[1].totalBytes)
    .slice(0, 3)
    .map(([key, { totalBytes, versionCount }]) => {
      const versionWord = versionCount === 1 ? "version" : "versions";
      return `largest: ${key} (${formatBytes(totalBytes)} across ${versionCount} ${versionWord})`;
    });

  return {
    id: "plugin.cache_size",
    class: "orientation",
    claimLevel: "observation",
    targetPath: cacheRoot,
    surfaceHints: { isPluginCacheVersionDir: false },
    evidence: {
      structural: [
        `plugin cache contains ${sizes.length} version directories`,
        `total size ${formatBytes(total)}`,
        ...top
      ]
    },
    missingKeys: [],
    summary: `plugin cache uses ${formatBytes(total)} across ${sizes.length} version directories`,
    nextAllowedStep: "none",
    blockedActions: []
  };
}

function detectLocalSkillShadow(context) {
  const localDir = path.join(context.home, "skills");
  const out = [];
  for (const skill of collectSkills(localDir)) {
    if (!context.pluginResources.skills.has(skill.name)) continue;
    out.push({
      id: "registry.local_skill_shadow",
      class: "shadow",
      targetPath: skill.path,
      surfaceHints: {},
      evidence: {
        structural: [
          `local skill name matches plugin-provided skill from ${pluginsFor(context.pluginResources.skills, skill.name)}`
        ]
      },
      missingKeys: ["user-intent"],
      summary: `${skill.name} shadows plugin skill`,
      nextAllowedStep: "decide whether the override is intentional",
      blockedActions: ["overwrite local edits"]
    });
  }
  return out;
}

function detectLocalCommandIdentical(context) {
  return localCommandIdentityFindings(context, true);
}

function detectLocalCommandDiverged(context) {
  return localCommandIdentityFindings(context, false);
}

function localCommandIdentityFindings(context, identical) {
  const localDir = path.join(context.home, "commands");
  const out = [];
  for (const command of collectCommands(localDir)) {
    const pluginCommands = context.pluginResources.commands.get(command.name) || [];
    if (pluginCommands.length === 0) continue;
    const localHash = hashFile(command.path, context);
    const hasIdentical = pluginCommands.some((pluginCommand) => hashFile(pluginCommand.path, context) === localHash);
    if (identical !== hasIdentical) continue;
    out.push({
      id: identical ? "registry.local_command_identical" : "registry.local_command_diverged",
      class: identical ? "shadow" : "divergence",
      targetPath: command.path,
      surfaceHints: {},
      evidence: {
        structural: [
          identical
            ? "local command is byte-identical to plugin version"
            : "local command has diverged from plugin version"
        ]
      },
      missingKeys: ["user-intent"],
      summary: identical
        ? `${command.name} is byte-identical to plugin version`
        : `${command.name} has diverged from plugin version`,
      nextAllowedStep: "review-required",
      blockedActions: ["overwrite local edits"]
    });
  }
  return out;
}

function detectRegistryBrokenFrontmatter(context) {
  const files = [
    ...collectSkills(path.join(context.home, "skills")).map((item) => ({ ...item, type: "skill" })),
    ...collectCommands(path.join(context.home, "commands")).map((item) => ({ ...item, type: "command" }))
  ];
  const out = [];
  for (const file of files) {
    const frontmatter = parseFrontmatter(readText(file.path, context));
    const broken = !frontmatter || (file.type === "skill" ? !frontmatter.name : !frontmatter.description);
    if (!broken) continue;
    out.push({
      id: "registry.broken_frontmatter",
      class: "integrity",
      targetPath: file.path,
      surfaceHints: {},
      evidence: {
        structural: [`${file.name} has missing or incomplete YAML frontmatter`]
      },
      missingKeys: ["valid frontmatter for loader"],
      summary: `${file.name} has missing or incomplete YAML frontmatter`,
      nextAllowedStep: "generate a patch preview",
      blockedActions: ["overwrite without backup"]
    });
  }
  return out;
}

// T-208: housekeeper.interrupted_operation — surface incomplete operation manifests
// even though v0.1 has no mutation. Required by operational-readiness.md §4 +
// protocol-contracts.md §17 + golden #10. Stance is forced to `block`.
function detectInterruptedOperation(context) {
  // T-409: skip cleanly when the operations directory is unreadable; the
  // dedicated `housekeeper.operations_unreadable` finding surfaces the gap
  // instead, and the report's degraded[] entry tells the user why this
  // detector did not run.
  if (!context.operationsDir.exists || context.operationsDir.unreadable) return null;
  const opsDir = context.operationsDir.path;
  const manifests = [];
  for (const name of context.operationsDir.names || []) {
    if (!name.endsWith(".json")) continue;
    const file = path.join(opsDir, name);
    const parsed = readJson(file);
    if (!parsed.ok || !parsed.value) continue;
    if (parsed.value.status === "verified") continue;
    manifests.push({ file, status: parsed.value.status || "unknown" });
  }
  if (manifests.length === 0) return null;
  const first = manifests[0];
  return {
    id: "housekeeper.interrupted_operation",
    class: "integrity",
    targetPath: first.file,
    surface: makeSurfaceClassification({
      surfaceClass: "housekeeper-owned",
      ownerClass: "housekeeper-owned",
      loadBearingClass: "not-load-bearing",
      sensitivityClass: "private-path",
      executionClass: "inert",
      rollbackClass: "manifest-backed",
      scopeClass: "in-scope",
      confidence: "high"
    }),
    evidence: {
      structural: [
        `operation id ${path.basename(first.file, ".json")} exists`,
        "manifest lacks completed verification record"
      ],
      reversibility: ["manifest-present-but-incomplete"]
    },
    missingKeys: ["recovery decision for interrupted operation"],
    summary: "Housekeeper operation manifest is incomplete",
    nextAllowedStep: "inspect operation record and choose recover, archive, or discard",
    blockedActions: [
      "start new mutation operation",
      "overwrite operation manifest",
      "hide Housekeeper self-failure"
    ],
    forceStance: "block"
  };
}

// T-409: housekeeper.config_invalid — emit when policy config exists but is
// malformed JSON. Stance: `inform` (orientation; not a hygiene problem and
// nothing to repair). The audit continues with default policy so dependent
// detectors do not crash. Required by docs/operational-readiness.md §4 +
// docs/state-governance.md §4 ("If Housekeeper state is corrupt: report it").
function detectHousekeeperConfigInvalid(context) {
  const error = context.config && context.config.error;
  if (!error) return null;
  const file = context.config.file || path.join(context.home, "housekeeper", "config.json");
  return {
    id: "housekeeper.config_invalid",
    class: "orientation",
    claimLevel: "observation",
    targetPath: file,
    surface: makeSurfaceClassification({
      surfaceClass: "housekeeper-owned",
      ownerClass: "housekeeper-owned",
      loadBearingClass: "not-load-bearing",
      sensitivityClass: "private-path",
      executionClass: "inert",
      rollbackClass: "snapshot-possible",
      scopeClass: "in-scope",
      confidence: "high"
    }),
    evidence: {
      structural: [
        `Housekeeper config at ${file} could not be parsed`,
        `parser error: ${error}`,
        "audit continued with default policy (no doNotTouch rules)"
      ]
    },
    missingKeys: ["valid Housekeeper policy"],
    summary: "Housekeeper config is invalid JSON; running with defaults",
    nextAllowedStep: "edit the config manually or remove it to restore defaults",
    blockedActions: ["overwrite config without user review"],
    forceStance: "inform"
  };
}

// T-409: housekeeper.operations_unreadable — emit when the operations
// directory exists but cannot be listed (permissions, bad mount, etc.).
// Stance: `inform` AND a `degraded[]` entry so consumers can show the
// limitation in the SCAN DEGRADED section. Required by
// docs/operational-readiness.md §4.
function detectHousekeeperOperationsUnreadable(context) {
  if (!context.operationsDir.unreadable) return null;
  return {
    id: "housekeeper.operations_unreadable",
    class: "orientation",
    claimLevel: "observation",
    targetPath: context.operationsDir.path,
    surface: makeSurfaceClassification({
      surfaceClass: "housekeeper-owned",
      ownerClass: "housekeeper-owned",
      loadBearingClass: "not-load-bearing",
      sensitivityClass: "private-path",
      executionClass: "inert",
      rollbackClass: "manifest-backed",
      scopeClass: "in-scope",
      confidence: "high"
    }),
    evidence: {
      structural: [
        `operations directory exists at ${context.operationsDir.path}`,
        `directory is not readable: ${context.operationsDir.error || "unknown error"}`,
        "interrupted-operation detector skipped due to read failure"
      ]
    },
    missingKeys: ["operations manifest readability"],
    summary: "Housekeeper operations directory is unreadable",
    nextAllowedStep: "fix permissions or report the environment damage",
    blockedActions: ["assume no interrupted operation", "start a new mutation"],
    forceStance: "inform"
  };
}

// T-409: home.not_found — emitted when the requested home directory does not
// exist. Stance: `block` per the user's task requirement; the report still
// renders with a single block finding so the CLI can exit non-zero cleanly
// without throwing.
function detectHomeNotFound(home) {
  return {
    id: "home.not_found",
    class: "integrity",
    targetPath: home,
    surface: makeSurfaceClassification({
      surfaceClass: "external-reference",
      ownerClass: "user-owned",
      loadBearingClass: "unknown",
      sensitivityClass: "unknown",
      executionClass: "inert",
      rollbackClass: "not-applicable",
      scopeClass: "in-scope",
      confidence: "high"
    }),
    evidence: {
      structural: [`requested home does not exist or is not a directory: ${home}`]
    },
    missingKeys: ["accessible Claude home directory"],
    summary: "Claude home directory was not found",
    nextAllowedStep: "verify --home value or create the directory before re-running",
    blockedActions: ["dependent inference", "settings parsing", "plugin scan", "operations scan"],
    forceStance: "block"
  };
}

// T-409: build a minimal Report when home is missing. Skips the normal
// pipeline so missing directories cannot crash downstream detectors.
function earlyReport(home, mode, detectorOutputs) {
  const findings = detectorOutputs.filter(Boolean).map((raw) => buildFinding(raw, {
    home,
    mode,
    policyMatchesFor: () => []
  }));
  const stanceSummary = countStances(findings);
  const boundaries = collectBoundaries(findings);
  const primary = pickPrimary(findings);
  return makeReport({
    schemaVersion: SCHEMA_VERSION,
    mode,
    home,
    generatedAt: new Date().toISOString(),
    primary: primary ? primary.id : null,
    stanceSummary,
    findings,
    boundaries,
    degraded: []
  });
}

// T-402: emit a single orientation finding when the bounded projects walk hit
// a budget. Stance: `inform` (orientation, no claim about completeness). The
// report's SCAN section already shows mode/degraded; this finding lets the
// JSON consumer enumerate the limit hit and the path that was truncated.
function detectScanBudget(context) {
  const scan = context.projectsScan;
  if (!scan || !scan.stopped) return null;
  const reasons = [...new Set(scan.degraded.map((d) => d.reason).filter(Boolean))];
  const budgets = [...new Set(scan.degraded.map((d) => d.budget).filter(Boolean))];
  const reasonText = reasons.join(", ") || "scan-degraded";
  return {
    id: "home.scan_budget_hit",
    class: "orientation",
    claimLevel: "observation",
    targetPath: context.projectsRoot,
    // The projects/ root is claude-managed app data per docs/surface-classification-spec.md
    // §4 (claude-app-data). Pin the surface explicitly so the stance engine
    // does not fall through to "unknown owner -> block".
    surface: makeSurfaceClassification({
      surfaceClass: "claude-app-data",
      ownerClass: "claude-managed",
      loadBearingClass: "not-load-bearing",
      sensitivityClass: "private-path",
      executionClass: "inert",
      rollbackClass: "not-applicable",
      scopeClass: "in-scope",
      confidence: "high"
    }),
    evidence: {
      structural: [
        `bounded scan stopped after ${scan.entries.length} entries`,
        `budget hit: ${reasonText}`,
        ...budgets.map((b) => `limit: ${b}`)
      ]
    },
    missingKeys: ["full-traversal of remaining project history"],
    summary: `bounded scan stopped early at ${context.projectsRoot}`,
    nextAllowedStep: "rerun with explicit larger budget or narrower scope",
    blockedActions: [
      "summarize scan as complete",
      "propose action from partial project-history evidence"
    ]
  };
}

// ---------- detector primitives ----------

function loadContext(home, options) {
  const pluginsFile = path.join(home, "plugins", "installed_plugins.json");
  const settingsFile = path.join(home, "settings.json");
  const installed = readJson(pluginsFile);
  const settings = readJson(settingsFile);
  const config = loadConfig(home, options.configPath);
  const pluginEntries = flattenPluginEntries(installed.value, home);
  const pluginResources = collectPluginResources(pluginEntries);
  const mode = options.mode || "diagnose";
  const scanLimits = options.scanLimits || {
    maxFiles: DEFAULT_MAX_FILES,
    maxBytes: DEFAULT_MAX_BYTES,
    maxWallMs: DEFAULT_MAX_WALL_MS
  };

  // T-402: bounded walk of <home>/projects/. Records degraded entries when
  // any budget is hit. Detector reads `projectsScan` to emit the orientation
  // finding; the renderer reads context.degraded via report.degraded.
  const projectsRoot = path.join(home, "projects");
  const projectsScan = walkBounded(projectsRoot, scanLimits);
  const degraded = [...projectsScan.degraded];

  // T-409: operations directory readability probe. Records whether the dir
  // exists but cannot be listed (permission denial). The detector reads
  // this to surface a `housekeeper.operations_unreadable` finding and
  // contributes a `degraded[]` entry so SCAN DEGRADED renders.
  const operationsDir = probeOperationsDir(home);
  if (operationsDir.unreadable) {
    degraded.push({
      kind: "scan-degraded",
      reason: "operations-unreadable",
      path: operationsDir.path,
      effect: "interrupted-operation detector skipped",
      nextStep: "fix permissions on the operations directory"
    });
  }

  return {
    home,
    installed,
    settings,
    settingsFile,
    config,
    pluginEntries,
    pluginResources,
    mode,
    scanLimits,
    projectsRoot,
    projectsScan,
    operationsDir,
    degraded,
    now: Date.now()
  };
}

// T-409: probe operations directory for existence and readability without
// throwing. Returns one of three states:
//   { exists: false } — no operations dir; nothing to surface
//   { exists: true, unreadable: true, error } — exists but readdir failed
//   { exists: true, unreadable: false, names } — exists and readable
function probeOperationsDir(home) {
  const opsPath = path.join(home, "housekeeper", "operations");
  if (!existsSync(opsPath)) return { path: opsPath, exists: false, unreadable: false };
  try {
    const names = readdirSync(opsPath);
    return { path: opsPath, exists: true, unreadable: false, names };
  } catch (error) {
    return {
      path: opsPath,
      exists: true,
      unreadable: true,
      error: error.code || error.message || "unknown"
    };
  }
}

function collectPolicyMatches(targetPath, context) {
  if (!context.config.rules || context.config.rules.length === 0) return [];
  const matches = [];
  for (const rule of context.config.rules) {
    if (rule.path && pathMatchesProtection(rule.path, targetPath, context.home)) {
      matches.push({
        type: "doNotTouch",
        pattern: rule.path,
        path: targetPath,
        reason: rule.reason || "do-not-touch rule",
        scope: rule.scope || "user",
        effect: "stance protect, action none"
      });
    }
  }
  return matches;
}

function readJson(file) {
  if (!existsSync(file)) return { ok: true, missing: true, value: null, file };
  try {
    return { ok: true, missing: false, value: JSON.parse(readFileSync(file, "utf8")), file };
  } catch (error) {
    return { ok: false, missing: false, value: null, file, error: error.message };
  }
}

function flattenPluginEntries(installed, home) {
  if (!installed || typeof installed !== "object" || !installed.plugins) return [];
  if (Array.isArray(installed.plugins)) {
    return installed.plugins.filter((record) => record && typeof record === "object").map((record) => {
      const marketplace = record.marketplace || "unknown";
      const name = record.name || "unknown";
      const version = record.version || "unknown";
      return {
        key: `${marketplace}/${name}`,
        scope: record.scope || "user",
        ...record,
        installPath: record.installPath
          || path.join(home, "plugins", "cache", marketplace, name, version)
      };
    });
  }
  const entries = [];
  for (const [key, records] of Object.entries(installed.plugins)) {
    if (!Array.isArray(records)) continue;
    for (const record of records) entries.push({ key, ...record });
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

function collectHookCommands(value) {
  const commands = [];
  const visit = (node) => {
    if (Array.isArray(node)) for (const child of node) visit(child);
    else if (node && typeof node === "object") {
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

function looksShellAmbiguous(command) {
  // Heuristic: command substitution or env-var expansion of plugin paths makes
  // direct-existence reasoning unsafe (per docs/loader-semantics.md §5).
  return /\$\{?[A-Z_]/.test(command) || /`[^`]+`/.test(command) || /\$\([^)]+\)/.test(command);
}

function mentionsPluginCache(command) {
  return command.includes("plugins/cache") || command.includes("CLAUDE_PLUGIN_ROOT");
}

function isPluginCacheCommand(candidate) {
  return candidate.includes(`${path.sep}plugins${path.sep}cache${path.sep}`);
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

// T-401: sector-boundary predicate per docs/surface-classification-spec.md §7
// and docs/safe-mode.md "Hard Rules". Used in safe mode to skip content reads
// under secret-adjacent subtrees. Metadata (existsSync of the parent dir,
// listing entries) stays allowed because it does not open file contents.
function isSectorBoundaryPath(target, context) {
  if (!target) return false;
  const home = context && context.home;
  const norm = path.normalize(target);
  if (home) {
    const credentialsRoot = path.normalize(path.join(home, "credentials"));
    if (norm === credentialsRoot || norm.startsWith(credentialsRoot + path.sep)) return true;
  }
  const base = path.basename(norm);
  if (base.startsWith(".env") || base === ".env") return true;
  // Path segment match for sector words used in the surface spec.
  const segments = norm.split(path.sep);
  for (const seg of segments) {
    if (seg === "credentials") return true;
    if (seg === "secrets") return true;
  }
  return false;
}

function readText(file, context) {
  // T-401: in safe mode, never open content under sector-boundary paths.
  if (context && context.mode === "safe" && isSectorBoundaryPath(file, context)) return "";
  try { return readFileSync(file, "utf8"); }
  catch { return ""; }
}

function hashFile(file, context) {
  // T-401: same content-read guard as readText.
  if (context && context.mode === "safe" && isSectorBoundaryPath(file, context)) return "";
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

function readdirSafe(dir) {
  try { return readdirSync(dir); }
  catch { return []; }
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

function isDirectory(file) {
  try { return statSync(file).isDirectory(); }
  catch { return false; }
}

function size(file) {
  try { return statSync(file).size; }
  catch { return 0; }
}

function dirSize(root) {
  return walk(root).reduce((sum, file) => sum + size(file), 0);
}

function mtimeMs(file) {
  try { return statSync(file).mtimeMs; }
  catch { return Date.now(); }
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
}
