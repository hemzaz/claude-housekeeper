# Evidence Keyring

Every door has its key.

In Housekeeper language, a door is a possible explanation or repair path. A key
is the minimum evidence needed before Housekeeper is allowed to open that door.

This matters because many Claude home failures look alike from the filesystem.
A stale-looking cache can be serving an active session. A duplicate skill can be
an intentional override. A missing hook path can be hidden inside shell syntax.
A large directory can be load-bearing history.

The protocol rule:

> A finding without the right key is only a suspicion.

## Key Classes

### Structural Key

Evidence from files and directories:

- JSON parses or does not parse
- path exists or does not exist
- file size, mtime, hash, or direct reference
- component layout matches a documented location

Structural keys are available in safe mode.

They can unlock diagnosis.

They rarely unlock repair by themselves.

### Loader Key

Evidence from Claude's own resolved view:

- `/skills`
- `/hooks`
- `/mcp`
- `/permissions`
- `/status`
- `/doctor`
- `/context`
- `claude --debug hooks`
- `claude --debug mcp`
- `claude --debug`

Loader keys are stronger than structural keys because they show what Claude
actually loaded.

They are not safe-mode keys because they require a live Claude session or live
Claude process.

### Behavioral Key

Evidence from a bounded action:

- a hook fires or does not fire
- a skill appears and invokes correctly
- an MCP server starts and lists tools
- a clean configuration reproduces or clears the issue
- a bare Claude prompt succeeds
- a full registry Claude prompt succeeds

Behavioral keys unlock high-confidence diagnosis and post-repair verification.

They require explicit consent when they can run hooks, start MCP servers, write
logs, or use credentials.

### Ownership Key

Evidence that answers who owns an object:

- user scope
- project scope
- local scope
- managed scope
- plugin source
- marketplace source
- version control status
- do-not-touch rule
- team policy

Ownership keys decide who may approve action.

Without ownership, Housekeeper may report but must not mutate.

### Freshness Key

Evidence that answers whether something is current:

- referenced by resolved settings
- referenced by enabled plugin state
- within Claude's documented plugin cache grace period
- referenced by an active process
- referenced by an active session
- matches current marketplace version
- has recent writes that match expected behavior

Freshness is not age alone.

### Reversibility Key

Evidence that a change can be undone:

- exact original bytes captured
- permissions and ownership captured
- symlink target captured without dereferencing
- parent directory state captured
- operation manifest written
- rollback command tested against a fixture

Without a reversibility key, cleanup cannot be presented as safe cleanup.

## Door/Key Map

| Door | False key | Real key | Action unlocked |
| --- | --- | --- | --- |
| "This cache is stale" | version dir is old | not referenced by known registry evidence, not inside documented grace period, no live process/session reference, no do-not-touch rule | candidate cleanup plan |
| "This hook is broken" | command string contains an old path | `/hooks` shows it loaded, direct executable path is missing, shell parse is unambiguous or debug log proves failure | repair plan |
| "This hook is ignored" | hook did not visibly run | `/hooks` absence, `/doctor` schema error, matcher case/path error, or `claude --debug hooks` trace | targeted diagnosis |
| "This skill is shadowed" | same name exists twice | documented precedence plus `/skills` resolved source | precedence finding |
| "This command is shadowed" | file names collide | command-vs-skill precedence, scope precedence, and `/skills` or command listing evidence | precedence finding |
| "This plugin duplicate is wrong" | same plugin name at two scopes | effective settings source, ownership, and whether duplicate is opt-in, opt-out, or managed | review or repair |
| "This MCP server is bad" | command path looks odd | `/mcp` status, project approval state, cwd-sensitive path analysis, and debug stderr when consented | diagnosis or repair |
| "This session state is dead" | old mtime | no active session/process reference, no resumable intent, no protected path, and retention policy | quarantine plan |
| "This log can rotate" | log is large | known log identity, append-only behavior, size threshold, retention policy, and snapshot | reversible cleanup |
| "This file is secret-adjacent" | path contains token-like word | deny patterns, credential locations, plugin sensitive config, auth path heuristics | redacted report only |
| "This repair worked" | command exited 0 | targeted behavior probe and, where relevant, full Claude session round-trip | verified status |

## New Rule: Three Keys For Mutation

