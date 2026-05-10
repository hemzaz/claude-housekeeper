# Claude Home Surface Map

This document maps what Housekeeper is allowed to reason about.

It is not a directory cleanup list. It is a map of surfaces, authority, and
evidence.

Sources:

- Claude directory: https://code.claude.com/docs/en/claude-directory
- Settings: https://code.claude.com/docs/en/settings
- Plugins reference: https://code.claude.com/docs/en/plugins-reference
- Hooks: https://code.claude.com/docs/en/hooks
- MCP: https://code.claude.com/docs/en/mcp
- Checkpointing: https://code.claude.com/docs/en/checkpointing

## 1. Surface Classes

Housekeeper must classify `.claude` material before it classifies findings.

The detailed classification contract is defined in
`docs/surface-classification-spec.md`.

Classification is not a cosmetic label. It is an action gate. If a surface is
unclassified, Housekeeper may report it, but it must not propose cleanup,
quarantine, repair, rotation, deduplication, or purge.

### Authored Configuration

User or team-authored configuration:

- `settings.json`
- `settings.local.json`
- `.mcp.json`
- `CLAUDE.md`
- custom skills
- legacy commands
- hook definitions
- plugin marketplace registrations
- project policy files

Default stance:

- high value
- user-owned or project-owned
- review before mutation

### Claude Application Data

Claude-managed operational data:

- project transcripts
- shell snapshots
- prompt input history
- file history
- todo state
- statsig or telemetry cache
- plugin cache
- cache directories

Default stance:

- not automatically disposable
- retention and loader semantics required
- safe to measure before safe to touch

### Executable Surfaces

Anything that can run code or start processes:

- hooks
- MCP servers
- plugin `bin/`
- skill shell injection
- command scripts
- monitor scripts
- external package managers

Default stance:

- never run in safe mode
- live probe only after consent
- parse structure before behavior

### Secret-Adjacent Surfaces

Anything near credentials or private system state:

- API key helpers
- auth files
- MCP environment variables
- plugin sensitive user config
- command lines with token-like values
- paths that reveal customer, project, or infrastructure names

Default stance:

- redact by default
- do not read content unless explicitly scoped
- do not include raw values in reports

### Housekeeper-Owned Surfaces

Future Housekeeper state:

- operation manifests
- snapshots
- quarantine metadata
- learned rules
- scan cache
- report cache

Default stance:

- accountable cleanup
- self-auditing
- uninstallable
- never stored inside registries where Claude might load it as a command,
  skill, hook, or namespace

## 2. Load-Bearing Tests

A surface is load-bearing if changing it can affect Claude behavior.

Known load-bearing surfaces:

- effective settings
- enabled plugins
- active plugin cache versions
- hook definitions
- MCP server definitions
- command and skill namespaces
- `CLAUDE.md` memory files
- permission rules
- managed policy

Possibly load-bearing surfaces:

- old plugin cache versions within orphan grace period
- session and project history used by resume
- shell snapshots used by stateful command context
- plugin data directories
- generated files referenced by hooks or MCP servers

Not enough:

- old mtime
- large size
- no obvious reference from one registry file
- directory name contains `_old`, `_tmp`, or `_archive`

## 3. Surface Questions

Before any finding becomes actionable, ask:

- Who owns this surface?
- Is it authored config, application data, executable, secret-adjacent, or
  Housekeeper-owned?
- Is it load-bearing now, historically load-bearing, or only clutter?
- Which Claude truth-probe can confirm effective behavior?
- What is the rollback proof?
- What is the sector boundary?

If these cannot be answered, the surface becomes `unknown-surface`, `review`,
`protect`, or `block`, not an action candidate.

## 3.1 Classification Axes

Minimum axes:

- `surfaceClass`: authored config, Claude app data, executable surface,
  secret-adjacent, Housekeeper-owned, external reference, or unknown
- `ownerClass`: user, project, team-managed, plugin, Claude-managed,
  Housekeeper, shared, or unknown
- `loadBearingClass`: known, possible, historical, not load-bearing, or unknown
- `sensitivityClass`: public structure, private path, secret-adjacent,
  secret content, regulated/personal, or unknown
- `executionClass`: inert, process-starting, hook-running, MCP-starting,
  plugin-code, shell-expansion risk, network risk, or unknown
- `rollbackClass`: manifest-backed, snapshot-possible, native-reversible,
  checkpoint-only, external-side-effects, irreversible, or unknown
- `scopeClass`: in-scope, protected, sector-boundary,
  parent-contains-boundary, out-of-scope, or unknown

The first diagnosis output should show these only when they clarify the issue.
Machine-readable output should always include them.

## 4. Research Correction: Checkpoints Are Not Rollback

Claude checkpointing is valuable, but it is not Housekeeper rollback.

Checkpointing tracks file edits made by Claude Code. It does not cover:

- Bash tool side effects
- direct filesystem mutations outside tracked edits
- database changes
- external API calls
- commands run by hooks
- package manager installs
- files changed by external processes

Housekeeper rollback must therefore be its own manifest-backed mechanism.

It may mention Claude checkpoints as context, but it must not rely on them to
recover Housekeeper cleanup.

Protocol consequence:

- `checkpoint-only` is a rollback blocker
- cleanup plans must not use Claude checkpoints as their rollback proof
- rollback requires Housekeeper-owned snapshots and operation manifests
- if Housekeeper cannot build that manifest, mutation is blocked

## 5. Research Correction: `.claude` Is Mixed Ownership

The `.claude` directory contains both user-authored configuration and
Claude-managed application data.

That means "clean `.claude`" is not a coherent action.

Every operation must target a surface class:

- inspect authored config
- validate executable surfaces
- measure application data
- quarantine Housekeeper-owned artifacts
- redact secret-adjacent surfaces

Surface first. Finding second. Action last.
