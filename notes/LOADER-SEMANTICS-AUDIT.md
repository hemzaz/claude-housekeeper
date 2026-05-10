# Loader Semantics Audit

Verification of every claim in `docs/loader-semantics.md` against current public Claude Code documentation, fetched 2026-05-10.

URLs audited:

- https://code.claude.com/docs/en/configuration  — reachable
- https://code.claude.com/docs/en/plugins  — reachable
- https://code.claude.com/docs/en/plugins-reference  — reachable
- https://code.claude.com/docs/en/slash-commands  — **content has moved to `/en/skills`**; see §4 finding
- https://code.claude.com/docs/en/hooks  — reachable
- https://code.claude.com/docs/en/mcp  — reachable
- https://code.claude.com/docs/en/debug-your-config  — reachable

Status legend per claim block:
- **STILL_ACCURATE** — current docs match the spec.
- **CHANGED** — docs now say something different (or contradict).
- **NOW_UNKNOWN** — URL not reachable / section removed / silent on the claim.
- **NEW_RULE_AVAILABLE** — docs add new constraint Housekeeper should know.

---

## §1 Settings Scopes

**Claims under audit:** Managed/User/Project/Local scopes; precedence Managed > CLI args > Local > Project > User; file paths `~/.claude/settings.json`, `.claude/settings.json`, `.claude/settings.local.json`, `~/.claude.json`, `.mcp.json`.

- **Status:** STILL_ACCURATE.
- **Citation (configuration):**
  > "When the same setting is configured in multiple scopes, more specific scopes take precedence:
  > 1. Managed (highest) - can't be overridden by anything
  > 2. Command line arguments - temporary session overrides
  > 3. Local - overrides project and user settings
  > 4. Project - overrides user settings
  > 5. User (lowest) - applies when nothing else specifies the setting"
- **Citation (paths):**
  > "Settings | `~/.claude/settings.json` | `.claude/settings.json` | `.claude/settings.local.json`"
  > "MCP servers | `~/.claude.json` | `.mcp.json` | `~/.claude.json` (per-project)"
  > "Other configuration is stored in `~/.claude.json`. This file contains your OAuth session, MCP server configurations for user and local scopes, per-project state (allowed tools, trust settings), and various caches."
- **NEW_RULE_AVAILABLE — Windows path resolution.** Spec is silent. Docs add:
  > "On Windows, paths shown as `~/.claude` resolve to `%USERPROFILE%\.claude`."
- **Impact on Housekeeper:** None for v0.1 (project is darwin-only per env). Note for future Windows support: every `~/.claude/...` probe must resolve `%USERPROFILE%`. The black-box test list (§9) already names "Windows paths" as required.
- **Recommendation:** No action for v0.1. Add a Windows path note to spec doc when Windows scope is added.

---

## §2 Plugin Enablement (and 7-day grace period)

**Claims under audit:** Plugins enabled via settings; project overrides user; local opts out; managed force-enable cannot be locally disabled; managed marketplace restrictions enforced before network/FS; marketplace plugins copied to `~/.claude/plugins/cache`; each version own directory; previous version marked orphaned after update/uninstall; **orphans removed automatically after about 7 days**; grace period exists for concurrent sessions.

- **Status:** STILL_ACCURATE — including the precise "7 days" number.
- **Citation (plugins-reference, §"Plugin caching and file resolution"):**
  > "For security and verification purposes, Claude Code copies *marketplace* plugins to the user's local **plugin cache** (`~/.claude/plugins/cache`) rather than using them in-place."
  > "Each installed version is a separate directory in the cache. When you update or uninstall a plugin, the previous version directory is marked as orphaned and removed automatically 7 days later. The grace period lets concurrent Claude Code sessions that already loaded the old version keep running without errors."
  > "Claude's Glob and Grep tools skip orphaned version directories during searches, so file results don't include outdated plugin code."
- **Citation (plugins-reference, §"Plugin scopes" table):**
  > "`managed` | Managed settings | Managed plugins (read-only, update only)"
- **Citation (plugins, §"Test your plugins locally"):**
  > "Marketplace plugins force-enabled by managed settings are the only exception and cannot be overridden."
