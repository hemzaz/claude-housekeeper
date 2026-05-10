# Framework Kernel

This is the smallest durable shape of Claude Housekeeper.

Commands, UI, implementation language, packaging, and distribution may change.
This kernel should not.

## 1. Core Sentence

Housekeeper restores trust by making the Claude home legible before it changes
anything.

The canonical flow is:

```text
observe -> classify surfaces -> collect evidence -> classify findings
```

Only after that may Housekeeper produce a plan.

Only after a plan may Housekeeper request consent.

Only after consent, snapshot, and rollback proof may Housekeeper act.

## 2. No Direct Path From Observation To Action

The central failure this product must avoid:

```text
old path -> stale -> delete
```

That shortcut is forbidden.

The correct path is:

```text
old path
  -> observed resource
  -> surface classification
  -> evidence keys
  -> finding classification
  -> plan
  -> consent gate
  -> snapshot and manifest
  -> action
  -> verification
```

Any missing stage lowers authority.

## 3. Claim Ladder

Housekeeper should speak in the strongest claim its evidence supports, and no
stronger.

| Level | Claim type | Example | Required support |
| --- | --- | --- | --- |
| 1 | observation | "path exists" | structural evidence |
| 2 | surface classification | "authored config" | path, shape, source, scope |
| 3 | suspicion | "may shadow plugin command" | structural relation |
| 4 | finding | "local command appears to shadow plugin command" | classification plus evidence key |
| 5 | diagnosis | "this hook is loaded and failing" | loader or behavioral key |
| 6 | plan | "patch this settings entry" | ownership, scope, reversibility |
| 7 | operation | "apply approved patch" | consent, snapshot, preconditions |
| 8 | verification | "broken behavior no longer observed" | targeted probe |

If a key is missing, the product should say what key is missing.

## 4. Surface Gate

Every resource passes through the surface gate.

The surface gate asks:

- What kind of thing is this?
- Who owns it?
- Can it affect Claude behavior?
- Is it sensitive?
- Can inspecting or probing it execute code?
- Is it inside scope?
- Can mutation be rolled back without relying on Claude checkpointing?

Outputs:

- `classified`: eligible for findings
- `unknown-surface`: report only
- `protected`: visible, non-actionable
- `sector-boundary`: do not aim there
- `scan-degraded`: evidence incomplete

The gate is allowed to block. Blocking with a clear reason is a successful
product behavior.

## 5. Evidence Gate

Every finding passes through the evidence gate.

Evidence types:

- structural
- loader
- behavioral
- ownership
- freshness
- reversibility

Mutation requires at least:

- structural key
- ownership key
- reversibility key

High-impact repair also requires:

- behavioral key

The evidence gate prevents false authority.

## 5A. Decision Calculus

After surface and evidence gates, Housekeeper chooses a stance.

The detailed stance rules are in `docs/decision-calculus.md`.

Allowed stances:

- `inform`
- `watch`
- `review`
- `probe`
- `protect`
- `prepare`
- `repair`
- `block`

The stance is the product posture toward the user. It is not an implementation
command.

Severity, confidence, and urgency do not directly grant authority. A severe
finding can still be blocked. A high-confidence finding can still be protected.
An urgent finding can still require a probe.

## 6. Rollback Gate

Rollback is not vibes, not hope, and not Claude checkpointing.

Rollback requires Housekeeper-owned proof:

- operation manifest
- exact target list
- before-state
- snapshot or native reversible mechanism
- restore command
- precondition checks
- sector-boundary exclusions

`checkpoint-only` means blocked.

Claude checkpointing can be context. It cannot be the rollback guarantee for
Housekeeper cleanup.

## 7. Authority Ladder

Authority increases only through explicit proof and consent.

```text
see -> classify -> explain -> suggest -> plan -> prepare -> act -> verify
```

Authority decreases when:

- ownership is unknown
- surface is secret-adjacent
- loader semantics are inferred
- freshness is uncertain
- rollback is partial
- live processes may be using the target
- the user marks it protected
- evidence conflicts

Urgency does not increase authority.

## 8. Finding Classes

Findings should be classified by what they mean, not only by where they were
found.

### Orientation Findings

They help the user understand the home.

Example:

- plugin cache size summary
- namespace map
- hook count by source

Default action: none.

### Integrity Findings

They indicate malformed or inconsistent state.

Example:

- invalid JSON
- broken frontmatter
- missing direct hook path

Default stance: prepare or review.

### Contamination Findings

They indicate old or duplicate material may affect current Claude behavior.

Example:

- local command shadows plugin command
- old plugin cache version may still be referenced

Default stance: review or probe until loader/freshness keys exist.

### Possession Findings

They indicate old actors may still be acting.

Example:

- active mode state with stale heartbeat
- lifecycle hook keeps firing from unexpected source

Default action: isolate and prove before repair.

### Hygiene Findings

They indicate bloat or drift that may be safe to reduce later.

Example:

- large logs
- old application data
- drift directories

Default action: summarize or reversible cleanup plan only after classification.

## 9. User-Facing Stances

Housekeeper should not present every uncertainty as a problem.

Possible stances:

- `inform`: useful context, no action
- `watch`: not urgent, may become relevant
- `review`: user intent likely matters
- `probe`: live key needed
- `protect`: boundary or do-not-touch
- `prepare`: plan can be drafted
- `repair`: narrow change can be made after consent
- `block`: action is not allowed under current evidence

This is the product's calming grammar.

The report should summarize stances, not only issues.

## 10. Forbidden Product Moves

Housekeeper must not:

- infer deletion authority from age, size, or name
- present a plan before surface classification
- present cleanup as safe without rollback proof
- treat Claude checkpointing as rollback proof
- hide protected items entirely
- auto-learn permission from repetition
- run live probes inside safe mode
- blur user-owned config with Claude-managed application data
- collapse review and cleanup into one bucket
- call something fixed before behavior is verified

## 11. Spec Acceptance Questions

Every future feature should answer:

- What surface classes does it touch?
- What claims does it make?
- What evidence keys support those claims?
- What false positives are likely?
- What does it refuse to do?
- What does it show when blocked?
- What rollback proof exists?
- What proves success?
- What remains unknown after success?

If these cannot be answered, the feature is not ready.

## 12. Product Shape

The sharp wedge remains:

> Tell me why Claude Code feels broken and what is safe to do next.

The first trusted behavior is not deletion.

It is a report that says:

- what kind of surfaces exist
- which surfaces are load-bearing
- what evidence supports each finding
- what is protected
- what is unknown
- what key would unlock the next step
- what cannot be touched
- what would be required before repair

That is the product before it is a cleaner.
