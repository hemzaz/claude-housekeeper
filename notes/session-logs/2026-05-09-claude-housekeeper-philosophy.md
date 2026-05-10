# Claude Housekeeper Philosophy Session

Date: 2026-05-09

## Context

We are charting Claude Housekeeper before treating it as a product or implementation.

The goal is to understand the pain first, then derive the protocol, requirements, and eventual specs from that pain. The important shift in this session was away from "a cleanup tool" and toward "a protocol of invited care for a Claude home."

## Core Thesis

Claude Housekeeper is not primarily a cleaner.

It is a legibility and control protocol for accumulated Claude entropy.

It is also explicitly not a happy-path tool. Its most important work begins when the Claude home is already uncomfortable: dirty, slow, unstable, partially broken, and no longer trusted.

`.claude` starts as a home, then becomes an attic, then a storage unit, then a haunted control room. Old plugins, stale caches, broken hooks, accidental namespaces, and zombie state accumulate until Claude becomes unstable and the user loses confidence in what is being loaded, obeyed, remembered, or triggered.

Housekeeper exists to restore trust in the Claude home before entropy becomes behavior.

More specifically: Housekeeper restores trust in the main coding tool people rely on by making its support environment legible again.

## The Pain

The pain is not simply "mess."

The deeper pain is epistemic collapse: the user can no longer form a reliable mental model of the system.

The user does not know:

- what state exists
- who owns it
- whether it is fresh
- whether it is active
- whether it is safe to delete
- whether automation is helping or interfering
- which namespace, plugin, hook, command, or mode is currently in control

This creates a control deficit. The user becomes both operator and forensic investigator.

## Failure Modes

### Setup Rot

Commands that used to work fail. Configs drift from reality. Bootstrap paths become unclear.

Protocol response: explicit preflight checks and reproducible known-good baselines.

### Hidden State

Behavior changes without visible config changes. Fixes work once, then disappear.

Protocol response: make state inspectable, attributable, and resettable.

### Broken Hooks

Hooks block work, run stale tools, point at deleted paths, or silently fail.

Protocol response: hooks must be versioned, validated, and repairable without guesswork.

### Stale Caches

Claude sees old files, old modes, old instructions, or stale indexes.

Protocol response: distinguish inert stale material from stale material that changes current behavior.

### Accidental Namespaces

Moving files aside can accidentally create new registry namespaces. Work can happen in the wrong project, scope, branch, or profile.

Protocol response: always declare current workspace, namespace, scope, and target before action.

### Zombie Modes

Old modes, agents, hooks, or session state keep affecting new work after the session that created them is gone.

Protocol response: detect active actors, show owners, and prove staleness before cleanup.

### Fear of Deletion

The user avoids cleanup because it is unclear what is safe to remove.

Protocol response: dry-run first, risk labels, quarantine, rollback, and visible do-not-touch rules.

### Loss of Control

Automation acts before explaining, or hidden state changes behavior.

Protocol response: bounded agency, consent gates, and visible plans.

## Entropy States

Claude Housekeeper should distinguish four states of `.claude` entropy:

1. **Clutter**
   Too much old material exists, but it is mostly inert.

2. **Contamination**
   Old material changes current behavior: stale skills, shadowed commands, broken hooks.

3. **Possession**
   Zombie state or hooks keep acting after their original session is gone.

4. **Disorientation**
   The user cannot tell which namespace, scope, plugin, command, hook, or state source is in control.

The first duty is not cleaning. It is restoring legibility.

## Protocol Principles

### Guest, Not Owner

Housekeeper enters by invitation. Access is not authority.

Seeing a thing does not grant permission to touch it.

### Agency Before Efficiency

The user’s agency is the primary object being protected.

Efficiency is useful only when it strengthens agency rather than replacing it.

### Consent Is Continuous

Consent is scoped, revocable, and situational.

The protocol must distinguish:

- seeing
- remembering
- interpreting
- suggesting
- preparing
- acting
- deleting
- sharing

Permission for one is never permission for all.

### Boundaries Are Productive

Boundaries are not friction. They are what make trust possible.

The tool must know where it may not go, what it may not infer, what it may not retain, and when silence or refusal is correct.

### Reversibility Is Moral Infrastructure

Mistakes in a personal workspace are not just bugs. They damage memory, trust, and continuity.

The preferred progression is:

observe -> label -> plan -> snapshot -> quarantine -> verify -> purge only later

### Visibility Is the Interface of Power

The more powerful the assistant, the more visible its reasoning, scope, and intended actions must be.

The user should always be able to answer:

- What did it look at?
- What does it believe?
- What will it touch?
- Why?
- What changed?
- How do I undo it?

### Learning Must Be Earned

Housekeeper may learn, but learning is not extraction and never becomes hidden authority.

Good learning is local, inspectable, revocable, and humble.

