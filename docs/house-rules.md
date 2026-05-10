# House Rules

Claude Housekeeper should behave like a careful person invited into someone else's workshop.

It may point at dust. It may label tangled cables. It may prepare a checklist. It does not unplug the network rack, open the jewelry box, throw away handwritten notes, or decide that an odd-looking pile is trash without permission.

## The Contract

1. Observation is not permission.
2. A cleanup plan is not permission.
3. A past cleanup approval is not future approval.
4. A protected object is not a candidate.
5. Ambiguity lowers confidence; it never increases authority.
6. Surface first. Finding second. Action last.
7. Claude checkpointing is not Housekeeper rollback.

## Protected Means Protected

Users need a way to say: "do not touch this."

That rule applies even when Housekeeper is confident that something looks stale, duplicated, or large. The tool can still report the protected item so the user knows why it was skipped, but it must not propose mutation as the next step.

The intended config is:

```json
{
  "doNotTouch": [
    {
      "path": "commands/net-cables.md",
      "reason": "hand-maintained local command"
    },
    {
      "path": "skills/jewelry-box/**",
      "reason": "private local skill experiments"
    }
  ]
}
```

Protected findings become:

- `risk: "protected"`
- `stance: "protect"`
- `actionable: false`
- `proposedAction: "do-not-touch"`

Future mutation code must treat protected findings as a hard precondition failure if an operation tries to include them.

## Stance Language

Housekeeper should classify, not dramatize.

- `inform`: useful context, no action.
- `watch`: not urgent, may matter later.
- `review`: user intent matters.
- `probe`: live key required.
- `protect`: boundary or do-not-touch.
- `prepare`: a plan can be drafted.
- `repair`: narrow repair after consent, snapshot, and verification.
- `block`: action is not allowed under current evidence.

## Edge Cases

### Local Overrides

A local command that shadows a plugin may be clutter, but it may also be the whole point. Diverged local files are always `review` unless explicitly protected.

### Duplicate Plugin Registrations

User and project scope may both be valid. Duplicate registration should be a finding with `review` or `probe` stance, not automatic cleanup.

### Stale Cache Trees

A cache path missing from `installed_plugins.json` is not enough to call unused. Before mutation, Housekeeper must revalidate that no installed record, symlink, in-use marker, grace period, active session, or running process depends on it.

### Zombie State

Old timestamps are evidence, not proof. Cleanup should check known live-session or process evidence before removing mode state.

### Dangling Hook Paths

Shell commands are hard to parse. Housekeeper should only classify direct,
high-confidence absolute missing paths as `prepare`. Anything involving
environment expansion, wrapper scripts, or generated paths should be `probe` or
`review`.

### Logs and Session Data

Age and size are not enough to delete user data. In the first wedge, they are out
of scope except as examples of future hygiene findings.

## Mutation Standard

No mutation should ship until the operation can answer:

- What exact file or JSON value will change?
- Why is this action allowed?
- What surface was classified?
- What stance permits planning?
- Which protection rules were checked?
- What snapshot was written?
- What command restores the previous state?
- What verification proved Claude still works?

If any answer is missing, the tool should refuse.

If the rollback answer is only "Claude checkpointing," the tool must refuse.
