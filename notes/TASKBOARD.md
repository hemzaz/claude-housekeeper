# Taskboard — Claude Housekeeper v0.1

Companion to `notes/PLAN.md`. Tasks are atomic, ordered by phase, each with a
single verify criterion. Mark `[x]` when complete; if a task expands, split
it into new T-IDs rather than overloading one.

Status legend: `[ ]` todo · `[~]` in progress · `[x]` done · `[!]` blocked

---

## Phase 0 — Vocabulary hygiene

- [ ] **T-001** Rename forbidden `proposedAction` values
  - File: `scripts/lib/audit.mjs`
  - Replace `"repair"` → `"none"`, `"quarantine"` → `"none"` in
    `issueMetadata()`. Keep the `protected`/`do-not-touch` path unchanged.
  - Verify: `grep -n '"repair"\|"quarantine"' scripts/lib/audit.mjs` returns
    nothing; existing tests still pass.

- [ ] **T-002** Drop "fix" verb from check actions
  - File: `scripts/lib/audit.mjs`
  - Replace `action: "fix settings.json"` and `action: "fix config"` with
    `action: "review"`.
  - Verify: `grep -n '"fix' scripts/lib/audit.mjs` returns nothing.

- [ ] **T-003** Add `HOUSEKEEPER REPORT` + `No files changed.` header to
  human output
  - File: `scripts/lib/audit.mjs` `formatScorecard()` and `formatPlan()`.
  - Prepend two lines to every output before any other section.
  - Verify: `node scripts/claude-housekeeper.mjs diagnose --home=fixtures/...`
    first two lines match exactly.

- [ ] **T-004** Add `filesChanged: false` and `schemaVersion: "0.1-pre"` to
  JSON output
  - Files: `scripts/lib/audit.mjs` `auditClaudeHome()` return shape.
  - Add at top level alongside existing fields.
  - Verify: `node scripts/claude-housekeeper.mjs diagnose --json | jq
    '.filesChanged, .schemaVersion'` returns `false` and `"0.1-pre"`.

- [ ] **T-005** Add a CI guard against mutation primitives in `scripts/`
  - File: new `scripts/format-check.mjs` rule, or new `test/no-mutation.test.mjs`.
  - Test: walk `scripts/`, fail if any file contains `unlinkSync`, `rmSync`,
    `writeFileSync`, `renameSync`, `mkdirSync`, `appendFileSync` outside
    explicit allow-list.
  - Verify: deliberately add `writeFileSync` to a script; test fails. Remove
    it; test passes.

---

## Phase 1 — Contract objects

- [ ] **T-101** Create `scripts/lib/contracts.mjs`
  - Exports: `makeSurfaceClassification`, `makeEvidenceSet`, `makeFinding`,
    `makeStance`, `makeReport`, `makePolicyMatch`, `makeScanLimit`.
  - Defaults match `docs/schemas.md`.
  - Verify: `test/contracts.test.mjs` round-trips each shape and asserts
    every required field is present with the documented default.

- [ ] **T-102** Create `scripts/lib/surface.mjs`
  - Exports: `classifySurface(path, hints) → SurfaceClassification` using
    the table in `docs/surface-classification-spec.md` §4.
  - Verify: `test/surface.test.mjs` covers each surface class with at least
    one positive + one negative case.

- [ ] **T-103** Create `scripts/lib/stance.mjs`
  - Exports: `decideStance({surface, evidence, missingKeys, policy, mode})
    → Stance`.
  - Decision order from `docs/decision-calculus.md` §4: protect → block →
    probe → review → prepare → repair → watch → inform.
  - Hard overrides from §5 implemented as early returns.
  - Verify: `test/stance.test.mjs` covers each row of the §6 stance matrix.

- [ ] **T-104** Wire policy loading into the new contract path
  - File: `scripts/lib/policy.mjs` (extracted from `audit.mjs`
    `loadConfig`/`normalizeProtectionRules`/`pathMatchesProtection`).
  - Returns `PolicyMatch[]` in the shape from `docs/schemas.md`.
  - Verify: `test/policy.test.mjs` proves matching, precedence, and
    `policyMatch.reason` propagation.

---

## Phase 2 — Stance-first audit pipeline

