# Architecture Notes

Claude Housekeeper is intentionally split into gates.

The architectural invariant is:

```text
observe -> classify surfaces -> collect evidence -> classify findings -> choose stance
```

There is no direct path from observation to action.

## Audit

`scripts/lib/audit.mjs` reads Claude state and returns a structured report. It should stay side-effect free.

Every issue should include:

- `severity`
- `confidence`
- `risk`
- `stance`
- `surfaceClassification`
- `evidence`
- `path` when available
- `summary`
- `proposedAction`
- `protected` when a do-not-touch rule matched

Informational findings, such as cache size accounting, must be marked `actionable: false`.

Future report rows should be stance-first. Risk is about action cost; stance is
how Housekeeper speaks to the user now.

Protection config is loaded from:

1. `--config=/path/to/config.json`
2. `~/.claude/housekeeper/config.json`
3. `~/.claude/housekeeper.json`

Supported rule sets are `doNotTouch` and `protect`. They share the same shape:

```json
{
  "doNotTouch": [
    {
      "check": "registry.local_command_diverged",
      "path": "commands/net-cables.md",
      "reason": "hand-maintained local command"
    }
  ]
}
```

Future mutation planners must reject any operation that targets a protected issue.

The first wedge should only depend on:

- settings parse
- direct hook path analysis
- plugin installed registry parse
- plugin cache version map
- protection policy read
- degraded scan reporting

## Planning

`plan` currently formats findings. Future versions should emit a deterministic
no-mutation plan preview with preconditions:

- path exists
- file hash matches
- mtime has not changed
- expected JSON pointer still has the same value
- target quarantine path does not exist
- surface classification is still the same
- stance still allows planning
- rollback class is not `checkpoint-only`

Mutation must fail closed if any precondition changes after diagnosis.

## Mutation

`clean`, `harden`, and `rollback` currently refuse mutation.

When mutation lands, the order should be:

1. Re-run the affected audit scope.
2. Re-classify affected surfaces.
3. Re-collect evidence keys.
4. Recompute stance.
5. Build an operation list.
6. Create a backup manifest.
7. Copy or move affected files into quarantine.
8. Apply the operation.
9. Run targeted verification.
10. Record rollback metadata.

Permanent deletion should be a separate purge command with an age threshold.

Claude checkpointing must never satisfy the rollback requirement. Rollback proof
must be Housekeeper-owned or native to the exact action.

## SessionStart Probes

SessionStart should run only bounded checks:

- parse `settings.json`
- parse `plugins/installed_plugins.json`
- inspect hook commands already present in settings
- check for interrupted Housekeeper transactions
- check local command and skill names against installed plugin resources

Avoid full recursive walks, size accounting, log scans, and mutation during session startup.

SessionStart output should be a reminder or cached status, not a full diagnosis.

## Knowledge Integration

The audit layer should eventually merge four local knowledge files:

- `config.json`: do-not-touch rules and user preferences
- `knowledge.json`: reviewed allowances and suggested lessons
- `operations/<id>.json`: completed cleanup manifests
- `quarantine/<id>/manifest.json`: rollback source of truth

The precedence order should be:

1. Invalid config produces a warning and disables learned behavior.
2. Do-not-touch rules override every other rule.
3. Rollback failure history lowers confidence.
4. Allowances suppress known false positives.
5. Lessons can suggest changes but cannot mutate classification unless accepted.

Knowledge may change noise level. It cannot grant action authority.