- **NEW_RULE_AVAILABLE — `${CLAUDE_PLUGIN_ROOT}` description tightens the orphan story.** Plugins-reference §"Plugin path variables":
  > "`${CLAUDE_PLUGIN_ROOT}` ... This path changes when the plugin updates. The previous version's directory remains on disk for about seven days after an update before cleanup, but treat it as ephemeral and do not write state here."
  This corroborates the 7-day window with a second authoritative quote.
- **NEW_RULE_AVAILABLE — `${CLAUDE_PLUGIN_DATA}` location.** Plugins-reference:
  > "The `${CLAUDE_PLUGIN_DATA}` directory resolves to `~/.claude/plugins/data/{id}/`, where `{id}` is the plugin identifier with characters outside `a-z`, `A-Z`, `0-9`, `_`, and `-` replaced by `-`. For a plugin installed as `formatter@my-marketplace`, the directory is `~/.claude/plugins/data/formatter-my-marketplace/`."
  Spec marks "exact local marker file semantics" as Unknown — `${CLAUDE_PLUGIN_DATA}` path encoding is now documented.
- **Impact on Housekeeper:** Confirms `expected-orphan` evidence band. Detector that classifies a `~/.claude/plugins/cache/<plugin>/<old-version>/` dir aged < 7 days as `expected-orphan` is on solid ground. Detector for `~/.claude/plugins/data/` should use the documented id-mangling rule (`[^a-zA-Z0-9_-]` → `-`) when correlating with `enabledPlugins` entries of the form `name@marketplace`.
- **Recommendation:** No action for the 7-day claim. Update spec doc Unknowns to remove "exact local marker file semantics" — the data dir encoding is now documented. Add an `id-mangling` helper to the planner backlog so any data-dir correlation uses the documented transform rather than guessing.

---

## §3 Plugin Structure

**Claims under audit:** Plugin root components — `.claude-plugin/plugin.json`, `skills/`, `commands/`, `agents/`, `hooks/`, `.mcp.json`, `.lsp.json`, `monitors/`, `bin/`, `settings.json`, `output-styles/`, `themes/`. Plus: name = namespace; plugin skills namespaced; `commands/` is legacy/flat MD with `skills/` recommended; `bin/` added to Bash PATH; component paths relative to plugin root and start with `./`; `skills` custom paths additive; commands/agents/output-styles/themes/monitors custom paths replace defaults; symlinks preserved.

- **Status:** STILL_ACCURATE on all twelve enumerated points.
- **Citation (plugins, table):**
  > "`.claude-plugin/` ... Contains plugin.json manifest"
  > "`skills/` ... Skills as `<name>/SKILL.md` directories"
  > "`commands/` ... Skills as flat Markdown files. Use `skills/` for new plugins"
  > "`agents/` ... Custom agent definitions"
  > "`hooks/` ... Event handlers in `hooks.json`"
  > "`.mcp.json` ... MCP server configurations"
  > "`.lsp.json` ... LSP server configurations for code intelligence"
  > "`monitors/` ... Background monitor configurations in `monitors.json`"
  > "`bin/` ... Executables added to the Bash tool's `PATH` while the plugin is enabled"
  > "`settings.json` ... Default settings applied when the plugin is enabled"
- **Citation (plugins-reference, §"Custom paths replace vs add to defaults"):**
  > "**Replaces the default**: `commands`, `agents`, `outputStyles`, `experimental.themes`, `experimental.monitors`. ... To keep the default and add more, list it explicitly: `\"commands\": [\"./commands/\", \"./extras/\"]`"
  > "**Adds to the default**: `skills`. The default `skills/` directory is always scanned, and directories listed in `skills` are loaded alongside it"
- **Citation (plugins-reference, §"Symbolic links to external files"):**
  > "Symlinks are preserved in the cache rather than dereferenced, and they resolve to their target at runtime."
- **NEW_RULE_AVAILABLE — `themes/` is `experimental`.** Plugins-reference manifest schema labels themes as `experimental.themes` and explicitly tags themes/monitors as "experimental components." Spec lists `themes/` as documented without the experimental qualifier.
- **NEW_RULE_AVAILABLE — Plugin root `CLAUDE.md` is NOT loaded.** Plugins-reference:
  > "A `CLAUDE.md` file at the plugin root is not loaded as project context. Plugins contribute context through skills, agents, and hooks rather than CLAUDE.md."
