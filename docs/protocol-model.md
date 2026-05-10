# Protocol Model

This document formalizes the Claude Housekeeper protocol after the philosophy, user case, contracts, sector boundaries, and pre-model foundations.

It defines the conceptual objects and state transitions. It is not yet a product spec or implementation plan.

## 1. Core Object Graph

Housekeeper operates over a Claude home.

```text
ClaudeHome
  contains Resources
  contains Namespaces
  contains Policies
  contains Knowledge
  produces SurfaceClassifications
  produces Findings
  produces Plans
  produces Operations
  records Evidence
  records Verification
```

The central flow:

```text
Intent -> Scope -> Observation -> SurfaceClassification -> Evidence -> Finding -> Stance -> PlanPreview -> ConsentGate -> Operation -> Verification -> Knowledge
```

Mutation is optional. Observation, classification, and orientation are first-class outcomes.

## 2. ClaudeHome

A `ClaudeHome` is the environment Housekeeper is invited to inspect.

It may include:

- plugin registries
- plugin caches
- local commands
- local skills
- hooks
- settings
- MCP servers
- mode state
- session state
- logs
- backups
- Housekeeper-owned artifacts
- project-level overrides
- user-level overrides

Required properties:

- `root`: filesystem root, usually `~/.claude`
- `scope`: user, project, or explicit path
- `owner`: user, project, shared, unknown
- `trustState`: coherent, cluttered, contaminated, possessed, disoriented, critical

## 3. Intent

`Intent` is the user’s desired outcome, separated from implementation.

Examples:

- "Tell me why Claude feels broken."
- "Find candidate stale plugin cache trees."
- "Show registry collisions."
- "Show byte-identical local command shadows."
- "Do not touch my local skills."

Fields:

- `statement`: user-facing goal
- `mode`: observe, suggest, plan, prepare, act, recover
- `urgency`: normal, degraded, emergency
- `constraints`: explicit limits
- `successCriteria`: what would count as done

Rule:

Intent never grants authority by itself. It must be combined with scope and consent.

## 4. Scope

`Scope` defines where Housekeeper may look or act.

Fields:

- `roots`: allowed paths
- `subsystems`: plugins, registry, state, settings, hooks, filesystem, Housekeeper
- `operationLimit`: observe, classify, plan, prepare, mutate
- `timeLimit`: current run, session, standing
- `exclusions`: paths, checks, namespaces, or owners
- `authority`: user, project, team, unknown

Scope may be broader for observation than for mutation.

Rule:

Anything outside scope is a sector boundary for action.

## 5. Resource

`Resource` is anything Housekeeper may observe.

Resource types:

- `pluginRegistration`
- `pluginCacheTree`
- `command`
- `skill`
- `hook`
- `settingsFile`
- `mcpServer`
- `modeState`
- `sessionState`
- `log`
- `backup`
- `quarantine`
- `knowledgeFile`
- `externalService`
- `unknownFile`

Resource fields:

- `id`
- `type`
- `path`
- `surfaceClassification`
- `namespace`
- `owner`
- `source`
- `state`
- `sensitivity`
- `sectorBoundary`
- `protected`
- `evidence`

## 6. Ownership

Ownership influences authority.

Ownership classes:

- `user-owned`
- `project-owned`
- `plugin-owned`
- `housekeeper-owned`
- `generated`
- `shared`
- `external`
- `unknown`

Default mutation stance:

| Owner | Default stance |
|---|---|
| user-owned | review |
| project-owned | review |
| plugin-owned | probe or review |
| housekeeper-owned | inform or prepare |
| generated | prepare only if reproducible and rollback-proofed |
| shared | block or review |
| external | block |
| unknown | review |

Rule:

Unknown ownership cannot support mutation.

## 6A. SurfaceClassification

`SurfaceClassification` is the gate between observation and finding.

Fields:

- `surfaceClass`: authored-config, claude-app-data, executable-surface,
  secret-adjacent, housekeeper-owned, external-reference, unknown
- `ownerClass`: user-owned, project-owned, team-managed, plugin-owned,
  claude-managed, housekeeper-owned, shared, unknown
- `loadBearingClass`: known-load-bearing, possibly-load-bearing,
  historically-load-bearing, not-load-bearing, unknown
- `sensitivityClass`: public-structure, private-path, secret-adjacent,
  secret-content, regulated-or-personal, unknown
