# Report Grammar

Housekeeper reports should restore orientation before they list tasks.

The report is not a dump. It is the visible shape of trust.

## 1. Default Shape

```text
HOUSEKEEPER REPORT
No files changed.

PRIMARY
  stance: <inform|watch|review|probe|protect|prepare|repair|block>
  finding: <one-line finding>
  evidence: <short evidence>
  missing key: <if any>
  next step: <next allowed step>

STANCE SUMMARY
  inform   <n>
  watch    <n>
  review   <n>
  probe    <n>
  protect  <n>
  prepare  <n>
  repair   <n>
  block    <n>

BOUNDARIES
  protected: <n>
  sector-boundary: <n>
  secret-adjacent skipped: <n>

SCAN
  mode: <safe|diagnose|live>
  degraded: <yes|no>
  skipped: <short list>
```

## 2. Primary Finding Selection

Choose the primary finding by:

1. current breakage
2. executable/lifecycle impact
3. load-bearing confidence
4. user-facing confusion
5. number of dependent findings
6. lowest safe next step

Do not choose the largest byte count as primary unless the user's explicit
intent is disk usage.

## 3. Stance Wording

### Inform

```text
stance: inform
next step: none
```

### Watch

```text
stance: watch
next step: no action now; revisit if it grows or starts affecting behavior
```

### Review

```text
stance: review
next step: decide whether this is intentional before planning changes
```

### Probe

```text
stance: probe
next step: run a live probe after consent
```

### Protect

```text
stance: protect
next step: none; excluded from action by rule
```

### Prepare

```text
stance: prepare
next step: generate a patch preview or operation plan
```

### Repair

```text
stance: repair
next step: snapshot, apply approved repair, verify
```

### Block

```text
stance: block
next step: resolve missing key or boundary before action
```

## 4. Blocked Action Format

```text
BLOCKED
  action: quarantine old plugin cache
  reason: rollback proof is checkpoint-only
  missing key: Housekeeper snapshot manifest
  allowed now: report and live freshness probe
  not allowed: delete or quarantine
```

## 5. Protected Finding Format

```text
PROTECTED
  path: ~/.claude/commands/local-build.md
  reason: do-not-touch rule: personal command
  visible because: it shadows a plugin command
  action: none
```

Protected items should be visible but not noisy.

## 6. Missing Key Format

```text
MISSING KEY
  claim wanted: cache is unused
  current evidence: not referenced by installed registry
  missing evidence: active-session check or elapsed orphan grace period
  current stance: probe
```

## 7. Degraded Scan Format

```text
SCAN DEGRADED
  budget hit: max files visited
  skipped: ~/.claude/projects
  effect: project-history findings may be incomplete
  next step: run full scan explicitly
```

## 8. Language Rules

Prefer:

- "candidate"
- "appears"
- "not referenced by known evidence"
- "live probe required"
- "blocked by rollback proof"
- "protected by rule"
- "no files changed"

Avoid:

- "junk"
- "trash"
- "deletion-ready"
- "definitely unused"
- "auto-fix"
- "guaranteed rollback"

## 9. Report Success

A good report lets the user answer:

- What is probably wrong?
- What does Housekeeper actually know?
- What is still unknown?
- What will not be touched?
- What is the next safe step?
