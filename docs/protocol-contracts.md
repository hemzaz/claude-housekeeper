# Protocol Contracts

This document begins translating the philosophy into contracts.

Contracts are not implementation details. They are promises the future product must keep. They define what the user can rely on before any command, UI, or cleanup behavior exists.

## 1. Orientation Contract

Housekeeper must first restore legibility.

The contract is designed for degraded conditions, not perfect ones. Housekeeper should assume it may be entering a Claude home where trust is already damaged: hooks are broken, caches are stale, modes are wandering, namespaces are unclear, and the user is no longer sure what Claude is obeying.

Before proposing action, it should show:

- what exists
- what is loaded
- what is active
- what is stale
- what is broken
- what shadows what
- what owns what
- what is protected
- what is unknown

The user should never have to guess which plugin, command, skill, hook, cache, or state file is influencing Claude.

Promise:

> You are never asked to approve cleanup before you can see the shape of the home.

Corollary:

> The worse the state of the home, the more carefully Housekeeper must move.

## 2. Observation Contract

Observation is read-only.

Looking, listing, counting, hashing, parsing, and comparing must not mutate state.

Observation may produce findings, confidence, risk labels, and evidence. It may not produce side effects.

Promise:

> Diagnosis changes the user’s understanding, not the user’s files.

## 3. Evidence Contract

Every finding must carry evidence.

A finding should be able to answer:

- What was observed?
- Where was it observed?
- What rule classified it?
- What confidence does Housekeeper have?
- What could make this a false positive?
- What should the user do next?

Housekeeper should not say "stale" without explaining why it believes something is stale.

Promise:

> No conclusion without a trail.

## 3A. Surface Classification Contract

Housekeeper must classify the surface before it classifies the problem.

A path is not enough. Age is not enough. Size is not enough. A familiar
directory name is not enough.

Before a finding becomes actionable, Housekeeper must identify:

- what kind of surface it is
- who likely owns it
- whether it can affect Claude behavior
- whether inspecting it can execute code
- whether it is secret-adjacent
- whether it is inside scope
- what rollback proof exists

If the surface cannot be classified, Housekeeper may report uncertainty, but it
cannot propose cleanup.

Promise:

> First understand what kind of thing it is; only then decide what may be wrong.

## 4. Risk And Stance Contract

Housekeeper must classify findings before recommending action.

Risk describes what action would cost.

Stance describes how Housekeeper should speak to the user now.

Initial stances:

- `inform`: useful context, no action
- `watch`: not urgent, may matter later
- `review`: user intent matters
- `probe`: live key required
- `protect`: boundary or do-not-touch
- `prepare`: plan can be drafted, no mutation
- `repair`: narrow repair after consent, snapshot, and verification
- `block`: action is not allowed under current evidence

Risk labels may still exist internally, but they do not decide authority by
themselves.

Risk can only move downward with stronger evidence or explicit user policy. It
cannot move downward because cleanup would be convenient.

Promise:

> Ambiguity lowers authority.

## 5. Protection Contract

Do-not-touch rules are hard boundaries.

A protected item may still be shown, counted, and explained, but it cannot become actionable while protected.

Protected means:

- non-actionable
- visible
- explained
- excluded from mutation
- excluded from learned authority

Protection examples:

- hand-maintained local commands
- private local skills
- experimental prompt directories
- active project hooks
- credential helpers
- session state the user wants preserved

Promise:

> Confidence never overrides a boundary.

## 5A. Sector Boundary Contract

Some boundaries are stronger than ordinary caution. They are sector boundaries.

In a fire range, sector boundaries are marked with lights. Under any circumstances, you do not aim or shoot there. For Housekeeper, a sector boundary is a no-fire zone: the tool must not target it, mutate it, infer permission around it, include it in bundled operations, or learn its way past it.

Sector boundaries are not "high risk cleanup." They are outside the allowed field of action.

### Default Sector Boundaries

The following areas are sector boundaries unless the user explicitly opens a narrowly scoped exception:

- secrets, tokens, API keys, auth files, credential helpers, keychains, SSH keys
- payment, financial, tax, legal, identity, medical, or immigration material
- user-marked do-not-touch paths
- files or directories belonging to another user or another project owner
- active work in progress that Housekeeper did not create
- current session state, running processes, live hooks, and active mode state
- infrastructure, deployment, production, database, and destructive operations
- anything outside the declared scope
- anything Housekeeper cannot observe enough to verify or roll back
- Housekeeper's own rollback evidence, operation manifests, and quarantine metadata

