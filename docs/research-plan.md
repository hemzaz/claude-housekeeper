# Research Plan

The next phase is field research, not more design.

Goal:

Build evidence about real broken Claude homes, loader semantics, false positives, performance, safety boundaries, and product language.

## 1. Research Questions

Primary questions:

- Which `.claude` failures are common?
- Which failures actually break Claude behavior?
- Which stale-looking artifacts are still load-bearing?
- Which action candidates create false positives?
- What scan budget is safe?
- What output makes users feel oriented rather than overwhelmed?

## 2. Data Collection Principles

No raw secrets.

No raw `.env`, private keys, auth files, shell history, or credential helper output.

No raw transcripts unless explicitly volunteered and redacted.

Prefer structural metadata:

- file paths, optionally redacted
- file sizes
- mtimes
- hashes, shortened
- JSON keys, not values
- plugin names/versions
- hook events and command path existence
- registry references
- OS and Claude Code version

Reports should support privacy modes:

- full local report
- redacted shareable report
- aggregate metrics only

## 2.1 Door/Key Research Method

Every suspected failure should be written as a door/key pair:

- Door: the possible conclusion or repair path.
- False key: the tempting heuristic that is not enough.
- Real key: the minimum evidence needed to open the door.
- Source: structural scan, Claude loader probe, behavioral probe, ownership
  record, freshness check, or rollback proof.
- Action unlocked: diagnose, warn, plan, repair, quarantine, purge, or verify.

This prevents Housekeeper from turning plausible filesystem observations into
false authority.

Example:

- Door: old plugin cache version is removable.
- False key: directory version is older than installed version.
- Real key: outside documented grace period, not referenced by known registry
  evidence, no active process/session reference, no do-not-touch rule, and
  rollback/quarantine available.
- Action unlocked: reversible cleanup plan, not immediate deletion.

## 3. Broken Home Corpus

Target sample:

- 20-50 user homes
- macOS, Linux, WSL, native Windows
- small, medium, and huge `.claude` directories
- plugin-heavy users
- hook-heavy users
- team/project managed users
- users with broken startup or missing skills

For each home:

- OS
- Claude Code version
- install method
- `.claude` size by top-level directory
- settings parse status
- plugin registry parse status
- plugin count
- hook count by event/source
- MCP count by scope
- local command/skill count
- shadow/collision count
- stale cache candidates
- active markers/process evidence
- observed primary pain
- user-labeled false positives

## 4. Loader Semantics Research

Use black-box tests across Claude versions.

Matrix:

- user command vs project command
- command vs skill same name
- standalone skill vs plugin skill
- plugin skill vs plugin skill same name
- user disabled plugin vs project enabled plugin
- local disabled plugin vs project enabled plugin
- MCP local/project/user/plugin same server name
- hook same event from user/project/local/plugin
- managed `allowManagedHooksOnly`
- settings merging arrays vs objects vs scalars
- `disableSkillShellExecution`
- SessionStart hook stdout/context behavior
- Windows paths and native `cmd /c npx` MCP behavior
- plugin cache orphan lifecycle across update, uninstall, concurrent sessions,
  and `/reload-plugins`

Output:

- documented behavior
- observed behavior
- version tested
- command used
- fixture layout
- expected Housekeeper classification
- required key before diagnosis or repair

## 5. Performance Research

Measure:

- full scan time
- safe-mode scan time
- directory size scan time
- hashing budget impact
- plugin cache traversal time
- project transcript traversal time
- symlink handling
- network mount behavior

Budgets to test:

- 100ms SessionStart probe
- 1s quick diagnose
- 5s normal diagnose
- manual full scan with progress

Report degraded scans:

- timeout hit
- file count cap hit
- byte cap hit
- path skipped by sensitivity rule
- symlink skipped
- mount skipped

## 6. False Positive Research

Ask users to label findings:

- true issue
- intentional
- protected
- harmless clutter
- unknown
- wrong

Expected classes:

