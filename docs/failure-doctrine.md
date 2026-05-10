# Failure Doctrine

Housekeeper must be useful when Housekeeper itself cannot complete its work.

Failure should produce orientation, not silence.

## 1. Failure Classes

### Scan Failure

Examples:

- permission denied
- file disappeared during scan
- symlink loop
- path too long
- file count budget hit

Default stance:

- `inform` if harmless
- `review` if coverage matters
- `block` if mutation would depend on missing evidence

### Parse Failure

Examples:

- invalid settings JSON
- invalid plugin registry
- broken frontmatter

Default stance:

- `prepare` for patch preview when exact
- `block` for advanced inference depending on parsed content

### Probe Failure

Examples:

- Claude command unavailable
- `/hooks` fails
- MCP status fails
- live probe times out

Default stance:

- `probe` if retry or narrower probe is reasonable
- `block` if action depends on the probe

### Rollback Failure

Examples:

- manifest missing
- manifest corrupt
- target changed after snapshot
- parent missing
- permissions changed

Default stance:

- `block`

Never improvise rollback.

### Policy Failure

Examples:

- policy file invalid
- conflicting policy
- project policy denies user action

Default stance:

- `protect` when safety policy is clear
- `block` when conflict affects mutation

## 2. Partial Reports

Partial reports must say:

- what completed
- what failed
- what was skipped
- what claims are weakened
- what action is blocked

Pattern:

```text
SCAN DEGRADED
completed: settings, plugin registry
failed: project history
effect: session-state findings incomplete
blocked: cleanup plans depending on session freshness
```

## 3. Failure Must Not Escalate Authority

If Housekeeper cannot read enough, it cannot act more boldly.

Failure narrows authority.

## 4. Recovery From Failure

Every failure should offer the smallest next safe step:

- rerun with larger budget
- run safe mode
- inspect exact file manually
- fix invalid JSON
- approve live probe
- restore manifest from backup
- stop and ask for project owner

