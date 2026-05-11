# Release Readiness — claude-housekeeper v0.2.0 (drop the `-beta`)

Date: 2026-05-11. Author: release-readiness analyst.
Source tag under review: `v0.2.0-beta.1`. Phase 10 (broaden cleanable set) in flight.

---

## §1 — Executive summary

The release is closer to ready than the version number admits. The hard
guarantees (snapshot/rollback/verify, schema 0.2, lockfile, refusal taxonomy)
are landed, tested (358 tests on the matrix), and documented. What is missing
is everything *around* the engineering: the things a user reaches for when
they trust a `1.x`-shaped release, not when they tolerate a `0.2-beta`.

**Top 3 blockers to drop `-beta`:**

1. **No CHANGELOG.md.** A first mutation-capable release with no changelog and
   no v0.1→v0.2 migration guide is a documentation failure, not an engineering
   one. Users will not find rollback by reading commits.
2. **README oversells "current" state.** Lists the v0.2.0-beta detectors as
   shipped, but Phase 10's `housekeeper.stale_lock` and
   `registry.local_command_identical` are NOT cleanable yet — the README does
   not say which detectors are cleanable. Same for `docs/index.html` (the
   public site still tagged `v0.2.0-beta.1`).
3. **Compatibility matrix still has "unknown until tested" placeholders.**
   The matrix doc explicitly says: do not promote without recording the exact
   Claude Code version. v0.1.0 shipped, v0.2.0-beta.1 shipped, and the matrix
   still reads as if release was last week. WSL, Linux distros, Windows are
   all unknown.

**Top 3 nice-to-haves:**

A. Release-tagging automation (currently manual; CI runs `npm pack --dry-run`
   but doesn't tag, doesn't publish, doesn't generate notes).
B. A dogfood soak script for `~/.claude` (the user has presumably been
   dogfooding; nothing in `scripts/` makes that repeatable for others).
C. Plugin marketplace polish for the `/claude-housekeeper:housekeep` slash
   command discoverability (only one command at `commands/housekeep.md`).

---

## §2 — Critical gaps (must-fix before v0.2.0 GA)

Each gap: effort estimate (S = <1 day, M = 1–3 days, L = 3+ days), owner,
priority (P0 = blocker, P1 = strong recommend).

### G1. No CHANGELOG.md
**Evidence:** `ls CHANGELOG* MIGRATION*` → none. Git tag list shows `v0.1.0,
v0.1.1, v0.1.2, v0.2.0-alpha.1, v0.2.0-beta.1` — five releases, zero
changelog entries. Release notes live only in PRs and git log.
**Effort:** S. **Owner:** Claude. **Priority:** P0.
**Suggested shape:** Keep-a-Changelog format. Backfill v0.1.0 → v0.2.0-beta.1
from commit log + GitHub release pages. Anchor the snapshot/rollback contract
section in a top-level "Unreleased → 0.2.0" block.

### G2. No v0.1 → v0.2 migration guide
**Evidence:** v0.2 introduces three new concepts the v0.1 user has not seen:
operation manifests, snapshots, rollback. `docs/rollback-contracts.md §6`
defines legacy-manifest behavior but the user-facing migration story is
absent. README says "`clean --confirm --yes` … can remove one plugin cache
version" but does not explain what changed since v0.1.x or how to inspect /
roll back / abort.
**Effort:** S–M. **Owner:** Claude. **Priority:** P0.
**Suggested shape:** New `docs/migration-v0.1-to-v0.2.md`. Sections: what's
new (mutation, snapshots, rollback), nothing breaks (diagnose/plan/verify
behavior unchanged), legacy manifests (what happens if you had one),
`HOUSEKEEPER_SESSION_HOOK=off` semantics retained.

### G3. README does not name which detectors are cleanable
**Evidence:** README §"Current Checks" lists 20 detector ids without marking
cleanable vs not. README §"Command Surface" says
"`plugin.cache_unreferenced` (plugin cache versions OUTSIDE the 7-day grace
window) is cleanable in v0.2.0-beta. Everything else routes to `refused[]`
with a structured reason" — buried in body text. After Phase 10 lands,
`housekeeper.stale_lock` and `registry.local_command_identical` join the
cleanable set, and the per-detector cleanable/refused state needs to be a
table, not prose.
**Effort:** S. **Owner:** Claude (after Phase 10 lands). **Priority:** P0.