- local command overrides
- local skill forks
- duplicate plugin scopes
- old resumable sessions
- retained logs
- symlinked plugin paths
- old cache with live process
- private project conventions

## 7. Trust UX Research

Test output formats:

### Incident Report

One primary issue, evidence, next step, risk, confidence.

### Scorecard

Subsystem rows and counts.

### Map

Namespace/ownership graph.

### Plan

Action candidates grouped by risk.

Questions:

- Which output calms users fastest?
- How many findings are too many?
- Is confidence helpful?
- Does "sector boundary" resonate or need plainer wording?
- Does "haunted" belong only in docs?

## 8. Safe Mode Research

Validate that safe mode:

- does not call `claude`
- does not run hooks
- does not start MCP servers
- does not run skill shell injection
- does not traverse sensitive paths
- handles invalid JSON
- handles missing plugin registry
- works when Claude startup fails

Minimum report:

- config parse status
- hook path direct existence
- enabled plugin registry status
- MCP config parse status
- obvious sector boundary notices
- no files changed

## 9. Research Artifacts

Create:

- `docs/loader-semantics.md`
- `docs/unknowns.md`
- `docs/safe-mode.md`
- `docs/framework-kernel.md`
- `docs/decision-calculus.md`
- `docs/evidence-keyring.md`
- `docs/surface-map.md`
- `docs/surface-classification-spec.md`
- `docs/protocol-spec.md`
- `docs/repair-rollback-spec.md`
- `docs/field-validation.md`
- `docs/report-grammar.md`
- `docs/policy-grammar.md`
- `docs/north-star.md`
- `docs/mvp-cutline.md`
- `docs/acceptance-cards.md`
- `docs/schemas.md`
- `docs/vocabulary.md`
- `docs/feedback-templates.md`
- `docs/kill-criteria.md`
- `docs/operator-doctrine.md`
- `docs/consent-ux.md`
- `docs/failure-doctrine.md`
- `docs/conflict-triage.md`
- `docs/mode-doctrine.md`
- `docs/state-governance.md`
- `docs/team-governance-threat-model.md`
- `fixtures/synthetic-homes/`
- `fixtures/loader-semantics/`
- redacted report format
- user interview script

## 9.1 Spec Coverage Research

Each spec must be tested against fixtures before implementation:

- `surface-map`: every fixture resource has a surface class
- `surface-classification-spec`: every actionable finding is blocked until the
  target surface has owner, load-bearing, sensitivity, execution, scope, and
  rollback classes
- `framework-kernel`: every fixture can identify the claim level it supports
  and the gate that blocks stronger claims
- `decision-calculus`: every fixture finding resolves to a stance, and the
  stance is explainable from surface, evidence, finding class, and policy
- `evidence-keyring`: every fixture finding has a required key
- `protocol-spec`: every fixture can move through finding lifecycle states
- `repair-rollback-spec`: every mutable fixture has snapshot, rollback, and
  verification expectations
- `field-validation`: every fixture has an acceptance card before
  implementation
- `report-grammar`: every fixture can produce a human report with primary
  finding, stance summary, boundaries, and scan limits
- `policy-grammar`: every protected or allowed fixture explains the matching
  policy and effect

Spec gap questions:

- Which surfaces have no owner?
- Which findings have no trustworthy key?
- Which repair candidates have no rollback proof?
- Which cleanup plans depend on Claude checkpointing by mistake?
- Which fixture requires a live probe and therefore cannot be resolved in safe
  mode?
- Which finding appears tempting from path age/size/name but is blocked by
  surface classification?
- Which output would remain truthful if the user refuses every proposed action?

## 10. Research Gates Before Mutation

No mutation until:

- loader semantics matrix exists for supported Claude versions
- safe-mode isolation is proven
- secret redaction path is tested
- rollback class language is finalized
- performance budgets are enforced
- false positive taxonomy has field data
- sector boundaries are enforced before content reads
- Claude checkpointing is explicitly excluded as a rollback guarantee
- every mutable action has a manifest-backed rollback model
