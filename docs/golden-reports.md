# Golden Reports

Golden reports are canonical output contracts.

They show how Housekeeper should speak before implementation details exist.
Future tests should compare against these examples semantically, not by fragile
spacing alone.

Every golden report starts with:

```text
HOUSEKEEPER REPORT
No files changed.
```

## 1. Clean Home

```text
HOUSEKEEPER REPORT
No files changed.

PRIMARY
  stance: inform
  finding: no first-wedge issues found
  evidence: settings parsed; plugin registry parsed; hook direct paths exist
  missing key: live Claude probes were not run in safe mode
  next step: none

STANCE SUMMARY
  inform   1
  watch    0
  review   0
  probe    0
  protect  0
  prepare  0
  repair   0
  block    0

BOUNDARIES
  protected: 0
  sector-boundary: 0
  secret-adjacent skipped: 0

SCAN
  mode: safe
  degraded: no
  skipped: live Claude probes
```

## 2. Broken Direct Hook Path

```text
HOUSEKEEPER REPORT
No files changed.

PRIMARY
  stance: prepare
  finding: settings hook references a missing direct executable path
  evidence: settings parsed; hook command contains an absolute path that does not exist
  missing key: live /hooks view and hook verification
  next step: generate a patch preview only

STANCE SUMMARY
  inform   0
  watch    0
  review   0
  probe    0
  protect  0
  prepare  1
  repair   0
  block    0

BOUNDARIES
  protected: 0
  sector-boundary: 0
  secret-adjacent skipped: 0

SCAN
  mode: safe
  degraded: no
  skipped: live hook execution, Claude /hooks probe

BLOCKED ACTIONS
  mutate settings
  delete plugin cache
  claim fixed
```

## 3. Shell-Ambiguous Hook Path

```text
HOUSEKEEPER REPORT
No files changed.

PRIMARY
  stance: probe
  finding: hook command contains a plugin-cache-looking path inside shell syntax
  evidence: settings parsed; command string references plugin cache text
  missing key: shell parse certainty or consented hook debug trace
  next step: run a live hook debug probe after consent

STANCE SUMMARY
  inform   0
  watch    0
  review   0
  probe    1
  protect  0
  prepare  0
  repair   0
  block    0

BOUNDARIES
  protected: 0
  sector-boundary: 0
  secret-adjacent skipped: 0

SCAN
  mode: safe
  degraded: no
  skipped: shell execution, hook execution

BLOCKED ACTIONS
  patch command string
  call hook broken with certainty
  claim fixed
```

## 4. Expected Orphan Cache

```text
HOUSEKEEPER REPORT
No files changed.

PRIMARY
  stance: watch
  finding: old plugin cache version appears to be an expected orphan
  evidence: version is not referenced by known installed registry evidence; orphan age is inside documented grace evidence
  missing key: live active-session reference check
  next step: no action now

STANCE SUMMARY
  inform   0
  watch    1
  review   0
  probe    0
  protect  0
  prepare  0
  repair   0
  block    0

BOUNDARIES
  protected: 0
  sector-boundary: 0
  secret-adjacent skipped: 0

SCAN
  mode: safe
  degraded: no
  skipped: live process and session checks

BLOCKED ACTIONS
  call unused
  quarantine
  delete
```

## 5. Candidate Stale Cache

```text
HOUSEKEEPER REPORT
No files changed.

PRIMARY
  stance: probe
  finding: plugin cache version is not referenced by known registry evidence
  evidence: installed registry parsed; version directory is outside known references
  missing key: active session, process reference, or retention policy evidence
  next step: run freshness probe or review manually

STANCE SUMMARY
  inform   0
  watch    0
  review   0
  probe    1
  protect  0
  prepare  0
  repair   0
  block    0

BOUNDARIES
  protected: 0
  sector-boundary: 0
  secret-adjacent skipped: 0

SCAN
  mode: safe
  degraded: no
  skipped: live process and session checks

BLOCKED ACTIONS
  call unused
  delete
  quarantine without Housekeeper rollback proof
```

## 6. Protected Finding

```text
HOUSEKEEPER REPORT
No files changed.

PRIMARY
  stance: protect
  finding: protected local command appears to shadow a plugin command
  evidence: local command name matches plugin-provided resource; do-not-touch rule matched
  missing key: none for protection
  next step: none

STANCE SUMMARY
  inform   0
  watch    0
  review   0
  probe    0
  protect  1
  prepare  0
  repair   0
  block    0

BOUNDARIES
  protected: 1
  sector-boundary: 0
  secret-adjacent skipped: 0

PROTECTED
  path: ~/.claude/commands/local-build.md
  reason: do-not-touch rule
  action: none
```

## 7. Invalid Settings

```text
HOUSEKEEPER REPORT
No files changed.

PRIMARY
  stance: prepare
  finding: settings.json is invalid JSON
  evidence: parser returned line and column for the invalid token
  missing key: valid settings required before hook or MCP inference
  next step: generate patch preview or edit manually

STANCE SUMMARY
  inform   0
  watch    0
  review   0
  probe    0
  protect  0
  prepare  1
  repair   0
  block    1

BOUNDARIES
  protected: 0
  sector-boundary: 0
  secret-adjacent skipped: 0

SCAN
  mode: safe
  degraded: yes
  skipped: dependent hook and MCP inference
```

## 8. Degraded Huge Home

```text
HOUSEKEEPER REPORT
No files changed.

PRIMARY
  stance: inform
  finding: scan budget was reached before project history traversal completed
  evidence: max files visited budget reached under ~/.claude/projects
  missing key: full traversal
  next step: run explicit full scan if project-history findings are needed

STANCE SUMMARY
  inform   1
  watch    0
  review   0
  probe    0
  protect  0
  prepare  0
  repair   0
  block    0

SCAN
  mode: safe
  degraded: yes
  skipped: remaining project history after budget

BLOCKED ACTIONS
  summarize scan as complete
  propose action from partial project-history evidence
```

## 9. Checkpoint-Only Rollback Blocked

```text
HOUSEKEEPER REPORT
No files changed.

PRIMARY
  stance: block
  finding: requested action has only Claude checkpoint context, not Housekeeper rollback proof
  evidence: Claude checkpoint exists; no Housekeeper snapshot manifest exists
  missing key: Housekeeper operation manifest and exact-byte snapshot
  next step: create Housekeeper rollback plan before mutation

STANCE SUMMARY
  inform   0
  watch    0
  review   0
  probe    0
  protect  0
  prepare  0
  repair   0
  block    1

BLOCKED
  action: quarantine plugin cache version
  reason: rollback proof is checkpoint-only
  allowed now: report
  not allowed: mutate
```

## 10. Housekeeper Internal State Problem

```text
HOUSEKEEPER REPORT
No files changed.

PRIMARY
  stance: block
  finding: Housekeeper operation manifest is incomplete
  evidence: operation id exists; manifest lacks completed verification record
  missing key: recovery decision for interrupted operation
  next step: inspect operation record and choose recover, archive, or discard

STANCE SUMMARY
  inform   0
  watch    0
  review   0
  probe    0
  protect  0
  prepare  0
  repair   0
  block    1

BLOCKED ACTIONS
  start new mutation operation
  overwrite operation manifest
  hide Housekeeper self-failure
```