- **NEW_RULE_AVAILABLE — Plugins cannot reach outside their directory.** Plugins-reference:
  > "Installed plugins cannot reference files outside their directory. Paths that traverse outside the plugin root (such as `../shared-utils`) will not work after installation because those external files are not copied to the cache."
- **Impact on Housekeeper:** Layout detector should tag `themes/` and `monitors/` with an `experimental` flag rather than treating them as first-class. A plugin-root `CLAUDE.md` is a misconfiguration signal worth surfacing. The "no parent traversal" rule justifies a finding when a plugin's hook command contains `../`.
- **Recommendation:** Update spec doc §3 to mark `themes/` and `monitors/` as experimental, and add the plugin-root `CLAUDE.md` no-load rule and the no-parent-traversal rule to the documented set. No detector change required for v0.1.

---

## §4 Skills And Commands

**Claims under audit:** Skills at `~/.claude/skills/<name>/SKILL.md`; custom commands merged into skills; `.claude/commands/deploy.md` and `.claude/skills/deploy/SKILL.md` both create `/deploy`; `.claude/commands/` files keep working; plugin skills namespaced; bodies load only when used; shell injection runs before Claude sees content unless `disableSkillShellExecution`; conflict precedence enterprise > personal > project; skill > legacy command on name collision.

- **Status:** STILL_ACCURATE on every itemized claim — but **the cited source URL has moved.**
- **CHANGED — URL drift.** Spec cites `/docs/en/slash-commands`. The current canonical page is `https://code.claude.com/docs/en/skills` (titled "Extend Claude with skills"). The slash-commands path resolves to skill content. The spec should be updated to track the new path, otherwise future re-fetches will keep landing on a moving target.
- **Citation (skills, intro callout):**
  > "Custom commands have been merged into skills. A file at `.claude/commands/deploy.md` and a skill at `.claude/skills/deploy/SKILL.md` both create `/deploy` and work the same way. Your existing `.claude/commands/` files keep working. Skills add optional features: a directory for supporting files, frontmatter to control whether you or Claude invokes them, and the ability for Claude to load them automatically when relevant."
- **Citation (skills, §"Where skills live"):**
  > "When skills share the same name across levels, enterprise overrides personal, and personal overrides project. Plugin skills use a `plugin-name:skill-name` namespace, so they cannot conflict with other levels. If you have files in `.claude/commands/`, those work the same way, but if a skill and a command share the same name, the skill takes precedence."
- **Citation (skills, §"Inject dynamic context"):**
  > "To disable this behavior for skills and custom commands from user, project, plugin, or additional-directory sources, set `\"disableSkillShellExecution\": true` in settings. Each command is replaced with `[shell command execution disabled by policy]` instead of being run. Bundled and managed skills are not affected."
- **NEW_RULE_AVAILABLE — Live change detection / nested discovery.** The skills page documents two behaviors that bear on a Housekeeper that scans the home directory:
  > "Claude Code watches skill directories for file changes. Adding, editing, or removing a skill under `~/.claude/skills/`, the project `.claude/skills/`, or a `.claude/skills/` inside an `--add-dir` directory takes effect within the current session without restarting. Creating a top-level skills directory that did not exist when the session started requires restarting Claude Code so the new directory can be watched."
  > "When you work with files in subdirectories, Claude Code automatically discovers skills from nested `.claude/skills/` directories."
  This means Housekeeper's enumeration must treat nested `.claude/skills/` discovered under any cwd subtree as in-scope, not just the root.
- **NEW_RULE_AVAILABLE — `skillOverrides` settings key.** New since spec was written:
  > "The `skillOverrides` setting controls skill visibility from your settings instead of the skill's own frontmatter. Use it for skills whose SKILL.md you don't want to edit ... Each key is a skill name and each value is one of four states: `\"on\"`, `\"name-only\"`, `\"user-invocable-only\"`, `\"off\"`. ... Plugin skills are not affected by `skillOverrides`."
  Affects "appears to shadow" reasoning — a skill present on disk but listed `"off"` in `skillOverrides` is still effectively hidden.
- **NEW_RULE_AVAILABLE — `--plugin-dir` precedence override.** Plugins doc:
  > "When a `--plugin-dir` plugin has the same name as an installed marketplace plugin, the local copy takes precedence for that session. ... Marketplace plugins force-enabled by managed settings are the only exception and cannot be overridden."
