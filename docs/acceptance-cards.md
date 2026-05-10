# Acceptance Cards

Acceptance cards are executable thinking without implementation.

Each card proves that a scenario travels through the framework correctly:

```text
surface -> evidence -> claim level -> finding class -> stance -> next step
```

## 1. broken-hook-simple

```yaml
id: broken-hook-simple
purpose: Direct missing hook paths become prepare stance, not cleanup.
mode_expectations:
  safe:
    claim_level: finding
    stance: prepare
  live:
    claim_level: diagnosis
    stance: prepare
surfaces:
  - path: ~/.claude/settings.json
    surfaceClass: authored-config
    ownerClass: user-owned
    loadBearingClass: known-load-bearing
    sensitivityClass: private-path
    executionClass: inert
    rollbackClass: snapshot-possible
    scopeClass: in-scope
evidence:
  structural:
    - settings parses
    - hook command contains missing direct absolute plugin cache path
  missing:
    - /hooks resolved view
finding:
  class: integrity
  stance: prepare
allowed_next_step: patch preview
blocked_actions:
  - mutate settings
  - delete plugin cache
  - claim fixed
```

## 2. broken-hook-shell-ambiguous

```yaml
id: broken-hook-shell-ambiguous
purpose: Shell ambiguity lowers authority.
mode_expectations:
  safe:
    claim_level: suspicion
    stance: probe
surfaces:
  - path: ~/.claude/settings.json
    surfaceClass: authored-config
    executionClass: shell-expansion-risk
evidence:
  structural:
    - hook command contains plugin cache-looking string
  missing:
    - shell parse certainty
    - hook debug trace
finding:
  class: integrity
  stance: probe
allowed_next_step: live hook debug probe after consent
blocked_actions:
  - patch command string
  - call hook broken
```

## 3. expected-orphan-cache

```yaml
id: expected-orphan-cache
purpose: Old plugin cache inside grace period is not stale.
mode_expectations:
  safe:
    claim_level: finding
    stance: watch
surfaces:
  - path: ~/.claude/plugins/cache/market/tool/1.0.0
    surfaceClass: claude-app-data
    ownerClass: claude-managed
    loadBearingClass: possibly-load-bearing
    rollbackClass: snapshot-possible
evidence:
  structural:
    - version not referenced by installed registry
    - observed orphan marker or age inside documented grace period
finding:
  class: hygiene
  stance: watch
allowed_next_step: none
blocked_actions:
  - call unused
  - quarantine
  - delete
```

## 4. candidate-stale-cache

```yaml
id: candidate-stale-cache
purpose: Cache outside known references still needs freshness key.
mode_expectations:
  safe:
    claim_level: finding
    stance: probe
surfaces:
  - path: ~/.claude/plugins/cache/market/tool/0.9.0
    surfaceClass: claude-app-data
    ownerClass: claude-managed
    loadBearingClass: possibly-load-bearing
evidence:
  structural:
    - not referenced by known installed registry evidence
  missing:
    - active session check
    - process reference check
    - explicit retention policy
finding:
  class: contamination
  stance: probe
allowed_next_step: live freshness probe or manual review
blocked_actions:
  - say unused
  - delete
```

## 5. protected-secret-path

```yaml
id: protected-secret-path
purpose: Secret-adjacent paths are visible but not inspected.
mode_expectations:
  safe:
    claim_level: surface
    stance: protect
surfaces:
  - path: ~/.claude/settings.json
    surfaceClass: authored-config
  - path: ~/.env
    surfaceClass: secret-adjacent
    sensitivityClass: secret-content
    scopeClass: sector-boundary
finding:
  class: orientation
  stance: protect
allowed_next_step: none
blocked_actions:
  - read secret file
  - print secret value
  - propose cleanup
```

## 6. checkpoint-only-rollback

```yaml
id: checkpoint-only-rollback
purpose: Claude checkpointing cannot satisfy Housekeeper rollback.
mode_expectations:
  plan:
    claim_level: finding
    stance: block
surfaces:
  - path: ~/.claude/plugins/cache/market/tool/0.9.0
    rollbackClass: checkpoint-only
evidence:
  reversibility:
    - Claude checkpoint exists
  missing:
    - Housekeeper operation manifest
    - Housekeeper snapshot
finding:
  class: hygiene
  stance: block
allowed_next_step: create Housekeeper rollback plan
blocked_actions:
  - quarantine
  - purge
```

## 7. invalid-settings

```yaml
id: invalid-settings
purpose: Invalid core config blocks dependent inference.
mode_expectations:
  safe:
    claim_level: finding
    stance: prepare
surfaces:
  - path: ~/.claude/settings.json
    surfaceClass: authored-config
    loadBearingClass: known-load-bearing
evidence:
  structural:
    - JSON parse error with line/column if available
finding:
  class: integrity
  stance: prepare
allowed_next_step: patch preview or manual edit
blocked_actions:
  - infer effective hooks
  - infer effective MCP
  - mutate without snapshot
```

## 8. huge-home-degraded

```yaml
id: huge-home-degraded
purpose: Scan budgets weaken claims instead of hiding failure.
mode_expectations:
  safe:
    claim_level: observation
    stance: inform
surfaces:
  - path: ~/.claude/projects
    surfaceClass: claude-app-data
evidence:
  structural:
    - scan budget hit
  missing:
    - full traversal
finding:
  class: orientation
  stance: inform
allowed_next_step: explicit full scan
blocked_actions:
  - summarize as complete
  - propose cleanup from partial data
```

## 9. interrupted-housekeeper-operation

```yaml
id: interrupted-housekeeper-operation
purpose: |
  Incomplete Housekeeper operation manifests block further work
  (operational-readiness.md §4; protocol-contracts.md "Edge Case 17";
  golden-reports.md §10).
mode_expectations:
  safe:
    claim_level: finding
    stance: block
surfaces:
  - path: ~/.claude/housekeeper/operations
    surfaceClass: housekeeper-owned
    ownerClass: housekeeper-owned
    loadBearingClass: not-load-bearing
    sensitivityClass: private-path
    executionClass: inert
    rollbackClass: manifest-backed
    scopeClass: in-scope
evidence:
  structural:
    - operation id directory exists
    - manifest status is not verified
  missing:
    - recovery decision for interrupted operation
finding:
  class: hygiene
  stance: block
allowed_next_step: inspect operation record and choose recover, archive, or discard
blocked_actions:
  - start new mutation operation
  - overwrite operation manifest
  - hide Housekeeper self-failure
```

## 10. symlinked-home

```yaml
id: symlinked-home
purpose: |
  Symlinked Claude home is not auto-traversed; identity must be canonical
  before action (protocol-contracts.md "Edge Case 6";
  surface-classification-spec.md §2 "Scope Class").
mode_expectations:
  safe:
    claim_level: surface
    stance: review
surfaces:
  - path: ~/.claude
    surfaceClass: unknown
    ownerClass: unknown
    loadBearingClass: unknown
    sensitivityClass: private-path
    executionClass: inert
    rollbackClass: unknown
    scopeClass: parent-contains-boundary
evidence:
  structural:
    - path is a symlink
    - observed and resolved paths differ
  ownership:
    - resolved target ownership unknown
  missing:
    - canonical target identity
    - traversal consent for resolved target
finding:
  class: orientation
  stance: review
allowed_next_step: report observed and resolved paths; request explicit traversal scope
blocked_actions:
  - traverse resolved target by default
  - mutate through symlink
  - infer scope from link name alone
```

