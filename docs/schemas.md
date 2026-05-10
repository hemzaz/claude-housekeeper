# Schema Drafts

These are contract shapes, not implementation schemas.

They exist so docs, fixtures, and future code can converge.

## 1. Report

```json
{
  "schemaVersion": "0.1",
  "mode": "safe",
  "home": "<redacted>",
  "generatedAt": "2026-05-10T00:00:00.000Z",
  "filesChanged": false,
  "primary": "finding-id",
  "stanceSummary": {
    "inform": 0,
    "watch": 0,
    "review": 0,
    "probe": 0,
    "protect": 0,
    "prepare": 0,
    "repair": 0,
    "block": 0
  },
  "findings": [],
  "boundaries": [],
  "degraded": []
}
```

## 2. Surface Classification

```json
{
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

## 3. Finding

```json
{
  "id": "settings.hook_path_dangling",
  "class": "integrity",
  "claimLevel": "finding",
  "stance": "prepare",
  "summary": "settings hook references missing direct plugin cache path",
  "surface": {},
  "evidence": {
    "structural": [],
    "loader": [],
    "behavioral": [],
    "ownership": [],
    "freshness": [],
    "reversibility": [],
    "missing": []
  },
  "nextAllowedStep": "patch-preview",
  "blockedActions": ["mutate-without-consent", "claim-fixed"]
}
```

## 4. Policy

```json
{
  "schemaVersion": "0.1",
  "doNotTouch": [
    {
      "path": "~/.claude/commands/local-*",
      "reason": "personal local commands",
      "scope": "user"
    }
  ],
  "allowances": [],
  "retention": [],
  "standingConsent": []
}
```

## 5. Acceptance Card

```yaml
id: fixture-name
purpose: What this proves.
mode_expectations:
  safe:
    claim_level: finding
    stance: probe
surfaces: []
evidence:
  structural: []
  loader: []
  behavioral: []
  ownership: []
  freshness: []
  reversibility: []
  missing: []
finding:
  class: integrity
  stance: probe
allowed_next_step: live-probe
blocked_actions: []
report_expectations: []
```

