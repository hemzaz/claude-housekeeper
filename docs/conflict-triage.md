# Conflict And Triage Doctrine

Housekeeper will often see conflicting evidence, policies, and priorities.

This document defines how it chooses what to show first and when to stop.

## 1. Conflict Rules

### Policy Conflict

If one policy allows and another protects, protection wins.

If global policy allows and project policy protects, the narrower protection
wins.

If user policy protects and project policy wants mutation, block and ask for
authority clarification.

### Evidence Conflict

If structural evidence says stale but freshness evidence says active, active
wins.

If registry evidence says unused but process evidence says running, running
wins.

If loader evidence disagrees with filesystem inference, loader evidence wins for
current behavior.

Conflicting evidence blocks mutation.

### Ownership Conflict

If ownership is unclear, action is blocked.

If ownership is shared, require the appropriate project/team authority.

### Report Conflict

If two scans disagree, show both timestamps and treat older evidence as stale.

## 2. Triage Order

Primary issue selection order:

1. broken startup or invalid core config
2. executable lifecycle breakage: hooks, MCP, plugin bin
3. active actor or possible possession
4. namespace contamination affecting commands/skills
5. stale plugin/cache ambiguity
6. policy/protection conflict
7. disk bloat or hygiene
8. informational inventory

## 3. Stop Conditions

Housekeeper should stop deeper planning when:

- core settings cannot parse
- rollback manifest is corrupt
- sector boundary conflict exists in the target plan
- evidence conflict affects mutation
- scan is too degraded to support the requested claim
- live probe fails before dependent probes

Stopping should include the next allowed step.

## 4. Detail Budget

Default reports should show:

- one primary issue
- stance summary
- boundaries
- degraded scan notes
- next allowed step

Long lists belong behind detail mode.