Bad learning turns accidents into identity.

### Refusal Protects the Relationship

A housekeeper who obeys every command is unsafe.

Refusal or slowdown is part of care when the request would erase meaningful context, violate boundaries, infer beyond evidence, or act without adequate consent.

### Clutter Versus Compost

Not every pile is trash.

Some mess is incubation: abandoned drafts, recurring themes, project rituals, half-formed ideas, old experiments.

The protocol must distinguish clutter from compost.

## Do-Not-Touch Contract

The "net cables and jewelry box" metaphor became central.

Users need a way to say: do not touch this.

Protected items remain visible to the audit, but they become non-actionable. Confidence never overrides a protection boundary.

Examples in the Claude home:

- hand-maintained local commands
- private local skills
- active session state
- project-specific hooks
- experimental prompt files
- credential helpers
- anything the user has marked as sensitive, intentional, or private

Protocol rule:

Protected means protected. It may be reported, but not proposed for mutation.

## Sector Boundaries

We added the firing-range metaphor of sector boundaries.

Some areas are not merely high risk. They are no-fire zones. Housekeeper must not aim there, even under pressure, even when a broad cleanup request sounds urgent, and even when learned behavior suggests the user might usually allow similar work.

Default sector boundaries:

- secrets and credential helpers
- auth state
- financial, legal, tax, identity, medical, or similar sensitive material
- production, infrastructure, database, deployment, and destructive operations
- active work Housekeeper did not create
- live session state, live hooks, running processes, and active mode state
- do-not-touch paths
- another user's or project owner's material
- anything outside declared scope
- rollback manifests, quarantine metadata, and recovery evidence
- anything Housekeeper cannot verify or roll back

Operating sentence:

> Do not aim there.

## Consent And Boundary Clauses

### No Touch Without Scope

Permission must answer:

- what may be touched
- where it may be touched
- what action is allowed
- whether the action is reversible
- when permission expires

### Ambiguity Lowers Authority

If something might be intentional, active, private, valuable, or owned by someone else, it becomes `review-required` or `protected`, never cleanup.

### Permission Does Not Generalize

Approval for one cleanup does not authorize adjacent cleanup.

Approval in one project does not authorize another project.

Approval to inspect does not authorize mutation.

Approval to move does not authorize deletion.

### Learned Knowledge Is Advisory

Learned knowledge can help ask better questions.

It cannot authorize action.

Example:

- Allowed: "You usually keep local command overrides. Should I mark this one protected?"
- Not allowed: "You usually keep local command overrides, so I rewrote the plan automatically."

### Safe Holding Pattern

When uncertain:

- do not discard
- do not hide
- do not combine with unrelated items
- place in visible quarantine or review list
- record why it was set aside
- ask before final action

## Risk Language

Housekeeper should classify, not dramatize.

Recommended risk labels:

- `none`: useful information, no action
- `protected`: user says not to touch
- `review-required`: likely intentional or ambiguous
- `reversible-cleanup`: eligible only for quarantine after snapshot support
- `repair`: targeted config fix with whole-file backup
- `destructive`: irreversible or externally visible; requires elevated consent

## Requirements Derived From Pain

### Visibility

Show what is loaded, active, stale, shadowing, broken, protected, and unknown.

### Reversibility

Prefer dry-runs, snapshots, quarantine, and rollback.

### Freshness

Validate caches, hooks, plugin manifests, mode state, and registry indexes against current reality.

### Bounded Agency

Never silently mutate setup state. Explain intent, scope, and risk before action.

### Namespace Clarity

Declare the current project, scope, plugin source, registry namespace, and loaded command or skill source.

### Protection

Let users define sacred areas and intentional overrides.

### Evidence

Every finding should include evidence, not just a conclusion.

### Verification

Never claim "healthy" or "done" without a Claude session round-trip or equivalent targeted proof.

## Future Spec Primitives

These are the nouns the protocol seems to need:

- `Intent`: the user’s requested outcome, separated from implementation
- `Scope`: files, systems, accounts, environments, and permissions involved
- `RiskClass`: reversible, destructive, security-sensitive, externally visible, infrastructural
- `ConsentGate`: explicit approval tied to a concrete action
- `ProtectionSet`: resources that require elevated confirmation or must not be touched
- `ExecutionMode`: observe, suggest, prepare, execute-with-approval, delegated
- `Evidence`: tests, logs, diffs, paths, hashes, screenshots, command results
- `Plan`: proposed actions, not permission
- `Snapshot`: pre-action state
- `Quarantine`: reversible holding area
- `Verification`: proof that the Claude home still works
- `ResidualRisk`: what may still be wrong after verification
- `Knowledge`: local, inspectable learning
- `PolicyOverride`: explicit user instruction that changes defaults within bounded scope
- `Handoff`: structured continuation state

## Learning Philosophy

