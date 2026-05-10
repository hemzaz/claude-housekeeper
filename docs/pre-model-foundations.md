# Pre-Model Foundations

This document closes the conceptual gaps before writing the formal protocol model.

The philosophy says why Housekeeper exists. The contracts say what must be promised. The sector boundaries say where not to aim. This layer defines the missing practical doctrine: where Housekeeper may operate, how authority escalates, what evidence means, how trust is restored, and how edge cases should feel to the user.

Convergence note:

The current framework uses stances rather than old cleanup classifications.
Where this document says review, probe, prepare, protect, or block, those are
user-facing postures, not implementation commands.

## 1. Operating Zones

Housekeeper needs more than no-fire zones. It also needs a field map.

### Green Zone

Allowed by default for read-only diagnosis:

- list installed plugins, commands, skills, hooks, caches, settings, and state files
- parse public config structure without printing secrets
- count files and sizes
- compare registry entries to disk paths
- detect command and skill name collisions
- identify Housekeeper-owned artifacts
- report exact paths, owners, timestamps, hashes, and evidence where safe

Green zone does not mean mutation is allowed. It means observation is allowed.

### Yellow Zone

Allowed to discuss and produce a plan preview, but not mutate:

- stale cache trees
- duplicate plugin registrations
- byte-identical local shadows
- old logs
- old session data
- broken direct hook references
- Housekeeper-owned quarantine or backups

Yellow zone items may become `watch`, `probe`, or `prepare` findings after
surface classification and evidence collection. Mutation still requires later
consent, snapshot, rollback proof, and verification.

### Orange Zone

Review or probe by default:

- diverged local commands or skills
- duplicate user/project scope where both may be intentional
- shell-ambiguous hook commands
- old mode state without process evidence
- shared project config
- symlinked or aliased paths
- resumable sessions
- anything with unclear ownership

Orange zone means Housekeeper may explain but should not recommend automatic
cleanup.

### Red Zone

High-risk work requiring elevated consent:

- edits to settings
- hook repair
- plugin uninstall or update
- stopping active processes
- deleting or purging quarantined material
- changing project-level policy

Red zone requires a concrete action, scope, rollback expectation, and verification plan.

### Black Zone

Sector boundaries. Do not aim there unless the user opens a narrow exception.

Examples: secrets, auth state, production infrastructure, live session state, rollback evidence, another person’s material, anything outside scope, anything unverifiable or non-reversible.

## 2. Authority Ladder

Housekeeper should not jump from observation to action.

Authority levels:

1. **Observe**: read-only inventory and evidence gathering.
2. **Classify surfaces**: identify surface, owner, load-bearing status,
   sensitivity, execution risk, scope, and rollback class.
3. **Collect evidence**: attach structural, loader, behavioral, ownership,
   freshness, and reversibility keys.
4. **Classify findings**: assign finding class, claim level, confidence, and
   residual risk.
5. **Choose stance**: inform, watch, review, probe, protect, prepare, repair, or
   block.
6. **Explain**: show why a finding matters or does not matter.
7. **Suggest**: propose a next step without preparing mutation.
8. **Plan**: assemble candidate operations and exclusions.
9. **Prepare**: compute preconditions, snapshots, rollback paths, and verification steps.
10. **Quarantine**: reversible move into a visible holding area.
11. **Repair**: targeted edit with backup and exact patch.
12. **Purge**: permanent deletion after retention and separate consent.
13. **Harden**: install prevention rules or hooks.

Each rung requires all consent and evidence from the rungs below it.

Skipping rungs is allowed only for read-only movement downward, never for mutation.

## 3. Evidence Standard

Housekeeper should separate what it sees from what it infers.

### Evidence Grades

- `observed`: directly read from disk, config, command output, or process table
- `corroborated`: two or more independent sources agree
- `inferred`: likely based on structure, age, path, or naming
- `stale`: evidence was true earlier but may no longer be true
- `conflicting`: sources disagree
- `unavailable`: required evidence cannot be obtained

### Evidence Rules

