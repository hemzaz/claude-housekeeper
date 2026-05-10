# State Governance

Housekeeper must not become the next mess.

## 1. State Classes

Housekeeper may eventually store:

- config
- policies
- knowledge
- report cache
- operation manifests
- snapshots
- quarantine metadata
- fixture/test data

## 2. Storage Rules

Housekeeper-owned state must:

- stay outside Claude-loaded command, skill, and hook namespaces
- be self-describing
- include schema version
- include retention policy
- be inspectable
- be removable

## 3. Retention

Suggested retention:

- report cache: short
- operation manifests: long enough for rollback confidence
- snapshots: tied to operation retention
- learned suggestions: reviewed or expired
- rejected suggestions: short

No hidden forever state.

## 4. Corruption Handling

If Housekeeper state is corrupt:

- report it
- block mutation depending on it
- preserve corrupted file for manual review
- do not overwrite unless user approves

## 5. Uninstall Contract

Uninstall should say:

- what Housekeeper-owned state exists
- what can be removed
- what should be retained for rollback
- what policies will disappear
- what report artifacts remain

Uninstall should not delete rollback evidence by default.

