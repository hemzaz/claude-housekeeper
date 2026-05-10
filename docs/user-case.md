# User Case

Claude Housekeeper exists because a Claude home decays in a particular way.

At first, `.claude` is useful: plugins, commands, skills, hooks, state, caches, session data, local experiments. Each piece was added for a reason. Over time, the relationships between those pieces rot. The user does not experience that as "a directory has many files." They experience it as Claude becoming strange.

Skills disappear. Hooks keep firing after the plugin that owned them is gone. Local commands shadow plugin commands. Old state survives the session that created it. Cache directories become more authoritative than reality. Namespaces appear by accident. A fresh session still feels haunted.

The user’s pain is not clutter. The pain is losing the mental model.

## What The User Feels

When Claude gets unstable, the user asks:

- Why did that skill disappear?
- Why is this hook still firing?
- Which plugin owns this command?
- Is this stale cache harmless or active?
- If I delete this, will I break everything?
- Why does a fresh session still feel haunted?
- What changed since yesterday?
- Can I trust this Claude home anymore?

Without Housekeeper, the user becomes both operator and forensic investigator. They must debug invisible state before doing the work they came to do.

## The Missing Piece

Claude has tools for doing work, but not yet a trusted maintenance layer for the world those tools live in.

Claude Code users accumulate:

- plugins
- skills
- commands
- hooks
- state files
- session debris
- caches
- backups
- local overrides
- experiments
- abandoned automation

The missing piece is not another capability plugin. It is a protocol for preserving the capability environment itself.

Claude Housekeeper is the missing maintenance layer for Claude Code.

## Not A Happy-Path Tool

Claude Housekeeper is most valuable when the environment is already uncomfortable.

It is not built for the clean demo where everything is current, coherent, fast, and obvious. It is built for the moment when Claude, the main tool people use to code, starts feeling unreliable:

- the same command behaves differently than yesterday
- a session starts with strange inherited state
- a hook fires from a deleted plugin path
- a skill disappears or is shadowed
- a cache seems to outrank reality
- a mode keeps acting after it should be gone
- the user is afraid to delete anything because the boundary between trash and load-bearing state is unclear

This is where trust breaks. Not because the user dislikes Claude, but because the home Claude depends on has become illegible.

Housekeeper’s job is to restore trust in the main tool. It does this by turning failure from superstition back into inspectable state.

It should be judged by how it behaves in partial failure, dirty state, interrupted cleanup, stale evidence, broken config, protected resources, and ambiguous ownership. The happy path matters, but it is not the center.

## Sector Boundaries

Some areas are not merely risky. They are out of bounds.

Like sector boundaries on a range, these are marked zones where Housekeeper must not aim: secrets, auth state, credential helpers, production infrastructure, active session state, live hooks, protected local work, another user's material, rollback evidence, and anything outside the declared scope.

This matters because Housekeeper is used when trust is already degraded. In that state, the user needs to know the tool will not create friendly fire while trying to help.

The user should be able to say:

> Do not aim there.

And Housekeeper should treat that as stronger than a warning, stronger than a preference, and stronger than learned behavior.

## Why It Is Good For The User

Housekeeper gives the user back orientation.

It answers:

### What Is Here?

Inventory the loaded plugins, local overrides, hooks, state, caches, and old artifacts.

### What Is Affecting Me Right Now?

Show not just what exists, but what is active, what shadows what, what points nowhere, and what may still be alive.

### What Is Safe To Ignore?

Some clutter is inert. The user should not waste attention on harmless dust.

### What Needs Review?

Diverged commands, local shadows, ambiguous state, intentional experiments, and anything that might be load-bearing.

### What Must Not Be Touched?

The jewelry box. The net cables. The sacred local hacks. The weird thing that looks messy but is intentional.

### What Can Be Fixed Later?

Only after evidence, scope, snapshot, quarantine, rollback, and verification.

### What Did We Learn?

Repeated problems should become prevention rules, not repeated firefights.

## Emotional Value

Housekeeper should reduce:

- dread before cleanup
- superstition around Claude failures
- fear of deleting something important
- the urge to reinstall everything blindly
- the feeling that invisible automation is in control

It should restore:

- orientation
- confidence
- ownership
- calm
- trust in the environment

The most humane promise is:

> It gives you back the feeling that your Claude environment is yours.

## Operational Value

Housekeeper should create:

- faster diagnosis
- fewer broken sessions
- fewer stale hooks
- fewer duplicate or shadowed skills
- clearer plugin ownership
- recoverable cleanup
- better handoff between sessions
- prevention of repeated failure modes

## User-Facing Thesis

Claude Housekeeper helps you understand, protect, and restore your Claude home before invisible drift turns into broken behavior.

Sharper:

> When Claude starts acting haunted, Housekeeper shows what is loaded, stale, active, broken, protected, and safe to review.

Core identity:

> Claude Housekeeper is not a cleaner. It is the legibility layer for Claude entropy.
