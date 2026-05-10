# Policy Grammar

Policies are how users tell Housekeeper where not to aim and how to interpret
known local intent.

Policy must stay small. If policy becomes a second messy home, Housekeeper has
failed.

## 1. Policy Types

### doNotTouch

Hard boundary.

```yaml
doNotTouch:
  - path: ~/.claude/commands/local-*
    reason: personal local commands
    scope: user
```

Effect:

- finding remains visible
- action becomes impossible
- learning cannot override it

### allowance

Known false positive or intentional condition.

```yaml
allowances:
  - finding: registry.local_command_shadow
    path: ~/.claude/commands/local-build.md
    reason: intentional override
    expires: never
```

Effect:

- finding may be downgraded
- report should still explain the allowance
- action is not authorized

### retention

User preference for application data age.

```yaml
retention:
  - surfaceClass: claude-app-data
    path: ~/.claude/projects
    minimumAgeDays: 90
```

Effect:

- changes stance from prepare to watch or review until policy threshold passes

### standingConsent

Narrow pre-approval for a reversible operation.

```yaml
standingConsent:
  - action: rotate-log
    path: ~/.claude/*.log
    maxStance: prepare
    requiresSnapshot: true
```

Effect:

- reduces consent friction
- does not cross sector boundaries
- does not authorize purge

## 2. Precedence

Policy precedence:

1. current explicit user instruction
2. sector boundary
3. doNotTouch
4. project policy
5. user policy
6. allowance
7. standing consent
8. learned suggestion
9. default rule

Narrower protection beats broader permission.

Permission never beats a sector boundary unless the boundary is reopened by a
precise exception.

## 3. Policy Report

Every applied policy should be explainable:

```text
policy: doNotTouch
matched: ~/.claude/commands/local-build.md
effect: stance protect, action none
reason: personal local commands
```

## 4. Policy Anti-Patterns

Avoid:

- broad `allow all cleanup`
- hidden learned policy
- policy that expires never by default
- policy that suppresses protected findings entirely
- policy that grants mutation without rollback
- policy that changes shared project state from user scope

## 5. Policy Review

Housekeeper should eventually support:

- list policies
- explain why a policy matched
- suggest a narrower policy
- expire stale allowances
- show policy conflicts
- export policies
- remove Housekeeper policies on uninstall
