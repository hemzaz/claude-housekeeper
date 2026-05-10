# Sector Boundaries

Sector boundaries are the no-fire zones of Claude Housekeeper.

The metaphor comes from a firing range: each boundary is marked with a light, and under any circumstances, you do not aim or shoot there. In Housekeeper terms, a sector boundary is an area the tool must not target, mutate, infer permission around, or accidentally include in a broader cleanup.

This is stronger than "high risk." High risk can be escalated. A sector boundary is out of the field of action unless the user opens a narrow exception.

## Why This Exists

Housekeeper is built for degraded trust states: stale caches, broken hooks, zombie modes, dirty settings, unclear namespaces, and partial failure.

Those are exactly the moments where a tool might be tempted to overreach.

Sector boundaries prevent emergency cleanup from becoming friendly fire.

## Default Sector Boundaries

These are out of bounds by default:

- secrets, tokens, API keys, credential helpers, keychains, SSH keys
- auth flows, login state, payment or billing material
- financial, tax, legal, medical, identity, or immigration documents
- production, deployment, infrastructure, database, and destructive operations
- anything outside the declared scope
- user-marked do-not-touch paths
- files owned by another person, project, or authority
- active work in progress that Housekeeper did not create
- current session state, live hooks, running processes, and active mode state
- rollback manifests, backup manifests, quarantine metadata, and recovery evidence
- anything Housekeeper cannot verify or roll back

## Rules

Inside a sector boundary, Housekeeper must not:

- delete
- edit
- rewrite
- quarantine
- move
- normalize
- rotate
- deduplicate
- open sensitive contents unless inspection itself was scoped
- include the path as part of parent-directory cleanup
- use learned behavior to bypass the boundary
- treat broad user urgency as permission

Housekeeper may:

- report that the boundary exists
- explain why it is out of bounds
- clean around it if no contact is required
- ask for a precise exception if the user asks to work there

## Exception Standard

Opening a sector boundary requires a specific consent gate.

The consent must include:

- exact target
- exact action
- reason
- duration
- rollback expectation
- verification method

Bad:

```text
clean everything broken
```

Better:

```text
For this run only, inspect ~/.claude/settings.json for hook commands that reference deleted plugin cache paths. Do not print tokens, do not edit auth helpers, and show the patch before applying it.
```

## Parent And Child Rules

If a parent directory is in bounds but contains a sector boundary child, cleanup must split the operation or stop.

If splitting would be ambiguous or lossy, stop.

If a parent directory is a sector boundary, all descendants are sector-boundary protected unless explicitly exempted.

## Learning Rule

Learning cannot erase a sector boundary.

Repeated approval may suggest a standing rule, but it cannot create one silently. The standing rule must still be narrow, visible, and revocable.

## Operating Sentence

Do not aim there.

