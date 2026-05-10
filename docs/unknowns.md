# Unknowns And Current Answers

This document answers the current unknowns as far as we can today.

Status labels:

- `documented`: supported by official Claude Code docs
- `local-sample`: observed in one local `.claude` home
- `inferred`: plausible but not proven
- `unknown`: requires field research or black-box testing
- `known-door`: the failure class is known, but the evidence key is not yet
  strong enough for repair

Sources used:

- Claude Code settings: https://code.claude.com/docs/en/configuration
- Claude Code plugins: https://code.claude.com/docs/en/plugins
- Claude Code skills: https://code.claude.com/docs/en/slash-commands
- Claude Code hooks: https://code.claude.com/docs/en/hooks
- Claude Code MCP: https://code.claude.com/docs/en/mcp
- Claude Code debug configuration: https://code.claude.com/docs/en/debug-your-config
- Claude Code plugin reference: https://code.claude.com/docs/en/plugins-reference

## 1. Real Corpus Of Broken Homes

### Which failures are common vs rare?

Current answer: `unknown`.

We have one strong anecdotal session and one local `.claude` sample. That is not enough to rank frequency.

Likely common:

- large session/project history
- stale plugin cache trees
- broken hook paths after plugin update/uninstall
- local command/skill shadows
- settings backup accumulation
- log growth

Likely rarer but severe:

- invalid core settings
- zombie modes that actively change behavior
- symlinked install roots
- partially interrupted plugin install/update
- cross-platform path identity failures

Required research:

- collect 20-50 redacted `.claude` home reports
- classify failures by frequency and severity
- record Claude Code version, OS, plugin count, hook count, and directory sizes

### Which directories grow fastest?

Current answer: `local-sample`.

In the local sample:

- `~/.claude/projects`: 1.1G
- `~/.claude/plugins`: 617M
- `~/.claude/plugins/cache/omc/oh-my-claudecode/4.13.6`: 310M
- `~/.claude/plugins/cache/everything-claude-code/everything-claude-code/2.0.0-rc.1`: 127M
- `~/.claude/homunculus`: 29M
- `~/.claude/claude-notifications-go`: 22M
- `~/.claude/file-history`: 12M
- logs: `cost-tracker.log` 3.9M, `bash-commands.log` 3.7M

Hypothesis:

- transcript/project/session storage and plugin caches are the main bloat sources
- plugin caches vary wildly by plugin because some include `node_modules`, tests, docs, repos, binaries, or assets

Required research:

- measure directory sizes across real homes
- record growth over time
- separate "large but expected" from "large and stale"

### Which hooks break most often?

Current answer: `unknown`, with local signal.

Local sample has many configured hook events:

- `PreToolUse`: 15 handlers
- `PostToolUse`: 12 handlers
- `Stop`: 10 handlers
- `SessionStart`: 6 handlers
- plus many smaller event hooks

Hypothesis:

- `Stop`, `SessionStart`, and plugin-provided hook paths are high-risk because they run at lifecycle boundaries and often reference plugin cache paths
- `PreToolUse` hooks are high-impact because they can block user work

Required research:

- detect dangling paths per hook event
- record hook type: command, HTTP, MCP tool, prompt, agent
- record source: user, project, local, plugin, managed
- identify plugin-root references that changed across plugin updates

### Which plugin layouts vary?

Current answer: `documented` plus `local-sample`.

Official docs say plugins can contain `.claude-plugin/plugin.json`, `skills/`, `commands/`, `agents/`, `hooks/`, `.mcp.json`, `.lsp.json`, `monitors/`, `bin/`, and `settings.json`.

Local sample shows additional variability:

- plugins with `node_modules`
- plugins with `.git`
- plugins with `dist`, `src`, `tests`, `assets`, `docs`, `scripts`
- plugins with `.in_use`
- plugins with legacy command shims
- plugins with binaries and platform-specific subtrees

Implication:

Housekeeper cannot assume a plugin cache tree contains only Claude components. Size and cleanup logic must preserve unknown directories unless registry evidence is strong.

### Which "stale" things are actually live?

Current answer: `documented` for plugin version cache grace period;
`unknown` elsewhere, with strong warning.

Local plugin cache trees contain `.in_use` directories with marker files. We do not yet know their exact semantics. A cache tree not referenced by `installed_plugins.json` may still be live if:

- Claude loader semantics include a source Housekeeper does not inspect
- a plugin command/hook/MCP process is running from that path
- a symlink or alias points to it
- `.in_use` markers are meaningful
- a session started before plugin update still references the old path

Official plugin docs add an important rule:

