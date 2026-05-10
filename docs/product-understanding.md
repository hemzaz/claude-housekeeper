# Product Understanding

This document bridges the protocol model into product thinking.

The philosophy answers what kind of relationship Housekeeper should have with the user. The protocol model defines the nouns and contracts. This document asks: how does this become a product people understand, choose, trust, and return to?

## 1. Product Thesis

Claude Housekeeper restores trust in Claude Code by making the Claude home legible before invisible drift turns into broken behavior.

It is not another capability plugin. It is the maintenance and trust layer for the capability environment.

Claude Code is the main tool people use to code. Housekeeper exists for the moment when that main tool starts feeling unstable, haunted, or no longer fully under the user’s control.

Core promise:

> Find what is loaded, active, expected-orphan, candidate-stale, broken,
> protected, missing a key, or blocked before you change anything.

More emotional promise:

> Get back the feeling that your Claude environment is yours.

## 2. Product Category

Primary category:

> Claude Code home inspector

Secondary categories:

- trust restoration tool
- environmental debugger
- Claude entropy monitor
- maintenance layer
- preflight inspector
- recovery protocol

It should not position itself primarily as:

- cleanup bot
- optimizer
- autonomous janitor
- plugin updater
- security scanner

The product category should imply care, inspection, and trust before action.

## 3. User Segments

### Solo Heavy Claude Code User

Uses Claude Code daily. Has many sessions, local overrides, plugins, hooks, and accumulated state.

Pain:

- Claude feels slower or stranger over time
- hard to know what changed
- afraid to delete old state

Value:

- regain orientation quickly
- find broken or stale causes without archaeology
- protect intentional hacks

### Plugin Experimenter

Installs, updates, removes, and compares plugins.

Pain:

- stale cache versions
- duplicate registrations
- plugin-owned commands colliding with local copies
- hooks referencing deleted versions

Value:

- see plugin/cache/registry relationships
- know what is stale versus active
- avoid breaking experiments while cleaning old ones

### Team Lead Or Maintainer

Maintains shared Claude config for a project or team.

Pain:

- local user state conflicts with project policy
- team members report inconsistent behavior
- hard to debug shared hooks and command namespaces

Value:

- produce reviewable diagnostics
- separate project-owned from user-owned state
- avoid silently mutating shared config

### Consultant Or Multi-Project Operator

Moves between many client/project contexts.

Pain:

- namespaces blur across projects
- local policies and project policies conflict
- accidental contamination between contexts

Value:

- declare current scope and ownership
- detect project/user collisions
- preserve boundaries between homes

### Ops-Minded Power User

Uses hooks, MCP servers, background agents, custom modes, and automation.

Pain:

- zombie modes
- stale state
- broken MCP commands
- hidden actors

Value:

- show active actors and owners
- detect dangling references
- restore control without disabling everything blindly

### Non-Expert User With A Haunted Setup

Does not deeply understand `.claude`, but something broke.

Pain:

- startup errors
- missing skills
- confusing warnings
- fear of making things worse

Value:

- one safe command
- plain-language report
- no files changed
- clear next step

## 4. Trigger Moments

A trigger moment is when the user feels the need.

High-intent triggers:

- Claude Code errors on startup.
- A hook keeps firing after plugin uninstall.
- Skills or commands disappear.
- A plugin update makes behavior weird.
- Claude feels slower or unstable.
- A fresh session inherits strange state.
- User sees many old plugin cache versions.
- User wants to clean `.claude` but is afraid.
- A mode keeps acting after the session ended.
- Team members see different Claude behavior in the same repo.

The wedge is not routine tidiness. The wedge is:

> Something feels wrong, and I need a trustworthy map before I touch anything.

## 5. Aha Moments

The product earns trust when it explains a weird failure in one glance.

Likely aha moments:

- "This hook points at a deleted plugin version."
- "This local command shadows the plugin command you expected."
- "This copied command is byte-identical, but action waits for rollback proof."
- "This command diverged; review before touching."
- "This mode state claims active but has an old heartbeat."
- "This cache exists but is not referenced by known installed registry evidence."
- "This path is protected, so it will not be touched."
- "No files changed. This is only the map."

The strongest aha:

> It tells me why Claude feels haunted without making the haunting worse.

## 6. Core User Journey

### 1. Anxiety

The user notices instability, slowness, missing skills, broken hooks, or namespace confusion.

