# Product memo — `clean --confirm --yes` for Claude Housekeeper v0.2.0

Author: product engineering · Companion to architect memo and Claude-Code-platform memo (parallel pass)
Lane: T-704 end-to-end flow · Status: design draft, not normative until synthesizer accepts
Decision Log reference: `notes/PLAN-v0.2.md` §5 (Q1-Q5 locked 2026-05-11)

This memo answers a different question than the architect memo. The architect
asks "how does clean work." This memo asks "who is clean *for*, what mental
model do they hold when they run it, and what is the minimum surface we can
ship that does not break that model." If those two memos disagree, the design
is wrong somewhere and the synthesizer must resolve it before T-704 starts.

---

## 0. Premise and stance

Claude Housekeeper's v0.1 promise is a single sentence on the README:

> Run one read-only command, get a report with stance, evidence, missing keys,
> and boundaries, and understand what is happening before Claude starts
> failing mid-session.

v0.2 is the first release that *acts*. Every product decision in this memo
flows from one observation: the people who installed v0.1 installed it
**because** it was read-only. They did not install it to delegate cleanup.
They installed it to see the truth about a system they were already wary of.

If `clean` looks like a tool that automates judgement, v0.2 breaks the
promise that earned the install. If `clean` looks like a *reversible
extension of the report* — one specific finding, surfaced by `diagnose`,
acted upon with snapshot proof — v0.2 keeps the promise and earns the next
trust threshold.

This memo proposes the most conservative useful `clean` we can ship. It
will feel small. That is intentional. v0.2 is not "Housekeeper learns to
clean." It is "Housekeeper learns to act once, on the one thing that is
already obviously safe, and produce rollback proof when it does."

---

## 1. Personas

Three personas are in scope for v0.2.0. We name them, give them a goal, a
success criterion, an anti-goal, and the exact CLI line they would type. If a
persona's CLI line cannot be supported, the design fails for them.

### Persona A — The Operator (primary, ~80% of v0.2 use)

**Name:** Mara, a senior engineer who runs Claude Code on a laptop she also
uses for client work. She has installed and uninstalled five plugins in the
last quarter. She has a `~/.claude/plugins/cache/` directory that is 1.4 GiB.

**Primary goal:** Reclaim a few hundred megabytes of disk and clear a
`plugin.expected_orphan` finding that has been on her `diagnose` report for
the last two weeks, *without* breaking her active plugins, her hooks, or her
local commands.

**Success criterion:** She runs `clean --confirm --yes` on one specific
target, sees a one-line confirmation, sees an op id she can save, and runs
`diagnose` again to verify the finding is gone. Total elapsed time: under
30 seconds. She does not need to read a man page mid-flight.

**Anti-goals:**
- She does **not** want a "clean everything" sweep. She has been burned by
  `brew cleanup` and `docker system prune`.
- She does **not** want an interactive prompt that reads from stdin. Her
  terminal is inside tmux, inside an iTerm split, inside a VS Code task
  runner. Stdin is contested.
- She does **not** want clean to ever touch `commands/` or `skills/`. Those
  are *her* surface area; she edits them by hand.

**Exact CLI line:**
```
claude-housekeeper diagnose                                 # see findings
claude-housekeeper clean --confirm --yes \
    --target=plugin.expected_orphan \
    --path=/Users/mara/.claude/plugins/cache/anthropic/research-tools/0.3.1
```

She types this exactly once. If the design forces her to type it twice or
remember a flag order, the design has failed her.

### Persona B — The CI Job (~15% of v0.2 use, growing)

**Name:** `housekeeper-nightly.yml`, a GitHub Action that runs against a
fleet of synthetic developer-image homes the team uses to test Claude
plugin updates before pushing to prod laptops.

**Primary goal:** Detect interrupted operations from the previous nightly,
verify that the home is clean enough to seed a new test run, and on a
*specific* whitelist of detector ids, auto-clean before the next test
batch begins. The CI job is non-interactive by definition — every shell
prompt is a build failure.

**Success criterion:** A clean machine-readable exit code. `0` means
nothing to do or done-and-verified. `2` means refusal (which is a
legitimate, scriptable state, not a failure). `1` means an actual error
worth a Slack page.

**Anti-goals:**
- Cannot tolerate hidden interactive prompts. `--yes` must bypass *all*
  consent UX, not just the obvious one.
- Cannot tolerate `--confirm` defaulting to dry-run when `--yes` is
  present; that ambiguity has historically caused CI false-greens.
- Cannot tolerate non-deterministic ordering of cleaned items in the
  manifest; the CI diffs manifests across runs.

**Exact CLI line:**
```
claude-housekeeper clean --confirm --yes \
    --target=plugin.expected_orphan \
    --max-files=1 --json \
  | tee "$RUN_DIR/clean.json"
```

The job parses the JSON output, archives the op id with the build, and
keys the next rollback flow off `clean.json.operationId`.

### Persona C — The Recovery Operator (~5% of v0.2 use, high stakes)

**Name:** Jamie, the on-call developer who got paged because Claude Code is
failing to start sessions on a teammate's laptop after a plugin upgrade went
sideways. They are not the laptop's owner. They have shell access for the
duration of the incident.

**Primary goal:** Confirm that a previously-completed `clean` op did not
delete something load-bearing, *and* roll it back if it did. They are not
running `clean` — they are running `rollback`. But their first thought when
they see the situation is to look at Housekeeper's manifest history.