- [ ] **T-201** Write detector adapter shape
  - In `scripts/lib/audit.mjs`, change every `check*()` to return
    `{ surfaceHints, evidence, missingKeys, kind, hint }` (raw detector
    output) without computing severity/risk/action.
  - Verify: `test/audit.test.mjs` rewritten to assert this shape.

- [ ] **T-202** Build `assembleReport()`
  - New entry point in `scripts/lib/audit.mjs`. For each detector output:
    classify surface → fill evidence → run stance engine → produce
    `Finding`. Aggregate into `Report`.
  - Verify: returns a `Report` with all required fields per
    `docs/schemas.md` §1.

- [ ] **T-203** Build human report renderer
  - New file `scripts/lib/report.mjs`. Implements `docs/report-grammar.md`
    §1 default shape: PRIMARY / STANCE SUMMARY / BOUNDARIES / SCAN, plus
    BLOCKED, PROTECTED, MISSING KEY, SCAN DEGRADED sections when relevant.
  - Primary finding selection follows §2 priority list.
  - Verify: render the `clean-home` fixture and byte-compare to
    `docs/golden-reports.md` §1.

- [ ] **T-204** Build JSON report renderer
  - In `scripts/lib/report.mjs`. Stable fields per
    `docs/operational-readiness.md` §8.
  - Verify: `--json` output validates against a schema test that pins each
    stable field's type.

- [ ] **T-205** Detector id remap (per PLAN §3 Phase 2 table)
  - Apply the renames listed in the plan. Update tests.
  - Verify: `node scripts/claude-housekeeper.mjs diagnose --json | jq
    '.findings[].id'` returns only ids from the new list.

- [ ] **T-205a** Split `plugin.stale_versions` into two findings
  - File: `scripts/lib/audit.mjs`. Replace the single detector with logic
    that emits `plugin.expected_orphan` (stance `watch`) when the version
    directory's mtime is within the documented ~7-day grace window, and
    `plugin.cache_unreferenced` (stance `probe`) when it is outside.
  - Constants: grace window in days (default 7) sourced from
    `docs/loader-semantics.md` §2.
  - Verify: fixtures `expected-orphan-cache` and `candidate-stale-cache`
    each emit only their own id, with the spec'd stance and missing keys.

- [ ] **T-208** Add `housekeeper.interrupted_operation` detector
  - Scan `<home>/.claude/housekeeper/operations/*.json`. If any manifest
    exists with status not in {`verified`}, emit a single
    `housekeeper.interrupted_operation` finding with stance `block`.
  - Surface: `housekeeper-owned`, `manifest-backed`, `in-scope`.
  - Required by `operational-readiness.md` §4, `protocol-contracts.md` §17,
    and golden report #10. Even though v0.1 has no mutation, the detector
    path stub guards against future incomplete operations.
  - Verify: fixture `interrupted-housekeeper-operation` emits one finding
    with `stance: block` and the report renders golden #10's `BLOCKED`
    section.

- [ ] **T-209** Add `mode` field to JSON output (default `"diagnose"`)
  - File: `scripts/lib/report.mjs` (or `audit.mjs` until renderer lands).
    JSON `mode` is `"safe"` under `--safe` and `"diagnose"` otherwise. The
    field is `stable` per `docs/schema-stability.md`.
  - Verify: `node scripts/claude-housekeeper.mjs diagnose --json | jq .mode`
    returns `"diagnose"`; same with `--safe` returns `"safe"`.

- [ ] **T-210** Truth-probe payload for "next step" recommendations
  - When a finding's `nextAllowedStep` references a live probe (e.g.
    `/hooks`, `claude --debug hooks`), attach the probe's metadata from
    `docs/truth-probe-catalog.md` §"Catalog" — `class`, `mayExecute`,
    `consent` — into a `proposedProbe` object on the finding.
  - Verify: `broken-hook-shell-ambiguous` JSON contains
    `findings[0].proposedProbe.class == "behavioral"` and
    `proposedProbe.consent == "high"`.

- [ ] **T-206** Rewrite `formatPlan()` as plan-mode rendering
  - Plan output uses the same renderer but in `mode: "plan"`, listing
    findings with their `nextAllowedStep` and `blockedActions`. No
    "destructive actions require…" boilerplate; that's covered by stance
    language now.
  - Verify: plan output for `broken-hook-simple` fixture lists `patch
    preview` as next step.