### Sector Boundary Rules

Sector boundary handling is stricter than risk classification:

- Do not mutate.
- Do not quarantine.
- Do not rewrite.
- Do not delete.
- Do not open or inspect sensitive contents unless inspection itself was scoped.
- Do not include as part of parent-directory cleanup.
- Do not suppress the boundary through learned behavior.
- Do not ask repeatedly after the user has marked it protected.
- Do not treat broad urgency as permission.

Allowed actions are limited to:

- report that a boundary exists
- explain why it is out of bounds
- clean around it if no contact is required
- ask for a precise exception if the user explicitly requests work there

### Sector Boundary Exception Standard

Opening a sector boundary requires a new, narrow consent gate:

- exact target
- exact action
- reason
- duration
- rollback expectation
- verification method

Example of insufficient consent:

> clean everything broken

Example of sufficient consent:

> For this run only, inspect `~/.claude/settings.json` for hook commands that reference deleted plugin cache paths. Do not print tokens, do not edit auth helpers, and show the patch before applying it.

Promise:

> Sector boundaries are not places to be careful. They are places not to aim.

## 6. Consent Contract

Consent is scoped, explicit, revocable, and time-bound.

Permission must specify:

- target
- action
- scope
- risk class
- duration
- rollback expectation

Consent to inspect is not consent to repair. Consent to repair is not consent to delete. Consent in one project is not consent in another.

Promise:

> Permission for one action is never permission for adjacent actions.

## 7. Plan Contract

A plan is not permission.

A plan is a reviewable description of possible actions. It must separate:

- protected items
- review items
- informational findings
- watch items
- probe items
- prepare candidates
- repair candidates
- blocked or unknown items

A plan should be stable enough that the user can discuss it, edit it, reject parts of it, and approve only a subset.

Promise:

> The user shapes the cleanup before the cleanup shapes the home.

## 8. Reversibility Contract

Any mutation must either be exactly reversible or explicitly treated as elevated risk.

Claude checkpointing does not satisfy this contract for Housekeeper cleanup.

Housekeeper must have its own snapshot, operation manifest, restore command,
preconditions, and verification plan.

Promise:

> A checkpoint is not a cleanup rollback plan.

Before mutation, Housekeeper must know:

- what will change
- what snapshot exists
- where the backup lives
- how rollback works
- what verification will run
- what residual risk remains

Deletion should start as quarantine. Permanent purge is a separate act with separate consent.

Promise:

> Cleanup without rollback proof is not cleanup.

## 9. Verification Contract

Housekeeper must not claim success merely because a command exited.

Verification should prove that Claude still works at the relevant layer:

- binary starts
- plugin registry loads
- hooks resolve
- tools still execute
- sessions can round-trip
- affected scope no longer reports the same finding

If verification is unavailable, Housekeeper must say so and report residual risk.

Promise:

> Done means verified, or explicitly not verified.

## 10. Learning Contract

Learning is local, inspectable, revocable, and advisory unless promoted to an explicit rule.

Housekeeper may learn from:

- false positives
- protected paths
- accepted plans
- rejected plans
- rollbacks
- successful verification
- failed verification

But learned knowledge cannot silently become authority.

Allowed:

> This has been marked intentional three times. Suggest adding an allowance?

Not allowed:

> This looked intentional before, so I skipped reporting it without telling you.

Promise:

> Memory may guide questions, but only rules grant authority.

## 11. Refusal Contract

Housekeeper must refuse or slow down when action would violate the protocol.

It should refuse when:

- scope is unclear
- protection applies
- evidence is insufficient
- rollback is unavailable
- verification cannot be designed
- action is irreversible and consent is weak
- the user asks to generalize a narrow permission unsafely

Refusal should be specific and useful, not moralizing.

Promise:

> A careful refusal is part of care.

## 12. Handoff Contract

Housekeeper must leave the next session more informed than the current one.

Every meaningful operation or investigation should leave:

- intent
- scope
- findings
- evidence
- user decisions
- unresolved ambiguities
- residual risk
- next steps

Promise:

> The user should not have to restart the archaeology every session.

## 13. Non-Contamination Contract

Housekeeper must not create new mess while diagnosing old mess.

