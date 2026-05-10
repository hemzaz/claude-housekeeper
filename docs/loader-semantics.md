# Claude Loader Semantics

This document separates documented Claude Code behavior from inference and required tests.

Sources:

- Settings: https://code.claude.com/docs/en/configuration
- Plugins: https://code.claude.com/docs/en/plugins
- Plugins reference: https://code.claude.com/docs/en/plugins-reference
- Skills: https://code.claude.com/docs/en/slash-commands
- Hooks: https://code.claude.com/docs/en/hooks
- MCP: https://code.claude.com/docs/en/mcp
- Debug configuration: https://code.claude.com/docs/en/debug-your-config

## 1. Settings Scopes

Status: `documented`.

Claude Code settings scopes:

- Managed
- User
- Project
- Local

Documented precedence from highest to lowest:

1. Managed
2. Command line arguments
3. Local
4. Project
5. User

Documented locations:

- User settings: `~/.claude/settings.json`
- Project settings: `.claude/settings.json`
- Local settings: `.claude/settings.local.json`
- User MCP/local MCP/per-project state: `~/.claude.json`
- Project MCP: `.mcp.json`

Build implication:

Housekeeper must not interpret a user setting alone as effective without considering higher-precedence scopes.

## 2. Plugin Enablement

Status: `documented` for settings behavior and major cache lifecycle behavior,
`unknown` for some installed cache internals.

Documented:

- Plugins can be enabled via settings.
- Project settings can override user settings.
- Local settings can opt out of project-enabled plugins.
- Managed force-enabled plugins cannot be disabled locally.
- Managed marketplace restrictions can block sources before network/filesystem operations.
- Marketplace plugins are copied into `~/.claude/plugins/cache`.
- Each installed version has its own directory.
- After update or uninstall, the previous version is marked orphaned.
- Orphaned previous versions are removed automatically after about 7 days.
- The grace period exists so concurrent sessions that already loaded the old
  version can keep running.

Unknown:

- `.in_use` semantics
- cache update atomicity
- exact local marker file semantics

Build implication:

Installed registry mismatch is evidence, not proof of unused cache. Old plugin
versions can be expected orphans during the documented grace period.

## 3. Plugin Structure

Status: `documented`.

Documented plugin root components:

- `.claude-plugin/plugin.json`
- `skills/`
- `commands/`
- `agents/`
- `hooks/`
- `.mcp.json`
- `.lsp.json`
- `monitors/`
- `bin/`
- `settings.json`
- `output-styles/`
- `themes/`

Documented:

- plugin manifest `name` is the namespace
- plugin skills are namespaced
- plugin `commands/` are legacy/flat Markdown skills; docs recommend `skills/` for new plugins
- `bin/` executables are added to Bash tool PATH while plugin is enabled
- plugin component paths must be relative to plugin root and start with `./`
- plugin `skills` custom paths are additive with the default `skills/` path
- custom paths for commands, agents, output styles, themes, and monitors replace
  their default directories
- symlinks inside plugin directories are preserved in cache and resolved at
  runtime

Build implication:

Plugin layout detection must be component-based and preserve unknown directories.

## 4. Skills And Commands

Status: partially `documented`, partially `unknown`.

Documented:

- skills live under `~/.claude/skills/<name>/SKILL.md`
- custom commands have merged into skills
- `.claude/commands/deploy.md` and `.claude/skills/deploy/SKILL.md` both create `/deploy`
- existing `.claude/commands/` files keep working
- plugin skills are namespaced
- skill bodies load only when used
- skill shell injection runs before Claude sees the skill content unless disabled by `disableSkillShellExecution`
- when skills share the same name, enterprise overrides personal and personal
  overrides project
- if a skill and a legacy command share a name, the skill takes precedence

Unknown:

- exact conflict behavior between standalone `/foo`, bundled `/foo`, and plugin `/plugin:foo`
- exact behavior when plugin prefix is omitted and names collide
- exact behavior for nested `.claude/skills/` discovered from additional
  directories when names collide with root project skills

Build implication:

Housekeeper can use documented skill-vs-command and enterprise/personal/project
precedence, but should still verify with `/skills` before claiming what is
available in a live session.

## 5. Hooks

Status: `documented` for locations and event behavior; source merge order needs testing.

Documented hook locations:

- `~/.claude/settings.json`
- `.claude/settings.json`
- `.claude/settings.local.json`
- managed policy settings
- plugin `hooks/hooks.json`
- skill or agent frontmatter while component is active

Documented behavior:

- hooks are defined by event, matcher group, handler
- matchers vary by event
- all matching handlers run in parallel
- identical handlers are deduplicated automatically
- command hooks are deduplicated by command string
- HTTP hooks are deduplicated by URL
- plugin hook scripts should reference `${CLAUDE_PLUGIN_ROOT}`
- `${CLAUDE_PLUGIN_ROOT}` changes on plugin update
- `${CLAUDE_PLUGIN_DATA}` survives plugin updates
- SessionStart runs on startup, resume, clear, and compact, and should be fast
- SessionStart stdout can add context to Claude
- SessionStart can persist env vars through `CLAUDE_ENV_FILE`
- `/hooks` lists active hook configurations for the current session
- `/doctor` reports schema errors and invalid keys
- `claude --debug hooks` records event matching, checked matchers, hook exit
  code, and output
- hook matcher values are strings, not arrays, and tool-name matching is
  case-sensitive

Unknown:

- exact merge order of hooks from all sources
- exact behavior when plugin update leaves stale hook command references
- whether all hook events in local sample are current public events or plugin-specific/older events
- performance impact of many hooks across sources

Build implication:

Direct missing paths in hook command strings are high-confidence findings only
when the path is parseable. A repair should prefer `/hooks` or debug evidence
before claiming the hook is broken in the live loader.