- marketplace plugins are copied into `~/.claude/plugins/cache`
- each installed version has its own directory
- after update or uninstall, the previous version is marked orphaned
- orphaned versions are removed automatically after about 7 days
- concurrent sessions that already loaded the old version can keep running
  during that grace period
- Claude's Glob and Grep skip orphaned version directories

Rule until proven:

Stale means "not referenced by known registry evidence," not
"deletion-ready."

Better terms:

- `expected-orphan`: old plugin version inside the documented grace period
- `candidate-stale-cache`: old plugin version beyond known references and grace
  period
- `live-orphan`: old plugin version still referenced by active process/session
- `protected`: user or policy says not to touch

## 2. Claude Loader Semantics

Detailed in `docs/loader-semantics.md`.

Current state:

- settings scope precedence is documented
- plugin namespacing and structure are documented
- skill precedence across enterprise, personal, project, plugin namespace, and
  legacy command collisions is documented
- hook locations and matcher behavior are documented
- MCP scope precedence is documented
- exact bundled command/skill collision behavior still needs black-box testing
- exact plugin cache marker behavior still needs black-box testing

## 3. False Positive Taxonomy

Dominant expected classes:

### Intentional local shadows

Status: `documented` for skill precedence; `inferred` for user intent.

A local command or skill with the same name as a plugin-provided resource may be an intentional override.

Official skill docs state:

- enterprise skills override personal skills
- personal skills override project skills
- plugin skills use `plugin-name:skill-name` namespacing
- if a skill and a legacy command share a name, the skill takes precedence

Default stance: `review`.

### Stale-looking resumable sessions

Status: `inferred`.

Age alone cannot prove a session is trash. Claude Code has session persistence and startup cleanup settings.

Default stance: `review`.

### Duplicate scope by design

Status: `documented`.

Settings and MCP support multiple scopes. Duplicate names can be valid depending on precedence.

Default stance: `review`.

### Symlinked plugin installs

Status: `unknown`.

Needs cross-platform path identity testing.

Default stance: `review`.

### Private local forks

Status: `inferred`.

Diverged commands or skills can be intentional user authorship.

Default stance: `review` or `protect`.

### Cache trees still in use

Status: `unknown`.

Must test `.in_use`, live process references, and old-session references.

Default stance: `probe` or `review` until proven.

## 4. Performance Envelope

### How slow is full scan?

Current answer: `unknown`.

Local sample has at least:

- 1.1G in `projects`
- 617M in `plugins`
- 103 files under `projects` at maxdepth 2
- plugin cache trees up to 310M

This is enough to prove unbounded recursive scanning is unsafe.

### Which paths are pathological?

Likely:

- `projects`
- `plugins/cache`
- plugin cache `node_modules`
- logs
- file-history
- session-data
- symlinked directories
- network-mounted homes

### What must be bounded?

Required budgets:

- max wall time
- max files visited
- max bytes hashed
- max depth per subsystem
- max log bytes read
- symlink traversal disabled by default
- mount boundary policy

### What can run at SessionStart?

Only cheap checks:

- parse `settings.json`
- parse plugin registry metadata
- detect interrupted Housekeeper operation
- check for obvious dangling direct hook paths already present in settings
- report stale cached scan if full scan is needed

Do not:

- compute directory sizes
- hash plugin trees
- scan transcripts/projects
- run Claude live probes
- run network/MCP checks

### How to avoid making slowness worse?

Use scan budgets, cached results with explicit freshness, degraded reports, and manual full scan mode.

## 5. Cross-Platform Reality

Status: mostly `unknown`.

Known from docs:

- Windows uses `%USERPROFILE%\.claude` for paths shown as `~/.claude`.
- Managed settings paths differ across macOS, Linux/WSL, and Windows.
- Native Windows MCP stdio servers that use `npx` need `cmd /c`.
- PowerShell can be configured as default shell.

Missing:

- path separator and case sensitivity rules
- junctions and symlinks on Windows
- APFS aliases/firmlinks on macOS
- file locks on Windows
- permissions and ACL/xattr preservation
- shell quoting differences
- npm/global install differences

Protocol consequence:

Mutation and rollback must be platform-gated. Read-only diagnosis should degrade when identity cannot be canonicalized.

## 6. Security Boundary

### What can be safely displayed?

Safe by default:

- existence of a sensitive path
- redacted path basename if needed
- config key names
- structural facts
- counts
- timestamps
- source type

Not safe by default:

- secret values
- raw env
- full command lines containing tokens
- HTTP headers
- `.env` content
- auth helper output
- shell history
- logs with unredacted tokens

### How aggressive should redaction be?

