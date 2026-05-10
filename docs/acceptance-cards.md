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

## 11. duplicate-scope-plugin

```yaml
id: duplicate-scope-plugin
purpose: |
  Same plugin enabled at user and project scope is reviewable, not
  automatically wrong (loader-semantics.md §1; protocol-contracts.md
  "Edge Case 7").
mode_expectations:
  safe:
    claim_level: finding
    stance: review
surfaces:
  - path: ~/.claude/settings.json
    surfaceClass: authored-config
    ownerClass: user-owned
    loadBearingClass: known-load-bearing
    sensitivityClass: private-path
    executionClass: inert
    rollbackClass: snapshot-possible
    scopeClass: in-scope
  - path: .claude/settings.json
    surfaceClass: authored-config
    ownerClass: project-owned
    loadBearingClass: known-load-bearing
    sensitivityClass: private-path
    executionClass: inert
    rollbackClass: snapshot-possible
    scopeClass: in-scope
evidence:
  structural:
    - same plugin name registered at user and project scope
  loader:
    - documented precedence places project above user
  missing:
    - effective precedence in current session
    - user intent for second registration
finding:
  class: integrity
  stance: review
allowed_next_step: show both registrations and documented precedence; do not deduplicate
blocked_actions:
  - remove one scope
  - infer one registration is orphaned
  - mutate either settings file
```

## 12. local-shadow-identical

```yaml
id: local-shadow-identical
purpose: |
  Byte-identical local copy of a plugin command is reviewable; prepare
  stance only with rollback proof (protocol-contracts.md "Edge Case 8";
  decision-calculus.md §6).
mode_expectations:
  safe:
    claim_level: finding
    stance: review
surfaces:
  - path: ~/.claude/commands/example.md
    surfaceClass: authored-config
    ownerClass: user-owned
    loadBearingClass: known-load-bearing
    sensitivityClass: private-path
    executionClass: inert
    rollbackClass: snapshot-possible
    scopeClass: in-scope
evidence:
  structural:
    - local command name matches plugin-provided resource
    - byte-identical content hash
  ownership:
    - plugin source identified
  missing:
    - user intent for the local copy
    - rollback proof required to escalate stance to prepare
finding:
  class: contamination
  stance: review
allowed_next_step: show source, target, and precedence; await user intent
blocked_actions:
  - remove local file
  - escalate to prepare without rollback proof
  - claim the local copy is redundant
```

## 13. local-shadow-diverged

```yaml
id: local-shadow-diverged
purpose: |
  Diverged local copy of a plugin command may be authorship; review only
  (protocol-contracts.md "Edge Case 8"; decision-calculus.md §6).
mode_expectations:
  safe:
    claim_level: finding
    stance: review
surfaces:
  - path: ~/.claude/commands/example.md
    surfaceClass: authored-config
    ownerClass: user-owned
    loadBearingClass: known-load-bearing
    sensitivityClass: private-path
    executionClass: inert
    rollbackClass: snapshot-possible
    scopeClass: in-scope
evidence:
  structural:
    - local command name matches plugin-provided resource
    - content bytes differ from plugin source
  ownership:
    - plugin source identified
  missing:
    - user intent for the divergence
finding:
  class: contamination
  stance: review
allowed_next_step: show both versions and let the user decide
blocked_actions:
  - overwrite local edits
  - propose syncing the local file to plugin source
  - escalate to prepare or repair
```

## 14. mcp-command-missing

```yaml
id: mcp-command-missing
purpose: |
  MCP server config with a missing direct command path is a prepare
  candidate; safe mode never starts the server (loader-semantics.md §6;
  safe-mode.md "Hard Rules"; protocol-contracts.md "Edge Case 15").
mode_expectations:
  safe:
    claim_level: finding
    stance: prepare
surfaces:
  - path: .mcp.json
    surfaceClass: authored-config
    ownerClass: project-owned
    loadBearingClass: known-load-bearing
    sensitivityClass: secret-adjacent
    executionClass: starts-mcp
    rollbackClass: snapshot-possible
    scopeClass: in-scope
evidence:
  structural:
    - MCP config parses
    - server command direct absolute path does not exist
  missing:
    - /mcp status from a live Claude session
    - startup consent
finding:
  class: integrity
  stance: prepare
allowed_next_step: patch preview only; do not start the server
blocked_actions:
  - start the MCP server
  - edit .mcp.json without consent
  - claim the server is broken before live status is checked
```

## 15. secret-command-fragment

```yaml
id: secret-command-fragment
purpose: |
  Token-like fragments inside a command string must be redacted in the
  rendered report, not just excluded (redaction-examples.md "Command
  Strings"; protocol-contracts.md "Edge Case 14"; safe-mode.md "Privacy
  Mode").
mode_expectations:
  safe:
    claim_level: surface
    stance: protect
surfaces:
  - path: ~/.claude/settings.json
    surfaceClass: secret-adjacent
    ownerClass: user-owned
    loadBearingClass: known-load-bearing
    sensitivityClass: secret-content
    executionClass: shell-expansion-risk
    rollbackClass: snapshot-possible
    scopeClass: sector-boundary
evidence:
  structural:
    - command string contains token-like env or argument pattern
  missing:
    - none for redaction
finding:
  class: orientation
  stance: protect
allowed_next_step: render the command with token fragments replaced by redaction placeholders
blocked_actions:
  - print the command raw
  - omit the command string entirely from the report
  - copy the token fragment into evidence or logs
```

