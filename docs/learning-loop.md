# Learning Loop

Claude Housekeeper should improve over time without becoming mysterious.

The tool should not "learn" by silently changing behavior because an LLM inferred a preference. It should learn by writing explicit local knowledge that the user can inspect, edit, export, and delete.

## Sources of Knowledge

Housekeeper can learn from five events:

1. False positive reports.
2. Do-not-touch rules.
3. User-approved cleanup plans.
4. Rollbacks.
5. Successful verification after cleanup.

Each event should become a small local record, not hidden state.

## Knowledge Types

### Protection Rules

Protection rules are user-authored boundaries:

```json
{
  "doNotTouch": [
    {
      "path": "skills/jewelry-box/**",
      "reason": "private local skill experiments"
    }
  ]
}
```

They answer: "What must never be changed?"

### Allowances

Allowances are reviewed exceptions:

```json
{
  "allow": [
    {
      "check": "registry.local_command_diverged",
      "path": "commands/go-build.md",
      "reason": "intentional project override"
    }
  ]
}
```

They answer: "What should stop showing as a warning?"

This differs from `doNotTouch`: an allowance hides or downgrades a known false positive; a do-not-touch rule remains visible but protected.

### Operation History

Operation history records what Housekeeper did:

```json
{
  "operationId": "2026-05-09-plugin-cleanup",
  "version": "0.1.0",
  "actions": [
    {
      "type": "quarantine",
      "source": "plugins/cache/omc/oh-my-claudecode/4.13.4",
      "snapshotHash": "sha256:..."
    }
  ],
  "verify": {
    "status": "pass"
  }
}
```

It answers: "What changed, and can it be reversed?"

### Lessons

Lessons are generalized observations derived from repeated outcomes, but they must stay reviewable:

```json
{
  "lessons": [
    {
      "pattern": "commands/go-*.md",
      "from": "3 accepted false-positive reports",
      "recommendation": "suggest allowance, do not auto-apply"
    }
  ]
}
```

They answer: "What should Housekeeper suggest next time?"

Lessons should suggest config changes; they should not silently create them.

## Learning Flow

1. `diagnose` reports a finding.
2. User marks it as protected, allowed, accepted, or rejected.
3. Housekeeper writes a local record.
4. Future `diagnose` reads that record and adjusts classification.
5. Housekeeper explains which rule changed the result.

No hidden state is allowed. Every changed classification needs an explanation.

## Review Commands

Future command surface:

```bash
claude-housekeeper learn false-positive --check=registry.local_command_diverged --path=commands/go-build.md --reason="intentional override"
claude-housekeeper protect path skills/jewelry-box/** --reason="private experiments"
claude-housekeeper knowledge list
claude-housekeeper knowledge explain commands/go-build.md
claude-housekeeper knowledge export
```

These commands should edit local config files only after showing the exact patch.

## Integration Points

### Diagnose

Applies protection and allowance rules, then prints why a finding changed classification.

### Plan

Separates actions into:

- blocked by protection
- suppressed by allowance
- review stance
- eligible for a future reversible plan

### Clean

Checks knowledge at apply time, not just diagnose time. If a file became protected after plan generation, mutation must abort.

### Harden

Installs prevention probes only from explicit user-approved rules. A repeated finding can recommend a guard, but it cannot install one by itself.

### Verify

Feeds operation history. A cleanup that fails verification should teach the planner to lower confidence for that action class until reviewed.

## What Housekeeper Must Not Learn

Housekeeper must not infer:

- "The user always wants old files deleted."
- "This directory name means trash."
- "This plugin is safe to remove."
- "A successful cleanup once means future cleanup can skip review."
- "A protected path can be touched if the tool is confident enough."

Learning should reduce repeated noise, not increase autonomy.

## Storage Layout

Recommended future layout:

```text
~/.claude/housekeeper/
  config.json          # user-authored rules
  knowledge.json       # reviewed allowances and lessons
  operations/
    <operation-id>.json # cleanup manifests and verification outcomes
  quarantine/
    <operation-id>/     # reversible moved files
```

All files should be JSON so users and Claude can inspect and edit them safely.