For the first wedge:

- parse settings structurally
- detect direct missing absolute paths
- classify direct path as `prepare`
- classify shell-ambiguous command as `probe`
- do not execute hooks
- do not edit settings

## 6. MCP Resolution

Status: `documented`.

Documented MCP scopes:

- Local: current project only, private, stored in `~/.claude.json`
- Project: current project only, shared via `.mcp.json`
- User: all projects, private, stored in `~/.claude.json`

Documented precedence for duplicate server names:

1. Local
2. Project
3. User
4. Plugin-provided servers
5. claude.ai connectors

Documented plugin MCP behavior:

- plugins can define MCP servers in plugin `.mcp.json` or inline in `plugin.json`
- enabled plugin MCP servers start automatically at session startup
- enabling/disabling plugins during a session requires `/reload-plugins` to connect/disconnect plugin MCP servers
- plugin MCP servers have access to the same user environment variables as manually configured servers

Build implication:

MCP config is credential-adjacent and can trigger external/local process behavior. Safe mode must parse config only; it must not start servers.

## 7. Marketplace And Cache Behavior

Status: `documented` for source types, managed restrictions, and major cache
lifecycle rules; `unknown` for some cache internals.

Documented marketplace source types include:

- GitHub
- git
- URL
- npm
- file
- directory
- settings inline

Documented:

- managed `strictKnownMarketplaces` can restrict marketplace sources
- blocked marketplace sources are enforced before network/filesystem operations
- marketplace plugins are copied into `~/.claude/plugins/cache`
- each installed version is a separate directory
- after update or uninstall, the previous version is marked orphaned
- orphaned previous versions are removed automatically about 7 days later
- the grace period exists so concurrent Claude sessions that already loaded the
  old version keep running
- Claude Glob and Grep skip orphaned version directories
- `${CLAUDE_PLUGIN_ROOT}` changes on update
- `${CLAUDE_PLUGIN_DATA}` persists across updates and is deleted on uninstall
  from the last scope unless `--keep-data` is used
- plugin symlinks are preserved in the cache and resolve at runtime
- `claude plugin prune --dry-run` exists for orphaned auto-installed plugin
  dependencies, not directly installed plugins

Unknown:

- cache directory naming guarantees
- how marketplace metadata freshness is tracked
- whether cache tree contents are safe to assume immutable
- exact local marker files such as `.in_use`

Build implication:

Old plugin cache versions can be expected, live, and intentionally retained
during the grace period. Housekeeper must not call them unused without
freshness evidence.

For the first wedge:

- use `expected-orphan` inside documented grace evidence
- use `candidate-stale-cache` when not referenced by known registry evidence
- stance should be `watch` or `probe`, not cleanup

## 8. SessionStart Behavior

Status: `documented` for hook event basics.

Documented:

- runs when Claude starts or resumes a session
- also runs after `/clear` and compaction
- supports only command and MCP-tool hooks
- source is startup, resume, clear, or compact
- stdout can add context to Claude
- should be fast

Build implication:

SessionStart is unsuitable for full scans. It can only run bounded probes or display stale cached scan status.

## 9. Required Black-Box Tests

Before mutation, test:

- user command vs project command same name
- command file vs skill folder same name
- user skill vs project skill same name
- standalone skill vs bundled skill same name
- plugin skill invocation with and without namespace
- plugin command/skill collision across plugins
- plugin enabled/disabled across user/project/local/managed settings
- plugin old cache version with active session
- hook merge order across sources
- hook stale `${CLAUDE_PLUGIN_ROOT}` after update
- skill shell injection disabled by policy
- MCP duplicate names across all scopes
- MCP plugin duplicate endpoint
- `.mcp.json` env expansion
- SessionStart stdout/context behavior
- Windows paths and native `cmd /c npx` MCP behavior

## 9.1 Built-In Truth Probes

Status: `documented`.

Claude Code exposes several live introspection commands:

- `/context`: context categories, including memory, skills, MCP tools, and
  conversation messages
- `/memory`: loaded `CLAUDE.md` and rules files
- `/skills`: available skills from project, user, and plugin sources
- `/agents`: configured subagents
- `/hooks`: active hook configurations
- `/mcp`: connected MCP servers and status
- `/permissions`: resolved permission rules
- `/doctor`: invalid keys, schema errors, and installation health
- `/debug [issue]`: debug logging plus diagnostic prompt
- `/status`: active settings sources and managed settings status

Build implication:

These are loader keys, not safe-mode keys. Safe mode can recommend them, but
should not run them by default because they require a live Claude process and
may run in an environment with hooks, MCP servers, credentials, and managed
settings.

## 9.2 Clean Configuration Probe

Status: `documented`.

Claude can be launched with `CLAUDE_CONFIG_DIR` pointing at an empty directory
from a directory with no project `.claude`, `.mcp.json`, or `CLAUDE.md`. This
starts without the user's normal user/project settings, hooks, MCP servers,
plugins, or memory. Managed settings can still apply.

Build implication:

Clean-config comparison is a high-value behavioral key:

- broken in real home but healthy in clean home means likely home/project
  configuration issue
- broken in clean home too means likely install, auth, environment, or managed
  policy issue

It is not safe mode because it launches Claude.

## 10. Housekeeper Language Restrictions

Until tested:

- say "not referenced by known registry evidence," not "unused"
- say "candidate stale cache," not "deletion-ready"
- say "expected orphan within documented grace period," not "stale" when an old
  plugin version is within the seven-day retention window
- say "appears to shadow," not "wins precedence"
- say "direct path missing," not "hook broken" if shell semantics are ambiguous
- say "live probe required," not "healthy"
