# Decision Calculus

Housekeeper needs a repeatable way to decide what posture to take toward a
finding.

The calculus does not decide implementation. It decides stance.

The point is to prevent three product failures:

- treating uncertainty as permission
- treating clutter as damage
- treating severity as authority

## 1. Inputs

Every decision consumes four inputs:

1. `SurfaceClassification`
2. `EvidenceKeys`
3. `FindingClass`
4. `UserPolicy`

It may also consider:

- urgency
- confidence
- reversibility
- scan degradation
- active process/session hints
- product mode: safe, diagnose, live diagnose, plan, act, verify

## 2. Outputs

Every decision outputs a `Stance`.

Allowed stances:

- `inform`
- `watch`
- `review`
- `probe`
- `protect`
- `prepare`
- `repair`
- `block`

The stance is not the final command. It is the posture Housekeeper takes toward
the user.

## 3. Stance Definitions

### Inform

Use when a finding improves orientation but asks for no decision.

Examples:

- plugin cache size
- hook count
- namespace inventory
- protected item count

User message:

```text
This is useful context. No action recommended.
```

### Watch

Use when something is not yet a problem but may deserve later attention.

Examples:

- growing logs below threshold
- expected plugin orphan inside grace period
- repeated but harmless duplicate registration

User message:

```text
No action now. Watch this if it grows or starts affecting behavior.
```

### Review

Use when user intent matters.

Examples:

- diverged local command
- local skill shadow
- duplicate scope that may be intentional
- old session state that may be resumable

User message:

```text
This may be intentional. Review before any plan.
```

### Probe

Use when a live or stronger key is needed.

Examples:

- hook path looks suspicious but shell parse is ambiguous
- MCP server command exists but health is unknown
- cache appears orphaned but active-session status is unknown

User message:

```text
A live probe is required before I can call this broken or unused.
```

### Protect

Use when policy or surface classification says do not touch.

Examples:

- do-not-touch rule
- secret-adjacent path
- sector boundary
- another user's material

User message:

```text
Protected. Visible in the report, excluded from action.
```

### Prepare

Use when a reviewable plan can be drafted but mutation is not yet authorized.

Examples:

- byte-identical local duplicate with snapshot-possible rollback
- settings patch with clear target and backup path
- log rotation plan with retention rule

User message:

```text
I can prepare a plan. No files change until approval.
```

### Repair

Use only when repair evidence is strong enough and consent has been granted.

Examples:

- known settings parse error with exact patch
- loaded hook points at a missing direct executable path
- MCP config uses a missing absolute command path

User message:

```text
This can be repaired after snapshot and verification.
```

### Block

Use when action is not allowed under current evidence or policy.

Examples:

- checkpoint-only rollback
- unknown owner
- out-of-scope path
- sector boundary without exception
- evidence conflict
- active process may still depend on target

User message:

```text
Blocked. Here is the missing key or boundary.
```

## 4. Decision Order

Order matters.

Housekeeper should evaluate stances in this order:

1. `protect`
2. `block`
3. `probe`
4. `review`
5. `prepare`
6. `repair`
7. `watch`
8. `inform`

This order biases toward preserving user agency and avoiding accidental action.

## 5. Hard Overrides

These rules always win:

- sector boundary -> `protect` or `block`
- do-not-touch -> `protect`
- unknown owner -> `block` for mutation, `review` for reporting
- unknown surface -> `block` for mutation, `inform` or `review` for reporting
- `checkpoint-only` rollback -> `block`
- secret content -> `protect`
- safe mode plus live-key requirement -> `probe`
- conflicting evidence -> `block`
- out-of-scope -> `block`

## 6. Stance Matrix

| Condition | Stance |
| --- | --- |
| no issue, useful inventory | `inform` |
| expected orphan within grace period | `watch` |
| possible load-bearing cache | `probe` |
| local override or diverged copy | `review` |
| user says do-not-touch | `protect` |
| secret-adjacent path | `protect` |
| malformed settings with exact location | `prepare` |
| malformed settings with approved patch and snapshot | `repair` |
| missing rollback proof | `block` |
| checkpoint-only rollback | `block` |
| unknown owner | `block` for action |
| safe mode cannot prove live behavior | `probe` |

## 7. Severity Does Not Decide Stance

Severity answers:

> How bad if true?

Stance answers:

> What posture should Housekeeper take now?

High severity can still be `block`.

Example:

```text
Production deploy hook appears broken, but it is outside scope and lacks
rollback proof.
```

Correct stance:

```text
block
```

Not:

```text
repair immediately
```

## 8. Confidence Does Not Decide Authority

Confidence answers:

> How sure is this finding?

Authority answers:

> What may Housekeeper do?

A high-confidence protected finding stays protected.

A high-confidence irreversible cleanup stays blocked.

A low-confidence suspicion may still be useful as `probe`.

## 9. Urgency Does Not Create Permission

Emergency mode narrows behavior.

It does not widen authority.

In degraded or emergency states, Housekeeper should:

- reduce output noise
- prefer safe mode
- avoid live probes unless explicitly authorized
- avoid bundled actions
- increase explanation of what is blocked and why

Urgency can change presentation.

It cannot skip gates.

## 10. Stance Payload

Every stance should carry:

- `stance`
- `why`
- `missingKey`
- `nextAllowedStep`
- `notAllowed`
- `userDecisionNeeded`

Example:

```json
{
  "stance": "probe",
  "why": "The hook command contains a plugin cache path, but shell parsing is ambiguous.",
  "missingKey": "loader or hook debug evidence",
  "nextAllowedStep": "Run a live hook probe after consent.",
  "notAllowed": "Do not patch or delete based on this string alone.",
  "userDecisionNeeded": true
}
```

## 11. Language Rules

Housekeeper should use stance language instead of emotional certainty.

Prefer:

- "review required"
- "live probe required"
- "protected by rule"
- "blocked by rollback proof"
- "prepare plan"
- "informational"

Avoid:

- "safe"
- "trash"
- "junk"
- "obviously unused"
- "auto-fix"
- "guaranteed rollback"

## 12. Product Implication

The report should not only count issues.

It should count stances:

```text
STANCE SUMMARY
inform       8
watch        3
review      12
probe        4
protect      5
prepare      2
repair       0
block        3
```

This teaches the user what kind of attention the home needs.

It also keeps Housekeeper from sounding like every finding is a cleanup task.

## 13. v0.1 Degradation

In v0.1 the `repair` stance is unreachable because Housekeeper-owned rollback
infrastructure does not ship until v0.4. Per `docs/repair-rollback-spec.md`,
`repair` requires reversibility keys (operation manifest, exact-byte snapshot,
restore command, verification plan) that v0.1 cannot produce.

Therefore in v0.1, any decision path that would otherwise return `repair`
MUST return `prepare` instead, with `nextAllowedStep` set to:

```text
deferred until v0.4 rollback infrastructure
```

This rule applies in both `safe` and `diagnose` modes. It does not weaken any
hard override from §5; `protect` and `block` still win when their conditions
hold. Once Housekeeper rollback infrastructure ships, the rule is removed and
§4 decision order returns unchanged.

Why this is a degradation, not a redefinition: the stance vocabulary stays
intact for v0.2+ when reversibility keys exist. The v0.1 build simply cannot
satisfy the Evidence Gate for `repair`, so the engine surfaces the missing
key (`v0.4 rollback infrastructure`) instead of inventing authority it does
not have.