- **Impact on Housekeeper:** Detector for "shadowed skill" must consult `skillOverrides` in user/project/local settings before claiming shadow. Black-box test list §9 already includes most precedence cases — add a `skillOverrides` test. The URL drift means the spec doc's source list is stale.
- **Recommendation:** Update spec doc §4 source URL from `slash-commands` to `skills`. Add `skillOverrides` to the documented precedence machinery in §4. Add a `nested-skill-discovery` note. No v0.1 detector blocked, but skill-shadow reasoning must be marked `probe` until `skillOverrides` is consulted.

---

## §5 Hooks

**Claims under audit:** Hook locations (six sources); event/matcher/handler structure; parallel execution; identical handler dedup; command dedup by string; HTTP dedup by URL; `${CLAUDE_PLUGIN_ROOT}` changes on update; `${CLAUDE_PLUGIN_DATA}` survives updates; SessionStart fires on startup/resume/clear/compact and should be fast; SessionStart stdout adds context; `CLAUDE_ENV_FILE`; `/hooks` lists active configurations; `/doctor` reports schema errors; `claude --debug hooks` records evaluation; matcher values are strings (not arrays), case-sensitive.

- **Status:** STILL_ACCURATE on every itemized claim.
- **Citation (hooks, §"Handler Deduplication"):**
  > "All matching hooks run in parallel, and identical handlers are deduplicated automatically."
  > "Command hooks are deduplicated by command string"
  > "HTTP hooks are deduplicated by URL"
- **Citation (hooks, §"Plugin Path Variables"):**
  > "`${CLAUDE_PLUGIN_ROOT}`: the plugin's installation directory. Changes on each plugin update."
  > "`${CLAUDE_PLUGIN_DATA}`: the plugin's persistent data directory, for dependencies and state that should survive plugin updates"
- **Citation (hooks, SessionStart matcher table):**
  > "`startup` | New session"
  > "`resume` | `--resume`, `--continue`, or `/resume`"
  > "`clear` | `/clear`"
  > "`compact` | Auto or manual compaction"
- **Citation (hooks, §"Matcher Behavior"):**
  > "Matchers are strings, not arrays, and are case-sensitive for tool-name matching."
- **Citation (hooks, §"The /hooks Menu"):**
  > "Type `/hooks` in Claude Code to open a read-only browser for your configured hooks. The menu shows every hook event with a count of configured hooks, lets you drill into matchers, and shows the full details of each hook handler."
  > Each hook is labeled with a source: `User`, `Project`, `Local`, `Plugin`, `Session`, `Built-in`.
- **Citation (debug-your-config):**
  > "An array value is a schema error: Claude Code shows a settings error notice, `/doctor` reports the validation failure, and the hook entry is dropped so it won't appear in `/hooks`."
- **NEW_RULE_AVAILABLE — explicit Spec §5 Unknown about merge order is partially answered.** `/hooks` menu's six source labels (User / Project / Local / Plugin / Session / Built-in) suggest the source attribution is per-handler at runtime. Docs still do not explicitly state a deterministic merge order for handlers across these sources beyond "all matching handlers run in parallel" and the dedup rules. So merge-order remains formally undocumented, but the source-label set is now nailed down.
- **NEW_RULE_AVAILABLE — additional hook events present in plugins-reference.** The plugins-reference table mentions `InstructionsLoaded`, `ConfigChange`, `CwdChanged`, `FileChanged`, `WorktreeCreate` as plugin-supportable events. Spec §5 Unknown about "whether all hook events in local sample are current public events" is partially clarified.
- **NEW_RULE_AVAILABLE — `CLAUDE_ENV_FILE` available in more events than spec lists.** Hooks doc:
  > "`CLAUDE_ENV_FILE` is also available for Setup, CwdChanged, and FileChanged hooks."
- **Impact on Housekeeper:** First-wedge stance ("classify direct missing path as `prepare`; classify shell-ambiguous as `probe`; do not execute hooks") is unchanged. The `/hooks` source label set is exactly the bucketing Housekeeper should mirror when reporting which scope a hook came from. Hook events `Setup`, `CwdChanged`, `FileChanged`, `WorktreeCreate`, `ConfigChange`, `InstructionsLoaded` should be added to the schema's known-events allowlist so unknown-event findings don't false-positive.
- **Recommendation:** Update spec doc §5 documented-events list to include `Setup, CwdChanged, FileChanged, ConfigChange, InstructionsLoaded, WorktreeCreate`. Add `/hooks`-source labels (User/Project/Local/Plugin/Session/Built-in) as the canonical source taxonomy. No v0.1 detector blocked.