User thought:

> I do not know what Claude is seeing anymore.

### 2. Safe Entry

The user runs a read-only command.

Expected feeling:

> This will not make things worse.

### 3. Orientation

Housekeeper shows a stance-first report and map.

Expected feeling:

> I can see the shape of the problem.

### 4. Protection

The user marks sacred paths, local hacks, active experiments, or private areas.

Expected feeling:

> It knows where not to aim.

### 5. Review

Housekeeper separates inform, watch, review, probe, protect, prepare, repair,
and block stances.

Expected feeling:

> I know what deserves attention.

### 6. Plan Preview

The user sees possible actions, but no mutation occurs.

Expected feeling:

> I am shaping the cleanup.

### 7. Recovery

When mutation eventually exists, actions start with surface reclassification,
evidence refresh, snapshot, manifest, and verification.

Expected feeling:

> I can undo this.

### 8. Prevention

Repeated findings become suggested rules or probes.

Expected feeling:

> We will not fight this same fire every week.

## 7. Product Promise

Primary promise:

> Claude Housekeeper turns haunted Claude state into inspectable state.

Operational promise:

> It shows what is loaded, active, expected-orphan, candidate-stale, broken,
> protected, missing a key, and blocked.

Safety promise:

> Diagnosis changes your understanding, not your files.

Recovery promise:

> Future mutation starts with Housekeeper-owned rollback proof and verification,
> not blind deletion.

## 8. MVP Boundary

The MVP should be narrow and trustworthy.

### Must Include

- read-only `diagnose`
- stance-first report
- no-mutation `plan`
- first wedge checks for broken hooks and plugin cache drift
- structured findings with surfaces, evidence, and stance
- protection/do-not-touch rules
- sector boundary awareness
- clear "no files changed" language
- JSON output for future integration

### Should Include Soon

- safe mode diagnosis
- allowances for known false positives
- namespace map
- evidence grades
- finding lifecycle
- config validation

### Must Not Include Yet

- automatic cleanup
- permanent deletion
- background daemon
- network updates bundled into cleanup
- plugin uninstall
- unreviewed hardening hooks
- secret scanning as a core promise
- autonomous "fix everything"

MVP thesis:

> The first release wins by being obviously safe and surprisingly clarifying.

## 9. UX Principles

### Show No-Change Confidence

Every read-only run should clearly say:

> No files were changed.

### Prefer Maps Over Walls Of Text

The stance-first report should lead. Details should be drill-down.

### Use Stance As Navigation

Group findings by Housekeeper's posture:

- inform
- watch
- review
- probe
- protect
- prepare
- repair
- block

### Explain Ownership

Show who owns each thing:

- user
- project
- plugin
- generated
- Housekeeper
- unknown

### Teach The System

Output should help the user learn Claude’s resolution rules: precedence, shadowing, hooks, cache references, scopes.

### Be Calm Under Failure

When config is broken or evidence conflicts, output should be precise and composed.

No drama, no "fixed everything," no false confidence.

## 10. Product Language

Recommended user-visible terms:

- loaded
- active
- expected orphan
- candidate stale cache
- shadowing
- diverged
- identical
- dangling
- protected
- outside declared scope
- review required
- live probe required
- missing key
- prepare plan
- blocked
- residual risk

Terms to avoid or use sparingly:

- optimized
- clean bill of health
- fixed everything
- safe cleanup
- unused, unless proven
- broken, unless the evidence is direct

Internal metaphor may use "haunted," but CLI output should stay precise.

## 11. Onboarding

The first run should not require configuration.

Default:

1. run read-only
2. show sector boundary defaults
3. show stance-first report
4. ask or suggest how to mark protected areas only after findings exist

Potential first-run text:

```text
Claude Housekeeper is running read-only.
No files will be changed.
Default sector boundaries are active: secrets, auth state, live sessions, production/infrastructure, and anything outside scope.
```

Boundary onboarding should be contextual:

> This local command diverges from the plugin version. Is it intentional? You can mark it protected or allowed.

## 12. Adoption Path

Housekeeper can enter the user’s life through several rituals:

### Recovery

Run when Claude feels broken.

### Preflight

Run before plugin updates, major config changes, or sharing setup with a team.

### SessionStart Probe

Lightweight checks only: config parse, hook path existence, active rollback marker, obvious collisions.