Aggressive by default. Redact before model-visible output, logs, JSON reports, and issue templates.

### Can evidence leak secrets through paths?

Yes.

Paths may reveal:

- customer names
- project names
- infrastructure names
- usernames
- secret file names
- internal services

Privacy mode should support basename-only or hashed path display.

### Should hashes be shown?

Maybe.

Hashes are useful for evidence and preconditions, but can leak identity for known files. Default should show short hashes or redact unless user requests full machine-readable evidence.

### Are plugin paths sensitive?

Sometimes.

Plugin paths can reveal internal marketplace names, org names, or local project names. Treat as low-to-medium sensitivity, and redact in shared reports.

Plugin `sensitive` user configuration should be treated as secret-adjacent even
when Housekeeper only sees path metadata.

## 7. Trust UX Details

Current answer: `inferred`; needs user testing.

Likely winning output:

```text
Claude Code health: FAIL

Primary issue:
  Hook "Stop" references a deleted plugin cache path.

Evidence:
  ~/.claude/settings.json -> hooks.Stop[2].command
  Missing path: ~/.claude/plugins/cache/.../1.38.0/...

Next step:
  Review proposed settings patch.

Risk:
  No files changed.

Confidence:
  High
```

Rules:

- default to one primary issue plus stance summary
- hide long lists behind detail mode
- show confidence only with evidence
- keep protected visible but separate
- never use cheerful language in degraded state

Unknown:

- exact stance summary/detail size before overload
- best confidence display
- best wording for sector boundaries

## 8. Learning Without Config Burden

Current answer: `inferred`.

Users should not manually edit config as the main flow.

Preferred UX:

- Housekeeper suggests a rule from a repeated decision
- user accepts/rejects the exact rule
- rule remains inspectable in a small local file
- `knowledge list`, `knowledge explain`, and `knowledge undo` exist later

Learning becomes mess when:

- rules are broad
- rules are silent
- rules hide findings without explanation
- old rules survive changed context
- knowledge files grow without pruning

## 9. Emergency Mode Semantics

Current answer: safe mode must be out-of-band.

Safe mode must not trust Claude plugin loading. It should be a standalone CLI or binary path.

Minimum viable scan:

- parse user/project/local settings files if explicitly in scope
- parse installed plugin registry if present
- list hook commands without executing hooks
- identify missing direct absolute paths
- list enabled plugins from settings
- identify malformed JSON
- identify active Housekeeper interrupted operations
- avoid content reads from sensitive paths

Safe mode must not:

- call `claude` except maybe `claude --version` in a separate live-probe mode
- run plugin commands
- run hooks
- start MCP servers
- execute shell snippets from skills/commands
- walk huge directories without budget

Important live-probe distinction:

- `/doctor`, `/status`, `/hooks`, `/mcp`, `/skills`, and `/context` are valuable
  loader keys, but they require a live Claude session and are not safe-mode
  operations.
- `CLAUDE_CONFIG_DIR` can be pointed at an empty directory for clean-config
  comparison, but that also launches Claude and may still inherit managed
  settings.

## 10. Repair Strategy

Preferred order:

1. explain manual fix
2. generate patch/diff
3. prepare exact operation with preconditions
4. snapshot
5. apply only after consent
6. verify

Default repair surface should be patch-preview first, not direct edit first.

Tool-specific APIs are safer when official and read/patch-oriented; shell commands are riskier.

## 11. Rollback Reality

Rollback classes:

- `exact`: content and metadata restored; proven on platform
- `metadata-exact`: content, mode, mtime, ownership, xattrs/ACLs restored
- `content-only`: file bytes restored, metadata may differ
- `best-effort`: restore attempted, known gaps
- `impossible`: external side effect or insufficient snapshot

Default claim should be content-only or best-effort unless exact restoration is tested.

Rollback hazards:

- concurrent changes
- symlink/hardlink identity
- file locks
- deleted parent directories
- active processes
- settings rewritten by Claude
- external API side effects

## 12. Housekeeper As A New Source Of State

Rules:

- keep all state under `~/.claude/housekeeper/`
- store only bounded JSON and quarantine manifests
- never store backups inside loaded command/skill/plugin namespaces
- rotate logs
- retain quarantine by policy
- self-diagnose stale operations
- support uninstall report

Unknown:

- default retention period
- max knowledge file size
- whether operation history should be per-project or global

## 13. Plugin Ecosystem Variability

Documented plugin components:

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

Local observed additions:

- `.git`
- `node_modules`
- `tests`
- `src`
- `dist`
- `assets`
- `docs`
- platform binaries
- `.in_use`