---

## §6 MCP Resolution

**Claims under audit:** Local in `~/.claude.json` (current project, private); Project in `.mcp.json` (current project, shared); User in `~/.claude.json` (all projects, private); duplicate-name precedence Local > Project > User > Plugin > claude.ai connectors; plugins define MCP in plugin `.mcp.json` or inline `plugin.json`; enabled plugin MCP starts at session start; `/reload-plugins` to (dis)connect plugin MCP mid-session; plugin MCP servers see same env as manual.

- **Status:** STILL_ACCURATE for the named scopes and overall ordering. Two refinements.
- **Citation (mcp, §"MCP installation scopes"):**
  > "Local | Current project only | No | `~/.claude.json`"
  > "Project | Current project only | Yes, via version control | `.mcp.json` in project root"
  > "User | All your projects | No | `~/.claude.json`"
- **Citation (mcp, §"Scope hierarchy and precedence"):**
  > "When the same server is defined in more than one place, Claude Code connects to it once, using the definition from the highest-precedence source:
  >   1. Local scope
  >   2. Project scope
  >   3. User scope
  >   5. claude.ai connectors"
  Note: the published list **skips item 4** in the numbered list. Plugin scope is mentioned in the next sentence:
  > "The three scopes match duplicates by name. Plugins and connectors match by endpoint, so one that points at the same URL or command as a server above is treated as a duplicate."
- **CHANGED — Spec says plugin precedes connectors as a numbered tier (4 → 5). Docs collapse plugin and connector into endpoint-matching, not name-matching.** Spec's "Plugin-provided servers" → "claude.ai connectors" is operationally close, but the **matching basis differs**: the three scopes match by name, plugins/connectors match by endpoint. Spec doesn't capture this distinction. This is a meaningful behavioral change for any detector that tries to detect "MCP duplicate" — name-match versus endpoint-match are different keys.
- **Citation (mcp, §"Plugin MCP servers"):**
  > "Plugins define MCP servers in `.mcp.json` at the plugin root or inline in `plugin.json`"
  > "**Automatic lifecycle**: At session startup, servers for enabled plugins connect automatically. If you enable or disable a plugin during a session, run `/reload-plugins` to connect or disconnect its MCP servers"
  > "**User environment access**: Access to same environment variables as manually configured servers"
- **NEW_RULE_AVAILABLE — managed MCP options.** Docs add `managed-mcp.json` exclusive control + allow/deny lists in managed settings:
  > "When you deploy a `managed-mcp.json` file, it takes exclusive control over all MCP servers. Users cannot add, modify, or use any MCP servers other than those defined in this file."
  > "Denylist takes absolute precedence: If a server matches a denylist entry (by name, command, or URL), it will be blocked even if it's on the allowlist"
  Paths: `/Library/Application Support/ClaudeCode/managed-mcp.json` (macOS), `/etc/claude-code/managed-mcp.json` (Linux/WSL), `C:\Program Files\ClaudeCode\managed-mcp.json` (Windows).
- **NEW_RULE_AVAILABLE — `streamable-http` alias.** Docs:
  > "the `type` field accepts `streamable-http` as an alias for `http`."
  Schema linters that allowlist transport types must accept this.
- **Impact on Housekeeper:** MCP duplicate-server detector must use **name** for Local/Project/User comparisons but **endpoint** (URL or command) for Plugin/connector comparisons — these are different matching keys. v0.1 stance ("parse only, do not start") is unchanged. Add `managed-mcp.json` to read-list when scanning for managed policy presence.
- **Recommendation:** **Update spec doc §6 to call out the name-vs-endpoint matching distinction.** Block any "MCP duplicate" detector until it implements both keys. Add `managed-mcp.json` paths to the documented surface. Add `streamable-http` to the recognized type list.

---

## §7 Marketplace And Cache Behavior