- [ ] **T-207** Update CLI dispatcher
  - File: `scripts/claude-housekeeper.mjs`. Pass `mode` ("diagnose" |
    "plan" | "safe") through to `assembleReport()`.
  - Verify: `--scope=settings` still works; `--config=` still works;
    `--home=` still works; `verify` is unchanged for now.

---

## Phase 3 — Fixtures, cards, goldens

- [ ] **T-301** Build `fixtures/synthetic-homes/clean-home/`
  - `home/.claude/settings.json` (valid empty hooks), parsed plugin
    registry, no orphans.
  - `card.yaml`, `report.txt`, `report.json` matching
    `docs/golden-reports.md` §1.

- [ ] **T-302** Build `broken-hook-simple` fixture (acceptance card §1)
  - Settings hook references absolute path that does not exist.
  - Goldens match `docs/golden-reports.md` §2.

- [ ] **T-303** Build `broken-hook-shell-ambiguous` fixture (card §2)
  - Hook command embeds plugin-cache-looking path inside shell syntax
    (e.g. `"$HOOK"`, command substitution).
  - Goldens match §3.

- [ ] **T-304** Build `expected-orphan-cache` fixture (card §3)
  - Plugin cache dir not in registry but inside grace period (mtime within
    7 days). Goldens match §4.

- [ ] **T-305** Build `candidate-stale-cache` fixture (card §4)
  - Plugin cache dir not in registry, mtime well outside grace window.
    Goldens match §5.

- [ ] **T-306** Build `protected-secret-path` fixture (card §5)
  - `.env` near home, `doNotTouch` rule covering it. Goldens match §6.
  - Also exercise `surface-classification-spec.md` §7 inheritance:
    parent boundary `~/secrets/**` causing `~/secrets/notes.md` to be
    excluded, AND child boundary `~/.claude/credentials/**` blocking
    recursive inspection of `~/.claude/`. Card asserts both directions
    appear in the report's `BOUNDARIES` section with the expected
    `parent-contains-boundary` / `sector-boundary` axes.

- [ ] **T-307** Build `checkpoint-only-rollback` fixture (card §6)
  - Plan-mode fixture: no Housekeeper manifest, only a synthetic
    "checkpoint exists" hint (a marker file). Goldens match §9.

- [ ] **T-308** Build `invalid-settings` fixture (card §7)
  - Malformed JSON in `settings.json`. Goldens match §7.

- [ ] **T-309** Build `huge-home-degraded` fixture (card §8)
  - Many small files under `~/.claude/projects/` to exceed scan budget.
    Goldens match §8.

- [ ] **T-310** Write `test/fixtures.test.mjs`
  - Walk `fixtures/synthetic-homes/`, parse each `card.yaml`, run
    `auditClaudeHome` on the home, assert: `finding.stance`,
    `finding.surface`, missing keys, blocked actions, and that the
    rendered report matches `report.txt` section-by-section.

- [ ] **T-311** Write `test/forbidden-language.test.mjs`
  - Render every fixture's report (human + JSON values, not keys) and
    assert no occurrence of the canonical phrase list, sourced from:
    - `docs/decision-calculus.md` §11
    - `docs/report-grammar.md` §8
    - `docs/vocabulary.md` §3
    - `docs/repair-rollback-spec.md` §8
    - `docs/loader-semantics.md` §10
  - Phrases (case-insensitive substring match, in field VALUES not
    field NAMES so e.g. `"stance":"inform"` keys stay legal):
    `safe to delete`, `safe cleanup`, `trash`, `junk`,
    `deletion-ready`, `obviously unused`, `definitely unused`,
    `auto-fix`, `guaranteed rollback`, `rollback guaranteed`,
    `optimized`, `clean bill of health`, `fixed everything`,
    `clean .claude`, `unused` (when not preceded by "not referenced",
    "candidate", or "may be"), `healthy` (when not preceded by
    "after verification" or "live probe").
  - Negative test: a benign report containing "safe step" or "safe
    mode" must pass. Word "safe" alone is allowed; phrase "safe to
    delete" is not.