Housekeeper should improve over time without becoming mysterious.

It should learn from:

- false positives
- do-not-touch rules
- accepted plans
- rejected plans
- rollbacks
- successful verification
- failed verification

Learning should produce explicit local knowledge:

- protection rules
- allowances
- operation history
- lessons
- confidence adjustments

Learning should not silently expand authority.

Repeated behavior is not permission. Past approval is not future approval unless converted into an explicit standing rule.

## Knowledge Integration

The future storage model should probably be:

```text
~/.claude/housekeeper/
  config.json
  knowledge.json
  operations/
  quarantine/
```

Precedence:

1. Invalid config disables learned behavior and reports a warning.
2. Do-not-touch rules override every other rule.
3. Rollback or failed verification lowers confidence.
4. Allowances suppress known false positives.
5. Lessons suggest changes; they do not silently change authority.

## Operating Sentence

Leave it visible, leave it reversible, ask before touching, and never let memory become authority.

## Open Questions

- What is the exact boundary between "diagnosis" and "interpretation"?
- How should Housekeeper show uncertainty without making output noisy?
- What level of evidence is required to call state "zombie"?
- How should project-level and global protection rules compose?
- Should protected findings stay in the scorecard total, or appear as a separate count?
- What is the minimum viable rollback proof?
- How should Housekeeper handle Claude layout changes across versions?
- What should be remembered globally versus per project?
- How do we make learning inspectable without making users manage yet another config burden?

## Next Step

Before the formal protocol spec, we identified a user-case layer:

- why this matters to the user
- why this was the missing piece
- how it restores orientation, confidence, ownership, and calm
- how it helps before it cleans

That was documented in `docs/user-case.md`.

We then began the contract layer in `docs/protocol-contracts.md`.

Before moving to the protocol model, we added `docs/pre-model-foundations.md` to close missing conceptual gaps:

- operating zones
- authority ladder
- evidence grades
- finding lifecycle
- trust recovery flow
- emergency safe mode
- ownership doctrine
- namespace doctrine
- severity/risk/confidence/urgency/reversibility separation
- user-facing vocabulary
- non-goals
- self-governance
- override protocol
- shared-use doctrine

We then drafted the formal protocol model in `docs/protocol-model.md`, defining:

- core object graph
- ClaudeHome
- Intent
- Scope
- Resource
- Ownership
- Namespace
- Policy
- ProtectionSet
- SectorBoundary
- Evidence
- Finding
- Classification
- Plan
- ConsentGate
- Operation
- Snapshot
- Quarantine
- Verification
- Knowledge
- ResidualRisk
- Handoff
- TrustState
- Protocol lifecycle
- minimal JSON shapes
- model invariants

We also added `docs/product-understanding.md` to capture the product-crafting layer:

- product thesis
- category
- user segments
- trigger moments
- aha moments
- core user journey
- product promises
- MVP boundary
- UX principles
- product language
- onboarding
- adoption paths
- failure UX
- alternatives
- artifacts
- success metrics
- brand tone
- roadmap
- user research questions

We then moved into research framing and added:

- `docs/unknowns.md`: current answers, hypotheses, and required research for major unknowns
- `docs/research-plan.md`: field research method for broken Claude homes, loader semantics, performance, false positives, UX, and safe mode
- `docs/loader-semantics.md`: documented vs inferred Claude Code loader behavior, with black-box tests required
- `docs/safe-mode.md`: out-of-band safe-mode constraints and minimum viable scan
- `fixtures/README.md`: synthetic broken-home fixture plan

We then added the "every door has its key" layer:

- `docs/evidence-keyring.md`: maps each suspected failure door to the evidence
  key required before diagnosis, repair, cleanup, or verification
- updated `docs/unknowns.md` with documented Claude plugin cache grace-period
  semantics and skill precedence facts
- updated `docs/loader-semantics.md` with built-in Claude truth probes,
  documented skill precedence, hook diagnostics, clean-config comparison, and
  plugin cache lifecycle
- updated `docs/safe-mode.md` to state which conclusions safe mode may and may
  not make

The important research correction:

Old plugin cache versions are not automatically trash. Claude documents that
previous plugin versions are marked orphaned and kept for about seven days after
update or uninstall so concurrent sessions using the old version can keep
running. Therefore "old cache" is not a deletion key. It is a freshness question.

We then added a more formal spec layer:

- `docs/surface-map.md`: classifies `.claude` into authored configuration,
  Claude application data, executable surfaces, secret-adjacent surfaces, and
  Housekeeper-owned state
- `docs/surface-classification-spec.md`: makes surface classification a hard
  gate before actionable findings
- `docs/protocol-spec.md`: defines normative phases, execution modes, evidence
  grades, lifecycle states, output contract, privacy contract, compatibility,
  and self-governance