**Claims under audit:** Source types include GitHub, git, URL, npm, file, directory, settings inline; managed `strictKnownMarketplaces` restricts sources; blocked sources enforced before network/FS; cache at `~/.claude/plugins/cache`; per-version directories; orphan-on-update/uninstall; **~7 day grace**; grace exists for concurrent sessions; Glob/Grep skip orphans; `${CLAUDE_PLUGIN_ROOT}` changes on update; `${CLAUDE_PLUGIN_DATA}` persists across updates and is deleted on uninstall from the last scope unless `--keep-data`; symlinks preserved; `claude plugin prune --dry-run` for orphaned auto-installed dependencies (not directly installed plugins).

- **Status:** Mostly STILL_ACCURATE; one CHANGED finding on source-type enumeration; one NOW_UNKNOWN on `strictKnownMarketplaces`.
- **Citation (plugins-reference, cache lifecycle — already quoted in §2 above):**
  > "Each installed version is a separate directory in the cache. When you update or uninstall a plugin, the previous version directory is marked as orphaned and removed automatically 7 days later."
  > "Claude's Glob and Grep tools skip orphaned version directories during searches"
- **Citation (plugins-reference, §"plugin uninstall"):**
  > "By default, uninstalling from the last remaining scope also deletes the plugin's `${CLAUDE_PLUGIN_DATA}` directory. Use `--keep-data` to preserve it"
- **Citation (plugins-reference, §"plugin prune"):**
  > "Remove auto-installed plugin dependencies that are no longer required by any installed plugin. Dependencies that Claude Code pulled in to satisfy another plugin's `dependencies` field are removed; plugins you installed directly are never touched."
  > "`--dry-run` | List what would be removed without removing anything"
  > "`claude plugin prune` requires Claude Code v2.1.121 or later."
- **CHANGED — Source type enumeration.** Plugins-reference §"Version management" lists the source types Claude Code recognizes for version resolution as:
  > "The git commit SHA of the plugin's source, for `github`, `url`, `git-subdir`, and relative-path sources in a git-hosted marketplace"
  > "`unknown`, for `npm` sources or local directories not inside a git repository"
  Spec lists "GitHub, git, URL, npm, file, directory, settings inline." The current documented set names `github`, `url`, `git-subdir`, plus relative-path-in-git-marketplace and `npm`. The names "git" (vs `git-subdir`), "file", "directory", "settings inline" are spec-side guesses that don't match the docs verbatim. The underlying behavior is similar, but the **source-type names need to be re-verified** — most likely from the un-audited `/en/plugin-marketplaces` page.
- **NOW_UNKNOWN — `strictKnownMarketplaces`.** I did not find this exact key in the fetched docs. The marketplace restriction story is now described under managed-MCP and `allowedMcpServers` / `deniedMcpServers`, but `strictKnownMarketplaces` as a managed plugin-marketplace key does not appear in the configuration page or plugins-reference text I fetched. Either the key has been renamed or it's documented on a page I didn't fetch (`/en/plugin-marketplaces` is referenced but not in the audited URL set).
- **Impact on Housekeeper:** Cache classification logic is fine. Source-type matching (e.g., when reading `.claude.json` marketplace entries) must use the documented enum (`github`, `url`, `git-subdir`, `npm`) — not the looser spec list. The `strictKnownMarketplaces` claim should be **demoted to NOW_UNKNOWN** until verified against the plugin-marketplaces page; any detector that warns about this key being unset should be blocked from shipping.
- **Recommendation:** Add `https://code.claude.com/docs/en/plugin-marketplaces` to the spec's source list and re-verify `strictKnownMarketplaces` from there before the marketplace-restriction probe ships. Update spec §7 source-type enumeration to match the documented names.

---

## §8 SessionStart Behavior

**Claims under audit:** Runs on start/resume/clear/compact; supports only command and MCP-tool hooks; source matchers are `startup`/`resume`/`clear`/`compact`; stdout adds context; should be fast.

- **Status:** STILL_ACCURATE for matcher set; CHANGED for handler-type restriction.
- **Citation (hooks):** matcher table covers `startup`/`resume`/`clear`/`compact` (quoted in §5 above).
  > "Any text your hook script prints to stdout is added as context for Claude."
