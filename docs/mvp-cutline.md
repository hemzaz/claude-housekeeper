# MVP Cutline

The MVP is a read-only diagnostic preview.

It is not cleanup.

It is not repair.

It is not hardening.

## 1. Included

### Modes

- safe diagnose
- normal diagnose
- plan preview as no-mutation explanation

### Subsystems

- settings parse
- hook command path analysis
- plugin installed registry parse
- plugin cache version map
- protection policy read
- stance summary
- degraded scan reporting

### Findings

- invalid settings JSON
- direct missing absolute path in hook command
- plugin cache version not referenced by known installed registry evidence
- expected orphan within documented grace period
- protected path match
- scan degraded by budget or boundary

### Output

- no-files-changed line
- primary finding
- stance summary
- boundaries
- skipped/degraded scan notes
- missing key when relevant

## 2. Excluded

- mutation
- quarantine
- purge
- settings patch application
- plugin update/uninstall
- MCP server startup
- hook execution
- live Claude probes by default
- broad session/project history cleanup
- learning rules
- standing consent
- team policy enforcement
- binary packaging beyond local CLI/plugin wrapper

## 3. Required Behaviors

The MVP must:

- never change files
- classify surfaces before findings
- produce a stance for every finding
- distinguish expected orphan from candidate stale cache
- distinguish direct missing hook path from shell-ambiguous hook string
- redact or avoid secret-adjacent content
- avoid running executable surfaces
- show protected findings as visible but non-actionable
- explicitly state when a live probe is required

## 4. MVP Non-Goals

The MVP does not prove:

- cleanup is safe
- rollback works
- hooks are fixed
- MCP servers are healthy
- all `.claude` bloat is identified
- old sessions are dead
- all loader semantics are known

## 5. MVP Acceptance

MVP is ready when:

1. Broken-hook fixture produces `prepare` or `probe`, never cleanup.
2. Expected-orphan fixture produces `watch`, never stale/delete.
3. Candidate-stale-cache fixture produces `probe`, never unused/delete.
4. Protected-secret-path fixture produces `protect`.
5. Invalid-settings fixture stops deeper inference and reports exact parse error.
6. Huge-home fixture reports degraded scan and weakened claims.
7. Checkpoint-only rollback fixture produces `block`.
8. Every report starts with "No files changed."