**Success criterion:** They can list the last N operations, see exactly
what each one touched, see which op produced the broken state, and
restore it. Critically: the *language* of clean's output has to make this
possible. A clean op that says only "cleaned 3 files" without naming them
forces Jamie to dig through the snapshot directory by hand.

**Anti-goals:**
- Does **not** want clean to ever silently widen its scope between dry-run
  and confirm. The manifest must record exactly what was planned vs
  applied.
- Does **not** want a "successfully cleaned" message that hides errors on
  individual files.

**Exact CLI line:**
```
claude-housekeeper diagnose                                   # see the interrupted-op finding
claude-housekeeper rollback --dry-run op_20260511143022_a1b2c3d4
claude-housekeeper rollback --yes op_20260511143022_a1b2c3d4
```

Note: Jamie does **not** run `clean`. They are downstream of someone else's
clean. The design must serve them anyway, because they are the persona who
suffers most when clean's UX is unclear.

### Persona we deliberately exclude in v0.2.0: The Hands-Off Maintainer

We deliberately do not design for "the user who installed Housekeeper and
never wants to think about it again." That user is a v0.4+ persona: it
requires the learning loop, accepted-plan history, and a confidence model
that v0.2 does not have. Trying to serve them in v0.2 produces a `clean`
that is too eager and breaks Persona A's trust.

---

## 2. Mental-model decision

When Mara types `clean`, what is she thinking? Three candidate mental
models compete. Only one survives.

### Candidate 1 — Sweep model

**Pitch:** `clean` operates on everything safely auto-cleanable. The user
says "go clean stuff" and clean picks the safe set.

**Why it loses:** This is the `brew cleanup` model. It violates the
read-only-by-default contract because the *act of running* `clean` becomes a
delegated decision. Persona A is allergic to this. Persona B is fine with
this in CI but only because CI runs in a synthetic home and is allowed to
get it wrong. Persona C has to debug it.

Critical objection: `diagnose` already produces a list of findings. If
`clean` re-derives "what is safe" instead of cleaning exactly what
`diagnose` reported, then clean and diagnose can disagree, and the user has
no way to know which one to trust. Two sources of truth is worse than one.

**Verdict:** Anti-pick. The sweep model destroys the v0.1 trust contract.

### Candidate 2 — Per-finding model

**Pitch:** `clean` takes one target id and acts on it: `clean
cache/agentsys/perf@1.0.1`. The user names exactly what they want gone.

**Why it loses on its own:** Beautiful in principle. Brittle in practice.
Detector ids look like `plugin.expected_orphan`; the *target* of that
finding is a path. There is no "one id" — there is a (finding id, path)
pair. And the path can be 80 characters long. Persona A is not going to
type it.

**Why it almost wins:** If we extend the model so the user names the
*finding* and the path is filled in from the diagnose report, this is
correct. But that is no longer purely a per-finding model — that is the
inbox model, where the inbox is "the findings diagnose just emitted."

**Verdict:** Anti-pick as stated, but the right intuition. Becomes part of
the inbox model below.

### Candidate 3 — Inbox model (winner)

**Pitch:** `clean` operates on a triaged queue: the findings that `diagnose`
just reported and that the user explicitly selects. `clean` is "act on this
finding from the report." Nothing more.

**Mental loop:**
1. User runs `diagnose`. Sees a list of findings, each with a stable id and
   a target path.
2. User decides which finding(s) they want acted on.
3. User runs `clean --confirm --yes --target=<finding-id>` (and optionally
   `--path=<path>` if there are multiple matches).
4. `clean` re-runs `diagnose` internally to re-derive the target set, picks
   exactly the matching finding, refuses if the finding is no longer
   present.
5. Snapshot, apply, verify, report op id.

**Why it wins:**
- Preserves single source of truth. `diagnose` decides what is wrong;
  `clean` decides nothing — it just acts.
- Maps to Persona A's mental model: "I see a thing on the report I want
  gone." She does not think "I want to clean."
- Maps to Persona B's CI need: a target id is a stable identifier; the CI
  can decide what to whitelist.
- Maps to Persona C's recovery flow: the manifest records the finding id,
  so they can see exactly what intent triggered the op.
- Forces the design to be small: if a finding cannot be expressed as a
  finding-id + target-path pair, it cannot be cleaned. That is a feature.

**Verdict:** **Pick.**

### Consequence: the verb in clean is *transcribe*, not *automate*

Under the inbox model, `clean` is literally transcribing one row of the
report into a snapshotted mutation. It is not deciding anything new. The
report decides. `clean` acts. That is the entire conceptual shape.

This has a corollary: **`clean` without a `--target` is an error.** It is
not a sweep. It is not "clean everything safe." It is "clean *this* finding"
or it does nothing. We will return to this in §6 (naming).

---

## 3. Interaction grammar

Three end-to-end transcripts. The first is the happy path. The second is a
refusal. The third is a mid-flight failure. Each shows exactly what the
operator sees, exit code, and what they should do next.

### 3.1 Happy path — Persona A cleans one expected orphan

