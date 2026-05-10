# Build Readiness Guide

This is the one-pass guide for a future coding agent.

Read this after:

1. `north-star.md`
2. `mvp-cutline.md`
3. `framework-kernel.md`
4. `decision-calculus.md`
5. `schemas.md`
6. `acceptance-cards.md`

Then build only the first wedge unless explicitly instructed otherwise.

For the concrete implementation sequence, module boundaries, and fixture-first
test order, read `implementation-blueprint.md` after this guide.

Before release or public distribution decisions, read
`operational-readiness.md`.

If a future agent is unsure whether the documentation layer is complete, read
`readiness-gap-ledger.md`.

## 1. First Wedge To Build

Build:

> Safe out-of-band diagnosis of broken hooks and plugin cache drift.

Do not build:

- mutation
- quarantine
- cleanup
- harden
- learning
- live probes by default
- broad `.claude` cleanup

## 2. Required Flow

The implementation must follow this flow:

```text
observe -> classify surfaces -> collect evidence -> classify findings -> choose stance -> report
```

There is no direct path from filesystem observation to cleanup language.

## 3. Minimum Objects

Implement these contract objects first:

- `SurfaceClassification`
- `EvidenceSet`
- `Finding`
- `Stance`
- `Report`
- `PolicyMatch`
- `ScanLimit`

Do not implement `Operation`, `Snapshot`, `Quarantine`, or `Rollback` until the
user explicitly authorizes mutation work.

## 4. First Checks

### Settings Parse

Input:

- `~/.claude/settings.json`

Output:

- valid or invalid JSON
- surface: authored-config
- stance: `prepare` for exact parse repair, `block` for dependent inference

### Hook Direct Missing Path

Input:

- hook command strings from settings

Output:

- direct missing absolute path -> `prepare`
- shell ambiguous path -> `probe`
- never execute hook
- never edit settings

### Plugin Registry Parse

Input:

- `~/.claude/plugins/installed_plugins.json`

Output:

- valid or invalid JSON
- plugin install path references
- missing registry blocks cache conclusions that depend on it

### Plugin Cache Version Map

Input:

- `~/.claude/plugins/cache/**`

Output:

- installed reference
- expected orphan if inside documented grace evidence
- candidate stale cache if not referenced by known registry evidence
- `probe` when freshness key is missing
- never "unused" unless loader/freshness proof exists

### Protection Policy

Input:

- `~/.claude/housekeeper/config.json`
- `~/.claude/housekeeper.json`

Output:

- matched do-not-touch rules
- stance `protect`
- visible but non-actionable finding

## 5. Required Report

Every text report starts with:

```text
HOUSEKEEPER REPORT
No files changed.
```

Every report includes:

- primary finding
- stance summary
- boundaries
- scan mode
- degraded scan notes

Every JSON report includes:

- schema version
- filesChanged false
- findings
- surface classifications
- evidence
- stance
- missing keys

## 6. Required Tests

Start with acceptance cards:

- broken-hook-simple
- broken-hook-shell-ambiguous
- expected-orphan-cache
- candidate-stale-cache
- protected-secret-path
- checkpoint-only-rollback
- invalid-settings
- huge-home-degraded

Each test should assert:

- surface classification exists
- evidence set exists
- stance is correct
- blocked actions are correct
- report says no files changed
- no mutation occurred

## 7. Forbidden Implementation Moves

Do not:

- add cleanup behavior
- add `rm`, unlink, move, or write operations for user state
- call Claude in safe mode
- run hooks
- start MCP servers
- execute plugin code
- call cache "unused" from registry evidence alone
- use Claude checkpointing as rollback proof
- hide protected findings entirely

## 8. Done Criteria

The first wedge is done when:

- all acceptance-card tests pass
- reports are stance-first
- every finding has a surface classification
- every finding has evidence or missing key
- no mutation code path exists in diagnose/plan
- docs and README still say no files changed
- users can understand the next safe step from the report