It should avoid:

- accidental registry namespaces
- backup files inside loaded skill or command directories
- hidden state with unclear ownership
- unbounded logs
- unreviewed background tasks
- new hooks that become future ghosts

Promise:

> The housekeeper must not become tomorrow’s clutter.

## 14. User Ownership Contract

The final authority is the user’s authorship of their environment.

The goal is not a spotless `.claude`. The goal is a livable, legible, trustworthy `.claude`.

Some mess is meaningful. Some old work is compost. Some hacks are load-bearing. Some protected areas are private because the user says so.

Promise:

> The Claude home belongs to the user, even when Housekeeper understands parts of it well.

## Edge Case Drilldown

The contracts above matter most when the situation is messy. This section defines how Housekeeper should behave when the easy path is tempting but unsafe.

### 1. Stale Evidence

Case: Housekeeper diagnosed a stale cache or broken hook, but time passed before action.

Rule: Evidence expires before mutation.

Required behavior:

- Re-read the target.
- Re-check path existence, hashes, mtimes, owners, and registry references.
- Abort if anything changed.
- Produce a new plan if the old evidence is stale.

Default stance: `block`.

Principle: A plan is a snapshot of belief, not durable truth.

### 2. Dirty Claude Home

Case: files under `.claude` changed during diagnosis, perhaps by Claude itself, a plugin update, or another session.

Rule: concurrent change lowers authority.

Required behavior:

- Attribute the changed paths if possible.
- Continue only with unaffected read-only reporting.
- Do not mutate any path whose state changed after observation.
- Mark affected findings as `review` or `block`.

Default stance: `review` or `block`.

Principle: Do not clean a room while someone else is rearranging it.

### 3. Conflicting Instructions

Case: global policy says cleanup is allowed, but project policy says a path is protected.

Rule: narrower protection wins unless it weakens safety.

Precedence:

1. explicit current user instruction
2. project do-not-touch rule
3. global do-not-touch rule
4. project allowance
5. global allowance
6. learned suggestion
7. default protocol

If two instructions conflict and neither is clearly safer, pause and ask.

Default stance: `block`.

Principle: Authority narrows as risk rises.

### 4. Protected Parent, Unprotected Child

Case: `skills/private/**` is protected, but `skills/private/tmp.md` looks stale.

Rule: parent protection covers descendants.

Required behavior:

- Report the finding as protected if useful.
- Do not propose cleanup.
- Do not ask repeatedly unless the user requests a review of protected items.

Default stance: `protect`.

Principle: A closed room includes the things inside it.

### 5. Unprotected Parent, Protected Child

Case: an old directory appears eligible for future cleanup planning, but one child path is protected.

Rule: cleanup cannot swallow protected descendants.

Required behavior:

- Split the operation.
- Exclude the protected child.
- If exclusion would make the operation ambiguous or lossy, block the whole operation.

Default stance: `block` or partial `review`.

Principle: The broom must not sweep the jewelry box with the dust.

### 6. Symlinks And Aliases

Case: a stale-looking path is a symlink, hardlink, alias, mount, or path alias to something live.

Rule: identity must be canonical before action.

Required behavior:

- Resolve canonical paths for evidence.
- Show both observed and resolved paths.
- Treat unresolved or cross-boundary links as elevated risk.
- Never clean through a link into an unscoped area.

Default stance: `review`.

Principle: A door may lead outside the room.

### 7. Duplicate Plugin Scope

Case: the same plugin is installed at user and project scope.

Rule: duplication is not automatically an error.

Required behavior:

- Show both registrations and their precedence.
- Explain whether both can be active.
- Mark as `prepare` only if one registration is provably orphaned,
  unprotected, and rollback proof exists.

Default stance: `review`.

Principle: Two copies may be a mistake, or they may be policy.

### 8. Local Shadow Of Plugin Resource

Case: a local command or skill has the same name as a plugin-provided one.

Rule: shadowing is ambiguous by default.

Required behavior:

- Show source, target, and precedence.
- If byte-identical, stance can become `prepare` only after rollback proof.
- If diverged, stance is `review`.
- If protected, stance is `protect`.

Default stance: `review`.

Principle: A local override may be clutter, but it may also be authorship.

### 9. Broken Hook Path

Case: a hook command references a deleted plugin path.

Rule: direct broken references are repair candidates, not delete candidates.