- `executionClass`: inert, starts-process, runs-hook, starts-mcp,
  runs-plugin-code, shell-expansion-risk, network-risk, unknown
- `rollbackClass`: manifest-backed, snapshot-possible, native-reversible,
  checkpoint-only, external-side-effects, irreversible, unknown
- `scopeClass`: in-scope, protected, sector-boundary,
  parent-contains-boundary, out-of-scope, unknown
- `confidence`: low, medium, high, proven
- `missingKeys`: evidence needed before action

Rules:

- no actionable finding without surface classification
- `checkpoint-only` rollback blocks mutation
- unknown owner blocks mutation
- possible load-bearing status defaults to `review` or `probe`
- executable surfaces require live-probe consent before behavior claims
- secret-adjacent surfaces activate redaction before reporting

## 7. Namespace

`Namespace` explains how Claude resolves resources.

Namespace types:

- user command namespace
- project command namespace
- plugin command namespace
- user skill namespace
- project skill namespace
- plugin skill namespace
- marketplace namespace
- plugin cache namespace
- hook namespace
- MCP namespace
- mode/session namespace
- accidental directory namespace

Namespace relation types:

- `owns`
- `loads`
- `shadows`
- `duplicates`
- `divergesFrom`
- `pointsTo`
- `orphanedFrom`
- `supersedes`

Every namespace conflict should identify:

- winner
- loser
- precedence rule
- source paths
- byte identity or divergence
- protection status

## 8. Policy

`Policy` is explicit user or project guidance.

Policy types:

- `doNotTouch`
- `allowance`
- `sectorBoundary`
- `standingConsent`
- `retention`
- `verificationRequirement`
- `learningPreference`
- `override`

Precedence:

1. current explicit user instruction
2. sector boundary
3. project do-not-touch
4. global do-not-touch
5. project allowance
6. global allowance
7. standing consent
8. learned suggestion
9. default protocol

Rule:

Policies may reduce noise, but only explicit consent may authorize mutation.

## 9. ProtectionSet

`ProtectionSet` is the resolved set of do-not-touch resources.

Sources:

- current instruction
- config files
- project policy
- global policy
- sector boundary defaults
- ownership uncertainty
- sensitivity detection

Protection effects:

- resource remains visible
- findings remain explainable
- actionability becomes false
- mutation planning excludes the resource
- parent cleanup must split or block
- learning cannot bypass it

Rule:

Protection applies transitively to descendants unless explicitly narrowed.

## 10. SectorBoundary

`SectorBoundary` is stronger than protection.

Sector boundary effects:

- out of action scope
- no mutation
- no quarantine
- no parent-directory sweep-through
- no learned bypass
- no sensitive content inspection unless inspection is explicitly scoped

Default sector boundary categories:

- secrets and credentials
- auth state
- production, database, infrastructure, deployment
- live hooks, live sessions, running processes
- rollback evidence
- another user’s material
- outside declared scope
- unverifiable or non-reversible targets

Rule:

A sector boundary can be opened only by a narrow exception, not by broad cleanup approval.

## 11. Evidence

`Evidence` supports findings and operations.

Evidence grades:

- `observed`
- `corroborated`
- `inferred`
- `stale`
- `conflicting`
- `unavailable`

Evidence fields:

- `source`: file, registry, command, process, hash, timestamp, user policy
- `value`: redacted if sensitive
- `observedAt`
- `freshUntil`
- `confidenceImpact`
- `falsePositiveRisk`

Rules:

- reporting can use observed evidence
- planning should prefer corroborated evidence
- mutation requires fresh evidence
- conflicting evidence blocks mutation
- stale evidence must be refreshed
- unavailable evidence becomes residual risk

## 12. Finding

`Finding` is an observation with classification.

Fields:

- `id`
- `resource`
- `surfaceClassification`
- `summary`
- `state`
- `severity`
- `risk`
- `stance`
- `claimLevel`
- `confidence`
- `urgency`
- `reversibility`
- `actionability`
- `evidence`
- `proposedAction`
- `falsePositiveModes`
- `lifecycleState`

Finding lifecycle:

```text
new -> known -> planned -> prepared -> resolved
       |        |          |
       |        |          -> blocked
       |        -> rejected
       -> protected
       -> allowed
       -> stale
       -> recurred
       -> critical
```