### Weekly Hygiene

Read-only stance summary and trend report.

### Before Cleanup

Generate plan preview, protection review, and future mutation preconditions.

The first adoption path should be recovery. Trust is easiest to earn when the tool explains a real pain.

## 13. Failure UX

Housekeeper must be excellent when it cannot proceed.

Example failures:

### Invalid Core Config

```text
I cannot trust settings-derived findings because settings.json is invalid.
No files were changed.
Next step: repair settings.json or run safe mode.
```

### Conflicting Evidence

```text
This cache tree is not referenced by installed_plugins.json, but an active marker exists inside it.
Stance: probe or review.
No action candidate was created.
```

### Sector Boundary

```text
This path is a sector boundary because it may contain credentials.
It was not inspected beyond metadata and will not be included in cleanup.
```

### Verification Unavailable

```text
I cannot verify Claude session startup from this environment.
The finding remains unresolved and residual risk is recorded.
```

Good failure UX increases trust.

## 14. Alternatives Users Use Today

Today users recover by:

- manually running `find`, `du`, `jq`, `ls`, and `grep`
- deleting chunks of `.claude`
- reinstalling plugins
- bypassing hooks
- asking Claude to debug itself while Claude is affected by the same broken state
- ignoring the rot until it breaks again

Housekeeper wins by being:

- scoped
- Claude-aware
- evidence-bearing
- read-only first
- rollback-oriented
- protection-aware
- calm in degraded state

## 15. Product Artifacts

Primary artifacts:

- stance-first report
- map
- plan preview
- protection rules
- evidence trail
- verification report
- operation log
- knowledge suggestions

Each artifact should answer a different user need:

- stance-first report: what posture should I take?
- map: what is influencing Claude?
- plan preview: what could we do later?
- protection rules: what must not be touched?
- evidence trail: why believe this?
- verification report: did trust improve?
- operation log: what changed?
- knowledge suggestions: how prevent recurrence?

## 16. Success Metrics

Product success should measure restored control, not raw deletion.

Possible metrics:

- time to identify broken hook path
- percentage of findings with clear owner
- percentage of findings with evidence grade
- false positive rate
- protected findings never mutated
- mutation attempts blocked by sector boundaries
- verification pass rate after repair
- rollback success rate
- repeat findings converted into reviewed rules
- user-reported "I know what is happening now"

Bad metrics:

- files deleted
- megabytes saved
- number of automatic repairs
- prompts avoided at the cost of safety

## 17. Brand Tone

Tone should be:

- calm
- exact
- trustworthy
- non-dramatic
- operational
- respectful of user authorship

Metaphors belong in docs. CLI output should be literal.

Good:

> This command shadows a plugin command and has different content.

Bad:

> I found a spooky ghost command.

## 18. Roadmap Shape

### v0.1: Read-Only First Wedge

- diagnose
- stance-first report
- no-mutation plan preview
- JSON findings
- surface classification
- broken hook and plugin cache drift focus
- protected rules
- no mutation

### v0.2: Knowledge And Boundaries

- allowances
- do-not-touch management
- finding lifecycle
- evidence grades

### v0.3: Safe Mode

- minimal dependency recovery scan
- broken config handling
- no hooks/plugins execution

### v0.4: Snapshot And Quarantine

- prepared operations
- snapshots
- quarantine
- rollback manifests

### v0.5: Verified Repair

- targeted settings/hook repair
- verification reports
- residual risk records

### v1.0: Trust Recovery Loop

- diagnose
- protect
- plan
- quarantine/repair
- verify
- learn
- prevent

## 19. User Research Questions

Questions to validate:

- What made your Claude setup feel broken?
- What were you afraid to delete?
- Which `.claude` folders do you understand?
- Have hooks or plugins broken your sessions?
- What would make you trust a cleanup plan?
- Would you trust quarantine before deletion?
- What output would make you feel safe?
- What should Housekeeper never touch?
- When would you want safe mode?
- What repeated failure would you want prevented?

## 20. Product Understanding Summary

Claude Housekeeper is valuable because it restores the user’s mental model.

It should begin as a read-only home inspection report, not a cleanup bot.

Its first job is to answer:

> What is happening in my Claude home, what can I ignore, what should I watch,
> what needs review, what needs a probe, what is protected, and what is blocked?

Only after that can it earn the right to help repair.