Required behavior:

- Show the hook event, command, missing path, and likely owning plugin.
- If the command contains shell expansion, wrappers, or generated paths, lower confidence.
- Repair only with whole-file backup and exact JSON patch.
- Never remove unrelated hook entries.

Default stance: `prepare` when direct, `probe` when shell-ambiguous.

Principle: A broken switchboard should be rewired carefully, not ripped out.

### 10. Invalid Settings

Case: `settings.json` or installed plugin registry cannot be parsed.

Rule: invalid core config disables advanced inference.

Required behavior:

- Report parse failure first.
- Avoid claims that depend on the invalid file.
- Do not learn from the broken state.
- Suggest repair using minimal targeted edits.

Default stance: `prepare` for the parse repair, `block` for dependent inference.

Principle: If the map is torn, stop navigating from it.

### 11. Zombie Mode State

Case: a mode state says `active=true`, but its heartbeat is old.

Rule: old heartbeat is evidence, not proof.

Required behavior:

- Check known session/process evidence where possible.
- Show last heartbeat, session id, and owning mode.
- If process evidence is absent, require a conservative timeout and freshness key
  before planning.
- If evidence is incomplete, stance is `review` or `probe`.

Default stance: `review`.

Principle: Do not declare something dead only because it is quiet.

### 12. Active Session Artifacts

Case: old session files look stale, but the user may resume them.

Rule: resumability is user value.

Required behavior:

- Separate active, recent, old, and unknown sessions.
- Never purge sessions solely by age without policy.
- Prefer archive or quarantine over deletion.

Default stance: `review`.

Principle: Old memory can still be memory.

### 13. Large Logs

Case: logs are large and slowing diagnosis.

Rule: logs are evidence until retention policy says otherwise.

Required behavior:

- Report size and last modified time.
- Suggest rotation, not deletion.
- Preserve the most recent useful tail when rotating.
- Never rotate protected logs.

Default stance: `prepare` only if rotation policy and rollback proof exist,
otherwise `review`.

Principle: Evidence should be compressed before it is erased.

### 14. Secrets And Credential Helpers

Case: files or settings may contain API keys, auth helpers, tokens, or credential paths.

Rule: secret-bearing material is a sector boundary by default.

Required behavior:

- Do not print secret values.
- Do not copy secrets into logs, plans, or issue reports.
- Do not move credential helpers unless explicitly scoped.
- Redact evidence while preserving enough structure to debug.

Default stance: `protect`.

Principle: A housekeeper may note a locked safe exists; it does not inventory the safe.

### 15. External Side Effects

Case: fixing a stale plugin might run `claude plugin update`, change network state, or hit a registry.

Rule: external actions require separate consent.

Required behavior:

- Distinguish local file cleanup from network or marketplace operations.
- Explain what service will be contacted.
- Show whether credentials may be used.
- Never bundle external updates into local cleanup approval.

Default stance: `block` until consent.

Principle: Leaving the house requires a different permission.

### 16. Background Actors

Case: hooks, agents, MCP servers, or background tasks may be running while cleanup happens.

Rule: active actors must be known before mutation.

Required behavior:

- Identify known active actors.
- Refuse mutation of paths they may own.
- Ask whether to stop, wait, or exclude.
- Record unresolved actors as residual risk.

Default stance: `block`.

Principle: Do not move the ladder while someone may be standing on it.

### 17. Interrupted Cleanup

Case: cleanup starts, snapshots some files, then crashes or is cancelled.

Rule: incomplete operations become first-class findings.

Required behavior:

- On next run, detect the interrupted operation.
- Show what completed, what did not, and what can roll back.
- Block new cleanup until the interrupted operation is resolved or explicitly abandoned.

Default stance: `block`.

Principle: Finish accounting before starting another job.

### 18. Rollback Failure

Case: rollback cannot restore exactly because targets changed or backups are incomplete.

Rule: failed rollback is a critical state.

Required behavior:

- Stop further mutation.
- Preserve all remaining evidence.
- Report exact failed precondition.
- Offer manual recovery steps.
- Lower confidence for that operation class in future learning.

Default stance: `block`; trust state is critical.

Principle: A broken undo button is an emergency, not a warning.

### 19. Verification Failure

Case: cleanup completes, but Claude smoketest fails.

Rule: mutation success without verification success is not success.

Required behavior:

- Mark operation as degraded.
- Offer rollback if possible.
- Report which probe failed first.
- Do not continue to later probes as proof.

Default stance: `block`; trust state is critical.

Principle: The home is not clean if the lights no longer work.

### 20. Learned False Positive

Case: user repeatedly dismisses the same finding.

Rule: repetition may suggest an allowance, not create one silently.

Required behavior:

- Suggest a local allowance rule.
- Show the exact scope of the proposed allowance.
- Keep reporting until the user accepts the rule.
- Never generalize beyond the observed path/check pair without approval.

Default stance: unchanged until accepted.

Principle: Annoyance is not consent.

### 21. Learned Preference Conflicts With Current Risk

Case: user usually allows stale cache cleanup, but current cache contains active markers.

Rule: current evidence overrides learned preference.

Required behavior:

- Explain the conflict.
- Elevate to `review` or `block`.
- Do not apply standing preference.

Default stance: `block`.

Principle: Habit yields to present danger.

### 22. User Says "Just Fix It"

Case: user gives broad permission under frustration.

Rule: broad urgency does not erase consent gates.

Required behavior:

- Proceed with low-risk read-only diagnosis.
- Present a scoped plan.
- Require explicit approval for mutation categories.
- Refuse destructive or external actions without separate confirmation.

Default stance: scope-dependent; destructive actions `block`.

Principle: Frustration is not a safe policy language.

### 23. User Says "Do Not Ask Me Again"

Case: user wants less prompting.

Rule: reduced prompting must become a bounded policy, not hidden autonomy.

Required behavior:

- Ask what category should be auto-approved.
- Define scope, duration, risk ceiling, and rollback requirement.
- Exclude protected, destructive, external, and ambiguous actions by default.

Default stance: policy proposal, not immediate authority.

Principle: Quiet operation still needs visible boundaries.

### 24. Multiple Users Or Shared Machine

Case: `.claude` contains shared project state or artifacts from another person.

Rule: ownership uncertainty raises risk.

Required behavior:

- Avoid modifying resources outside the current user's clear ownership.
- Treat shared project config as project-owned, not personal.
- Require authority for shared or team-level changes.

Default stance: `review`.

Principle: One resident cannot authorize cleanup of another resident’s desk.

### 25. Version Drift In Claude Layout

Case: Claude changes plugin cache, registry, or settings schema.

Rule: unknown schema disables destructive inference.

Required behavior:

- Detect schema version where possible.
- Mark unsupported versions as `review` or `block`.
- Avoid cleanup based on outdated layout assumptions.

Default stance: `block` for mutation, `inform` for diagnosis.

Principle: Do not clean by an obsolete floor plan.

### 26. Housekeeper's Own Artifacts

Case: Housekeeper creates logs, snapshots, quarantine, or knowledge files.

Rule: Housekeeper must be accountable for its own mess.

Required behavior:

- Put artifacts in a clearly owned namespace.
- Bound log size and retention.
- Never place backups inside loaded registry paths.
- Include self-checks for stale Housekeeper artifacts.

Default stance: self-owned, reviewable.

Principle: The housekeeper must clean its own closet.

## Edge Case Default Table

| Edge case | Default stance |
|---|---|
| protected path | `protect` |
| sector boundary | out of bounds unless explicitly opened |
| ambiguous ownership | `review` or `block` |
| invalid core config | `prepare` for parse repair; `block` dependent inference |
| stale evidence before mutation | `block` |
| concurrent changes | `review` or `block` |
| broken direct hook path | `prepare` |
| shell-ambiguous hook path | `probe` |
| duplicate scope | `review` |
| byte-identical local shadow | `prepare` only with rollback proof |
| diverged local shadow | `review` |
| zombie state with weak evidence | `review` or `probe` |
| active background actor | `block` |
| interrupted cleanup | `block` |
| rollback failure | `block`, critical trust state |
| verification failure | `block`, critical trust state |
| secret-bearing material | `protect` |
| external side effect | `block` |
| unsupported Claude schema | `block` for mutation |

## Contract Summary

Housekeeper may observe, explain, classify, remember explicit rules, suggest plans, and prepare reversible actions.

Housekeeper may not silently mutate, infer permission, erase protected material, hide uncertainty, turn memory into authority, or claim success without verification.

Operating sentence:

> Leave it visible, leave it reversible, ask before touching, and never let memory become authority.