Mutation requires three independent keys:

1. A structural key showing the candidate exists.
2. An ownership key showing who can authorize touching it.
3. A reversibility key showing how to undo the exact action.

For high-impact repairs, add a fourth key:

4. A behavioral key showing the repair changed the broken behavior.

## Safe Mode Key Limits

Safe mode can provide:

- structural keys
- partial ownership keys
- redaction keys
- sector-boundary keys

Safe mode cannot provide:

- loader keys
- behavioral keys
- live freshness keys

Therefore safe mode should say:

- "direct path missing"
- "candidate stale cache"
- "live probe required"
- "protected by rule"
- "scan degraded"

It should not say:

- "unused"
- "deletion-ready"
- "Claude will not load this"
- "healthy"

## Claude's Built-In Keys

Official Claude Code diagnostics are part of the keyring:

- `/context`: shows what occupies the current context
- `/memory`: shows loaded memory files and rules
- `/skills`: shows skills from project, user, and plugin sources
- `/agents`: shows configured subagents
- `/hooks`: shows active hook configurations
- `/mcp`: shows connected MCP servers and status
- `/permissions`: shows resolved allow and deny rules
- `/doctor`: reports invalid keys, schema errors, and installation health
- `/status`: shows active settings sources and managed settings status

Housekeeper should not duplicate these as folklore. It should use them as
truth-probes when live probing is allowed, and it should tell the user when it
is withholding a conclusion because those probes have not been run.

## Cache Door

The plugin cache has a documented live-stale state.

Marketplace plugins are copied into `~/.claude/plugins/cache`. Each installed
version has its own directory. After update or uninstall, the previous version
is marked orphaned and removed automatically seven days later. That grace period
exists so concurrent sessions that loaded the old version can keep running.

This changes Housekeeper's language:

- old version within grace period: `expected-orphan`
- old version beyond grace period: `candidate-stale-cache`
- old version referenced by a live process/session: `live-orphan`
- old version protected by user rule: `protected`

The cache door opens only with freshness evidence.

## Hook Door

Hooks are especially dangerous because they are executable and lifecycle-bound.

The right keys are:

- schema validity
- event name
- matcher shape and case
- handler type
- direct executable path where parseable
- source scope
- `/hooks` resolved view
- `claude --debug hooks` trace where consented

Housekeeper should distinguish:

- not configured
- configured but not loaded
- loaded but matcher missed
- loaded and fired but failed
- loaded and fired successfully
- loaded from an unexpected source

These are different failures and need different repairs.

## Skill And Command Door

Official docs now establish important precedence:

- enterprise skill overrides personal skill
- personal skill overrides project skill
- plugin skills use `plugin-name:skill-name` namespacing
- if a skill and a legacy command share a name, the skill takes precedence

This lets Housekeeper classify more than before, but still not everything.

Needed keys:

- source level
- path shape
- `SKILL.md` frontmatter
- command file frontmatter
- `/skills` resolved view
- bundled skill or built-in command collision status

Do not treat a local duplicate as trash. It may be the user's deliberate
override.

## MCP Door

MCP servers are process-starting, credential-adjacent components.

Safe mode may parse structure and identify obvious path problems, but it must
not start servers. A repair door opens only after:

- scope and owner are known
- approval status is known
- command path resolution is understood
- relative path behavior is accounted for
- `/mcp` or debug evidence confirms failure

## Clean Config Door

A clean configuration is the master comparison key.

Claude documents that `CLAUDE_CONFIG_DIR` can point to an empty directory to
bypass the usual `~/.claude` user/project setup, while managed settings may
still apply.

Housekeeper should use this pattern as a research and support key:

- broken in real home, healthy in clean home: likely configuration/home issue
- broken in clean home too: likely install/auth/environment/managed issue
- healthy in both: likely intermittent, session-specific, or project-specific

This key is powerful, but it is not safe mode. It launches Claude.

## Key Debt

Every unsupported conclusion creates key debt.

Examples:

- "unused" without a live-freshness key
- "shadowed" without a loader key
- "broken hook" without a hook trace or direct parseable path
- "safe cleanup" without rollback proof
- "fixed" without behavioral verification

Key debt is allowed in research notes.

It is not allowed in user-facing repair claims.