- [ ] **T-312** Migrate `test/audit.test.mjs` cases to fixtures
  - Move the four existing tmpdir tests into named fixtures and delete
    the inline construction.
  - Verify: `test/audit.test.mjs` is either removed or only contains
    contract-level tests not covered by fixtures.

- [ ] **T-313** Build `interrupted-housekeeper-operation` fixture
  - `home/.claude/housekeeper/operations/op_001.json` with
    `{"status": "applying"}` and no completion record.
  - `card.yaml` stance: `block`. Surface: `housekeeper-owned`,
    `manifest-backed`. Goldens match `docs/golden-reports.md` §10.

- [ ] **T-314** Build `symlinked-home` fixture
  - `home/.claude/commands/local-build.md` is a symlink to a path
    outside the simulated home root.
  - `card.yaml` stance: `review` or `block` (per fixture-matrix). Asserts
    Housekeeper does not dereference by default.
  - Verify: report's `BOUNDARIES` notes "symlink not traversed".

- [ ] **T-315** Build `duplicate-scope-plugin` fixture
  - Same plugin name registered in user-scope `~/.claude/settings.json`
    and project-scope `.claude/settings.json`.
  - `card.yaml` stance: `review`. Finding id: `plugin.duplicate_registration`.
  - Verify: finding lists both source paths and explains precedence per
    `docs/loader-semantics.md` §1.

- [ ] **T-316** Build `local-shadow-identical` fixture
  - Local command `~/.claude/commands/foo.md` byte-identical to
    plugin-provided `commands/foo.md`.
  - `card.yaml` stance: `review` (`prepare` only with rollback proof per
    `docs/protocol-contracts.md` "Local Shadow"). Finding id:
    `registry.local_command_identical`.

- [ ] **T-317** Build `local-shadow-diverged` fixture
  - Local command file with same name as a plugin-provided one but
    different bytes.
  - `card.yaml` stance: `review`. Finding id:
    `registry.local_command_diverged`. Asserts the report does not
    suggest overwriting local edits.

- [ ] **T-318** Build `mcp-command-missing` fixture
  - `~/.claude/.mcp.json` references an absolute command path that does
    not exist.
  - `card.yaml` stance: `prepare` (or `probe` if path includes shell
    expansion). Finding id: `settings.mcp_command_missing`. Verify safe
    mode does NOT start the server.

- [ ] **T-319** Build `secret-command-fragment` fixture
  - Hook command string contains `ANTHROPIC_API_KEY=sk-...` or similar
    token-like fragment.
  - `card.yaml` stance: `protect`. Verify the rendered report redacts the
    token per `docs/redaction-examples.md` "Command Strings". Goldens
    must show `<redacted>`, not the raw token.

---

## Phase 4 — Operational readiness

- [ ] **T-401** Implement `--safe` flag
  - Files: `scripts/claude-housekeeper.mjs` (parse), `scripts/lib/audit.mjs`
    (mode pass-through). Safe mode disables MCP-command absolute-path
    follows and any traversal under sector-boundary paths beyond
    metadata.
  - Report shows `mode: safe` in SCAN section.
  - Verify: new fixture-card flag `safe_mode_expectations` checked.

- [ ] **T-402** Implement scan budgets
  - `maxFiles` (default 5000), `maxBytes` (default per-file 1 MiB read
    cap), `maxWallMs` (default 5000ms).
  - On exceed: stop traversal of that subtree; record in
    `report.degraded[]`.
  - Verify: `huge-home-degraded` fixture triggers degraded SCAN section.

- [ ] **T-403** Replace `verify` subagent dispatch stub
  - File: `scripts/claude-housekeeper.mjs` `runVerify()`. Replace the
    hardcoded `FAIL Not implemented` final probe with a clear
    `SKIP subagent dispatch (not implemented in v0.1)` line that does not
    set non-zero exit.
  - Verify: `verify` returns exit 0 on a healthy Claude install.

- [ ] **T-404** Align `docs/schema-stability.md` with shipped JSON
  - File already exists with the stable-field table. Confirm every field
    listed there is actually emitted by the renderer in T-204; add or
    remove rows so the doc and code agree exactly. Add README link.
  - Verify: a test reads the markdown table, runs the renderer on
    `clean-home`, and asserts every `stable` field is present.