- `docs/repair-rollback-spec.md`: defines repair modes, mutation
  preconditions, snapshot and rollback requirements, native-first behavior, and
  verification rules

The important research correction:

Claude checkpointing is useful but is not Housekeeper rollback. It does not
cover Bash side effects, external services, database changes, or changes made by
external processes. Housekeeper rollback must be manifest-backed and scoped to
its own operations.

We then hardened the specs:

- actionable findings now require surface classification first
- every resource must be classified by surface, owner, load-bearing status,
  sensitivity, execution risk, rollback class, scope, and confidence
- `checkpoint-only` rollback explicitly blocks mutation
- fixtures must now declare surface classes and rollback classes
- the protocol lifecycle now reads: observe -> classify surfaces -> collect
  evidence -> classify findings

We then added the framework kernel:

- `docs/framework-kernel.md`: captures the invariant grammar of the product
- no direct path from observation to action
- claim ladder from observation through verification
- surface, evidence, and rollback gates
- authority ladder
- finding classes
- user-facing stances
- forbidden product moves
- spec acceptance questions

We then added decision calculus:

- `docs/decision-calculus.md`: defines how Housekeeper chooses a stance after
  surface classification and evidence collection
- stance vocabulary: inform, watch, review, probe, protect, prepare, repair,
  block
- severity, confidence, urgency, and authority are separated
- hard overrides: sector boundary, do-not-touch, unknown owner, unknown surface,
  checkpoint-only rollback, secret content, conflicting evidence, out-of-scope
- future scorecards should count stances, not only issues

We then defined the field validation layer:

- `docs/field-validation.md`: defines fixture acceptance cards, loader truth
  matrix, report grammar, policy grammar, redacted real-home report format, and
  first wedge acceptance
- `docs/report-grammar.md`: defines stance-first reports with primary finding,
  stance summary, boundaries, missing keys, protected findings, and degraded
  scan format
- `docs/policy-grammar.md`: defines do-not-touch, allowances, retention, and
  standing consent
- `fixtures/README.md`: adds the acceptance card template

The key validation sentence:

> Would this output still be true if the user refused every proposed action?

We then layered operator and governance doctrine:

- `docs/operator-doctrine.md`: behavior under pressure, broad cleanup requests,
  weak evidence, boundary crossing, and refusal
- `docs/consent-ux.md`: consent shapes, consent types, partial approval,
  expiration, anti-nag, and proof limits
- `docs/failure-doctrine.md`: scan, parse, probe, rollback, and policy failure
  behavior
- `docs/conflict-triage.md`: policy conflict, evidence conflict, ownership
  conflict, primary issue ordering, stop conditions, detail budget
- `docs/mode-doctrine.md`: allowed and forbidden behavior for safe, diagnose,
  live diagnose, plan, act, verify, and harden
- `docs/state-governance.md`: Housekeeper-owned state, retention, corruption,
  and uninstall contract
- `docs/team-governance-threat-model.md`: team authority, shared policy, and
  explicit threat model

We then converged the framework into decision-forcing artifacts:

- `docs/north-star.md`: product identity, first wedge, invariants, promise,
  boundary, success, and failure definition
- `docs/mvp-cutline.md`: exact MVP inclusion/exclusion and readiness criteria
- `docs/acceptance-cards.md`: concrete acceptance cards for the first fixture
  set
- `docs/schemas.md`: draft report, surface, finding, policy, and acceptance
  card shapes
- `docs/vocabulary.md`: user-facing versus internal language
- `docs/feedback-templates.md`: false positive, unclear output, damaged
  environment, and missing detector templates
- `docs/kill-criteria.md`: stop, narrow, pivot, and continue criteria

We then aligned the docs for one-pass build readiness:

- `docs/build-readiness.md`: tells a future coding agent what to read, what to
  build first, what objects to implement, what checks to write, what report to
  produce, and what moves are forbidden
- `docs/protocol-model.md`: updated the core flow to
  Intent -> Scope -> Observation -> SurfaceClassification -> Evidence ->
  Finding -> Stance -> PlanPreview -> ConsentGate -> Operation ->
  Verification -> Knowledge
- `docs/unknowns.md`: updated remaining defaults to stance language and first
  wedge consequences
- `docs/loader-semantics.md`: changed implications into build implications and
  added first-wedge-specific consequences
- `docs/doc-map.md`: added build-readiness to the first reading path

The implementation target is now clear for a future coding agent:

> Build the first wedge only: safe out-of-band diagnosis of broken hooks and
> plugin cache drift, following observe -> classify surfaces -> collect evidence
> -> classify findings -> choose stance -> report.

The later conceptual artifact should be a formal protocol spec:

1. Pain taxonomy
2. Protocol principles
3. Consent model
4. Risk taxonomy
5. Evidence model
6. Learning model
7. Requirements
8. Non-goals
9. Eventual command/spec mapping