- `observed` may support reporting.
- `corroborated` may support planning.
- `inferred` may support review, not mutation.
- `stale` must be refreshed before mutation.
- `conflicting` blocks mutation.
- `unavailable` lowers confidence and raises residual risk.

No finding should be allowed to hide its evidence grade.

## 4. Finding Lifecycle

A finding is not just a row in a report. It has history.

Lifecycle states:

- `new`: not previously seen
- `known`: seen before
- `protected`: covered by do-not-touch or sector boundary
- `allowed`: accepted false positive or intentional state
- `accepted`: user agrees it should be handled
- `rejected`: user disagrees with classification
- `planned`: included in a reviewable plan
- `prepared`: preconditions and rollback are known
- `quarantined`: reversible action completed
- `repaired`: targeted fix completed
- `resolved`: no longer present after verification
- `recurred`: resolved before, now back
- `stale`: evidence expired
- `blocked`: cannot safely proceed
- `critical`: rollback or verification failure

Learning should mostly operate on lifecycle transitions, not raw files.

## 5. Trust Recovery Flow

The canonical user journey is not "clean." It is trust recovery.

1. **Orient**
   Show the shape of the home.

2. **Stabilize**
   Detect broken core config, active background actors, sector boundaries, and interrupted operations.

3. **Isolate**
   Separate harmless clutter, active contamination, possession, and disorientation.

4. **Protect**
   Apply do-not-touch rules and sector boundaries.

5. **Choose Stance**
   Decide whether the user needs inform, watch, review, probe, protect, prepare,
   repair, or block.

6. **Plan**
   Present reviewable candidates with evidence and risk.

7. **Act**
   Only where scoped consent, snapshot, and rollback exist.

8. **Verify**
   Prove Claude still works at the affected layer.

9. **Prevent**
   Suggest future probes or rules based on what was learned.

This flow should be visible to the user. They should know which phase they are in.

## 6. Emergency Safe Mode

Housekeeper needs a recovery posture for badly broken Claude homes.

Safe mode should mean:

- no mutation
- no plugin execution
- no hook execution
- no reliance on loaded registry state
- direct file inspection only
- bounded recursive scans
- redacted output
- clear "minimum viable truth" report

Safe mode exists for cases where normal Claude behavior is too compromised to trust.

Safe mode asks:

- Can the binary start?
- Can core config parse?
- What hooks would fire?
- What plugins are registered?
- Which paths are missing?
- Which active states claim ownership?
- What must be disabled manually to regain control?

Safe mode is not cleanup. It is triage.

## 7. Ownership Doctrine

Cleanup decisions depend on ownership.

Ownership classes:

- `user-owned`: authored or explicitly maintained by the user
- `project-owned`: belongs to the current project policy or repository
- `plugin-owned`: installed by a plugin or marketplace
- `housekeeper-owned`: created by Housekeeper
- `generated`: produced by a known process and reproducible
- `shared`: may affect other users or projects
- `unknown`: ownership unclear

Defaults:

- user-owned: `review` unless explicitly selected
- project-owned: `review`; may need project authority
- plugin-owned: can be diagnosed against registry; cleanup still requires evidence
- housekeeper-owned: Housekeeper is responsible for lifecycle and cleanup
- generated: eligible for `prepare` only if reproducible, unprotected, and
  rollback proof exists
- shared: `review` or `block`
- unknown: `review`

## 8. Namespace Doctrine

Namespace confusion is one of the core pains.

Housekeeper should always distinguish:

- user scope
- project scope
- plugin marketplace
- plugin cache path
- local command namespace
- local skill namespace
- accidental directory namespace
- hook namespace
- MCP server namespace
- mode/session namespace

For every collision or shadow, Housekeeper should show:

- winner
- loser
- precedence rule
- source paths
- whether content is identical or diverged
- whether the override is protected or allowed

Namespace findings should teach the user how Claude is resolving behavior.

## 9. Severity, Risk, Confidence, Urgency, Reversibility, Stance

These must not be collapsed.

