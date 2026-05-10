# North Star

Claude Housekeeper is a Claude Code home inspector.

It restores trust by making the Claude home legible before it changes anything.

It is not primarily a cleaner.

It is not an autonomous janitor.

It is not a replacement for `/doctor`.

It is the layer that answers:

> What is happening in my Claude home, what can I ignore, what should I watch,
> what needs review, what needs a live probe, what is protected, and what is
> blocked?

## 1. The First Wedge

The first wedge is:

> Safe out-of-band diagnosis of broken hooks and plugin cache drift.

This wedge is narrow enough to build safely and painful enough to matter.

It focuses on:

- `settings.json` parse status
- hook command direct missing path detection
- plugin installed registry parse status
- plugin cache version map
- expected-orphan versus candidate-stale-cache language
- protected paths
- stance summary
- no-files-changed guarantee

It excludes:

- automatic cleanup
- editing settings
- deleting plugin caches
- plugin uninstall/update
- broad `.claude` cleanup
- live probes by default
- secrets inspection

## 2. Non-Negotiable Invariants

1. No direct path from observation to action.
2. Surface first. Finding second. Action last.
3. Every finding carries evidence.
4. Every actionable finding has a stance.
5. Protected means protected.
6. Sector boundaries are no-fire zones.
7. Safe mode does not run Claude, hooks, MCP, plugin code, or project scripts.
8. Claude checkpointing is not Housekeeper rollback.
9. Mutation requires Housekeeper-owned rollback proof.
10. No claim of "fixed" without behavioral verification.

## 3. Product Promise

User-facing:

> No files changed. Here is what I found, what I know, what I do not know, and
> the next safe step.

Internal:

> Be useful without becoming overconfident.

## 4. Product Boundary

Housekeeper may:

- observe
- classify
- explain
- report
- mark missing keys
- prepare plans
- recommend probes
- protect user-declared boundaries

Housekeeper may not, in the first wedge:

- mutate files
- quarantine files
- delete files
- run live probes by default
- execute user/plugin/project code
- claim caches are unused without freshness proof
- claim hooks are fixed without verification

## 5. Success Definition

The first version succeeds if a user with a broken hook or confusing plugin cache
can run one safe command and learn:

- the likely problem
- the evidence
- the missing key, if any
- whether this is protected or blocked
- the next safe step
- that no files changed

## 6. Failure Definition

The first version fails if:

- users think it deleted or changed something
- it calls stale-looking caches deletion-ready
- it hides uncertainty
- it produces too much output to orient under stress
- it treats `/doctor` overlap as competition instead of complement
- it cannot explain why a finding has its stance