Official plugin reference adds:

- plugin `commands`, `agents`, output styles, themes, and monitors can replace
  default directories when custom paths are configured
- plugin `skills` custom paths add to the default `skills/` directory
- all plugin path fields must be relative to plugin root and start with `./`
- `${CLAUDE_PLUGIN_ROOT}` changes after update
- `${CLAUDE_PLUGIN_DATA}` persists across updates and may contain dependencies
- symlinks inside plugin directories are preserved in cache and resolved at
  runtime

Unknown:

- manifest schema drift
- uninstall residue
- dev/local plugin behavior
- plugin-generated runtime files
- cache update atomicity

## 14. Version Drift

Known:

- Claude Code docs include version-specific settings notes.
- Some settings require minimum versions.
- Windows managed settings path changed in v2.1.75.
- MCP startup retry behavior changed as of v2.1.121.

Required:

- feature detection
- schema version detection
- compatibility matrix
- fixtures per Claude version
- graceful degradation when unsupported

## 15. Team/Org Governance

Known:

- managed settings have highest precedence and cannot be overridden
- project settings are team-shared
- local settings are per-machine and gitignored
- managed policies can restrict hooks, MCP, permissions, plugins, and marketplaces

Unknown:

- project do-not-touch ownership model
- team approval UX
- audit trail accepted by teams
- conflict resolution between user protection and project policy

Default:

Shared/project scope is blocked for mutation without explicit project authority.

## 16. Product Sharp Wedge

Best wedge after adversarial review:

> Out-of-band read-only diagnosis for broken Claude Code homes.

First output:

> Tell me why Claude Code is broken and what is safe to do next.

Initial focus:

1. broken direct hook paths
2. invalid settings/config
3. registry/plugin cache mismatch
4. local command/skill shadows
5. zombie state with strong evidence

Do not start with whole-home cleanup.

## 17. Distribution Reality

Answer:

- standalone CLI is required for safe mode
- Claude plugin can be a convenience wrapper only
- plugin must not be required to recover plugin loading problems
- `npx` may help trial but brings network/dependency trust concerns
- local package binary is safer for degraded environments

Potential distribution:

- `claude-housekeeper diagnose --safe`
- plugin `/housekeep` wrapper for healthy Claude sessions
- GitHub release binary later

## 18. Legal/Support Expectations

Required:

- preview label
- no global rollback claims
- explicit "no files changed" language
- support boundary: diagnosis may be wrong under unknown Claude versions
- damaged environment issue template
- redaction guidance for reports
- recovery disclaimers

## 19. Data Model Pressure

Essential fields:

- id
- summary
- resource path/type
- surface classification
- evidence
- stance
- risk
- confidence
- actionability
- protected/sector status
- next step

Postpone:

- full lifecycle history
- operation history
- knowledge graph
- team policy
- rich namespace graph

Stable API should start with findings, surface classifications, evidence, and
stance summary, not full protocol objects.

## 20. Real User Vocabulary

Likely docs-only:

- haunted
- entropy
- sector boundaries
- Claude home

Likely CLI:

- detected
- evidence
- next step
- stance
- confidence
- no files changed
- protected
- review
- live probe required
- blocked
- cannot verify

Need validate with users.

Candidate product translation:

- "door/key" is useful internally and in philosophy docs
- CLI should likely say "evidence required" instead of "missing key"
- "sector boundary" can remain a strong metaphor in design docs, while CLI can
  say "protected by rule" or "outside declared scope"

## Central Unknown Unknown

We still do not know which parts of `.claude` are load-bearing in ways not inferable from files alone.

This is the central danger.

Therefore:

- "unused" is forbidden unless proven by loader semantics
- "stale" means not referenced by known evidence, not safe
- safe mode must avoid live loader assumptions
- loader semantics research gates mutation
- the first wedge should emit `watch`, `probe`, `protect`, `prepare`, or `block`
  rather than cleanup language

## New Research Corrections

### `.claude` Is Not One Kind Of Thing

Status: `documented`.

Claude's `.claude` area contains authored configuration, executable surfaces,
plugin material, MCP configuration, transcripts, history, caches, and other
application data.

Implication:

Housekeeper should classify surfaces before findings. "Clean `.claude`" is not
a meaningful operation.

### Claude Checkpoints Are Not Housekeeper Rollback

Status: `documented`.

Claude checkpointing can restore file edits tracked by Claude Code, but it does
not cover Bash tool side effects, database changes, external API calls, or
external process changes.

Implication:

Housekeeper must provide its own snapshot and rollback manifests. It may not use
Claude checkpointing as proof that cleanup is reversible.