- `severity`: how bad if the finding is true
- `risk`: how dangerous it is to act
- `confidence`: how sure Housekeeper is
- `urgency`: how soon it matters
- `reversibility`: how recoverable the proposed action is
- `stance`: what posture Housekeeper should take now

Examples:

- Large log: low severity, low urgency, medium risk to delete, `watch` or
  `prepare` only if rotation policy and rollback proof exist.
- Broken direct hook path: medium severity, high confidence, repair risk,
  medium urgency, usually `prepare`.
- Secret-bearing file: severity unknown, action risk high, sector boundary.
- Zombie mode: potentially high severity, often medium confidence, `review` or
  `probe` until corroborated.

This separation prevents the common mistake: "this looks bad, therefore delete it."

## 10. User Language

The protocol should use stable words that teach the system.

Recommended vocabulary:

- `loaded`: Claude currently sees or may use this
- `active`: currently running or marked active
- `stale`: older than expected or not referenced by current registry
- `orphaned`: no owner or registry reference found
- `shadowing`: one resource overrides another by name
- `diverged`: same name, different content
- `identical`: byte-identical copy
- `dangling`: reference points to missing path
- `protected`: do-not-touch rule applies
- `sector boundary`: out of bounds
- `review required`: human decision needed
- `live probe required`: stronger key needed
- `watch`: visible but not currently actionable
- `prepare`: plan can be drafted, no mutation yet
- `blocked`: cannot proceed safely
- `critical`: rollback or verification failure
- `residual risk`: what may still be wrong

Avoid vague language:

- "optimized"
- "fixed everything"
- "safe cleanup" without specifying why
- "healthy" without verification
- "unused" when only "not referenced" is known

## 11. Non-Goals

Housekeeper is not:

- an autonomous janitor
- a generic disk cleaner
- a secret scanner
- a security product
- a plugin updater first
- a performance optimizer first
- a replacement for Claude Code
- a tool for hiding complexity from the user
- a system that should create more hidden state than it explains
- a tool that should make irreversible changes by default

Housekeeper is a trust restoration protocol.

## 12. Self-Governance

Housekeeper can become tomorrow's clutter unless governed.

Rules:

- all artifacts live under a clearly owned namespace
- logs are bounded and rotate
- quarantine has retention policy
- operation manifests are inspectable
- learning files are editable
- backups are not stored inside loaded command or skill namespaces
- self-checks report stale Housekeeper artifacts
- uninstall must explain what remains and why

Housekeeper must diagnose itself.

## 13. Human Override Protocol

Users may override defaults, but overrides must be precise.

Override types:

- `temporary exception`: one run, one target, one action
- `standing policy`: durable rule, visible and revocable
- `break glass`: high-risk action with explicit residual risk
- `never ask again`: allowed only as bounded policy with risk ceiling

Even under override, Housekeeper should still refuse:

- hidden sector boundary bypass
- impossible rollback presented as reversible
- destructive action outside declared scope
- mutation with stale or conflicting evidence
- action that would erase rollback evidence

Override is not abdication. It is a scoped transfer of authority.

## 14. Shared-Use Doctrine

Some Claude homes are shared through projects, teams, repos, or machines.

Rules:

- personal policy cannot silently rewrite shared project policy
- project policy cannot silently touch personal protected paths
- another user's artifacts require that user's authority
- team-level cleanup should produce a review artifact, not direct mutation
- shared caches and hooks require higher evidence and stronger rollback

When ownership is mixed, Housekeeper should prefer reporting and planning over action.

## 15. Readiness Before Protocol Model

Before writing formal schemas, the following concepts are now sufficiently charted:

- user pain
- degraded-state doctrine
- sector boundaries
- operating zones
- authority ladder
- evidence quality
- finding lifecycle
- trust recovery flow
- emergency safe mode
- ownership
- namespace resolution
- risk/severity/confidence separation
- user vocabulary
- non-goals
- self-governance
- human override
- shared-use behavior
- stance calculus
- surface classification gate
- rollback boundary excluding Claude checkpointing

The next document can now become the protocol model: the formal nouns, relationships, state transitions, and schemas.
