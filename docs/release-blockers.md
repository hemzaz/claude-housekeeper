# Release Blockers

This is the hard stop list.

If any blocker is true, do not publish a release without documenting an explicit
waiver and residual risk.

## Read-Only Preview Blockers

- `diagnose` or `plan` can mutate user files.
- Report output omits `No files changed.`
- A finding is emitted without surface classification.
- A finding is emitted without evidence or a missing key.
- Cache findings imply deletion authority from registry evidence alone.
- Hook findings imply repair without verification.
- Protected findings are hidden entirely.
- Secret-adjacent content is printed in shareable output.
- Safe mode can call Claude, run hooks, start MCP, execute plugin code, or run
  shell commands.
- Stale terminology scan finds old authority labels in build-facing docs.
- Golden reports do not exist for primary first-wedge cases.
- Fixture matrix does not cover every first-wedge detector.
- README or site overstates cleanup, health, rollback, or repair capability.

## Mutation Release Blockers

Mutation is blocked unless all are true:

- Housekeeper-owned snapshot manifest exists.
- Exact original bytes are captured.
- permissions, symlink identity, and parent state are captured where relevant.
- rollback command is tested against fixtures.
- preconditions are revalidated immediately before action.
- operation id is printed.
- verification is run or residual risk is printed.
- Claude checkpointing is not cited as rollback proof.
- sector boundaries are enforced before mutation.
- concurrent-change behavior is defined.

## Public Support Blockers

- no damaged-environment template
- no false-positive template
- no compatibility matrix
- no redaction examples
- no known limitations section
- no standalone recovery invocation path