```
$ claude-housekeeper diagnose --scope=plugins
HOUSEKEEPER REPORT
No files changed.

PRIMARY
  stance: watch
  finding: old plugin cache version appears to be an expected orphan
  evidence: installed registry parsed; version not referenced; within-grace-period
  path: ~/.claude/plugins/cache/anthropic/research-tools/0.3.1
  next step: no action now (or `clean --target=plugin.expected_orphan` if intentional)

STANCE SUMMARY
  inform   1   watch  1   review  0   probe  0
  protect  0   prepare 0  repair  0   block  0

SCAN
  mode: diagnose
  degraded: no
  skipped: none

[exit 0]

$ claude-housekeeper clean --confirm --yes \
    --target=plugin.expected_orphan \
    --path=~/.claude/plugins/cache/anthropic/research-tools/0.3.1
HOUSEKEEPER CLEAN
op_20260511143022_a1b2c3d4
  target: plugin.expected_orphan
  path: ~/.claude/plugins/cache/anthropic/research-tools/0.3.1
  snapshot: ~/.claude/housekeeper/snapshots/op_20260511143022_a1b2c3d4/
  files snapshotted: 47 (12.4 MiB)
  applied: 47 of 47
  verified: 47 of 47
  status: verified

To roll back: claude-housekeeper rollback op_20260511143022_a1b2c3d4

[exit 0]

$ claude-housekeeper diagnose --scope=plugins
HOUSEKEEPER REPORT
No files changed.

PRIMARY
  stance: inform
  finding: no first-wedge issues found
  ...

[exit 0]
```

What this transcript demonstrates:
- The op id appears on its own line, copyable in one click.
- "Snapshot, applied, verified" appears as three count lines so a partial
  apply is visible at a glance ("applied: 47 of 47" not "done").
- The rollback hint is present *every time*, not just on failure. Rollback
  is not exotic; it is one click away by design.
- The follow-up `diagnose` is what closes the loop. v0.2.0 should not
  re-run diagnose automatically after clean — it should *suggest* it in
  the next-step hint. (Decision: do not auto-run; it confuses CI; see §4.)

### 3.2 Refusal path — protected path

```
$ claude-housekeeper clean --confirm --yes \
    --target=registry.local_command_identical \
    --path=~/.claude/commands/net-cables.md
HOUSEKEEPER CLEAN
status: refused

Path is protected by a do-not-touch rule.
  path:        ~/.claude/commands/net-cables.md
  rule:        doNotTouch.path = "commands/net-cables.md"
  rule reason: "hand-maintained local command"

No snapshot was taken. No files changed.

To override: remove the rule from ~/.claude/housekeeper/config.json,
or pick a different target. Protected paths cannot be cleaned via --yes.

[exit 2]
```

What this transcript demonstrates:
- Exit code `2` (not `1`) — refusals are legitimate, scriptable, and
  expected. `1` is reserved for real errors.
- The rule that triggered the refusal is quoted back to the user verbatim
  so they can find and audit it.
- No alternative is offered ("would you like to delete it anyway?"). The
  protected boundary is hard. The override path requires editing config —
  that friction is intentional.
- "No snapshot was taken. No files changed." is explicit. After the
  v0.1 promise this is the load-bearing reassurance.

### 3.3 Mid-flight failure path — partial apply auto-rollback

```
$ claude-housekeeper clean --confirm --yes \
    --target=plugin.expected_orphan \
    --path=~/.claude/plugins/cache/some-plugin/0.2.0
HOUSEKEEPER CLEAN
op_20260511144511_e5f6a7b8
  target: plugin.expected_orphan
  path: ~/.claude/plugins/cache/some-plugin/0.2.0
  snapshot: ~/.claude/housekeeper/snapshots/op_20260511144511_e5f6a7b8/
  files snapshotted: 31 (8.1 MiB)
  applying...
  ERROR: EACCES on ~/.claude/plugins/cache/some-plugin/0.2.0/skills/locked/SKILL.md
  applied: 14 of 31 (partial)

Auto-rollback triggered because the operation partially applied.
  rolled back: 14 of 14
  status: rolled_back

Run `diagnose` to see the unchanged state. The original finding will
re-appear because nothing was removed.

[exit 1]
```

What this transcript demonstrates:
- Status `rolled_back` is the *good* outcome of a partial apply per Q5.
  The user did not lose data; they did not gain anything either.
- The "rolled back: 14 of 14" line forces the eye to verify rollback was
  complete. If it were partial-rollback, the line would say "13 of 14"
  and the manifest would be in interrupted-operation state.
- Exit code `1`: this *is* an error from the user's perspective — clean
  did not achieve the goal. Distinct from refusal (`2`).
- The explicit "the original finding will re-appear" is critical. Without
  it, Persona A will run `diagnose`, see the finding still present, and
  conclude rollback failed. The text closes that ambiguity.

---

## 4. Failure UX

Six specific failure-text decisions. Each is exact wording, not a hint.

### 4.1 `clean --confirm` without `--yes`

Per Q1 decision (Decision Log row 4): `--yes` is the scriptable consent
flag, no interactive stdin. Without `--yes`, `clean --confirm` must
**refuse**, not prompt. Exact text:

```
$ claude-housekeeper clean --confirm --target=plugin.expected_orphan --path=...
HOUSEKEEPER CLEAN
status: refused

--confirm requires --yes for non-interactive consent in v0.2.0.
v0.2 does not read stdin. To proceed:

    claude-housekeeper clean --confirm --yes \
        --target=plugin.expected_orphan \
        --path=...

No snapshot was taken. No files changed.

[exit 2]
```

Rationale: the alternative — silently treat `--confirm` alone as dry-run —
is a CI footgun. Refuse loudly, give the corrected command line in the
refusal, exit `2`.

### 4.2 `--yes` without `--confirm`