Rules:

- a finding can be useful even if not actionable
- a finding may be protected and still visible
- a resolved finding that returns becomes recurred
- a finding with expired evidence becomes stale

## 13. Classification

Classification separates several dimensions.

### Severity

How bad if the finding is true:

- info
- low
- medium
- high
- critical

### Risk

How dangerous action would be:

- none
- protected
- sector-boundary
- review
- prepare
- repair
- destructive
- blocked
- critical

### Stance

How Housekeeper should speak now:

- inform
- watch
- review
- probe
- protect
- prepare
- repair
- block

### Confidence

How sure Housekeeper is:

- low
- medium
- high
- proven

### Urgency

How soon it matters:

- none
- soon
- current-session
- immediate

### Reversibility

How recoverable action is:

- not-applicable
- exact
- approximate
- partial
- irreversible
- unknown

Rule:

High severity does not imply permission to act. Low action risk does not imply the finding matters.

## 14. PlanPreview

`PlanPreview` is a reviewable set of candidate operations and exclusions.

It is not permission and is not mutation.

Fields:

- `intent`
- `scope`
- `generatedAt`
- `evidenceFreshness`
- `includedFindings`
- `excludedFindings`
- `operations`
- `requiredConsentGates`
- `sectorBoundaryConflicts`
- `residualRisk`

Plan preview sections:

- inform
- watch
- review
- probe
- protect
- prepare
- repair candidates
- blocked
- critical

Rules:

- a plan is not permission
- plans expire
- plans must be revalidated before mutation
- plans must be editable by omission

## 15. ConsentGate

`ConsentGate` is an approval requirement tied to an action.

Fields:

- `target`
- `action`
- `scope`
- `risk`
- `evidence`
- `rollback`
- `verification`
- `duration`
- `authority`

Consent gate levels:

- no consent needed: read-only observation in green zone
- review consent: classify and include in plan preview
- action consent: quarantine or repair
- elevated consent: destructive, external, shared, or red-zone action
- forbidden without exception: sector boundary

Rule:

Consent cannot be inferred from repetition, urgency, or broad language.

## 16. Operation

`Operation` is a concrete action.

Operation types:

- `none`
- `quarantine`
- `restore`
- `rotate`
- `repairJson`
- `removeReference`
- `stopActor`
- `installGuard`
- `purge`

Operation fields:

- `id`
- `type`
- `targets`
- `preconditions`
- `snapshot`
- `rollback`
- `consentGate`
- `verification`
- `status`

Operation states:

```text
draft -> prepared -> consented -> applying -> applied -> verified
                         |            |          |
                         |            |          -> degraded
                         |            -> failed
                         -> cancelled
```

Rules:

- every mutating operation needs preconditions
- precondition failure aborts the operation
- interrupted operations become findings
- purge is separate from quarantine

## 17. Snapshot

`Snapshot` records pre-action state.

Snapshot fields:

- `operationId`
- `createdAt`
- `housekeeperVersion`
- `claudeVersion`
- `targets`
- `hashes`
- `mtimes`
- `owners`
- `permissions`
- `backupPaths`
- `manifestHash`

Rules:

- no snapshot, no mutation
- snapshot storage must not be inside loaded registry paths
- snapshot manifest is itself a sector boundary

## 18. Quarantine

`Quarantine` is reversible holding, not deletion.

Fields:

- `operationId`
- `sourcePath`
- `quarantinePath`
- `reason`
- `restoreCommand`
- `retentionPolicy`

Rules:

- quarantine must preserve enough metadata to restore
- quarantine cannot include protected descendants
- quarantine must be visible and accountable
- purge requires separate consent

## 19. Verification

`Verification` proves or limits trust after action.

Probe types:

- binary starts
- config parses
- plugin registry loads
- hooks resolve
- tool execution works
- bare session round-trip works
- full session round-trip works
- affected finding no longer appears
- protected resources unchanged

Verification states:

- not-run
- passed
- failed
- skipped
- unavailable
- degraded

Rule:

If verification fails, operation success is degraded or critical, not complete.

## 20. Knowledge

`Knowledge` is local, inspectable learning.

Knowledge types:

- `protectionRule`
- `allowance`
- `lesson`
- `operationHistory`
- `rollbackHistory`
- `confidenceAdjustment`

Rules:

