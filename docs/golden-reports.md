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
  finding: do-not-touch rules match secret-adjacent paths in both parent and child directions
  evidence: do-not-touch rule matched ~/.env; do-not-touch rule matched ~/.claude/credentials/**
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
  sector-boundary: 1
  parent-contains-boundary: 1
  secret-adjacent skipped: 0

PROTECTED
  path: ~/.env
  reason: do-not-touch rule
  action: none

  path: ~/.claude/credentials/**
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

## 11. Interrupted Housekeeper Operation

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

## 12. Symlinked Home

```text
HOUSEKEEPER REPORT
No files changed.

PRIMARY
  stance: review
  finding: a symlink under ~/.claude resolves outside the observed home root
  evidence: path is a symlink; observed and resolved paths differ
  missing key: canonical target identity and traversal consent for resolved target
  next step: decide whether this is intentional before planning changes

STANCE SUMMARY
  inform   0
  watch    0
  review   1
  probe    0
  protect  0
  prepare  0
  repair   0
  block    0

BOUNDARIES
  protected: 0
  sector-boundary: 0
  parent-contains-boundary: 1
  secret-adjacent skipped: 0

SCAN
  mode: safe
  degraded: no
  skipped: symlink target traversal

BLOCKED ACTIONS
  traverse resolved target by default
  mutate through symlink
  infer scope from link name alone
```

## 13. Duplicate Scope Plugin

```text
HOUSEKEEPER REPORT
No files changed.

PRIMARY
  stance: review
  finding: same plugin appears registered at both user and project scope
  evidence: user settings parsed; project settings parsed; both list the same plugin name
  missing key: effective precedence in current session and user intent for the second registration
  next step: decide whether this is intentional before planning changes

STANCE SUMMARY
  inform   0
  watch    0
  review   1
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
  skipped: live /status precedence probe

BLOCKED ACTIONS
  remove one scope
  infer one registration is orphaned
  mutate either settings file
```

## 14. Local Shadow Identical

```text
HOUSEKEEPER REPORT
No files changed.

PRIMARY
  stance: review
  finding: a local command file appears to shadow a byte-identical plugin-provided command
  evidence: local command name matches plugin-provided resource; byte-identical content hash
  missing key: user intent for the local copy and rollback proof required to escalate stance
  next step: decide whether this is intentional before planning changes

STANCE SUMMARY
  inform   0
  watch    0
  review   1
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
  skipped: live /skills precedence probe

BLOCKED ACTIONS
  remove local file
  escalate to prepare without rollback proof
  claim the local copy is redundant
```

## 15. Local Shadow Diverged

```text
HOUSEKEEPER REPORT
No files changed.

PRIMARY
  stance: review
  finding: a local command file shares a name with a plugin-provided command but content bytes differ
  evidence: local command name matches plugin-provided resource; content bytes differ from plugin source
  missing key: user intent for the divergence
  next step: decide whether this is intentional before planning changes

STANCE SUMMARY
  inform   0
  watch    0
  review   1
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
  skipped: live /skills precedence probe

BLOCKED ACTIONS
  overwrite local edits
  propose syncing the local file to plugin source
  escalate to prepare or repair
```

## 16. MCP Command Missing

```text
HOUSEKEEPER REPORT
No files changed.

PRIMARY
  stance: prepare
  finding: MCP server config references a missing direct executable path
  evidence: MCP config parsed; server command contains an absolute path that does not exist
  missing key: live /mcp status and startup consent
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
  skipped: MCP server startup, Claude /mcp probe

BLOCKED ACTIONS
  start the MCP server
  edit .mcp.json without consent
  claim the server is broken before live status is checked
```

## 17. Secret Command Fragment

```text
HOUSEKEEPER REPORT
No files changed.

PRIMARY
  stance: protect
  finding: a hook command string contains a token-like env fragment
  evidence: command string parsed; token-like pattern matched inside command
  missing key: none for redaction
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
  sector-boundary: 1
  secret-adjacent skipped: 0

PROTECTED
  path: ~/.claude/settings.json
  reason: hook command contains a token-like env fragment
  command: ANTHROPIC_API_KEY=<redacted> /usr/local/bin/syn-notify
  action: none

BLOCKED ACTIONS
  print the command raw
  omit the command string entirely from the report
  copy the token fragment into evidence or logs
```

