# Surface Classification Spec

Housekeeper must classify surfaces before it emits findings.

This is a hard gate. A path is not a finding target until Housekeeper has first
classified what kind of surface it is, who likely owns it, how sensitive it is,
and whether changing it could affect Claude behavior.

## 1. Rule

> Surface first. Finding second. Action last.

Housekeeper MUST NOT produce an actionable finding for an unclassified surface.

Housekeeper MAY report an unclassified surface as:

- `unknown-surface`
- `scan-degraded`
- `needs-manual-review`
- `outside-scope`

But it MUST NOT propose cleanup, quarantine, repair, deduplication, rotation, or
purge until classification is complete enough for that action.

## 2. Classification Axes

Every observed resource gets a `SurfaceClassification`.

Required axes:

- `surfaceClass`
- `ownerClass`
- `loadBearingClass`
- `sensitivityClass`
- `executionClass`
- `rollbackClass`
- `scopeClass`
- `confidence`

### Surface Class

What kind of thing is this?

- `authored-config`
- `claude-app-data`
- `executable-surface`
- `secret-adjacent`
- `housekeeper-owned`
- `external-reference`
- `unknown`

### Owner Class

Who has authority over it?

- `user-owned`
- `project-owned`
- `team-managed`
- `plugin-owned`
- `claude-managed`
- `housekeeper-owned`
- `shared`
- `unknown`

### Load-Bearing Class

Can this affect Claude behavior?

- `known-load-bearing`
- `possibly-load-bearing`
- `historically-load-bearing`
- `not-load-bearing`
- `unknown`

### Sensitivity Class

How dangerous is display or inspection?

- `public-structure`
- `private-path`
- `secret-adjacent`
- `secret-content`
- `regulated-or-personal`
- `unknown`

### Execution Class

Can inspection or probing execute code?

- `inert`
- `starts-process`
- `runs-hook`
- `starts-mcp`
- `runs-plugin-code`
- `shell-expansion-risk`
- `network-risk`
- `unknown`

### Rollback Class

What kind of rollback proof exists?

- `manifest-backed`
- `snapshot-possible`
- `native-reversible`
- `checkpoint-only`
- `external-side-effects`
- `irreversible`
- `unknown`

### Scope Class

Is this within the declared work area?

- `in-scope`
- `protected`
- `sector-boundary`
- `parent-contains-boundary`
- `out-of-scope`
- `unknown`

## 3. Classification Gate

Before producing a normal finding, Housekeeper MUST answer:

- Is the resource in scope?
- Is it protected or inside a sector boundary?
- Is it authored config, application data, executable, secret-adjacent, or
  Housekeeper-owned?
- Could it be load-bearing?
- Could inspecting or probing it execute code?
- Can a future mutation be rolled back without relying on Claude checkpointing?

If any answer is `unknown`, the finding may still exist, but default stance is
`review` or `block`.

## 4. Action Eligibility Matrix

| Classification result | Allowed default action |
| --- | --- |
| `unknown` surface | report only |
| `secret-content` or regulated content | boundary notice only |
| `sector-boundary` | no action without narrow exception |
| `executable-surface` | structural parse only; live probe requires consent |
| `known-load-bearing` | no cleanup; repair only with loader/behavioral key |
| `possibly-load-bearing` | review |
| `claude-app-data` | measure and summarize; native action preferred |
| `authored-config` | patch preview only until explicit consent |
| `housekeeper-owned` | accountable cleanup allowed with manifest |
| `checkpoint-only` rollback | mutation blocked |
| `manifest-backed` rollback | eligible if other keys pass |

## 5. Finding Fields Added By Classification

Every finding SHOULD include:

```json
{
  "surface": {
    "surfaceClass": "authored-config",
    "ownerClass": "user-owned",
    "loadBearingClass": "known-load-bearing",
    "sensitivityClass": "private-path",
    "executionClass": "inert",
    "rollbackClass": "snapshot-possible",
    "scopeClass": "in-scope",
    "confidence": "high"
  }
}
```

The finding summary should be derived from this classification.

Bad:

```text
old file should be removed
```

Better:

```text
authored config references a missing direct hook path; repair requires patch
preview, snapshot, and live hook verification
```

## 6. Unknown Surface Handling

Unknown surfaces are not failures by themselves.

They become findings only when:

- they are inside a Claude-loaded path
- they block confidence
- they prevent scan completion
- they hide a sector boundary
- they may be executable
- they affect rollback

Default wording:

```text
Unclassified surface found. Housekeeper can report it but will not plan cleanup
until ownership, load-bearing status, and rollback status are known.
```

## 7. Boundary Propagation

Classification propagates:

- If a parent is a sector boundary, descendants inherit `sector-boundary`.
- If a child is a sector boundary, parent cleanup becomes
  `parent-contains-boundary`.
- If any descendant is secret-adjacent and traversal is not scoped, parent
  recursive inspection is blocked or degraded.
- If a directory contains executable surfaces, live probing is separated from
  structural scanning.

## 8. Checkpoint Boundary

`checkpoint-only` is not rollback.

Claude checkpoints may help a Claude Code session restore tracked file edits,
but they do not prove Housekeeper cleanup is reversible.

Therefore:

- `rollbackClass: checkpoint-only` blocks mutation.
- A cleanup plan MUST NOT cite Claude checkpointing as its rollback mechanism.
- A repair plan MAY mention that a Claude checkpoint exists as context only.
- The plan must still provide Housekeeper's own snapshot and operation manifest.

## 9. Minimum Classifier Output

Safe mode classifier output:

```json
{
  "path": "~/.claude/settings.json",
  "surfaceClass": "authored-config",
  "ownerClass": "user-owned",
  "loadBearingClass": "known-load-bearing",
  "sensitivityClass": "private-path",
  "executionClass": "inert",
  "rollbackClass": "snapshot-possible",
  "scopeClass": "in-scope",
  "confidence": "medium",
  "limits": ["safe-mode-no-loader-key"]
}
```

Normal/live diagnose may add:

- loader source
- resolved source
- active session reference
- process reference
- native command output
- verification probe result

## 10. Classifier Failure Is A Product Outcome

If Housekeeper cannot classify a surface, it has still done useful work.

It should say:

- what it could classify
- what remains unknown
- which key is missing
- which action is blocked
- what probe would unlock the next step

Classifier uncertainty should produce orientation, not paralysis.
