# Tie-Breaker — `clean --confirm --yes` for v0.2.0 (T-704)

**Author:** independent tie-breaker (no peer voice; not a fourth memo)
**Companion memos under review:**
- `docs/design/clean-architecture-memo.md` (architect, PR #44, unmerged at write time, ~1247 lines)
- `docs/design/clean-product-memo.md` (product, merged #43, ~1058 lines)
- `docs/design/clean-claude-code-memo.md` (platform, merged #42, ~1013 lines)
**Posture:** binding ruling per disagreement. Cited to source. Not diplomatic.
**Materially-wrong calls made:** one (product memo §1 / §5 / Appendix A on detector identity).

---

## How to read this document

Section 1 enumerates every cross-memo disagreement I found. Section 2 issues
one ruling per conflict and names the implementation consequence. Section 3
records the empirical verifications I ran against the code in `scripts/lib/`
and the source-of-truth docs in `docs/`. Section 4 collapses all rulings
into a single buildable spec paragraph for v0.2.0 T-704. Section 5 lists
three questions the synthesizer must escalate to the user — they are
product preferences that no source can decide.

I read all three memos in full plus `docs/loader-semantics.md`,
`docs/snapshot-architecture.md`, `docs/rollback-contracts.md`,
`notes/PLAN-v0.2.md`, and the relevant ranges of `scripts/lib/audit.mjs` and
`scripts/lib/snapshot.mjs`. Citations below are file:line where they
exist in code, and section anchors where they are doc-shaped.

---

## Section 1 — Conflicts identified

### Conflict 1 (= dispatcher A) — Which detector ships as v0.2.0 cleanable

**Product memo, Appendix A (line 1053):**
> "Ship cleanable in v0.2.0: exactly one detector, `plugin.expected_orphan`."

Product memo §5 (line 539) classifies `plugin.expected_orphan` as **YES**
cleanable and `plugin.cache_unreferenced` as **no (v0.3)**.

**Architect memo §2.1 (line 420):**
> "v0.2.0 ships exactly one cleanable detector: `plugin.cache_unreferenced`."

Architect §2 table row (line 410) explicitly classifies
`plugin.expected_orphan` as REFUSE with reason `stance-not-prepare`.

**Claude Code memo §1.1 P4 (line 41):**
> "If target is a plugin cache version dir, it must be reported as
> `plugin.cache_unreferenced` (outside the documented grace window) — never
> `plugin.expected_orphan`."

Claude Code §8.2 R2 (line 562) makes `plugin.expected_orphan` a **hard
refusal category** ("within grace window"). The same memo §2.1 matrix row
(line 87) marks the in-grace deletion case `n/a — refused by P4`.

**Source of truth:** `scripts/lib/audit.mjs`:511-547.
- Line 511: `detectPluginExpectedOrphan` filters `entry.withinGrace === true`.
- Line 522: `summary: "old plugin cache version appears to be an expected orphan"`.
- Line 523: `nextAllowedStep: "no action now"`.
- Line 524: **`blockedActions: ["call unused", "quarantine", "delete"]`**.
- Line 528: `detectPluginCacheUnreferenced` filters `entry.withinGrace === false`.
- Line 545: `nextAllowedStep: "run freshness probe or review manually"`.
- Line 556-557: `ageMs > PLUGIN_ORPHAN_GRACE_MS` ⇒ `withinGrace: false`.
- Line 31: `PLUGIN_ORPHAN_GRACE_DAYS = 7`.

**The disagreement in one sentence:** the product memo names the in-grace
detector (the one whose own `blockedActions` field forbids deletion) as the
v0.2.0 cleanable target; the architect and platform memos name the
post-grace detector. Two of three memos agree, and the source code agrees
with those two.

### Conflict 2 (= dispatcher B) — `mutationOp` representation

**Architect memo §0 (line 50) and §1.4 (lines 256-312):**
> "`mutationOp` is an inert *descriptor* (`{ kind, args }`), not a function
> reference. The `apply()` callable that `applyOperation()` receives is
> materialised at `executeCleanPlan()` time by a registry keyed on
> `mutationKind`."

The architect lists three reasons (§1.4 lines 269-283): not serialisable,
not loggable into `consentSummary`, not auditable in tests.

**Product memo:** silent. The CLI transcripts (§3) name targets and paths
but do not address how the mutation is represented internally.

**Claude Code memo:** silent on representation. Implicitly assumes "the
mutation engine" exists (§0, §1.3) and lists preconditions (§1.1) and
post-conditions (§1.2) on it, but does not constrain its in-memory shape.

**Source of truth:** `scripts/lib/snapshot.mjs:534-575` —
`applyOperation(id, home, ops)` accepts an `ops` array where `ops[i].apply`
is called as a function (line 556: `await ops[i].apply(entry.originalPath)`).
The function reference is the *integration seam*, not a contract about
where the descriptor lives upstream.

`docs/rollback-contracts.md:124` requires `consentSummary` to be
"Non-empty human-readable consent record" — i.e., a string. To produce a
string consent record before the function runs, the upstream layer needs a
description that is not the function itself.

**The disagreement in one sentence:** only the architect addressed this;
the other two memos are silent. There is no actual disagreement, but the
synthesizer needs a ruling because the platform memo's §1.3 invariant
("If P1–P8 and Q1–Q5 all hold, the architect's mutation engine has met
its contract") presupposes a contract the platform memo did not specify.

### Conflict 3 (= dispatcher C) — Verb name, and `--confirm` + `--yes`

**Product memo §6.1 (line 634):**
> "Recommendation: keep `clean` for v0.2.0. Consider rename in v0.3."

Product §6.2 (line 676): "keep `--confirm --yes`."

**Architect memo §10 (line 1202-1206):**
> "The CLI gate order (`--confirm` then `--yes` vs. `--confirm-and-yes`).
> Already shipped in #40. This memo treats the gate as a precondition."

I.e., the architect treats the verb and flag pair as decided upstream.

**Claude Code memo:** silent on verb. Silent on flag count. References
`clean --confirm --yes` throughout (memo title, §1.2 Q3, §2.1 matrix, §3.1
RELOAD HINT, §11 ship rules) — i.e., assumes the established pair.

**Source of truth:** `commands/housekeep.md` argument hint uses `clean`,
PR #40 shipped `--confirm` and `--yes`, `notes/PLAN-v0.2.md` Decision Log
row Q1 (line 125) locked the two-flag design on 2026-05-11.

**The disagreement in one sentence:** there is no live disagreement; the
verb and flag shape are settled by prior decisions (#40 and Q1) and only
the product memo re-litigates the verb question, ultimately landing on
"keep". The synthesizer's job here is to record "ratified, no rename" and
move on.

### Conflict 4 — Refusal taxonomy: gaps and overlap

**Architect memo §5 (lines 856-890):** 14 refusal categories with explicit
error classes and exit codes. Includes `policy-protected-path`,
`policy-sector-boundary`, `policy-out-of-scope`, `stance-not-prepare`,
`execution-class-not-inert`, `missing-evidence-key`,
`rollback-class-checkpoint-only`, `rollback-class-irreversible`,
`unknown-owner`, `out-of-scope`, `no-mutation-mapping-in-v0.2`,
`budget-would-exceed-per-op`, `budget-would-exceed-aggregate`,
`plan-state-error`.

**Claude Code memo §8 (lines 536-649):** 5 categories with refusal IDs
R1-R5. `R1` active plugin version, `R2` cache inside grace window, `R3`
settings edits, `R4` project-level `.mcp.json`, `R5` local skill/command
path. §10.3 adds `plugin.symlinked_cache`. §10.5 adds
`plugin.cache_referenced_by_hook` as a NEW finding id.

**Product memo §7 (lines 712-820):** 5 user-facing scenarios with refusal
*text*, not refusal *taxonomy*. They map to: missing `--yes`, protected
path, not-cleanable detector, finding-not-present, budget-exceeded.

**Overlap analysis:**
- Architect's `policy-protected-path` ⊇ Claude Code's R4
  (`.mcp.json` is a sector-boundary class of protection) and partially R5
  (local skill/command).
- Architect's `plan-state-error` ⊇ "interrupted operation exists"; Claude
  Code's §6.5 invariant ("detector must not auto-fire mutation") is the
  same gate.
- Architect's `stance-not-prepare` is the catch-all that absorbs
  `plugin.expected_orphan` (stance `watch`); Claude Code expresses the
  same fact via R2 ("within grace window"). They are isomorphic for the
  shipping detector.
- Claude Code's `plugin.symlinked_cache` (§10.3) and
  `plugin.cache_referenced_by_hook` (§10.5) are NEW finding identities
  the architect did not enumerate.

**The disagreement in one sentence:** the architect provides the
*taxonomy* (how refusals are classified internally); the platform memo
provides the *platform-specific refusal facts* (which categories
v0.2.0 must include for safety); both can coexist, and there are two
platform-required refusals that need to be added to the architect's list.

### Conflict 5 — Concurrency lockfile

**Claude Code memo §2.2 (lines 96-118):** mandates a per-`<home>` lockfile
at `<home>/.claude/housekeeper/lock` with PID/hostname/startedAt/command
fields, atomic write+rename, 30-minute staleness window, no auto-clear,
release on terminal status. Reason cited: operator's own global
`CLAUDE.md` describes parallel agent worktrees that could invoke `clean`
against the same home.

**Architect memo:** §8.1 (line 1085-1090) mentions an `fcntl` advisory
lock option for TOCTOU mitigation but defers ("cross-platform-fragile;
defer"). Architect's preferred TOCTOU mitigation is a re-list check at
apply time (line 1097-1099).

**Product memo:** silent on lockfile.

**The disagreement in one sentence:** the architect rejects a lockfile as
unnecessary for v0.2.0 (`fcntl` is "cross-platform-fragile"); the
platform memo mandates a different lockfile (file-based, not `fcntl`)
because the operator's threat model includes parallel agent invocations.
These are not the same mechanism, so "the architect already considered
and rejected it" is not quite right — the architect rejected a *different*
lockfile.

### Conflict 6 — CLI flag shape for addressing the target

**Product memo §1 (line 76) and §3.1 (line 282):**
- `--target=<detector-id>` (e.g., `plugin.expected_orphan`)
- `--path=<absolute-path>`
- "inbox model": user names the finding from the report.

**Architect memo:** silent on `--target` / `--path` flag names. §10
(line 1203) defers CLI flag parsing as out of scope. The `Q-ARCH-D`
discussion (§7, line 1019-1033) implies "one finding per invocation"
without specifying how it's addressed.

**Claude Code memo:** silent. Uses `clean --confirm --yes` throughout
without binding the addressing scheme.

**The disagreement in one sentence:** only product memo specifies
addressing; architect and platform are silent and have not contradicted.
Synthesizer needs to ratify product's `--target` + `--path` pair.

### Conflict 7 — Where the new code lives

**Architect §4.1 (line 661):** new file `scripts/lib/clean-plan.mjs`,
exports `composeCleanPlan`, `validateCleanPlan`, `executeCleanPlan`,
`MUTATION_REGISTRY`. §4.5 (line 843) requires extending the
`no-mutation.test.mjs` allowlist to include this new file (the existing
allowlist only permits `scripts/lib/snapshot.mjs` per Decision Log Q1
T-600 entry at `notes/PLAN-v0.2.md:124`).

**Product memo:** silent on module layout.

**Claude Code memo §3.1 (line 213-214):** refers to "the report renderer
(`scripts/lib/report.mjs` per Phase 2 of `notes/PLAN.md`)" and asserts
that renderer "must emit this block whenever `command == "clean"` and
`status == "verified"` in the operation manifest." Does not specify
where the *plan* itself lives.

**The disagreement in one sentence:** no contradiction; architect's
`clean-plan.mjs` proposal stands unopposed and is the cleanest extension
of the existing module-allowlist invariant.

### Conflict 8 — The `verify()` bug at `scripts/lib/snapshot.mjs:600`

**Architect memo §3.5 (line 618-653) and §7 Q-ARCH-B (line 977-991):**
> "`scripts/lib/snapshot.mjs:600` currently `continue`s on null
> `sha256After`, which means a deletion is silently considered verified
> even if the file is still present. **This is a bug for v0.2 the moment
> any deletion mutation lands.**"
>
> "This must be patched in the T-704 PR, not deferred."

**Product memo and Claude Code memo:** both silent on the bug; neither
flagged it.

**Source of truth:** `scripts/lib/snapshot.mjs`:597-608, verified
empirically (see Section 3). The architect's reading is correct, and the
situation is worse than described (see Verification 1 below).

**The disagreement in one sentence:** only the architect found this; no
disagreement, but a critical empirical claim the tie-breaker must
endorse or reject before T-704 PR opens.

### Conflict 9 — Auto-rollback wiring in v0.2.0

**Product memo §3.3 (line 355-389) and §4.3 (line 442-461):** the
partial-apply path *auto-rolls-back* and reports `status: rolled_back`
with `[exit 1]`. The transcript shows "rolled back: 14 of 14" as the
expected user-visible state.

**Architect memo §6.1 row (line 920):**
> "Auto-rollback on `partialApply: true`: **NO** (defer to T-704
> follow-up) ... Recommend: in v0.2.0, leave `partialApply: true`
> manifests for `housekeeper.interrupted_operation` to surface."

§4.4 line 832-834:
> "Q5 decision: auto-rollback only when status reached 'applied' with
> partialApply: true. Implementation defers to T-802 once the rollback()
> function lands; until then, leave applied and let
> housekeeper.interrupted_operation surface it."

**Claude Code memo §6.4 (line 437-444):** describes the recovery flow
through `rollback <id>` for all interrupted statuses, including
`applied + partialApply`. Does not specify whether the rollback is auto
or manual.

**Source of truth:** `notes/PLAN-v0.2.md` Decision Log Q5 (line 129):
> "Partial-apply: auto-rollback only when status reached `applied`.
> Earlier failures discard the snapshot; mid-rollback crashes flow
> through `housekeeper.interrupted_operation`."

Locked by the user on 2026-05-11.

**The disagreement in one sentence:** the product memo's transcripts
assume auto-rollback is wired in v0.2.0; the architect explicitly defers
the wiring to a follow-up because `rollback()` is in a separate task
(T-802) and is not yet implemented in the snapshot lifecycle landed in
PR #41. This is a real conflict about what v0.2.0 actually ships.

### Conflict 10 — Settings edits

**Claude Code memo §5 (line 302-389):** v0.2.0 **REFUSES** all settings
edits. R3 hard refusal. §11 ship rule #3 (line 928).

**Architect memo §2 table:** `settings.invalid_json`,
`settings.hook_path_dangling`, `settings.hook_command_shell_ambiguous`,
`settings.mcp_command_missing` all REFUSE with reasons that include
"defer to v0.3 harden" or "missing-evidence-key" (lines 405-408).

**Product memo §5 table (lines 535-538):** all `settings.*` detectors
either **never** or **no (v0.3+)**.

**The disagreement in one sentence:** all three memos agree on refusal;
no conflict. Recorded here only to confirm convergence.

### Conflict 11 — Reload hint emission

**Claude Code memo §3.1 (line 196-210) and §11 ship rule #10 (line 942):**
mandates a `RELOAD HINT` block in the report after every successful
clean run.

**Product memo:** silent on RELOAD HINT specifically. The transcripts
(§3.1 line 285-296) include lines like "files snapshotted: 47 (12.4 MiB)"
and "applied: 47 of 47" but no RELOAD HINT.

**Architect memo:** silent on RELOAD HINT.

**The disagreement in one sentence:** the platform memo requires a
user-facing reload hint; the product transcripts do not include it. The
product transcripts are normative for UX text per the product memo's
§3 framing; the omission of RELOAD HINT in the transcripts is a real gap
that must be closed.

### Conflict 12 — Pre-mutation symlink check

**Claude Code memo §10.3 (line 821-848):** mandates `lstat`-based
symlink refusal for every target path under
`~/.claude/plugins/cache/`. Includes refusal text format.

**Architect memo §8.2 (line 1101-1124):** treats symlinks via the
existing `lstat` use at `scripts/lib/snapshot.mjs:326-328` and asserts
"the rollback should use `symlink(target, path)`, not
`writeFile(path, target)`" (§8.3 line 1140) — but this is about
rollback restoration, not pre-snapshot refusal. The architect's
symlink concern is "do not recurse into symlinked directories"
(line 1121), not "refuse any symlink target outright".

**Product memo:** silent on symlinks.

**The disagreement in one sentence:** the platform memo refuses any
symlink in the cleanable target; the architect refuses recursion into
symlinks but permits a symlink as a leaf to be snapshotted (the existing
snapshot code already supports this). These are different policies; the
platform memo is stricter.

### Conflict 13 — MCP-server-declaring plugin refusal

**Claude Code memo §7.3 (line 491-515):** mandates refusal of cache
version directory deletion if `<cache_version_dir>/.claude-plugin/plugin.json`
or `<cache_version_dir>/.mcp.json` declares an MCP server, **even when
the version is outside grace**. Reason cited: "even an 'orphaned outside
grace' version dir could be referenced by an MCP server that crashed and
is being respawned by Claude."

**Architect memo:** silent. The detector mapping (§2 line 410) routes
`plugin.cache_unreferenced` to `dir-rmtree` unconditionally; no special
case for MCP-server-bearing plugins.

**Product memo:** silent.

**The disagreement in one sentence:** the platform memo carves an
additional refusal class out of the *only cleanable detector*; the
architect's mapping would clean those versions. This collapses the v0.2.0
cleanable surface from "all `plugin.cache_unreferenced` findings" to "the
subset of `plugin.cache_unreferenced` findings whose cache dir does not
declare an MCP server."

### Conflict 14 — Hook-reference back-check

**Claude Code memo §10.5 (line 871-901):** proposes a new finding id
`plugin.cache_referenced_by_hook` with stance `protect`, scanning every
cache version dir path against every hook command string in
`settings.json` and refusing deletion if any match.

**Architect memo:** silent. Does not enumerate this category in the §2
detector table or the §5 refusal taxonomy.

**Product memo:** silent.

**The disagreement in one sentence:** the platform memo proposes a new
detector and a new refusal that the architect's taxonomy does not list.
This is a unilateral platform addition.

### Conflict 15 — `~/.claude/plugins/data/` exclusion

**Claude Code memo §9.7 (line 752-771):** mandates that `clean` MUST NOT
touch `~/.claude/plugins/data/` and that the RELOAD HINT must mention
"this is plugin state that survives updates per Claude Code's contract.
Housekeeper does not modify it."

**Architect memo:** silent. The §2 detector mapping is scoped to
`plugin.cache_unreferenced` which by audit.mjs construction only fires for
paths under `<home>/plugins/cache/` (line 552:
`path.join(context.home, "plugins", "cache")`).

**Product memo:** silent.

**The disagreement in one sentence:** no live conflict; the audit
detector already constrains the cleanable set to `plugins/cache/` and
never to `plugins/data/`. The platform memo's concern is reasonable
defensive depth but does not require an architecture change.

### Conflict 16 — Persona priority and primary user

**Product memo §1 (lines 41-162):** three personas — Mara (operator,
primary, ~80%), `housekeeper-nightly.yml` (CI, ~15%), Jamie (recovery,
~5%). Persona A (Mara) is named primary.

**Architect memo and Claude Code memo:** silent on personas. No contradiction.

**The disagreement in one sentence:** product has named the primary
persona; nothing contradicts. Synthesizer ratifies.

### Conflict 17 — One operation per plan

**Architect §1.6 (line 336-366):** v0.2.0 plans contain exactly one
`CleanOperation`. If N findings are cleanable, pick the highest-priority
one and refuse the rest (default per `Q-ARCH-D`, line 1019). Source:
`notes/PLAN-v0.2.md:30` "Bulk / recursive operations — Deferred to v0.3
— single-file ops only in v0.2."

**Product memo §8 (line 852-857):** v0.2 is one path per op:
> "v0.2.0 ships exactly this rule. It is not what `clean` will look
> like at v1.0."

**Claude Code memo:** silent on N-ops-per-plan.

**The disagreement in one sentence:** architect and product agree
(one op per plan); platform is silent. Ratify.

---

## Section 2 — Rulings

### Ruling 1 (Conflict 1) — `plugin.cache_unreferenced` is the v0.2.0 cleanable detector

**Ruling:** v0.2.0 ships exactly one cleanable detector:
**`plugin.cache_unreferenced`**. The architect memo and the Claude Code
memo are correct. The product memo is **materially wrong** on this point.

**Rationale (citations all to the source code, which the memos must serve):**

1. `scripts/lib/audit.mjs:512` — `detectPluginExpectedOrphan` filters
   `withinGrace === true`, i.e., **inside the 7-day grace**.
2. `scripts/lib/audit.mjs:524` — that detector's own `blockedActions`
   array literally contains the string **`"delete"`**. The detector
   contract forbids what the product memo wants to do.
3. `docs/loader-semantics.md` §2 / §7 (quoted in Claude Code memo line
   41): "Orphaned previous versions are removed automatically about 7 days
   later. The grace period exists so concurrent Claude Code sessions that
   already loaded the old version keep running." Deleting during the
   grace window is exactly the scenario the grace window protects against.
4. `scripts/lib/audit.mjs:528` — `detectPluginCacheUnreferenced` filters
   `withinGrace === false`, i.e., **outside the 7-day grace**. By
   construction, this is the safe-to-delete subset.
5. `scripts/lib/audit.mjs:545` — `nextAllowedStep: "run freshness probe
   or review manually"`. The snapshot+verify pipeline IS the freshness
   probe with proof of rollback.

The product memo's reading inverts the semantics. Its narrative ("Mara
sees `plugin.expected_orphan` on her report for two weeks and wants to
clean it") would only fire if the detector kept firing past day 7, which
by audit construction it does not — at day 8 the same path stops firing
as `plugin.expected_orphan` and starts firing as `plugin.cache_unreferenced`.
The user's two-week-old finding **is already** a `plugin.cache_unreferenced`
finding by the time clean might act on it.

**Implementation consequence:**
- `composeCleanPlan` classifier (architect §4.2 step 10) maps
  `finding.id === "plugin.cache_unreferenced"` → cleanable;
  `finding.id === "plugin.expected_orphan"` → refused with reason
  `stance-not-prepare` (its `nextAllowedStep` is "no action now").
- All product memo transcripts must be updated: `--target=plugin.expected_orphan`
  becomes `--target=plugin.cache_unreferenced` in §1, §3.1, §3.3, §7.4.
- Product memo's §5 table needs the two rows swapped — `plugin.expected_orphan`
  becomes "never" cleanable; `plugin.cache_unreferenced` becomes "YES".
- Refusal text 7.3 ("not cleanable in v0.2") must list
  `plugin.cache_unreferenced` (not `plugin.expected_orphan`) as the
  detector that IS cleanable.

### Ruling 2 (Conflict 2) — `mutationOp` is a descriptor, not a function

**Ruling:** `CleanOperation.mutationOp` is a serialisable descriptor
`{ kind, args }`. The architect memo wins by default (no one contradicts)
and on the merits.

**Rationale:**
1. `docs/rollback-contracts.md:124` requires `consentSummary` to be a
   non-empty string. To render that string before consent and execute
   the matching mutation after, the upstream layer cannot pass a closure
   — it must pass data the renderer can stringify and the executor can
   dispatch on.
2. Tests need to assert "plan for fixture X contains exactly one op of
   kind dir-rmtree with args matching `<expected>`." Function equality
   is not introspectable in JS; descriptor equality is trivial.
3. The architect's three-line registry pattern (memo §1.4 line 289-312)
   is mechanical and adds no architectural debt. There is no cost to
   choosing the descriptor.

**Implementation consequence:**
- `scripts/lib/clean-plan.mjs` defines
  `MutationOpDescriptor = { kind: MutationKind, args: object }` (per
  architect §1.3 line 165-169) and a `MUTATION_REGISTRY` (per §1.4
  line 289-312).
- `executeCleanPlan` materialises descriptors into `ops[i].apply`
  callables at the moment of `applyOperation()` invocation (architect
  §4.4 line 820-825).
- The manifest's `consentSummary` field is rendered from the descriptor
  via `renderConsentString(operation, plan)` (architect §4.4 line 812).

### Ruling 3 (Conflict 3) — Keep `clean`; keep `--confirm --yes`

**Ruling:** Verb stays `clean`. Flag pair stays `--confirm` + `--yes`.
The product memo's reasoning (§6.1 lines 636-658, §6.2 lines 686-705) is
sound. The architect and platform memos do not contradict.

**Rationale:**
1. PR #40 (2026-05-11) shipped the `--confirm` and `--yes` flags as
   landed behaviour. Renaming at the *exact* release where the behaviour
   flips from refusal to mutation is the worst possible moment for
   cognitive cost.
2. `notes/PLAN-v0.2.md` Decision Log Q1 (line 125) records user-locked
   decision: `--yes` flag, no interactive stdin.
3. `commands/housekeep.md` argument hint already names `clean` as a
   recognised verb.
4. The verb question reopens cleanly at v0.3 if the cleanable set
   expands, per product memo §6.1.

**Implementation consequence:** none — ratification of existing state.
The `--help` change product memo proposes (§6.2 line 700-705,
cross-referencing the two flags) is a low-cost UX improvement and
should land with T-704.

### Ruling 4 (Conflict 4) — Architect taxonomy is the canonical refusal model; platform refusals slot in

**Ruling:** Adopt the architect's 14-entry refusal taxonomy as the
internal classification. The platform memo's R1, R2, R3, R4, R5 map onto
existing categories (R1 → `policy-protected-path` via the active-plugin
rule; R2 → `stance-not-prepare`; R3 → `no-mutation-mapping-in-v0.2`;
R4 → `policy-sector-boundary`; R5 → `no-mutation-mapping-in-v0.2`).

Two **new** refusal categories from the platform memo MUST be added to
the architect's list:
- **`plugin-symlinked-cache`** (from Claude Code §10.3 — Risk-C)
- **`plugin-cache-referenced-by-hook`** (from Claude Code §10.5 —
  Risk-E)

**Rationale:**
- The architect's taxonomy is more granular and gives the exit-code
  model exactness (Section 5 line 869-884). It's the right base.
- The two platform additions are not redundant — they describe surface
  conditions on the cleanable target that no other category captures.
- The architect's `composeCleanPlan` classifier ordering (§4.2 line 749)
  must add these two checks at step 7 (between owner-class and
  stance), since both block deletion regardless of detector stance.

**Implementation consequence:**
- `REFUSAL_REASONS` array in `scripts/lib/clean-plan.mjs` adds two
  entries: `"plugin-symlinked-cache"` and `"plugin-cache-referenced-by-hook"`.
- `classifyForClean()` adds steps:
  - 6a. If `targetPath` `lstat().isSymbolicLink()` → refuse
    `plugin-symlinked-cache`.
  - 6b. If `targetPath` appears in any hook command string in
    `~/.claude/settings.json` → refuse
    `plugin-cache-referenced-by-hook`.
- These checks run during `composeCleanPlan`, not at apply time, so the
  refusal surfaces in `--dry-run`.

### Ruling 5 (Conflict 5) — Ship the lockfile in v0.2.0

**Ruling:** Adopt the platform memo's lockfile design from §2.2 (lines
96-118). File-based, not `fcntl`. Path:
`<home>/.claude/housekeeper/lock`. 30-minute staleness window. No
auto-clear; emit `housekeeper.stale_lock` informational finding instead.

**Rationale:**
1. The architect's objection (memo §8.1) was to `fcntl` advisory locks
   (cross-platform-fragile). The platform memo's file-based lockfile is
   different and uses the atomic-write protocol already in
   `scripts/lib/snapshot.mjs:214`. Same atomicity guarantees; no new
   primitives.
2. The operator's `CLAUDE.md` (global) explicitly describes parallel
   agent worktrees. Two simultaneous `clean --confirm --yes` invocations
   against the same `<home>` is a real scenario in this user's
   environment, not a hypothetical.
3. The cost is one file create + rename at start, one unlink at end,
   plus a 30-minute stale-detection branch. Trivial.

**Implementation consequence:**
- `executeCleanPlan` (architect §4.4) acquires the lock as its first
  step, before `gcSnapshots()`.
- `validateCleanPlan` (architect §4.3) does NOT acquire the lock —
  validation is read-only.
- A new detector `housekeeper.stale_lock` is added to the always-on
  set (informational finding; stance `inform`; not cleanable). This is
  an `audit.mjs` change; the platform memo's §11 rule #6 captures it.
- The lock is released on every terminal status: `verified`,
  `rolled_back`, `aborted`. It is NOT released on `applied` or
  `snapshot_taken` — those are non-terminal.

### Ruling 6 (Conflict 6) — Ratify `--target=<detector-id>` + `--path=<absolute-path>`

**Ruling:** The product memo's addressing scheme is correct.

**Rationale:**
1. The inbox model (product §2 line 208-237) is the only one that
   preserves the single-source-of-truth property: `diagnose` decides
   what is wrong, `clean` decides nothing.
2. `--target` accepts a detector id (a stable identifier — there are
   exactly 18 in the codebase, enumerated in `audit.mjs`). `--path`
   accepts an absolute path to disambiguate when N findings of the same
   detector exist.
3. The architect's §10 note ("The CLI gate order ... Already shipped in
   #40. This memo treats the gate as a precondition.") indicates no
   architect disagreement.

**Implementation consequence:**
- `scripts/claude-housekeeper.mjs` adds `--target=<id>` and
  `--path=<path>` flag parsing on the `clean` subcommand.
- `composeCleanPlan` filters `report.findings` to those matching
  `--target` AND (if provided) `--path` before applying the classifier.
- If `--target` is missing, refuse with exit 2 and corrected-command
  hint (product memo §6.2 style).
- If `--target` matches multiple findings and `--path` is missing,
  refuse with exit 2 and list the candidate paths.

### Ruling 7 (Conflict 7) — Code lives in `scripts/lib/clean-plan.mjs`

**Ruling:** New file. Allowlist `clean-plan.mjs` in
`no-mutation.test.mjs`.

**Rationale:** No contradiction. The architect's §4.5 reasoning
(line 843-852) is sound: `audit.mjs` is read-only by convention,
`snapshot.mjs` is the I/O layer, `clean-plan.mjs` is the new
designated mutation-planning surface.

**Implementation consequence:**
- New file: `scripts/lib/clean-plan.mjs` exporting `composeCleanPlan`,
  `validateCleanPlan`, `executeCleanPlan`, `MUTATION_REGISTRY`,
  `REFUSAL_REASONS`, `MUTATION_KINDS` (architect §4.1).
- Edit one line in `test/no-mutation.test.mjs` (whatever the existing
  allowlist mechanism is — architect §4.5 line 850-852) to add
  `clean-plan.mjs`.
- Add a row to `notes/PLAN-v0.2.md` Decision Log recording the
  allowlist extension.

### Ruling 8 (Conflict 8) — The `verify()` bug MUST be fixed in the T-704 PR

**Ruling:** The architect's claim is **confirmed empirically** (see
Section 3, Verification 1). The bug is real, and the situation is
slightly worse than the architect described: `applyOperation()` at
`scripts/lib/snapshot.mjs:558` also fails for deletions (it calls
`hashFile(originalPath)` after the file is gone, which throws ENOENT and
trips the `catch` block at line 559 — setting `partialApply = true`
for every successful deletion).

The fix MUST land in the T-704 PR, not deferred. Two patches:

**Patch A — `applyOperation` deletion-aware hash:**
The current loop (`scripts/lib/snapshot.mjs:553-564`) calls
`await hashFile(entry.originalPath)` unconditionally after
`ops[i].apply()`. For a deletion this throws ENOENT and the catch
block marks the entry `applied: false` and sets `partialApply: true`.
Fix: after `ops[i].apply`, check whether the file still exists. If it
does, hash it. If it does not (intended deletion), leave
`entry.sha256After = null` (its initialized default per
`makeOperationManifest` line 98).

**Patch B — `verify()` deletion-aware check:**
The current loop at `scripts/lib/snapshot.mjs:597-608` `continue`s on
null `sha256After`, silently verifying any deletion. Fix: treat
`sha256After === null` as intended-deletion. Verify by absence using
`existsSync(entry.originalPath)`. The exact patch is architect §3.5
line 629-647.

**Rationale:**
1. The bug is dormant in v0.1 (no deletions ever happen — `clean` was
   refused). The moment `dir-rmtree` lands, every successful deletion
   either gets miscategorised as `partialApply: true` (Patch A) or
   passes `verify()` silently even when the file survives (Patch B).
2. T-704 ships the first deletion. Shipping the deletion without the
   fix is shipping a known-broken verification path.
3. Both patches are small (under 10 lines combined) and localised to
   `snapshot.mjs`. They do not require a new module.

**Implementation consequence:**
- T-704 PR diff includes a `scripts/lib/snapshot.mjs` change for
  Patch A and Patch B together.
- Test fixture: add a deletion fixture that asserts
  `manifest.status === "verified"` and
  `manifest.files[0].sha256After === null` after a successful
  dir-rmtree apply + verify. (The existing snapshot test suite has the
  hooks for this.)
- A negative test: apply a dir-rmtree, then create a file at the same
  path before verify, assert `verifyFailure === true` on that entry.

### Ruling 9 (Conflict 9) — Auto-rollback deferred; partial-apply surfaces via `housekeeper.interrupted_operation`

**Ruling:** The architect is right. The product memo's §3.3 transcript
showing automatic rollback is **incorrect for v0.2.0** as currently
scoped. v0.2.0 leaves `applied + partialApply: true` manifests for the
standing `housekeeper.interrupted_operation` detector to surface.
Auto-rollback wiring lands when `rollback()` lands (T-802), which is
post-T-704.

**Rationale:**
1. `notes/PLAN-v0.2.md` Decision Log Q5 (line 129) records the locked
   user decision: "auto-rollback only when status reached `applied`."
2. PR #41 (the commit at `9ed5a64`) shipped `applyOperation` and
   `verify` but did NOT ship `rollback()`. There is no callable to
   invoke from an auto-rollback hook in v0.2.0 today.
3. T-802 (rollback) is a separate, parallel task. The taskboard at
   `notes/TASKBOARD-v0.2.md:132` confirms.
4. The product memo's transcript shows "Auto-rollback triggered" — but
   the function that would do this is unimplemented. The transcript is
   aspirational, not implementable in T-704's scope.

**Implementation consequence:**
- Product memo §3.3 transcript and §4.3 wording MUST be updated. New
  partial-apply UX for v0.2.0:
  ```
  HOUSEKEEPER CLEAN
  op_<id>
    target: plugin.cache_unreferenced
    path: <path>
    snapshot: <snapshot-path>
    files snapshotted: 31 (8.1 MiB)
    applying...
    ERROR: <reason> on <file>
    applied: 14 of 31 (partial)
    status: applied (partial)

  This operation is in an interrupted state. The next `diagnose` run
  will surface it under `housekeeper.interrupted_operation`. To
  recover, run:

      claude-housekeeper rollback <op-id>

  [exit 1]
  ```
- §4.3 "Auto-rollback per Q5" section heading must change to "Partial
  apply per Q5". The phrase "Auto-rollback triggered" is removed.
- When `rollback()` lands (T-802) and the auto-rollback hook is wired,
  the original product transcript text becomes correct. That is a
  v0.2.0 follow-up PR, not T-704.

### Ruling 10 (Conflict 10) — Settings edits refused

**Ruling:** Ratify. All three memos agree.

**Implementation consequence:** `composeCleanPlan` classifier maps every
`settings.*` detector id to refusal `no-mutation-mapping-in-v0.2`.
(Already the architect's §2 default.)

### Ruling 11 (Conflict 11) — Emit RELOAD HINT in the verified path

**Ruling:** Adopt the platform memo's RELOAD HINT block (§3.1 line
196-210). Add to the product memo's §3.1 happy-path transcript.

**Rationale:**
1. The platform memo's reasoning (§3 reload matrix line 180-191) is
   sound: even when the deletion is benign at filesystem level,
   `/reload-plugins` is the user's way to confirm Claude's MCP
   subsystem has no stale reference. Mentioning it costs one block of
   help text and saves at least one support escalation when a user
   notices a stale connection after clean.
2. The product memo silently dropped this in its transcripts, but its
   own §10 (line 992-1014) lists "open questions for the synthesizer"
   without flagging it — meaning product agrees in principle and just
   didn't show it.

**Implementation consequence:**
- `scripts/lib/report.mjs` adds a `RELOAD HINT` block renderer that
  fires when `command === "clean" && status === "verified"`.
- The block content is dynamic based on what was deleted (the platform
  memo's three bullets in §3.1).
- The product memo's §3.1 transcript MUST be amended to include the
  RELOAD HINT block before `[exit 0]`.

### Ruling 12 (Conflict 12) — Refuse any symlink target

**Ruling:** Adopt the platform memo's stricter rule from §10.3. Refuse
any target whose `lstat().isSymbolicLink()` returns true under the
cleanable surface.

**Rationale:**
1. The architect's "do not recurse into symlinked directories" rule
   (memo §8.2 line 1121) is necessary but not sufficient: a symlink at
   the cache version directory root (`<cache_root>/<market>/<plugin>/<version>`
   itself being a symlink) would have the walker delete the link
   without recursion, but the rollback would write file bytes back to
   the symlink target, not recreate the symlink. The platform memo's
   §10.3 mitigation is the right level of defence.
2. v0.2.0 has no rollback for symlinks yet (architect §8.3 line 1140
   flags this as needing a test fixture before T-802). Refusing the
   target entirely is cheaper than getting rollback-of-symlink right
   in T-704.

**Implementation consequence:**
- `composeCleanPlan` classifier step 6a (defined in Ruling 4)
  `lstat`'s the target. If `isSymbolicLink()`, refuse
  `plugin-symlinked-cache`.
- This is a precondition check during plan composition, not a
  post-snapshot check.

### Ruling 13 (Conflict 13) — Refuse MCP-server-declaring cache versions

**Ruling:** Adopt the platform memo's §7.3 rule. Refuse deletion of any
cache version dir whose `.claude-plugin/plugin.json` or `.mcp.json`
declares an MCP server.

**Rationale:**
1. The platform memo's reasoning is conservative but correct: there is
   no documented way to prove a plugin's MCP subsystem has no live
   reference to a cached version. The 7-day grace covers session-start
   plugin loading; it does not cover crash-respawn loops for MCP
   children.
2. The cost of false-positive refusal is one release of latency on
   cleaning MCP-bearing orphans. The cost of false-positive deletion is
   "Claude crashed mid-task with no obvious cause" (platform §10.1
   Risk-A severity high).
3. v0.3 can ship MCP-aware verification (platform memo §7.3 line
   495-498) and lift the refusal.

**Implementation consequence:**
- `composeCleanPlan` classifier adds step 6c: if `targetPath` has a
  `.claude-plugin/plugin.json` or `.mcp.json` declaring an MCP server,
  refuse with a new reason `plugin-cache-has-mcp-server` (third new
  entry in `REFUSAL_REASONS`).
- This refusal is **soft** (lifts in v0.3), unlike R1/R2/R4 which are
  hard.

### Ruling 14 (Conflict 14) — Hook-reference back-check is required

**Ruling:** Ship the platform memo's §10.5 detector
`plugin.cache_referenced_by_hook` as part of T-704. This is a v0.2.0
ship rule, not a v0.3 lift.

**Rationale:**
1. The Risk-E scenario (Housekeeper deletes a cache version dir whose
   path is hardcoded into a SessionStart hook command in
   settings.json) is plausible: the operator's CLAUDE.md describes
   multiple SessionStart hooks, and Housekeeper itself ships one.
2. The check is cheap: read settings.json (we already do this in
   `audit.mjs`), scan the hook command strings, refuse if any contains
   the target dir path.
3. The platform memo's stance assignment (`protect`, per
   `docs/loader-semantics.md` §10 vocabulary) is correct.

**Implementation consequence:**
- `audit.mjs` gets a new detector function `detectPluginCacheReferencedByHook`.
  Adds a new finding id to the always-on set.
- The new finding emits with `forceStance: "protect"` (architect §2
  table maps `protect` stance to refusal `policy-protected-path`).
- `composeCleanPlan` automatically refuses any target with this
  finding via the existing classifier step 2 (`finding.stance ===
  "protect"`) — no new classifier step needed; the detector itself
  surfaces the protection.

### Ruling 15 (Conflict 15) — `plugins/data/` is already out of scope

**Ruling:** No code change required. Add a note to the RELOAD HINT
text per platform memo §9.7.

**Rationale:** `audit.mjs:552` already scopes
`listCacheVersionDirs` to `<home>/plugins/cache/`, which by file path
construction never reaches `<home>/plugins/data/`. The detector cannot
fire on data dirs.

**Implementation consequence:**
- The RELOAD HINT renderer (Ruling 11) appends the platform memo's
  §9.7 NOTE block when a `plugin.cache_unreferenced` clean succeeds.
  Text:
  ```
  NOTE: <NN MB> of plugin-related data lives under
  ~/.claude/plugins/data/ (separate from cache). This is plugin state
  that survives updates per Claude Code's contract. Housekeeper does
  not modify it.
  ```

### Ruling 16 (Conflict 16) — Mara is the primary persona

**Ruling:** Ratify. Mara (product §1 Persona A) is the primary
persona; `housekeeper-nightly.yml` is secondary; Jamie is tertiary.

**Implementation consequence:** copy in `clean --help` and refusal
messages prioritises Mara's mental model (read report, name finding,
clean one path, see op id). CI ergonomics are second-class
(machine-parseable JSON via `--json`, deterministic ordering, exit
codes are the contract).

### Ruling 17 (Conflict 17) — One operation per plan in v0.2.0

**Ruling:** Ratify. Architect §1.6 + product §8 agree. If N findings
match the addressing scheme, pick the smallest by `estimatedBytes`
(architect's `Q-ARCH-D` default-when-priority-ties, §7 line 1033) and
refuse the rest with reason `no-mutation-mapping-in-v0.2`.

**Rationale:**
1. `notes/PLAN-v0.2.md:30` is explicit.
2. Smallest-bytes ordering is the cheap-test-of-pipeline default; it
   makes the first cleanable invocation the lowest-risk one.
3. The user can re-run `clean` to address subsequent matches.

**Implementation consequence:**
- `composeCleanPlan` enforces `operations.length === 1` after
  filtering by `--target`/`--path`.
- If `operations.length > 1` after filtering, pick the smallest by
  `estimatedBytes`, refuse the rest.

---

## Section 3 — Verifications

### Verification 1 — `verify()` silently passes deletions (architect Q-ARCH-B)

**Claim:** `scripts/lib/snapshot.mjs:600` `continue`s on null
`sha256After`, silently passing a deletion as verified even if the file
is still present.

**How verified:** read `scripts/lib/snapshot.mjs:590-619`.

**Verdict:** **CONFIRMED.** The exact lines are:
```js
// scripts/lib/snapshot.mjs:597-602
let allMatch = true;
for (const entry of manifest.files) {
  // Only verify files that were successfully applied (have a sha256After).
  if (entry.sha256After === null || entry.sha256After === undefined) {
    continue;
  }
```

The comment ("Only verify files that were successfully applied") is
the source of the bug: it treats null `sha256After` as "not applied",
but for a deletion, null `sha256After` is the *intended* terminal state.
The verify path falls through with `allMatch` still true if every file
in the manifest was a deletion.

**Additional finding (not in the architect memo):**
`scripts/lib/snapshot.mjs:558` calls `await hashFile(entry.originalPath)`
unconditionally after `ops[i].apply()`. For a deletion, the file does
not exist; `hashFile` throws ENOENT; the `catch` at line 559 fires;
the entry is marked `entry.applied = false` and the manifest is marked
`partialApply: true`. So in v0.2.0 as currently coded, **every
successful deletion would be miscategorised as a partial apply** — the
bug is worse than the architect described. Both `applyOperation()` and
`verify()` need a fix.

This makes Ruling 8 stronger, not weaker: the T-704 PR cannot defer
either patch.

### Verification 2 — `plugin.expected_orphan` vs `plugin.cache_unreferenced` semantics (Conflict 1)

**Claim:** `plugin.expected_orphan` fires WITHIN the 7-day grace;
`plugin.cache_unreferenced` fires OUTSIDE.

**How verified:** read `scripts/lib/audit.mjs:511-548` and
`audit.mjs:550-560`.

**Verdict:** **CONFIRMED.**
- `detectPluginExpectedOrphan` (line 511): `filter((entry) =>
  entry.withinGrace).map(...)`.
- `detectPluginCacheUnreferenced` (line 528): `filter((entry) =>
  !entry.withinGrace).map(...)`.
- `pluginCacheOrphans` (line 550-560) sets
  `withinGrace: ageMs <= PLUGIN_ORPHAN_GRACE_MS` where
  `PLUGIN_ORPHAN_GRACE_DAYS = 7` (line 31).

**Additional finding:** `detectPluginExpectedOrphan`'s output
explicitly lists `"delete"` in its `blockedActions` (line 524). The
detector's own contract forbids the action the product memo proposes.
This makes Ruling 1's "materially wrong" call unambiguous.

### Verification 3 — `applyOperation` signature and `ops[i].apply` contract

**Claim:** `applyOperation(id, home, ops)` accepts an `ops` array of
function references; nothing upstream constrains the in-memory
mutation representation.

**How verified:** read `scripts/lib/snapshot.mjs:534-575`.

**Verdict:** **CONFIRMED.** Line 556:
`await ops[i].apply(entry.originalPath)`.
The function reference is the integration boundary. Choosing the
descriptor representation at the layer above is a free choice — the
architect's proposal in Ruling 2 is sound.

### Verification 4 — Operation manifest schema requires `consentSummary` to be a non-empty string

**Claim:** A serialisable consent record is required by the manifest
contract.

**How verified:** read `docs/rollback-contracts.md` §3 (lines 56-138).

**Verdict:** **CONFIRMED.** Line 124: "Non-empty human-readable consent
record." This requires the upstream layer to render a string before the
function executes — i.e., the architect's descriptor argument
(Ruling 2) is the only design that meets the contract without a
parallel description registry.

### Verification 5 — `notes/PLAN-v0.2.md` Q5 auto-rollback decision

**Claim:** auto-rollback is locked to the "applied + partialApply" case
only, and the implementation of rollback is in a separate task.

**How verified:** read `notes/PLAN-v0.2.md:129` and Section 2 (lines
36-46).

**Verdict:** **CONFIRMED.** The Decision Log row Q5 (line 129) and the
Dependencies table (line 38-42) show:
- Q5 decision is "auto-rollback only when status reached `applied`".
- Snapshot writer landed in PR #29 / #30 / #37.
- `applyOperation` landed in PR #41 (commit `9ed5a64`).
- `rollback()` is not in the merged set — only the snapshot writer,
  `gcSnapshots`, `applyOperation`, and `verify` landed in #41.

This means the auto-rollback path the product memo's §3.3 transcript
depicts has no implementation to call. Ruling 9 is correct.

### Verification 6 — `notes/PLAN-v0.2.md` Decision Log Q1 (`--yes` flag, no stdin)

**Claim:** `--confirm --yes` is the locked flag pair; no interactive
stdin in v0.2.

**How verified:** read `notes/PLAN-v0.2.md:125`.

**Verdict:** **CONFIRMED.** The row is dated 2026-05-11, decided by
"user (Elad)". Ruling 3 is correct.

### Verification 7 — `no-mutation.test.mjs` allowlist precedent

**Claim:** Adding `clean-plan.mjs` to the no-mutation allowlist is
consistent with the existing precedent for `snapshot.mjs`.

**How verified:** read `notes/PLAN-v0.2.md:124`.

**Verdict:** **CONFIRMED.** The Decision Log row reads:
> "no-mutation.test.mjs allowlists lib/snapshot.mjs ... An allowlist
> (not a wholesale relaxation) preserves the invariant for everything
> else."

Extending this allowlist to a second file is a one-line addition with
the same rationale. Ruling 7 stands.

### Verification 8 — Architect's `executionClass: inert` mapping for `plugin.cache_unreferenced`

**Claim (architect §2.2 line 437):** The surface classification axes
for `plugin.cache_unreferenced` are uniformly clean-eligible
(inert execution, snapshot-possible rollback, claude-managed owner,
not-load-bearing-outside-grace).

**How verified:** read `scripts/lib/audit.mjs:528-548` and grepped for
`executionClass` in audit.mjs (no `executionClass: "inert"` literal
appears inline for `plugin.cache_unreferenced`; the classification
flows via surfaceHints + the surface classifier in `surface.mjs`).

**Verdict:** **PARTIALLY VERIFIED.** The detector at line 528 emits
`surfaceHints: { isPluginCacheVersionDir: true }` and does not set
`forceStance`, deferring stance to the calculator. The architect's
claim relies on the surface classifier's mapping of "plugin cache
version dir, outside grace" being uniformly clean-eligible — I did not
re-derive `surface.mjs` from the source. I accept the architect's
reading on this point pending no contradiction from the other memos
(none).

### Verification 9 — `installed_plugins.json` is the live-version key (platform P3)

**Claim:** The presence in `installed_plugins.json` is the way to
discriminate "active version" from "orphaned cache".

**How verified:** `scripts/lib/audit.mjs:551`:
`const livePaths = new Set(context.pluginEntries.map((entry) => entry.installPath).filter(Boolean));`
and `scripts/lib/audit.mjs:555`:
`if (livePaths.has(versionDir)) continue;`

**Verdict:** **CONFIRMED.** The orphan detector explicitly excludes
versions present in `installed_plugins.json` (via `context.pluginEntries`,
which is derived from that file). Platform memo §1.1 P3 is correct.

### Verification 10 — Three memos exist on the listed PRs

**Claim:** Architect on PR #44, product on PR #43, platform on PR #42.

**How verified:** `gh pr list --state all --limit 20`.

**Verdict:** **CONFIRMED.**
- #44 open: "docs(design): T-704 architecture memo ..." — unmerged.
- #43 merged: "docs(design): product memo for clean ..." — landed.
- #42 merged: "docs(design): T-704 platform memo for clean ..." — landed.

The architect memo is on commit `3797df6` on the head of PR #44; I read
that commit's `docs/design/clean-architecture-memo.md` directly.

---

## Section 4 — Aggregated final spec for v0.2.0 T-704

v0.2.0 ships `clean --confirm --yes --target=<detector-id>
[--path=<absolute-path>]` with `--json` as an opt-in renderer. The only
cleanable detector is `plugin.cache_unreferenced` (outside the 7-day
grace window per `scripts/lib/audit.mjs:528`). Everything else is
refused. The mutation pipeline introduces a new pure module
`scripts/lib/clean-plan.mjs` (allowlisted in `no-mutation.test.mjs`)
exporting `composeCleanPlan`, `validateCleanPlan`, `executeCleanPlan`,
and a `MUTATION_REGISTRY` keyed on the four-value `MutationKind` enum
(`dir-rmtree`, `file-unlink`, `file-replace`, `json-fragment-edit`);
only `dir-rmtree` materialises in v0.2.0. `CleanOperation.mutationOp` is
an inert `{ kind, args }` descriptor that the renderer stringifies for
the manifest's `consentSummary` and that `executeCleanPlan`
materialises into the callable that `applyOperation` consumes. The
classifier in `composeCleanPlan` runs the architect's 10-step order
(`plan-state-error` → protection → sector-boundary → execution-class →
rollback-class → owner → symlink (`lstat`) refusal → hook-reference
refusal → MCP-server-declaring-plugin refusal → stance → missing-key →
v0.2-mapping lookup), adding three new refusal reasons to the
architect's list (`plugin-symlinked-cache`,
`plugin-cache-referenced-by-hook`,
`plugin-cache-has-mcp-server`). `validateCleanPlan` re-checks against
live filesystem and policy and refuses if drift detected.
`executeCleanPlan` acquires a file-based lockfile at
`<home>/.claude/housekeeper/lock` with 30-minute staleness before
calling `gcSnapshots`, `takeSnapshot`, `applyOperation`, and `verify`
in sequence; lock is released on terminal manifest status. The T-704 PR
includes two patches to `scripts/lib/snapshot.mjs`: (Patch A) make
`applyOperation` deletion-aware by skipping the post-apply `hashFile`
call when the file no longer exists (leaving `sha256After = null`),
and (Patch B) make `verify` deletion-aware by treating null
`sha256After` as intended-deletion and asserting `!existsSync` rather
than skipping. Auto-rollback on `partialApply: true` is **not** wired
in T-704; partial applies surface via the existing
`housekeeper.interrupted_operation` detector and route to
`rollback <id>` once that command lands in T-802. The successful clean
path emits a `RELOAD HINT` block (run `/reload-plugins` in active
sessions) plus a `NOTE` about `plugins/data/` retention. Plans contain
exactly one `CleanOperation`; if `--target`/`--path` matches multiple
findings, pick the smallest by `estimatedBytes` and refuse the rest.
Exit codes: 0 on success (or `--dry-run`); 1 on mid-flight failure
including partial-apply; 2 on refusal (missing flags, protected/
sector-boundary path, not-cleanable detector, finding-not-present,
symlink target, hook-referenced target, MCP-declaring target, budget
exceeded, snapshot incomplete, interrupted-op interlock). The verb
stays `clean`. The flag pair stays `--confirm` + `--yes`. Mara is the
primary persona; CI ergonomics are second. A new always-on detector
`plugin.cache_referenced_by_hook` lands in `audit.mjs` (stance
`protect`). A new always-on informational finding
`housekeeper.stale_lock` lands when the lockfile is past its 30-minute
staleness window.

---

## Section 5 — Open questions for the synthesizer to escalate

These three rulings depend on a product preference no source can
decide. Synthesizer must surface them to the user (Elad) before T-704
PR opens.

### Question 1 — Default ordering when N findings tie on size

Ruling 17 picks the smallest `estimatedBytes` when multiple
`plugin.cache_unreferenced` findings match `--target`/`--path`. If two
findings have the same `estimatedBytes` (rare but possible with identical
cache layouts across plugins), which one ships in v0.2.0?

**Recommendation:** lexicographic order of `targetPath`. Deterministic,
trivial to implement, and consistent with the
"deterministic ordering of cleaned items in the manifest" anti-goal
in product memo §1 Persona B.

**Trade-off:** lexicographic ordering may not match the user's
intent (alphabetical-first cache might be the *most* important plugin),
but in v0.2.0 the user re-runs clean to address the next one anyway, so
ordering is only the first-touch question.

### Question 2 — Should `composeCleanPlan` re-run `assembleReport` internally or accept a pre-generated `Report`?

The architect's pipeline (§1.2 diagram, line 96-135) shows
`assembleReport()` and `composeCleanPlan()` as sequential calls from
`runClean()`. The product memo's §2 inbox model says "`clean` re-runs
`diagnose` internally to re-derive the target set" (line 220-221).

If `composeCleanPlan` accepts an externally-generated `Report`, the user
could in theory hand it a stale report from an earlier `diagnose` run.
If `composeCleanPlan` runs `assembleReport` internally, the call is
slower but always fresh.

**Recommendation:** Run `assembleReport` internally as the first step
of `runClean`. The cost is ~100ms on a typical home (per `notes/PLAN.md`
Phase 1 budgets). The benefit is that the addressing scheme can never
target a finding that no longer exists.

**Trade-off:** product memo §7.4 ("operator targets a finding that is
no longer present", exit 2 refusal text at line 776-797) becomes the
fresh-state-detection path — and a useful one. The performance cost is
negligible.

### Question 3 — When v0.3 ships, does `plugin.expected_orphan` ever become cleanable?

Ruling 1 makes `plugin.expected_orphan` permanently uncleanable in
v0.2.0 (and the detector itself blocks the action). The product memo
implicitly suggests it should eventually be cleanable. The platform memo
(§8.2 R2 line 643-645) marks it as a **hard** refusal that does **not**
lift in v0.3 — "Claude's own contract."

**Recommendation:** the platform memo's reading is correct. The 7-day
grace exists for concurrent-session safety; that constraint does not
relax in v0.3. The v0.3 expansion of cleanable detectors should be on
`registry.local_command_identical`, `settings.hook_path_dangling`, and
`settings.mcp_command_missing` (which all need the `harden` patch-
synthesis surface), not on shrinking the grace window.

**Trade-off:** if v0.3 ships an active-session probe that proves no
running Claude session has loaded a specific cache version (platform
memo Q-PLAT-1, line 657-677), the grace window could be reduced. That
is a v0.4+ research direction, not a v0.3 one.

---

## Appendix — Headline ruling for the dispatcher

**Conflict A (which detector?): `plugin.cache_unreferenced`.** The
product memo is materially wrong; the architect and platform memos are
correct. The product memo's own §5 table row for
`plugin.expected_orphan`, when read against `scripts/lib/audit.mjs:511,
524`, contradicts itself: the detector emits `nextAllowedStep: "no
action now"` and lists `"delete"` in `blockedActions`. The cleanable
finding by the time the user is two weeks past install is **already**
firing as `plugin.cache_unreferenced`, not `plugin.expected_orphan`.

All v0.2.0 user-facing materials referencing
`--target=plugin.expected_orphan` MUST be corrected to
`--target=plugin.cache_unreferenced` before T-704 ships.

*End of tie-breaker.*