- [ ] **T-405** Populate `docs/compatibility-matrix.md` first row
  - macOS (current maintainer version), Claude Code version (record from
    `claude --version` at release time), Node LTS (from CI matrix).
  - Verify: README links to the matrix; matrix has at least one
    `supported` row.

- [ ] **T-406** Add issue templates
  - New: `.github/ISSUE_TEMPLATE/damaged-environment.md`,
    `.github/ISSUE_TEMPLATE/loader-semantics.md`,
    `.github/ISSUE_TEMPLATE/compatibility-report.md`. Templates ask for
    the redacted JSON report, Housekeeper version, Claude version, OS,
    Node, operation id (always `none` in v0.1). Bodies follow the
    schemas in `docs/support-issue-templates.md`.
  - `release-blockers.md` "Public Support Blockers" lists all three.
  - Verify: `gh issue create --template damaged-environment.md` surfaces
    correctly; same for the other two.

- [ ] **T-408** Implement `--redact` privacy mode
  - File: `scripts/lib/report.mjs`. Apply the rules from
    `docs/redaction-examples.md`: replace home-prefix with `~`, project
    paths with `<project>`, env-var values matching token-like patterns
    (`sk-`, `ghp_`, `Bearer `, `=*<32+ alnum>$`) with `<redacted>`,
    URI passwords with `<redacted>`. Apply to both human and JSON
    output when `--redact` is set.
  - Apply automatically to anything classified
    `sensitivityClass: secret-adjacent` or `secret-content`.
  - Verify: `test/redaction.test.mjs` runs the renderer over the
    `secret-command-fragment` fixture and asserts none of the raw
    token strings appear in stdout/JSON. Negative: a finding without
    sensitive content renders unchanged.

- [ ] **T-411** Revise `docs/loader-semantics.md` after audit drift
  - File: `docs/loader-semantics.md`. Apply the four CHANGED items from
    `notes/LOADER-SEMANTICS-AUDIT.md`:
    1. §6 MCP duplicate matching: split into per-source key (name for
       Local/Project/User, endpoint for Plugin/connector).
    2. §4 update source URL `slash-commands` → `skills`.
    3. §7 marketplace source-type enum: replace loose list with the
       documented `github`/`url`/`git-subdir`/`npm` set.
    4. §7 `strictKnownMarketplaces`: demote to NOW_UNKNOWN, cite the
       missing URL `/en/plugin-marketplaces`, recommend probe before
       building any policy detector that depends on it.
  - Verify: re-running the loader-semantics audit (same prompt) returns
    drift summary STILL_ACCURATE 11+ / CHANGED 0 (or one item that
    changed since the last audit, whichever is smaller).

