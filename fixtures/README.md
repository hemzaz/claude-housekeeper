# Fixtures

Fixtures are synthetic Claude homes for testing the protocol.

They are not real user homes. They should contain no secrets and no private paths.

## Scenario Set

Planned fixture scenarios:

Each scenario should declare:

- surface classes
- owner classes
- load-bearing classes
- sensitivity classes
- execution classes
- rollback classes
- scope classes
- expected findings
- required evidence keys
- safe-mode result
- live-probe result when applicable
- repair eligibility
- rollback expectation

### stale-cache

Installed registry references one plugin version, while an older version tree remains in cache.

Expected:

- surface class: Claude application data
- load-bearing class: possibly load-bearing until freshness key is known
- rollback class: snapshot-possible only if Housekeeper manifest exists
- report stale candidate
- do not call it unused
- do not grant deletion authority

### broken-hook

Settings hook references a deleted plugin cache path.

Expected:

- surface class: authored config plus executable surface
- execution class: runs-hook
- direct missing path finding
- repair candidate if shell command is simple
- review stance if shell command is ambiguous

### duplicate-scope

Same plugin enabled at user and project scope.

Expected:

- surface class: authored config or plugin registration
- owner class: user/project/team according to source
- show both scopes
- classify as review unless precedence and intent are proven

### local-shadow

Local command or skill has same name as plugin-provided resource.

Expected:

- surface class: authored config
- load-bearing class: known or possibly load-bearing
- byte-identical copy -> prepare only with rollback proof
- diverged copy -> review
- protected copy -> protected

### zombie-mode

Mode state says active but heartbeat is old.

Expected:

- surface class: Claude application data
- load-bearing class: possibly load-bearing
- review unless process/session evidence corroborates staleness

### invalid-settings

`settings.json` is malformed.

Expected:

- surface class: authored config
- load-bearing class: known-load-bearing
- invalid core config
- advanced inference disabled

### protected-secret-path

Config references `.env`, key files, auth helpers, or credential-like paths.

Expected:

- surface class: secret-adjacent
- sensitivity class: secret-adjacent or secret-content
- sector boundary
- no content read
- redacted output

### interrupted-cleanup

Housekeeper operation manifest exists in incomplete state.

Expected:

- surface class: Housekeeper-owned
- rollback class: manifest-backed or corrupt-manifest
- block new cleanup
- show recovery options

### symlinked-home

Claude home or plugin cache contains symlinks.

Expected:

- execution/scope identity warning
- identity warning
- no traversal by default

### huge-home

Large transcript/project/cache directories.

Expected:

- surface class: Claude application data
- scan budget hit
- degraded partial report

### checkpoint-mismatch

Claude checkpoint exists, but the simulated cleanup changes files through an
external process that checkpointing would not restore.

Expected:

- Housekeeper does not treat Claude checkpoint as rollback proof
- operation requires Housekeeper-owned snapshot manifest
- rollback eligibility is blocked without manifest

### app-data-versus-config

Home contains both authored settings and Claude-managed app data.

Expected:

- surface map separates config, executable, application data, and
  secret-adjacent surfaces
- no broad "clean home" action is available
- each proposed action targets one surface class

## Fixture Rules

- No real secrets.
- No real usernames.
- No external network dependency.
- No executable scripts unless explicitly part of a safe parser fixture.
- Every fixture includes expected findings.

## Acceptance Card Template

Each fixture should eventually have an acceptance card:

```yaml
id: fixture-name
purpose: What framework behavior this proves.
mode_expectations:
  safe:
    claim_level: observation|surface|suspicion|finding|diagnosis
    stance: inform|watch|review|probe|protect|prepare|repair|block
  live:
    claim_level: observation|surface|suspicion|finding|diagnosis
    stance: inform|watch|review|probe|protect|prepare|repair|block
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
  class: orientation|integrity|contamination|possession|hygiene
  stance: inform|watch|review|probe|protect|prepare|repair|block
allowed_next_step: report|probe|prepare-plan|none
blocked_actions: []
report_expectations: []
```