- **CHANGED — hook handler types.** Spec says SessionStart "supports only command and MCP-tool hooks." Hooks doc now lists five handler types globally:
  > "The menu displays all five hook types: `command`, `prompt`, `agent`, `http`, `mcp_tool`."
  The hooks doc text I fetched does not explicitly restrict SessionStart to command + mcp_tool only. The spec's "only command and MCP-tool" claim may be outdated. Worth re-verifying against the `/en/hooks` page's per-event support matrix (which I have only partial coverage of in the truncated output).
- **Impact on Housekeeper:** SessionStart-handler-type detector should be marked `probe` until the per-event handler-type matrix is re-read in full.
- **Recommendation:** Re-fetch the hooks page in full (it was truncated) before making any claim about SessionStart handler-type restrictions.

---

## §9 Required Black-Box Tests

- **Status:** STILL_ACCURATE as a test list. None of the listed tests are made obsolete by the doc state.
- **Recommendation:** Add three new tests:
  1. `skillOverrides` shadowing (per §4 NEW_RULE_AVAILABLE).
  2. MCP duplicate by **endpoint** for plugin/connector vs by **name** for scope (per §6 CHANGED).
  3. SessionStart handler types — verify which of `command`/`prompt`/`agent`/`http`/`mcp_tool` are accepted (per §8 CHANGED).

---

## §9.1 Built-In Truth Probes

**Claims under audit:** `/context`, `/memory`, `/skills`, `/agents`, `/hooks`, `/mcp`, `/permissions`, `/doctor`, `/debug`, `/status`.

- **Status:** STILL_ACCURATE.
- **Citation (debug-your-config table):** Every probe in the spec table is present verbatim with the documented behavior:
  > "`/memory` | Which CLAUDE.md and rules files loaded, plus auto-memory entries"
  > "`/skills` | Available skills from project, user, and plugin sources"
  > "`/agents` | Configured subagents and their settings"
  > "`/hooks` | Active hook configurations"
  > "`/mcp` | Connected MCP servers and their status"
  > "`/permissions` | Resolved allow and deny rules currently in effect"
  > "`/doctor` | Configuration diagnostics: invalid keys, schema errors, installation health"
  > "`/debug [issue]` | Enables debug logging for the session and prompts Claude to diagnose using the log output and settings paths"
  > "`/status` | Active settings sources, including whether managed settings are in effect"
- **NEW_RULE_AVAILABLE — `/doctor` interactive escalation.** Docs add:
  > "When `/doctor` reports issues, press `f` to send the diagnostic report to Claude and have it walk through fixes with you."
  This is just informational for Housekeeper.
- **Recommendation:** No action.

---

## §9.2 Clean Configuration Probe

**Claim under audit:** `CLAUDE_CONFIG_DIR` pointing at empty dir + project with no `.claude/.mcp.json/CLAUDE.md` produces a session with no user/project settings, hooks, MCP, plugins, or memory; managed settings still apply.

- **Status:** STILL_ACCURATE — verbatim match.
- **Citation (debug-your-config):**
  > "Point `CLAUDE_CONFIG_DIR` at an empty directory to bypass everything under `~/.claude`, and launch from a directory that has no `.claude` folder, `.mcp.json`, or `CLAUDE.md` so project configuration is also skipped."
  > "```bash\ncd /tmp && CLAUDE_CONFIG_DIR=/tmp/claude-clean claude\n```"
  > "The clean session has no user or project settings, hooks, MCP servers, plugins, or memory."
  > "Managed settings still apply if your organization deploys them, since they live at a system path outside `~/.claude`"
- **NEW_RULE_AVAILABLE — credentials caveat.** Docs add platform-specific behavior the spec is silent on:
  > "On Linux and Windows, you'll be prompted to log in again because credentials are stored under the configuration directory"
  > "On macOS, credentials are in the Keychain and carry over to the clean session"
  Material because Housekeeper's clean-config probe instructions on Linux/Windows must warn the user they will need to re-auth.
- **Impact on Housekeeper:** Spec §9.2 build implication ("It is not safe mode because it launches Claude.") still holds. Add a credentials caveat to docs/probes for non-mac platforms.
- **Recommendation:** Add cross-platform credentials caveat to spec doc §9.2.

---

## §10 Housekeeper Language Restrictions

- **Status:** STILL_ACCURATE — language hedges are conservative and remain warranted given the CHANGED findings above.
- **Recommendation:** No action. The CHANGED findings reinforce the restraint.

---

## Drift summary

