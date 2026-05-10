# Fixture Matrix

The fixture matrix turns scenarios into build targets.

Each fixture must have:

- directory under `fixtures/synthetic-homes/<id>/`
- acceptance card under `fixtures/synthetic-homes/<id>/card.yaml`
- optional golden human report under `fixtures/synthetic-homes/<id>/report.txt`
- optional golden JSON report under `fixtures/synthetic-homes/<id>/report.json`

Fixtures must not contain real secrets, real usernames, or external network
dependencies.

## Matrix

| Fixture | Surface | Evidence | Missing key | Stance | Blocked actions |
| --- | --- | --- | --- | --- | --- |
| `clean-home` | settings, plugin registry, hook paths | parsers pass; direct paths exist | live probes | `inform` | claim healthy |
| `broken-hook-simple` | authored config, executable reference | settings parsed; direct absolute path missing | `/hooks` view, verification | `prepare` | mutate settings, delete cache, claim fixed |
| `broken-hook-shell-ambiguous` | authored config, shell-risk command | command contains plugin-cache-looking text | shell certainty, debug trace | `probe` | patch command, claim hook broken |
| `expected-orphan-cache` | Claude app data | cache version not referenced; inside grace evidence | live session/process reference | `watch` | call unused, quarantine, delete |
| `candidate-stale-cache` | Claude app data | cache version not referenced by known registry evidence | freshness key, retention policy | `probe` | call unused, mutate |
| `protected-secret-path` | secret-adjacent, sector boundary | protection rule or secret pattern matched | none for protection | `protect` | read content, print value, mutate |
| `checkpoint-only-rollback` | rollback blocker | Claude checkpoint exists | Housekeeper manifest and snapshot | `block` | mutate, cite checkpoint as rollback |
| `invalid-settings` | authored config | JSON parse error | valid settings for dependent inference | `prepare` | infer hooks, infer MCP, mutate |
| `huge-home-degraded` | Claude app data | scan budget hit | full traversal | `inform` | claim complete, plan action from skipped data |
| `interrupted-housekeeper-operation` | Housekeeper-owned state | incomplete operation manifest | recovery decision | `block` | start new mutation, overwrite manifest |
| `symlinked-home` | scope and identity risk | symlink observed | target identity and traversal consent | `review` or `block` | traverse by default, mutate target |
| `duplicate-scope-plugin` | plugin registration | same plugin name at multiple scopes | effective precedence, user intent | `review` | remove one scope |
| `local-shadow-identical` | authored config and plugin resource | same name and same bytes | ownership intent, rollback proof | `review` | remove local file |
| `local-shadow-diverged` | authored config and plugin resource | same name, different bytes | user intent | `review` | overwrite local edits |
| `mcp-command-missing` | authored config, executable reference | MCP command direct path missing | `/mcp` status, startup consent | `prepare` or `probe` | start server, edit config |
| `secret-command-fragment` | secret-adjacent command | token-like env or arg pattern | none for redaction | `protect` | print command raw |

## Directory Convention

```text
fixtures/synthetic-homes/
  broken-hook-simple/
    home/
      .claude/
        settings.json
    card.yaml
    report.txt
    report.json
```

Rules:

- `home/` is the simulated home root.
- `.claude/` under `home/` is the simulated Claude home.
- Tests must pass an explicit home path; they must not inspect the real
  developer home.
- Paths in golden reports should use `~` or `<home>` redaction.
- Fixture scripts are disallowed unless the fixture explicitly tests parser
  treatment of executable surfaces.

## Fixture Completion Gate

A fixture is complete only when:

- the card names surface classification axes
- expected evidence keys are listed
- missing keys are listed
- stance is named
- blocked actions are listed
- at least one report expectation exists
- safe-mode behavior is explicit
- no real secret or username appears