- knowledge is advisory unless promoted to policy
- learned behavior cannot bypass sector boundaries
- repeated dismissal can suggest an allowance, not silently create it
- failed rollback lowers confidence for similar operations
- knowledge must be exportable and deletable

## 21. ResidualRisk

`ResidualRisk` records what may still be wrong.

Fields:

- `description`
- `cause`
- `affectedScope`
- `severity`
- `nextStep`

Residual risk is required when:

- verification is unavailable
- evidence is incomplete
- action was partial
- rollback is approximate
- ownership is unknown
- schema is unsupported

Rule:

Residual risk must be explicit. Silence implies false confidence.

## 22. Handoff

`Handoff` makes sessions continuous.

Fields:

- `intent`
- `scope`
- `findings`
- `plans`
- `operations`
- `userDecisions`
- `protectionRules`
- `unresolvedAmbiguities`
- `residualRisk`
- `nextSteps`

Rule:

The next session should not need to redo archaeology unless evidence expired.

## 23. Trust State Model

ClaudeHome trust states:

- `coherent`: state is legible and verified
- `cluttered`: old material exists but appears inert
- `contaminated`: stale material changes current behavior
- `possessed`: old actors continue acting
- `disoriented`: namespace or ownership is unclear
- `critical`: rollback, verification, config parse, or sector boundary failure

Transitions:

```text
coherent -> cluttered -> contaminated -> possessed
                    \          \          \
                     -> disoriented -> critical
```

Recovery transitions:

```text
critical -> safe-mode -> orient -> stabilize -> verify
possessed -> isolate actors -> stabilize -> verify
contaminated -> repair/quarantine -> verify
disoriented -> namespace map -> plan
cluttered -> inform, watch, or prepare only with rollback proof
```

## 24. Protocol Lifecycle

Canonical lifecycle:

```text
Receive Intent
  -> Resolve Scope
  -> Apply Sector Boundaries
  -> Observe
  -> Classify Surfaces
  -> Collect Evidence
  -> Classify Findings
  -> Choose Stance
  -> Restore Orientation
  -> Produce Plan Preview
  -> Request Consent Gates
  -> Prepare Operations
  -> Snapshot
  -> Apply
  -> Verify
  -> Record Knowledge
  -> Handoff
```

Any stage may stop with:

- blocked
- review
- protect
- critical
- residual risk

Stopping safely is a valid outcome.

## 25. Minimal JSON Shapes

These are illustrative, not final schemas.

### Finding

```json
{
  "id": "registry.local_command_diverged",
  "resource": {
    "type": "command",
    "path": "~/.claude/commands/go-build.md",
    "owner": "user-owned"
  },
  "summary": "go-build shadows plugin command and differs from plugin version",
  "severity": "medium",
  "risk": "review",
  "stance": "review",
  "claimLevel": "finding",
  "confidence": "high",
  "urgency": "soon",
  "reversibility": "exact",
  "actionability": false,
  "evidence": [
    {
      "grade": "observed",
      "source": "sha256",
      "value": "redacted"
    }
  ],
  "proposedAction": "review",
  "lifecycleState": "new"
}
```

### ConsentGate

```json
{
  "target": "~/.claude/commands/go-review.md",
  "action": "prepare-plan",
  "scope": "registry",
  "risk": "prepare",
  "duration": "current-run",
  "rollback": "exact",
  "verification": "registry-loads"
}
```

### Operation

```json
{
  "id": "op_001",
  "type": "quarantine",
  "targets": ["~/.claude/commands/go-review.md"],
  "preconditions": [
    {
      "kind": "sha256",
      "value": "redacted"
    }
  ],
  "status": "prepared"
}
```

## 26. Model Invariants

- Observation does not mutate.
- Surface classification precedes findings.
- No actionable finding without surface classification.
- Plans are not permission.
- Protected resources are visible but not actionable.
- Sector boundaries are out of action scope.
- Stance is separate from severity, confidence, risk, and urgency.
- Mutation requires fresh evidence.
- Mutation requires a consent gate.
- Mutation requires a snapshot.
- Mutation cannot rely on Claude checkpointing as rollback.
- Cleanup starts with quarantine, not purge.
- Verification is part of completion.
- Learning cannot create hidden authority.
- Residual risk must be named.
- Housekeeper-owned artifacts must be governed.