```
HOUSEKEEPER CLEAN
status: refused

--yes alone does not arm mutation. You must also pass --confirm.

No snapshot was taken. No files changed.

[exit 2]
```

Rationale: `--yes` is "skip the interactive consent." `--confirm` is "I
want to mutate." Both must be present. This catches the operator who
copy-pasted half a command line.

### 4.3 Auto-rollback per Q5 (status `applied` + `partialApply: true`)

Text covered in transcript 3.3 above. The non-negotiable elements:
- The phrase "Auto-rollback triggered" must appear verbatim — operators
  will grep for it.
- The phrase must NOT reference internal jargon ("Q5", "partialApply
  flag"). It must use user-facing words: "the operation partially
  applied."
- The phrase "the original finding will re-appear" must close the
  message.

Final wording:

```
Auto-rollback triggered because the operation partially applied.
  rolled back: 14 of 14
  status: rolled_back

Run `diagnose` to see the unchanged state. The original finding will
re-appear because nothing was removed.
```

### 4.4 Partial failure then user runs `diagnose`

When the user runs `diagnose` after a partial-apply-then-rollback, the
report MUST be clean (no `housekeeper.interrupted_operation` finding) but
the original finding MUST re-appear. The manifest is in `rolled_back`
state, which is terminal per `docs/snapshot-architecture.md §9`.

If diagnose shows `housekeeper.interrupted_operation` here, that is a
bug: it would mean rollback itself was interrupted, which is a separate
failure mode (§3.3 transcript ends cleanly).

### 4.5 Snapshot budget exceeded

```
HOUSEKEEPER CLEAN
status: refused

Target exceeds the per-operation budget.
  files:    74 (limit 50)
  bytes:    14.2 MiB (limit 10.0 MiB)

v0.2 enforces this limit before any snapshot is written. Cleaning the
target would require splitting it into multiple operations, which v0.2
does not support. Defer or clean a more specific path.

No snapshot was taken. No files changed.

[exit 2]
```

The two limits are reported on separate lines, both with actual-vs-limit
pairs. This is the most likely refusal Persona A will see in practice;
the text has to be specific and not blame them.

### 4.6 File changed between snapshot and apply

```
HOUSEKEEPER CLEAN
op_20260511145011_b9c8d7a6
  target: plugin.expected_orphan
  status: aborted (snapshot_taken)

A file in the target set changed between snapshot and apply.
  path:     ~/.claude/plugins/cache/some-plugin/0.2.0/cache.db
  expected: sha256:1f3a...
  found:    sha256:9b2c...

No mutation was applied. The snapshot directory is retained until you
run:

    claude-housekeeper rollback --abort op_20260511145011_b9c8d7a6

[exit 2]
```

This text is critical: status is `snapshot_taken`, not `applied`. There
is nothing to roll back yet. The `--abort` form on `rollback` cleans up
the snapshot directory. (T-902 covers this.)

---

## 5. Scope recommendation

Every detector from `scripts/lib/audit.mjs`, classified for v0.2.0
cleanability. This is the table the synthesizer and the architect should
agree on. If it differs from theirs, we have a real disagreement.

Total detector ids: 18 (17 listed in the README plus `plugin.cache_size`,
which the audit.mjs source enumerates separately).

| Detector id | v0.2.0 cleanable? | If yes: user-observable effect / disk effect | If no/never: stance user sees instead | Anti-pattern avoided by NOT cleaning |
|---|---|---|---|---|
| `settings.invalid_json` | **never** | — | `block`; manual edit required | Auto-editing settings.json with no schema validator destroys live config |
| `settings.hook_path_dangling` | **no (v0.3+)** | — | `prepare`; "generate a patch preview only" | Auto-removing hook entries breaks user's intentional plugin path even when path is currently dangling |
| `settings.hook_command_shell_ambiguous` | **never** | — | `probe`; requires `claude --debug hooks` | Shell parsing is a different competence than path management; out of scope for Housekeeper |
| `settings.mcp_command_missing` | **no (v0.3+)** | — | `prepare`; patch preview | Same as hook_path_dangling: removing the entry may hide an environment issue the user is mid-fixing |
| `plugin.expected_orphan` | **YES** | Deletes the named plugin-cache version directory; disk effect: typically 1-50 MiB per version | — | — |
| `plugin.cache_unreferenced` | **no (v0.3)** | — | `probe`; "run freshness probe or review manually" | Outside the orphan grace period means we *don't know* if it is unused; cleaning requires the loader-side probe that v0.2 doesn't have |
| `plugin.duplicate_registration` | **never** | — | `review`; "review intent before any change" | Auto-resolution requires picking which scope to keep — that is user intent, not Housekeeper's call |
| `plugin.cache_size` | **never** | — | `inform`; orientation only | This is a metric, not a fault. Cleaning it would mean "delete some plugin caches" with no specific target — explicit anti-pattern |
| `registry.local_skill_shadow` | **never** | — | `review`; "decide whether the override is intentional" | Local skills are user surface area; deleting one is data loss |
| `registry.local_command_identical` | **never** | — | `review`; "show source, target, and precedence; await user intent" | User may have made the local copy *deliberately* before editing; "byte-identical" today is not consent to delete |
| `registry.local_command_diverged` | **never** | — | `review`; "show both versions and let the user decide" | The user clearly cared enough to diverge. Deleting their work is a bug |
| `registry.broken_frontmatter` | **never** | — | `prepare`; "generate a patch preview" | Auto-rewriting frontmatter without showing the diff is exactly the kind of magic that erodes trust |
| `housekeeper.interrupted_operation` | **never** | — | `block`; "inspect operation record" → routes to `rollback <id>` per Q3 | `clean` cleaning *its own* interrupted operation is recursive surgery; rollback handles this |
| `housekeeper.config_invalid` | **never** | — | `inform`; "edit the config manually or remove it to restore defaults" | Housekeeper repairing its own config is auto-modification of the protection policy — exact opposite of trust |
| `housekeeper.operations_unreadable` | **never** | — | `inform`; "fix permissions" | Permission fixes belong to the OS, not Housekeeper |
| `home.not_found` | **never** | — | `block`; "verify --home value" | Self-explanatory |
| `home.scan_budget_hit` | **never** | — | `inform`; "rerun with explicit larger budget" | Cleaning a "budget hit" finding is incoherent — there is no path to act on |
| `home.clean` | **never** | — | `inform`; "no first-wedge issues found" | Cleaning "no issues" is incoherent |

### v0.2.0 ship gate for cleanable detectors

**Ship cleanable in v0.2.0: exactly one detector — `plugin.expected_orphan`.**

That is the recommendation, and it is deliberate. The justification:

1. **`plugin.expected_orphan` is the only finding where:**
   - The target is unambiguously a plugin-cache version directory the
     user does not reference.
   - The grace period (7 days per `PLUGIN_ORPHAN_GRACE_DAYS`) already
     encodes the soak time we need before action is safe.
   - The disk effect is concrete and easy to explain ("deleted 12.4 MiB").
   - The rollback story is trivial (restore the directory from snapshot).
   - The current stance is `watch` — "not urgent, may matter later" —
     which is the *only* stance that maps cleanly to "user opted in to
     act." Compare to `review` (needs intent), `probe` (needs live
     evidence), `prepare` (patch preview), `protect` (boundary), `block`
     (refused) — none of those are the right shape for "yes, just do it."