- [ ] **T-409** Self-failure read-only degradation
  - File: `scripts/lib/policy.mjs` and `scripts/lib/audit.mjs`. If
    Housekeeper config (`config.json` / `housekeeper.json`) is invalid
    JSON, emit a `housekeeper.config_invalid` finding with stance
    `inform`, fall back to defaults, and continue read-only diagnosis.
    Do NOT crash. If `~/.claude/housekeeper/operations/` exists but
    cannot be read, emit `inform` plus add a `degraded` entry.
  - Required by `docs/operational-readiness.md` §4 ("read-only mode must
    degrade around Housekeeper self-failure instead of crashing").
  - Verify: a fixture with corrupt `housekeeper.json` produces a report
    that still exits 0, lists the degradation, and does not hide other
    findings.

- [ ] **T-407** README + slash-command doc alignment
  - Update README's "Current Checks" list to use the new finding ids.
  - Update `commands/housekeep.md` argument hint to drop `clean`,
    `harden`, `rollback` from the suggested first-line set (keep them
    documented as refusing).
  - Verify: a stranger reading README and the slash-command help sees
    matching language.

---

## Phase 5 — Release prep

- [ ] **T-501** CI matrix
  - File: `.github/workflows/ci.yml`. Run on Node LTS + latest, on
    `ubuntu-latest` + `macos-latest`. Steps: install, `npm test`,
    `npm run lint`, `npm run format`, `npm pack --dry-run`.
  - Verify: PR shows green checks across the matrix.

- [ ] **T-502** Plugin manifest validation in CI (conditional)
  - Step that runs `claude plugin validate .claude-plugin/plugin.json`
    only if `claude` is on the PATH; otherwise skip with a clear log.
  - Verify: CI job logs show the conditional outcome explicitly.

- [ ] **T-503** README example freshness test
  - `test/readme.test.mjs` runs `diagnose` on `clean-home` and asserts
    the README's example block matches the rendered report
    section-by-section.
  - Verify: editing README without updating fixture (or vice versa)
    fails CI.

- [ ] **T-504** GitHub Pages from `docs/`
  - Confirm `docs/index.html` reflects the new vocabulary (no
    "scorecard", no "fix"). Update any site copy that overshoots the
    wedge.
  - Verify: Pages preview renders; no broken links to docs that don't
    exist.

- [ ] **T-505** Walk through `docs/launch-checklist.md`
  - For each bullet, link to the closing artifact (test, doc, or commit).
  - Verify: every "Required Before Public Announcement" item is checked
    or has an explicit waiver in `docs/readiness-gap-ledger.md`.

- [ ] **T-506** Tag `v0.1.0`
  - Only after T-505 is fully checked.
  - Verify: `git tag v0.1.0` + push; release notes match
    `docs/launch-checklist.md` "Suggested First Release Notes".

- [ ] **T-507** Bump `schemaVersion` from `"0.1-pre"` to `"0.1"` at tag
  - File: `scripts/lib/audit.mjs` (or `report.mjs` once renderer lands).
    Sole change: the literal string `"0.1-pre"` becomes `"0.1"`.
  - Per `docs/schemas.md` §1 + `docs/schema-stability.md`. Pre-release
    builds keep `0.1-pre`; the tag commit is the only place this flips.
  - Verify: a release-prep test asserts the constant equals `"0.1"`
    before allowing `git tag v0.1.0`. CI dry-run before T-506.

- [ ] **T-508** README out-of-band invocation path
  - File: `README.md`. Add (or confirm) a "Recovery: when Claude itself
    is broken" section showing at least one standalone invocation that
    does not depend on Claude plugin loading, e.g.
    `npx claude-housekeeper diagnose --safe` or local
    `node ./scripts/claude-housekeeper.mjs diagnose --safe`.
  - Required by `docs/operational-readiness.md` §3 (Distribution and
    Recovery Layer).
  - Verify: README contains the literal command; site copy
    (`docs/index.html`) repeats it.

---

## Cross-cutting (not blocking a specific phase)

- [ ] **T-X01** Decide on plugin slash command name (open question #2 in plan)
- [ ] **T-X02** Decide on `--safe` semantics (open question #4 in plan)
- [ ] **T-X03** Confirm repo target `hemzaz/claude-housekeeper` (#3)
- [ ] **T-X04** Confirm `disable-model-invocation: true` on slash command (#5)
- [ ] **T-X05** Decide v0.1 scope for `housekeeper.interrupted_operation`
  - Even before v0.1 has any mutation, do we ship the read-only detector
    so the path is exercised, or wait until v0.4 (Snapshot And Quarantine)?
    Recommendation: ship now per `operational-readiness.md` §4 — the
    detector is cheap, the fixture and golden already exist (§10), and
    a stub guarantees future mutation cannot run with stale manifests.
- [ ] **T-X06** Pin the grace-period constant
  - `loader-semantics.md` says "about 7 days" for plugin orphan retention.
    Code should pin a single constant `PLUGIN_ORPHAN_GRACE_DAYS = 7` and
    cite the doc. Decide: is this user-configurable via policy, or fixed
    until Claude documents a different value? Recommendation: fixed in
    v0.1; surface as policy in v0.2 if real homes show false positives.
- [ ] **T-X07** Confirm forbidden-language test scope (PLAN §6A item 11)
  - The list spans five spec docs and contains words ("safe", "healthy")
    that are valid in some contexts. Confirm phrase-level matching
    (T-311) is the right choice over word-level. Risk: new spec docs
    could add phrases without anyone updating the test.

- [ ] **T-X08** Resolve `repair` stance v0.1 degradation rule
  - Surfaced by PR #3 (Architect, Q2). The kernel's Evidence Gate
    forbids `repair` without reversibility keys, which v0.1 cannot
    produce (no Housekeeper rollback infrastructure ships in v0.1).
    `docs/decision-calculus.md` does not state a v0.1-only degradation
    rule explicitly. Decision: in v0.1, the `repair` stance must NEVER
    appear in any rendered report or finding. Document this in
    `docs/decision-calculus.md` (new section) and add an assertion in
    `test/stance.test.mjs` that mode-`safe` and mode-`diagnose` cannot
    return `repair`.
  - Verify: stance test asserts `repair` is unreachable in v0.1 modes.

- [ ] **T-X09** Reconcile `protected-secret-path` fixture vs golden #6
  - Surfaced by PR #5 (TDD guide, finding #1). Card #5 specifies a
    fixture mounting `.env` and `~/.claude/credentials/`. Golden report
    #6 shows `~/.claude/commands/local-build.md` as the protected path
    — a different example (local command shadow), not secret-adjacent.
    These describe two distinct fixtures sharing one name.
  - Decision: the card is canonical (matches fixture-matrix description
    "secret-adjacent paths"). Update `docs/golden-reports.md` §6 to use
    the `.env`/credentials example to match card #5 and the actual
    fixture in `fixtures/synthetic-homes/protected-secret-path/`.
  - Verify: fixture's `report.txt` becomes byte-identical to the
    revised golden #6.

- [ ] **T-X10** Update card #7 (invalid-settings) to include secondary block
  - Surfaced by PR #5 (TDD guide, finding #2). Card #7 lists only
    stance `prepare`. Golden #7 STANCE SUMMARY shows both `prepare: 1`
    and `block: 1`. Per `docs/protocol-contracts.md` "Invalid Settings"
    Edge Case 10: stance is `prepare` for the parse repair AND `block`
    for dependent inference. Card under-specifies.
  - Decision: extend card #7 in `docs/acceptance-cards.md` to declare
    BOTH findings — primary `settings.invalid_json` (stance `prepare`)
    AND secondary `settings.dependent_inference_blocked` (stance
    `block`). Update fixture `invalid-settings/report.json` to emit
    both.
  - Verify: golden #7 STANCE SUMMARY counts match the card and fixture.

- [ ] **T-X11** Confirm `implementation-blueprint.md` §3 module list
  - Surfaced by PR #3 (Architect, Q1). The blueprint lists 10 modules
    but the codebase needs `contracts.mjs` (data factories, not in the
    list) and `audit.mjs` (orchestrator, not in the list). The
    Architect treated both as "off-list infrastructure" but the spec
    should be explicit.
  - Decision: extend `docs/implementation-blueprint.md` §3 to list 12
    modules (add `contracts` and `audit`), or annotate the existing 10
    with a note that infrastructure modules are implied. Either is
    fine; pick the less invasive edit.
  - Verify: `notes/MODULE-BOUNDARIES.md` and the spec agree.

- [ ] **T-X12** Pin JSON `mode` default contract
  - Surfaced by Architect (Q3) and earlier traceability C3. Goldens in
    `docs/golden-reports.md` show `mode: safe` because they describe
    safe-mode invocations; T-209 specified default `mode: "diagnose"`
    for normal runs. These are reconcilable — the goldens declare the
    fixture's invocation mode; the runtime default is `diagnose` only
    when no flag is passed.
  - Decision: write a one-paragraph contract in `docs/schema-stability.md`
    pinning that JSON `mode` is REQUIRED, takes the active runtime mode
    (`safe` / `diagnose` / `live`), and goldens MUST declare the mode
    they were captured under in their fixture's `card.yaml`.
  - Verify: contract appears in `docs/schema-stability.md`; T-203
    byte-compares cite the per-fixture mode rather than assume one
    default.

---

## Definition of done for the board

The board is "done" when all Phase 0–5 tasks are `[x]` and `git tag v0.1.0`
is pushed. After that, drafting v0.2 (knowledge and boundaries) opens a new
board.

## How to use this board across sessions

1. Read `notes/PLAN.md` first if returning cold.
2. Pick the lowest-numbered `[ ]` task in the lowest-numbered open phase.
3. Read its verify criterion before starting; it's the success contract.
4. When done, mark `[x]` and update PLAN.md only if the phase's exit
   conditions changed.
5. New work that emerges mid-task → new T-ID, don't expand an existing one.