### G4. docs/index.html and `<a href=…v0.2.0-beta.1>` will lag the GA tag
**Evidence:** `docs/index.html:183-184` hardcodes the version string and tag
link. There is no CI step to bump it when tagging. At GA, this site will
either be stale or require a manual edit committed to main.
**Effort:** S. **Owner:** Claude. **Priority:** P0.
**Suggested shape:** Either (a) replace with a build-time substitution from
`package.json`, or (b) add a release checklist item and a test in
`test/readme.test.mjs`-style suite that asserts `docs/index.html` version
matches `package.json`.

### G5. Compatibility matrix promotion never happened
**Evidence:** `docs/compatibility-matrix.md` still reads "unknown until tag"
for Claude Code version. v0.2.0-beta.1 is tagged. The matrix says
"maintainer fills in the exact `claude --version` value at tag time" — that
process did not run for v0.1.0, v0.1.1, v0.1.2, v0.2.0-alpha.1, or
v0.2.0-beta.1.
**Effort:** S to backfill macOS row; M to add a real Linux entry. **Owner:**
user (Elad) — needs actual `claude --version` outputs. **Priority:** P0.
A v0.2.0 GA that ships without recording the Claude Code version tested
against undermines the doc's stated contract.

### G6. CI does not validate the Claude plugin manifest in any environment
**Evidence:** `.github/workflows/ci.yml` has `claude plugin validate` gated
on `command -v claude` — which is never true on GitHub-hosted runners. The
output is `SKIP claude plugin validate`. This means `.claude-plugin/plugin.json`
has never been validated in CI.
**Effort:** S–M. **Owner:** Codex/external (depends on whether `claude` is
installable on Linux runners). **Priority:** P1.
**Mitigation:** Add a JSON-schema test of plugin.json shape (commands array,
keywords, required fields) until `claude plugin validate` is available in CI.

### G7. Error messages lack a "next step" hint
**Evidence:** Sampled 13 refusal messages in `scripts/lib/clean-plan.mjs`.
Examples:
- `"Path X is a symbolic link; clean refuses symlinks"` — fine, but does
  not tell user what to do. Manually delete? Stop using the symlink?
- `"Detector X is not cleanable in v0.2.0"` — does not link to a roadmap
  or say "use rm if you accept the risk."
- `"Surface ownerClass is X; clean only acts on claude-managed or user-owned"`
  — uses internal vocabulary (`ownerClass`) that users have not seen.
- `"v0.2 cleans one finding per invocation; re-run clean to address this one"`
  — actually good (tells the user what to do).
The `nextAllowedStep` field IS used in audit findings (good). It is NOT
threaded through refusals.
**Effort:** M. **Owner:** Claude. **Priority:** P1.
**Suggested shape:** Add `nextStep: string` to each refusal in
`composeCleanPlan`. CLI renders it as "Next: …" under the refusal message.

### G8. No fixture for Plugin install from disk (vs marketplace)
**Evidence:** `ls fixtures/synthetic-homes/` shows 16 fixtures covering
broken hooks, candidate stale cache, duplicate scope, expected orphan,
interrupted operation, etc. No fixture for: plugin installed from a local
filesystem path (no marketplace metadata), plugin installed with a
non-standard `installSource`, plugin where `plugin.json` declares MCP server
but the binary is missing.
**Effort:** M. **Owner:** Claude. **Priority:** P1.
**Concrete missing fixtures:**
- `plugin-installed-from-disk/` — `installSource: "local"` and no marketplace
- `plugin-with-stale-mcp-server/` — `plugin.json` declares MCP server but
  binary path is dead