2. **Cleaning any settings.* detector is too risky for v0.2.0.** Settings
   surgery is one bad regex away from a destroyed config file. We have
   snapshot rollback, but the user-visible cost of a wrong patch is high
   (Claude won't start). Defer to v0.3 where we can also ship a `harden
   --confirm` flow with a proper diff preview.

3. **Cleaning any registry.* detector is data loss in disguise.** Local
   commands and skills are user-authored. Even "byte-identical to plugin
   version" does not mean "delete the local copy" — the user may have
   intentionally locked the version. The review stance is correct.

4. **Cleaning `plugin.cache_unreferenced` (outside grace) requires the
   loader-side probe** that v0.2 explicitly doesn't have. Without it,
   "unreferenced" is an inference, not a fact. Wait for v0.3.

The single-detector cleanable set is the answer the staff-level test
asks for: "what is the smallest surface that meaningfully moves the
product forward without breaking the trust contract?" One detector. One
verb. One op id per invocation.

---

## 6. Naming

Two naming questions: the verb (`clean` vs alternatives), and the flag
shape (`--confirm` + `--yes` vs alternatives).

### 6.1 The verb: is `clean` right?

Candidates considered:

| Verb | Connotation | Fit with "Housekeeper" | Cost to rename | Verdict |
|---|---|---|---|---|
| `clean` | "tidy up the surface" — broad, optimistic, sweepy | medium (housekeepers clean) | — (no rename) | Status quo |
| `prune` | "selectively remove dead branches" — precise, mechanical | high (housekeepers prune plants) | high: rename plugin slash command, npm bin, README, docs site | Best semantic fit |
| `tidy` | "rearrange, not delete" — too soft for the actual act | medium | high | Misleading |
| `gc` | "garbage collect" — technical, opaque to non-eng | low (machine-coded) | high | Bad for the target persona |
| `apply` | "apply a plan" — neutral, fits the report→apply mental model | low | high | Generic |
| `act` | "carry out the next allowed step" | low | high | Vague |

**Tension.** `clean` is what the README, the slash command
(`/claude-housekeeper:housekeep clean`), the v0.1 refusal text, the docs
site, and the user's muscle memory all already say. Renaming costs:
- `commands/housekeep.md` argument hint
- `package.json` bin entry (if it becomes a top-level `claude-housekeeper
  prune`)
- `notes/PLAN-v0.2.md` §1 pillar table
- `docs/index.html` "Roadmap" item ("Snapshot-backed `clean`")
- README "Command Surface" section
- All v0.1 fixture goldens that mention `clean`
- The pre-v0.2 community expectation set by v0.1 release notes

The semantic case for `prune` is real: under the inbox model, the only
detector we will clean is `plugin.expected_orphan`, which is *literally*
pruning dead branches off the plugin cache tree. `prune` is more honest
about what v0.2 actually does.

The semantic case against `clean` is that "clean" implies completeness —
"the surface is now clean." That is not what v0.2 delivers. It delivers
"this specific finding has been acted upon." `clean` overpromises.

**Recommendation: keep `clean` for v0.2.0. Consider rename in v0.3.**

Justification:
1. v0.1 has shipped with `clean` on the command surface (refused, but
   visible). Changing the verb between v0.1 and v0.2 — the *exact*
   release where it transitions from refusal to actual mutation — is the
   highest possible cognitive cost moment for users. The change in
   *behaviour* is the headline; the change in *name* is noise.
2. The cost of rename is concentrated in user-facing docs and muscle
   memory. The cost is irreversible: once we ship v0.2 with the new
   verb, anyone who had v0.1 has to update their mental model and their
   scripts.
3. `prune` is a real improvement, but a marginal one. The trust gain
   from "the verb matches the act" is smaller than the trust loss from
   "Housekeeper renames things between minor versions."
4. If v0.3 expands the cleanable set beyond `plugin.expected_orphan`,
   the verb question reopens. At that point we have an honest decision:
   keep `clean` because the set is now broad, or split into
   `clean`/`prune`/etc. v0.2 is not the moment to bet on which way the
   surface grows.

The cost of NOT renaming: we live with a verb that overpromises by one
notch. That cost is paid in the help text ("clean only acts on findings
you name with --target") and the docs ("clean is not a sweep"). That is
a fair cost.

### 6.2 The flag shape: `--confirm` + `--yes`?

This pair was locked in `notes/PLAN-v0.2.md` §5 Q1: `--confirm` arms
mutation, `--yes` is the non-interactive consent (replacing what would
otherwise be a stdin prompt). The question: is this two flags too
clever?

**Alternatives considered:**

| Flag shape | Mental load | CI ergonomics | Reversibility cost | Verdict |
|---|---|---|---|---|
| `--confirm` alone (mutates) | low | high (just pass the flag) | high (if a user accidentally sets it in a shell alias, every `clean` mutates) | Risky |
| `--apply` alone | low | high | same risk as above | Different verb, same problem |
| `--confirm` (dry-run by default) + `--yes` (commit) | medium | high (CI passes both) | low (forgetting one is a no-op or refusal, never a surprise mutation) | **Pick** |
| `--execute` alone | low | high | same as `--confirm` alone | Same risk |

**Recommendation: keep `--confirm --yes`.**

Justification:
1. The asymmetry between the two flags encodes the safety we want:
   `--confirm` says "I want to do a mutation operation"; `--yes` says
   "I have read the plan and am not at an interactive prompt." Either
   one alone is a no-op (with a refusal message). Both together is the
   only path to mutation.
2. The CI script writer types both. The interactive operator types both.
   There is no surprise mutation path because both are required.
3. The "two flags is too clever" objection assumes operators will not
   read the help once. They will read it once, because the first time
   they hit the refusal message in §4.1, the message contains the
   corrected command line.

There is one alternative worth mentioning for future versions:
`--confirm=yes` (one flag with a value) collapses the surface to a
single flag. We do not recommend it for v0.2 because the value form is
harder to spot in CI logs and harder to express in environment
variables.

**One textual change recommended:** the `--help` output for `--confirm`
and `--yes` should appear as a coupled pair:

```
  --confirm           Arm mutation. Required with --yes to take effect.
                      Without --yes, refuses (v0.2 does not read stdin).
  --yes               Provide non-interactive consent. Required with
                      --confirm to take effect.
```

Each flag references the other in its own help line. That is the
cheapest way to make the asymmetry visible.

---

## 7. Refusal scenarios

Five concrete scenarios where the user expects clean to work and clean
must refuse. Each: what they did, what clean says (exact text), what they
should do next.

### 7.1 Operator forgot `--yes`

**What they did:**
```
claude-housekeeper clean --confirm --target=plugin.expected_orphan --path=...
```

**Clean says (exact text):** See §4.1. Exit 2. Refusal includes the
corrected command line.

**What they should do next:** Re-run the command with `--yes` appended.
The refusal message is literally a copy-paste of the corrected line.

### 7.2 Operator targets a protected path

**What they did:** `clean --confirm --yes --target=registry.local_skill_shadow --path=~/.claude/skills/jewelry-box/...`

**Clean says (exact text):** See §3.2 (refusal transcript). The rule and
its reason are quoted back. Exit 2.

**What they should do next:** Either edit
`~/.claude/housekeeper/config.json` to remove the protection (which is
itself a deliberate action), or pick a different target. There is no
override flag. This is the v0.1 promise ("protected means protected")
held intact in v0.2.

### 7.3 Operator targets a detector that v0.2 does not clean

**What they did:** `clean --confirm --yes --target=registry.local_command_diverged --path=...`

**Clean says (exact text):**
```
HOUSEKEEPER CLEAN
status: refused

The target `registry.local_command_diverged` is not cleanable in v0.2.

In v0.2.0, only `plugin.expected_orphan` is cleanable. Diverged local
commands require user intent (was the divergence deliberate?). Run
`diagnose` for the full finding, including paths, hashes, and the
suggested next step.

No snapshot was taken. No files changed.

[exit 2]
```

**What they should do next:** Read the finding in the `diagnose` report.
The `next step` field tells them what to do (in this case: "show both
versions and let the user decide" — a manual review).

### 7.4 Operator targets a finding that is no longer present

**What they did:** They saw the finding 20 minutes ago in a `diagnose`
report and ran `clean` to act on it. In the meantime, something else
already cleaned the directory (manual `rm`, another shell, a different
tool).

**Clean says (exact text):**
```
HOUSEKEEPER CLEAN
status: refused

The target `plugin.expected_orphan` was not present in the live
diagnose pass. The path you specified does not currently match any
finding:

    --path=~/.claude/plugins/cache/anthropic/research-tools/0.3.1

Possible causes:
  - The finding was already resolved (the path no longer exists).
  - The path was changed by another process since you last ran diagnose.
  - The path is misspelled.

Run `diagnose --scope=plugins` to see the current state.

No snapshot was taken. No files changed.

[exit 2]
```

**What they should do next:** Re-run `diagnose` and re-evaluate. The
refusal is *evidence* that something changed; that itself is useful
information. The user is now in Persona C territory and needs to
understand what.

### 7.5 Operator targets a path that exceeds the per-op budget

**What they did:** `clean --confirm --yes --target=plugin.expected_orphan --path=~/.claude/plugins/cache/big-plugin/2.0.0` where `2.0.0` contains 200 files totalling 50 MiB.

**Clean says (exact text):** See §4.5. Exit 2. Both limits reported.

**What they should do next:** Three options, listed in the help-text
order. (a) Defer — the directory is small enough to live with. (b) Clean
a more specific path — but this is only useful if the directory contains
a sub-tree that is itself a complete cleanable unit, which for plugin
caches it usually is not. (c) Wait for v0.3, which will support bulk ops
via a different flag.

The refusal text deliberately does NOT include a
`--force-bigger-budget` flag. The budget is a safety property, not a UX
inconvenience.

---

## 8. v0.2.0 ship gate

The minimum surface that ships. Cut ruthlessly.

**In:**
- `clean --confirm --yes --target=plugin.expected_orphan --path=<absolute-path>`
- Exit codes: `0` success, `1` mid-flight failure (with auto-rollback per
  Q5), `2` refusal (protected path, missing flags, not-cleanable
  detector, finding-not-present, budget exceeded, snapshot incomplete).
- Output: human-readable by default; `--json` produces the operation
  manifest plus a `result` envelope.
- `--dry-run` (default for `clean` without `--confirm`) shows what would
  happen, identical to `plan` for that target. No snapshot, no mutation.
- Rollback hint on every successful op: "To roll back: claude-housekeeper
  rollback <op-id>".

**Out (deferred to v0.3 or later):**
- Bulk / multi-target operations. v0.2 is one target per invocation.
- Any other detector cleanable. `plugin.cache_unreferenced`,
  `settings.hook_path_dangling`, `registry.broken_frontmatter` — all
  deferred.
- Interactive stdin prompts. Per Q1, `--yes` replaces them.
- `--force` flag of any flavour. There is no override path in v0.2.
- Auto-running `diagnose` after a successful clean. The CI consumer
  would see extra output it has to parse around. The interactive
  operator can type `diagnose` themselves; the rollback-hint convention
  is that the user types the next command.
- A "clean all findings flagged cleanable" sweep. The inbox model
  forbids it.
- `clean --target=plugin.expected_orphan` without `--path` (i.e., clean
  every matching finding). v0.2 is one path per op. (T-703 verifies
  *one* manifest per op; allowing many findings in one op would muddy
  the manifest schema and the rollback story.)

**The single-detector, single-path, single-op rule.** v0.2.0 ships
exactly this rule. It is not what `clean` will look like at v1.0. It is
what `clean` looks like when v0.2 is shipping to a user base that knows
v0.1 was read-only.

---

## 9. Five product risks

For each: probability, severity, mitigation.

### Risk 1 — Adoption: users see `clean` does almost nothing and uninstall

**Description.** Users see that the only cleanable detector is
`plugin.expected_orphan`, conclude Housekeeper v0.2 is a non-event, and
either uninstall or stop running it. Adoption stalls.

**Probability:** medium. The headline of v0.2 is "snapshot-backed
mutation exists," not "everything is cleanable now." A meaningful
fraction of users will skim the release notes and miss the nuance.

**Severity:** medium. Losing the user before v0.3 means we never get
the trust window to ship the broader cleanable set.

**Mitigation:**
- Release notes lead with the *snapshot framework*, not the cleanable
  detector. Frame as "v0.2 is the foundation; the cleanable set will
  grow per release in v0.3 and v0.4."
- The README "Roadmap" section must list the v0.3 cleanable candidates
  explicitly so users see the trajectory.
- `clean --help` should name *which* detectors are not yet cleanable
  and why, so users can see we have thought about it.

### Risk 2 — Misuse: a CI job accidentally cleans many homes

**Description.** A team writes a nightly CI job that scrapes
`plugin.expected_orphan` findings across a fleet of dev images and runs
`clean --confirm --yes` for each. A bug in the job loop accidentally
runs it across all employees' real laptops via a shared config.

**Probability:** low — requires several layers of misconfiguration —
but non-zero because CI jobs do escape their sandboxes.

**Severity:** high. The act itself is recoverable (rollback), but the
*surprise* erodes trust at scale.

**Mitigation:**
- The `--home=` flag must be explicit; `clean` must NOT default to the
  ambient `~/.claude`. Force the CI author to name the home.
- The snapshot directory size is bounded (50 files / 10 MiB), so the
  blast radius of a single op is bounded.
- The rollback flow is trivial: every op id is greppable from CI logs;
  rollback is one command per id.
- v0.2 should ship a `--require-explicit-home` env var that the user
  can set globally to refuse all invocations without `--home`.

### Risk 3 — Trust loss: a single false-positive `plugin.expected_orphan` clean breaks a user's session

**Description.** A plugin is marked as `expected_orphan` by the
detector (because the installed registry no longer references it within
grace), but the user is actively in the middle of a Claude session that
loaded that plugin's MCP server. Clean removes the version directory.
The next time the user's session tries to access the MCP server's
still-cached state, something breaks.

**Probability:** low. The detector's grace period is 7 days; a plugin
that has been unreferenced for that long is almost certainly truly
orphaned. But edge cases exist: a plugin that was uninstalled and
reinstalled at the same version within the window.

**Severity:** high. The first time this happens to a user, they lose
trust in `clean` for years.

**Mitigation:**
- The snapshot is real, atomic, and verified before clean returns. A
  rollback restores the directory in seconds.
- The output text includes the rollback command on *every* success,
  not just on failure. The rollback path is as visible as the clean
  path.
- Documentation must say plainly: "if your session breaks after a
  `clean`, run `rollback <op-id>` immediately and report."
- (For v0.3:) consider an active-session probe before cleaning. v0.2
  cannot do this without crossing the loader-key safe-mode boundary;
  the grace period is our proxy for "not in use."

### Risk 4 — Surprise: the auto-rollback behaviour confuses users

**Description.** A user runs `clean`, sees "auto-rollback triggered,"
and concludes Housekeeper is "broken." They do not understand that
auto-rollback is the *safety net working correctly*. They submit an
issue titled "clean failed silently."

**Probability:** medium. Auto-rollback is non-intuitive: most CLI tools
either succeed or leave a mess. Housekeeper succeeds, fails, or undoes
itself. The third option is new.

**Severity:** low. The user state is correct (nothing was cleaned). The
narrative is wrong (they think the tool failed when it actually saved
them).

**Mitigation:**
- The transcript text for partial-apply auto-rollback (§3.3) is
  designed to be self-explanatory. "Rolled back: N of N" and "the
  original finding will re-appear" are the load-bearing phrases.
- The `--help` output must include a "When auto-rollback fires"
  subsection with one concrete example.
- Release notes should include a brief "rollback is not failure"
  callout.

### Risk 5 — Coverage gap: v0.2 ships and users discover `clean` cannot touch the thing they actually want cleaned

**Description.** v0.2 ships with one cleanable detector. The first
thing many users will try is to clean a `plugin.cache_unreferenced`
(outside the 7-day grace), or a `settings.hook_path_dangling`, or a
`registry.local_command_identical`. All of those refuse. The user
concludes "this tool doesn't actually clean anything."

**Probability:** high — possibly the highest-probability item on this
list.

**Severity:** medium. The user does not lose data; they lose interest.

**Mitigation:**
- The refusal text (§7.3) names *why* the detector is not cleanable
  and what stance it has instead. The user learns something each time
  they hit it.
- The `diagnose` report's `next step` field for each finding should be
  the authoritative source of "what to do about this finding."
  Cleanable is just one of those next steps.
- `docs/clean-detector-matrix.md` (a v0.2 docs deliverable) should
  publish the full table from §5 so users can see the v0.2 → v0.3 →
  v0.4 trajectory at a glance.

---

## 10. Open questions for the synthesizer

The architect memo and the Claude-Code-platform memo are being written
in parallel. There are three places where this memo's recommendation
may disagree with theirs and the synthesizer must reconcile.

1. **The verb (`clean`).** This memo recommends keep. The
   Claude-Code-platform memo may recommend rename to a more
   slash-command-friendly token. If they disagree, the synthesizer
   should weight the README/v0.1 continuity argument above
   slash-command ergonomics, but should not simply override.

2. **The single-detector ship gate (`plugin.expected_orphan` only).**
   The architect memo may want a broader set ("clean what is cleanable"
   is architecturally cleaner). This memo strongly favours the narrow
   set. The synthesizer should be aware that broadening the set in v0.2
   is a product decision, not an architecture decision.

3. **The `--target` / `--path` pair as the addressing scheme.** This
   memo assumes the inbox model means "name the finding + path." The
   architect may propose a single `--operation-spec` JSON file. The
   synthesizer should pick the inbox model for v0.2 (Persona A types
   one line), but note the JSON form for v0.3 when bulk ops arrive.

---

## 11. Sign-off criteria for this memo

A staff product engineer at Anthropic would sign off on this memo when:

- The persona section is concrete enough that we can argue about edge
  cases by referring to a persona by name ("would Mara want that?").
- The mental model decision survives the question "what does the user
  *think* clean is?" with one sentence: "act on a finding from the
  report."
- The transcripts are copy-pasteable into a manual QA script and the
  output text matches.
- The scope table for v0.2.0 has *one* detector cleanable and a clear
  reason against the other 17.
- The naming decision documents the cost of NOT renaming, which is
  paid in help-text precision, not in trust.
- The risks section has a mitigation for each risk that can be shipped
  with v0.2.0, not deferred.

If any of those is unclear, the synthesizer should flag it; this memo
is draft until the cross-memo pass closes.

---

## Appendix A — Recommendation digest

For the synthesizer's executive summary:

- **Personas:** Mara (operator), `housekeeper-nightly.yml` (CI), Jamie
  (recovery).
- **Mental model:** Inbox model. `clean` acts on a finding from
  `diagnose`, never decides anything new.
- **Verb decision:** Keep `clean`. Rename cost > rename gain in v0.2.
  Reopen at v0.3.
- **Flag decision:** Keep `--confirm` + `--yes`. Make the help text
  cross-reference the pair.
- **Ship cleanable in v0.2.0:** exactly one detector,
  `plugin.expected_orphan`.
- **Out of scope for v0.2.0:** every other detector, bulk ops, stdin
  prompts, force flags, auto-diagnose-after-clean.
- **Highest product risk:** Risk 5 (coverage gap). Mitigated by the
  refusal text and the published cleanable matrix.
