# Field Validation Layer

The framework is not validated until it survives real homes and synthetic homes.

This document defines the missing layer between concept and implementation.

Goal:

> Prove that Housekeeper can be useful without becoming overconfident.

## 1. Validation Thesis

Housekeeper earns trust when it can say:

- what it knows
- how it knows it
- what it does not know
- what key would unlock the next claim
- what can be ignored
- what needs review
- what is protected
- what is blocked

The product is not ready when it finds many issues.

It is ready when its uncertainty is accurate.

## 2. Validation Artifacts

Before implementation, define these artifacts:

1. fixture acceptance cards
2. loader truth matrix
3. report grammar
4. policy grammar
5. redacted real-home report format
6. first wedge acceptance definition

## 3. Fixture Acceptance Cards

Each fixture needs a card with this shape:

```yaml
id: broken-hook-simple
purpose: Prove direct missing hook paths become prepare stance, not cleanup.
mode_expectations:
  safe:
    claim_level: finding
    stance: prepare
    must_not: [run_hook, edit_settings, call_hook_broken_without_parseable_path]
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
    - hook command contains missing absolute plugin cache path
  missing:
    - loader hook view
finding:
  class: integrity
  summary: settings hook references missing direct plugin path
  stance: prepare
  missingKey: live hook verification
allowed_next_step: prepare patch preview
blocked_actions:
  - mutate without consent
  - delete plugin cache
  - claim fixed
```

Acceptance cards force every fixture to prove the whole chain:

```text
surface -> evidence -> claim level -> finding class -> stance -> next step
```

## 4. Loader Truth Matrix

The loader truth matrix records what Claude actually does.

Each row should contain:

- `question`
- `fixture`
- `Claude Code version`
- `OS`
- `command used`
- `observed behavior`
- `official source`
- `Housekeeper rule`
- `confidence`
- `known drift risk`

Example:

```yaml
question: skill and legacy command share a name
fixture: loader-skill-command-collision
observed_behavior: skill takes precedence over legacy command
official_source: slash command docs
housekeeper_rule: classify legacy command as shadowed only after /skills confirms resolved source
confidence: documented-plus-tested
```

Unknown loader behavior must produce `probe` or `review`, not cleanup.

## 5. Report Grammar

Reports should be stance-first.

Default report:

```text
HOUSEKEEPER REPORT
No files changed.

PRIMARY
  stance: probe
  finding: old plugin cache version may still be live
  evidence: not referenced by installed registry; inside plugin cache
  missing key: active-session or orphan-grace evidence
  next step: run live freshness probe or wait until grace period expires

STANCE SUMMARY
  inform   4
  watch    2
  review   3
  probe    1
  protect  1
  prepare  0
  repair   0
  block    1

BOUNDARIES
  1 protected path
  0 files inspected inside secret-adjacent paths

SKIPPED
  project history scan capped at 1s
```

Detailed report sections:

- surfaces
- evidence
- findings
- stances
- protected
- blocked
- probes
- residual risk

Machine-readable reports should include all classification axes.

Human reports should show only the axes that explain the decision.

## 6. Policy Grammar

Policies should be small and human-readable.

Core policy shapes:

```yaml
doNotTouch:
  - path: ~/.claude/commands/local-*
    reason: personal local commands
    scope: user

allowances:
  - finding: registry.local_command_diverged
    path: ~/.claude/commands/local-build.md
    reason: intentional override
    expires: never

retention:
  - surfaceClass: claude-app-data
    path: ~/.claude/projects
    minimumAgeDays: 90

standingConsent:
  - action: rotate-log
    path: ~/.claude/*.log
    maxStance: prepare
    requiresSnapshot: true
```

Policy rules:

- do-not-touch beats allowance
- narrower protection beats broader permission
- standing consent cannot cross sector boundaries
- learned suggestions do not become policy without acceptance
- policies must be explainable in report output

## 7. Redacted Real-Home Report Format

Real-home research should collect structure, not secrets.

Required fields:

- report schema version
- Housekeeper version
- Claude Code version
- OS
- install method if known
- top-level `.claude` sizes
- plugin count
- hook count by event
- MCP count by scope
- command/skill count
- surface class counts
- stance counts
- protected count
- blocked count
- degraded scan reasons
- user-labeled false positives

Avoid:

- raw secret values
- full command lines with token-like strings
- raw transcripts
- auth file content
- shell history
- `.env` content

Shareable reports should redact home prefixes and support basename-only paths.

## 8. First Wedge

The first wedge should be:

> Safe out-of-band diagnosis of broken hooks and plugin cache drift.

Why this wedge:

- painfully obvious when broken
- linked to real failure modes
- safely diagnosable with structural evidence
- benefits from live probes but does not require mutation
- demonstrates the core philosophy

Included:

- settings parse status
- hook command direct missing path detection
- plugin installed registry parse status
- plugin cache version map
- expected-orphan versus candidate-stale-cache language
- stance summary
- protected paths
- no-files-changed guarantee

Excluded:

- automatic cleanup
- plugin uninstall
- editing settings
- deleting cache trees
- broad `.claude` scan
- secrets inspection

Success:

```text
User learns why Claude is failing or what key is missing, without Housekeeper
changing anything.
```

## 9. Validation Gates

Before coding mutation:

1. Ten fixture acceptance cards exist.
2. Loader truth matrix covers the first wedge.
3. Report grammar has three examples: clean, degraded, blocked.
4. Policy grammar handles do-not-touch and allowance.
5. Redacted report format is documented.
6. At least five real-home reports have been reviewed manually.
7. False positives are labeled and folded back into fixture cards.
8. No fixture uses Claude checkpointing as rollback proof.

## 10. The Central Test

For every finding, ask:

> Would this output still be true if the user refused every proposed action?

If yes, it is a trustworthy diagnostic.

If no, it is probably selling the cleanup too early.