| Status | Count | Sections |
|---|---|---|
| STILL_ACCURATE | 7 | §1, §2 (core 7-day claim), §3, §5, §8 (matcher set), §9, §9.1, §9.2 |
| CHANGED | 4 | §4 (URL drifted), §6 (name-vs-endpoint matching), §7 (source-type enumeration), §8 (handler types) |
| NOW_UNKNOWN | 1 | §7 `strictKnownMarketplaces` |
| NEW_RULE_AVAILABLE (additive, not contradicting) | 12 | §1 Windows paths; §2 `${CLAUDE_PLUGIN_DATA}` location; §3 experimental themes/monitors, no plugin-root CLAUDE.md, no parent traversal; §4 `skillOverrides`, nested skill discovery, `--plugin-dir` precedence; §5 additional events, `CLAUDE_ENV_FILE` event coverage; §6 `managed-mcp.json` + `streamable-http`; §9.2 credentials caveat |

(Sub-totals overlap because some sections produce both a STILL_ACCURATE core and NEW_RULE_AVAILABLE additions — the table counts the dominant verdict per top-level claim.)

### Most consequential change for v0.1 scope

**§6 MCP name-vs-endpoint matching.** Spec assumes a single duplicate-detection key (name). Docs explicitly distinguish: scope-vs-scope conflicts match **by name**, plugin/connector duplicates match **by endpoint** (URL or command). Any v0.1 detector that flags MCP duplicates on the basis of name alone will under-report plugin/connector overlap and over-report harmless name reuse across scopes. This is the only change that should block a v0.1 detector from shipping; the 7-day grace claim — the central concern of the audit — is fully corroborated by two independent doc citations and is safe to rely on.

---

## Action items for the planner

1. **PLAN.md / TASKBOARD.md — block any "MCP duplicate" detector** until it implements both name-matching (Local/Project/User) and endpoint-matching (Plugin / claude.ai connector). File: any task referencing `/mcp` or `.mcp.json` parsing.

2. **PLAN.md — re-verify `strictKnownMarketplaces`** against the un-audited `/en/plugin-marketplaces` page before any marketplace-restriction probe ships. Status NOW_UNKNOWN until that re-verification.

3. **PLAN.md — add `skillOverrides` to the skill shadow detector inputs.** A skill present on disk but listed as `"off"` in `skillOverrides` is hidden, not shadowed by another skill. Detector must read `skillOverrides` from user/project/local settings before claiming "appears to shadow."

4. **PLAN.md — re-fetch `/en/hooks` in full** (truncated this run) before any SessionStart handler-type detector ships. Spec's "command and MCP-tool only" may now be outdated; docs list five handler types globally.

5. **docs/loader-semantics.md — update sources list:**
   - `/docs/en/slash-commands` → `/docs/en/skills` (URL drift).
   - Add `/docs/en/plugin-marketplaces` so the §7 `strictKnownMarketplaces` re-verification has a documented source.

6. **docs/loader-semantics.md — additive updates with no detector impact:**
   - §1: add Windows path resolution note.
   - §2: remove "exact local marker file semantics" from Unknown — `${CLAUDE_PLUGIN_DATA}` location is documented (`~/.claude/plugins/data/{id}/` with the `[^a-zA-Z0-9_-]` → `-` mangling rule).
   - §3: tag `themes/` and `monitors/` as experimental components; document that plugin-root `CLAUDE.md` is not loaded; document the no-parent-traversal rule.
   - §5: extend the documented hook events to include `Setup`, `CwdChanged`, `FileChanged`, `ConfigChange`, `InstructionsLoaded`, `WorktreeCreate`. Add the `/hooks`-source taxonomy (User / Project / Local / Plugin / Session / Built-in) as the canonical source label set.
   - §6: document name-vs-endpoint matching split; add `managed-mcp.json` paths and `streamable-http` alias.
   - §7: replace the freehand source-type list with the documented enum `github`, `url`, `git-subdir`, `npm`, "relative-path in git-hosted marketplace."
   - §9.2: add the cross-platform credentials caveat (re-auth required on Linux/Windows; keychain carry-over on macOS).

7. **TASKBOARD.md — fixture impact:** Any test fixture under `fixtures/` that encodes the assumption "MCP duplicate = same name" needs a partner fixture with two endpoints that share a URL across plugin and connector to exercise the endpoint-matching path.
