# Repair And Rollback Spec

Housekeeper wins or loses trust at repair time.

Diagnosis may be helpful, but repair is where the user discovers whether the
tool respects their home.

## 1. Repair Is Not Cleanup

Cleanup removes or reduces clutter.

Repair changes behavior.

Examples:

- removing old logs is cleanup
- patching a dangling hook path is repair
- disabling a broken MCP server is repair
- moving byte-identical local command copies is cleanup
- editing settings precedence is repair

Repair requires stronger evidence than cleanup because it changes what Claude
will do next.

## 2. Repair Modes

### Explain

Housekeeper prints the problem and manual fix.

No mutation.

Use when:

- evidence is weak
- ownership is unclear
- repair is outside scope
- sector boundary is near

### Patch Preview

Housekeeper generates a proposed patch or operation plan.

No mutation.

Use when:

- target file is known
- change is small
- user can review exact diff
- rollback is possible

### Snapshot And Apply

Housekeeper writes a snapshot, applies the approved patch, and verifies.

Use when:

- structural key exists
- ownership key exists
- reversibility key exists
- consent gate is explicit
- verification probe is defined

### Quarantine

Housekeeper moves material to an out-of-loader holding area.

Use when:

- deletion is premature
- user may need recovery
- loader no longer sees the object after quarantine
- rollback path is clear

Never quarantine into a Claude-loaded namespace.

### Defer

Housekeeper refuses to repair now and explains the missing key.

Use when:

- live probe is required but not consented
- concurrent session may still depend on the object
- rollback proof is missing
- path is protected
- action would cross a sector boundary

## 3. Native First

When Claude provides a native command, Housekeeper should prefer it over
inventing filesystem surgery.

Examples:

- use documented diagnostics such as `/doctor`, `/hooks`, `/mcp`, `/skills`,
  `/status`, and `/context` as live keys
- use documented plugin commands as research inputs
- treat `claude plugin prune --dry-run` as the native key for orphaned
  auto-installed plugin dependencies
- treat project history purge as a native action when the user explicitly wants
  to remove project application data

Housekeeper should not wrap a native command in hidden automation. It should show
the command and why it is the safer key.

## 4. Mutation Preconditions

Every mutation must have:

- exact target list
- surface classification
- operation type
- expected before-state
- evidence key
- ownership key
- sector-boundary check
- snapshot plan
- rollback command
- verification probe
- residual risk statement

If any precondition fails, the operation stops before mutation.

If surface classification is missing or `unknown`, the operation stops before
mutation.

If `rollbackClass` is `checkpoint-only`, the operation stops before mutation.

## 5. Snapshot Requirements

A snapshot must capture:

- original bytes
- file mode
- ownership when available
- symlink identity and target without dereferencing
- parent directory existence
- timestamp
- path redaction metadata for reports
- Housekeeper version and operation id
- consent summary

Directories require a manifest:

- entries
- file types
- sizes
- hashes where budget allows
- skipped entries
- symlinks
- permissions
- sector-boundary exclusions

## 6. Rollback Requirements

Rollback must be:

- explicit
- scoped to one operation
- dry-runnable
- preconditioned
- unwilling to overwrite newer user changes without consent

Rollback must detect:

- target changed after operation
- parent missing
- permissions changed
- symlink changed
- process holds file open where detectable
- Housekeeper manifest corrupt
- sector boundary now covers the target

Rollback failure must not improvise.

It should stop and print the safest manual recovery path.

## 6.1 Checkpoint Prohibition

Claude checkpoints are not Housekeeper rollback.

Housekeeper MUST NOT:

- advertise cleanup as reversible because Claude checkpointing is enabled
- use a Claude checkpoint as its only recovery plan
- skip its own snapshot because a checkpoint exists
- claim rollback coverage for Bash, hook, MCP, package-manager, database,
  external API, or external process side effects

Housekeeper MAY:

- mention checkpoints as a separate Claude Code feature
- recommend a Claude checkpoint workflow for normal coding edits
- use checkpoint presence as context in a report

But a Housekeeper mutation requires Housekeeper-owned rollback proof:

- operation manifest
- target snapshot
- restore command
- precondition checks
- verification expectations

If the only recovery evidence is a Claude checkpoint, classification is:

```text
rollbackClass: checkpoint-only
action: blocked
reason: cleanup rollback not proven
```

## 7. Verification Requirements

Verification depends on repair type:

- settings repair: parse settings, then run live loader probe if consented
- hook repair: `/hooks` or `claude --debug hooks`, plus targeted event if safe
- MCP repair: `/mcp` status, without starting unknown servers in safe mode
- plugin repair: plugin list and cache/reference consistency
- registry repair: `/skills` or equivalent resolved view
- cleanup: target absent from loader path and present in quarantine

Never say fixed because a file edit succeeded.

Say fixed only when the broken behavior is no longer observed.

## 8. Repair Language

Allowed:

- "I can prepare a patch."
- "This repair is reversible under these conditions."
- "This needs a live probe before I can call it broken."
- "The file changed since the plan; stopping."

Forbidden:

- "deletion-ready" without reversibility and freshness keys
- "unused" without loader/freshness proof
- "fixed" without behavior verification
- "rollback guaranteed" when external processes or concurrent edits exist

## 9. Repair Philosophy

Repair is a conversation with the home, not a conquest of it.

The correct repair is often smaller than the tempting cleanup.

When the user is anxious because Claude is unstable, the product should become
more explicit, not more automatic.