- `hooks-with-env-expansion/` — hook command uses `${HOME}/.bin/foo`
  (the README explicitly acknowledges this is a known limitation; a fixture
  would lock the behavior)
- `settings-json-comments/` — JSONC with `//` comments (Claude Code accepts
  these; does Housekeeper's parser?)
- `dual-scope-plugin-install/` — user-scope and project-scope plugin with
  same name (drift class the global CLAUDE.md describes as a recurring failure)

### G9. No documented performance bound for large homes
**Evidence:** `audit.mjs` exposes `DEFAULT_MAX_FILES` and `DEFAULT_MAX_BYTES`
budgets; CLI accepts `--max-files=`. No benchmark, no documented walltime
target. Question "what happens on a 10,000-file home?" is unanswered.
**Effort:** S to add a benchmark fixture and assertion. **Owner:** Claude.
**Priority:** P1.
**Suggested shape:** Add `fixtures/synthetic-homes/huge-home-degraded/` (it
exists, see ls output — but it's not exercised as a perf test). Add a
`scripts/bench.mjs` that runs diagnose against it and prints walltime;
document a target ("diagnose should complete in <2s on a 10k-file home; if
not, `home.scan_budget_hit` fires").

### G10. README "Example output" may not reflect current behavior
**Evidence:** README lines 100-134 hardcode a diagnose output block. Since
v0.2.0-beta adds `housekeeper.stale_lock` and `plugin.cache_referenced_by_hook`
detectors that ALWAYS run, a fresh diagnose on `clean-home` may now emit
different stance counts. `test/readme.test.mjs` exists — check whether it
verifies the README example matches actual fixture output. If not, the
example will drift silently.
**Effort:** S. **Owner:** Claude. **Priority:** P1.
**Action:** Re-run `node scripts/claude-housekeeper.mjs diagnose --safe
--scope=settings --home=fixtures/synthetic-homes/clean-home/home/` and
diff against README. Update or add a guard test.

### G11. Schema-stability doc lacks v0.2 manifest section
**Evidence:** `docs/schema-stability.md` covers only `schemaVersion: "0.1"`
(report shape). Operation manifest schema (`schemaVersion: "0.2"`) is pinned
in `docs/rollback-contracts.md §7` but not cross-referenced in the stability
doc. T-619 in TASKBOARD-v0.2.md was created exactly for this; it is `[ ]`
not `[x]`.
**Effort:** S. **Owner:** Claude. **Priority:** P0.
**Action:** Land T-619 before GA — add a "Stable Fields For `0.2`
(operation manifest)" section to `docs/schema-stability.md`.

### G12. No semver/breaking-change policy doc
**Evidence:** Nothing in `docs/` describes what counts as breaking after
v0.2.0. The rollback-contracts doc commits to "stable within v0.2 line"
but does not say what triggers a v0.3 vs v1.0. Refusal `class`/`reason`
strings, detector ids, manifest field names — what's locked and what's not?
**Effort:** S. **Owner:** Claude. **Priority:** P1.
**Suggested shape:** `docs/versioning-policy.md`: detector ids are stable
within a major (renaming = breaking); refusal `reason` strings are stable
within a major; report `schemaVersion` follows its own line; manifest
`schemaVersion` follows its own line; the bin name `claude-housekeeper`
is stable.

### G13. No signature/HMAC on operation manifests
**Evidence:** Operation manifests are plain JSON written to
`<home>/.claude/housekeeper/operations/`. If an attacker (or a buggy script)
writes a crafted manifest with `status: "applied"` and `files: []`, the
rollback flow will not detect tampering — it will refuse with a manifest
read but won't flag forgery. Same for `sha256Before` — if an attacker
modifies the manifest to claim a different hash, snapshot integrity is
weakened.
**Effort:** M. **Owner:** Claude or user (design call). **Priority:** P1.
**Counter-argument:** The threat model says "single-user local tooling."
A user who can write to `<home>/.claude/housekeeper/operations/` already
owns the home. So signature is defense-in-depth, not a v0.2 blocker — but
it deserves to be **documented as out-of-scope** in a threat-model doc, not
just left unaddressed. See G14.

### G14. No threat model doc for rollback flow
**Evidence:** `docs/team-governance-threat-model.md` exists but covers
governance, not rollback. No doc explains: what attacks does the snapshot
flow defend against? What attacks does it NOT defend against (e.g., the
malicious-manifest case in G13)? What is the trust boundary?
**Effort:** S. **Owner:** Claude. **Priority:** P1.

### G15. `clean --confirm --yes` re-runs full `assembleReport` but no timeout
**Evidence:** Q-USER-2 locked: `composeCleanPlan` re-runs `assembleReport`
for freshness (~100ms cost). On a large home, this cost is unbounded. A
user invoking `clean` from CI or a script could hang on a slow filesystem
(network mount, full disk). No `--timeout` or fallback.
**Effort:** S. **Owner:** Claude. **Priority:** P1.

### G16. `--abort` UX: only works on `snapshot_taken` / `planned`
**Evidence:** `claude-housekeeper.mjs:380` calls `abortRollbackOperation`
for `--abort`. The help text says "cancel a snapshot_taken operation and
delete its unused snapshot tree." But the interrupted-operation detector
fires on `applied` and `applied + partialApply: true` too — the user reads
"interrupted operation; run `rollback --abort <id>`" and the abort refuses
because the status is `applied`. The recovery hints (T-901) need to be
proven to map cleanly to actual abort/rollback eligibility for ALL
non-terminal statuses.
**Effort:** S to audit + S to fix any miswirings. **Owner:** Claude.
**Priority:** P1.
**Action:** Read `audit.mjs` interrupted-op hint generation and confirm
each status maps to a command that won't refuse.

---

## §3 — Nice-to-haves (post-GA OK, but plan)

### N1. Release-tagging automation
Currently: tag manually, write release notes in GitHub UI, no GitHub release
asset upload. CI does `npm pack --dry-run` but doesn't pack-on-tag.
**Suggested:** Add `.github/workflows/release.yml` triggered on tag push.
Steps: pack, attach tarball to release, run `claude plugin validate` if
available, post release notes from CHANGELOG section.

### N2. CHANGELOG-from-commits automation
After G1 ships, automate via `conventional-changelog` or similar so the
changelog updates on PR merge.

### N3. Soak-period dogfood script
A `scripts/soak.mjs` that runs diagnose + plan + verify against
`$CLAUDE_HOME` and a sample fixture set, logs results to `.omc/research/`,
prints a one-screen summary. Lets the user (and external testers) run a
repeatable soak.

### N4. `--target` ID validation against the cleanable set
Currently `--target=foo` is accepted by `parseArgs` and only fails at the
refusal classifier. A clearer error at parse time would be better UX.

### N5. Plugin marketplace listing prep
The plugin currently has ONE command (`/claude-housekeeper:housekeep`).
Marketplace expects: README polish, screenshot, plugin.json keywords
optimized for search. Current keywords are good but generic. Add a
`screenshot` directive if marketplace supports it.

### N6. Concurrency lockfile observability
Lockfile path is `<home>/.claude/housekeeper/lock` (30-min staleness). No
log of who held the lock when. Add a `<home>/.claude/housekeeper/lock.history`
append-only log for audit (one line per lock acquire/release).

### N7. `clean --confirm --yes` could print a one-line summary line at exit
Currently prints multi-line report. For scripting, a final
`DONE: 1 operation verified, op_id=…` line on stdout (separate from the
plan-mode block) makes piping easier.

### N8. Pre-commit hook for forbidden-language test in dev
`test/forbidden-language.test.mjs` exists. A pre-commit version would catch
"fix"/"clean up" language slipping into docs before CI.

### N9. README needs an "FAQ" section
Q: "Why does clean refuse my obvious orphan plugin?" → A: 7-day grace
window per Claude Code contract.
Q: "Can I undo a rollback?" → A: No; rollback is terminal. The snapshot is
retained for GC.
Q: "What if I lose `<home>/.claude/housekeeper/`?" → A: Operations history
is gone, but no live data is affected; clean refuses to operate without
snapshot proof.

### N10. Test/coverage badge in README
README currently has no badges. CI status, npm version (post-publish),
license badges are cheap signals of project maturity.

---

## §4 — Already in good shape (preserve)

- **Test count and matrix.** 358 tests, Ubuntu + macOS × Node 20 + 22.
  Test files cover audit, contracts, surface, stance, policy, redact,
  snapshot, snapshot-writer, clean-plan, rollback-plan, CLI, hooks,
  safe-mode, redaction, self-failure, schema-stability, fixtures, README,
  issue-templates, observe, forbidden-language. Comprehensive.
- **Refusal taxonomy.** 12-rule classifier in `composeCleanPlan` is
  documented in `clean-design.md §2`, implemented, tested. The taxonomy is
  the right shape — first-match-wins, structured exit codes.
- **Atomic write protocol.** write-temp + rename + fsync-parent. Documented,
  pinned, ships with the macOS-EINVAL pragma.
- **Schema stability for the report.** `schemaVersion: "0.1"` is documented
  and tested (`test/schema-stability.test.mjs`). The fact that the same
  pattern is documented but not yet applied to the manifest (G11) is the
  only gap.
- **The four-stance/eight-stance discipline.** Surface-first, evidence-
  second, action-last is consistently honored. Refusals carry
  `targetPath`, `class`, `reason`, `message`, `exitCode`. This is the
  single most important piece of v0.2 not to regress.
- **Issue templates.** Five issue templates in `.github/ISSUE_TEMPLATE/`
  (false-positive, loader-semantics, compatibility, damaged-environment,
  cleanup-request). Tested by `test/issue-templates.test.mjs`. Better than
  most v1 projects.
- **npm pack file list.** 19 files, 56KB tarball, 208KB unpacked. The
  `files` array in package.json correctly excludes `test/`, `docs/`,
  `fixtures/`, `notes/`. `.omc/`, `.git/`, `node_modules/` already in
  `.npmignore`. **Ready to publish.**
- **Recovery surface.** `--abort`, `--dry-run`, `--confirm --yes` flag set
  is clean. The reuse of `rollback <id>` for recovery (Q3) is correct.

---

## §5 — Recommendations for the soak period

A concrete script the user can run against their own `~/.claude` to gain
confidence before dropping `-beta`. Run nightly for 5–7 days; expect zero
unexpected refusals and zero unexpected mutations.

```bash
#!/usr/bin/env bash
# Save as scripts/soak.sh on a branch, run nightly.
# Expects: claude-housekeeper installed (or run via `node scripts/...mjs`)

set -euo pipefail
HOME_DIR="${CLAUDE_HOME:-$HOME/.claude}"
OUT_DIR=".omc/research/soak-$(date +%Y%m%d)"
mkdir -p "$OUT_DIR"

echo "=== 1. Diagnose (default) ==="
node scripts/claude-housekeeper.mjs diagnose --json > "$OUT_DIR/diagnose.json"

echo "=== 2. Diagnose (--safe --redact, share-safe) ==="
node scripts/claude-housekeeper.mjs diagnose --safe --redact > "$OUT_DIR/safe-redacted.txt"

echo "=== 3. Plan output for each scope ==="
for scope in settings plugins registry housekeeper; do
  node scripts/claude-housekeeper.mjs plan --scope=$scope > "$OUT_DIR/plan-$scope.txt" || true
done

echo "=== 4. Verify smoketest ==="
node scripts/claude-housekeeper.mjs verify > "$OUT_DIR/verify.txt" || true

echo "=== 5. Interrupted-op check (read-only) ==="
ls "$HOME_DIR/housekeeper/operations/"*.json 2>/dev/null | while read m; do
  jq -r '.id + " " + .status' "$m"
done > "$OUT_DIR/operations.txt" || true

echo "=== 6. Diff against yesterday ==="
YESTERDAY=$(date -v-1d +%Y%m%d 2>/dev/null || date -d "yesterday" +%Y%m%d)
if [ -d ".omc/research/soak-$YESTERDAY" ]; then
  diff ".omc/research/soak-$YESTERDAY/diagnose.json" "$OUT_DIR/diagnose.json" \
    > "$OUT_DIR/diff-from-yesterday.txt" || true
fi

echo "Soak complete. Results in $OUT_DIR"
```

**Pass criteria for dropping `-beta`:**

1. **Zero unexpected refusals across 7 nights.** Every refusal must trace to
   a documented reason in §2 of `docs/design/clean-design.md`.
2. **Zero `housekeeper.interrupted_operation` findings that were not user-
   initiated.** If a non-terminal manifest appears that the user didn't
   create, that is a bug.
3. **Diff from one night to the next should be ≤ stance-shuffle.** New
   findings only when the home actually changed.
4. **At least ONE end-to-end clean+rollback cycle** on a real plugin cache:
   - run `diagnose` → identify a `plugin.cache_unreferenced` finding
   - run `clean --confirm --yes --target=plugin.cache_unreferenced --path=<P>`
   - verify dir is gone, manifest is `verified`
   - run `rollback <op_id> --dry-run` (should show what would restore)
   - run `rollback <op_id> --confirm --yes` (should restore)
   - run `diagnose` again — the finding should re-fire
5. **At least ONE `--abort` cycle** on a `snapshot_taken` op (kill the
   process mid-clean, then `rollback --abort <id>`).
6. **Run against at least one other home** — Codex's home, a CI-built
   home, a fresh `claude` install. The matrix's "Linux unknown" row needs
   to be promoted to `supported` based on real evidence.

**Stop conditions during soak:**

- Any `filesChanged: true` in a non-mutation command (diagnose/plan/verify).
  That's a snapshot/rollback contract violation.
- Any manifest with `schemaVersion != "0.2"` that wasn't intentionally
  legacy-tested.
- Any refusal whose `message` field is empty or contains the literal
  string `undefined`.
- Any `op_*` id that does not match `op_[0-9]{14}_[0-9a-f]{8}`.

---

## §6 — Recommended GA cut order

1. (P0) Backfill CHANGELOG.md and write `docs/migration-v0.1-to-v0.2.md`.
2. (P0) Add detector-by-detector cleanable table to README. Update
   `docs/index.html` once the version-bump mechanism is decided (G4).
3. (P0) Update compatibility matrix with real Claude Code version. User
   action item.
4. (P0) Land T-619 (schema stability for manifest).
5. (P0) Finish Phase 10 (Phase 10 handoff already exists).
6. (P1) Add `nextStep` to refusal messages (G7).
7. (P1) Add the missing fixtures (G8) — especially dual-scope plugin install,
   which the global CLAUDE.md flags as a recurring failure pattern.
8. (P1) Add G15 timeout and G16 audit.
9. (P1) Write threat-model doc (G14) and versioning-policy doc (G12).
10. (P1) Run the §5 soak for 5–7 nights against the user's own `~/.claude`.
11. (Final) Tag `v0.2.0` (no -beta suffix). Update site. Optionally publish
    to npm (user has deferred — fine to defer further).

Approximate total effort: 2–4 focused days of doc work + soak time. The
engineering for v0.2 is done; what remains is the release shell.

---

## §7 — Out of scope for this analysis

- npm publishing — user has explicitly deferred. Confirm `files` list is
  correct (it is — §4) and move on.
- Marketplace listing — out of scope per the task framing.
- The pipeline-security scan another agent is running. Note its absence
  here is intentional.
- Phase 10 task details — covered by `notes/HANDOFF-PHASE-10.md`.
- v0.3 features (`harden --confirm`, learning loop, bulk ops). Not
  blockers for v0.2.0.
