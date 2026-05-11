# HANDOFF — Phase 10: broaden the cleanable set (file-unlink kind)

**Origin:** Tag `v0.2.0-beta.1` (commit `e933685`).
**Status of upstream work:** Complete. 358 tests passing, Ubuntu+macOS × Node 20+22.
**Reason for handoff:** v0.2.0-beta.1 ships with one cleanable detector (`plugin.cache_unreferenced`) and one mutation kind (`dir-rmtree`). The README "Coming" list and the GitHub Pages site both promise broadening the cleanable set in v0.2.x patches — Phase 10 is the smallest chunk that delivers on that promise without introducing new infrastructure burden.

---

## 1. What you are picking up

Add **`file-unlink`** as a second mutation kind, register its rollback inverse, and gate two new detectors behind it:

- **`housekeeper.stale_lock`** — Housekeeper's own concurrency lockfile is stale (> 30 min). Safe to delete; restoring it from snapshot is meaningless but the symmetry preserves the rollback contract.
- **`registry.local_command_identical`** — a local command file is byte-identical to its plugin counterpart. Safe to delete the local copy; the plugin version takes over via precedence.

After Phase 10:

```bash
claude-housekeeper clean --confirm --yes --target=housekeeper.stale_lock
claude-housekeeper clean --confirm --yes --target=registry.local_command_identical --path=<abs path>
claude-housekeeper rollback <op_id> --confirm --yes   # works for file-unlink ops too
```

Both run through the existing `composeCleanPlan → validateCleanPlan → executeCleanPlan` pipeline. Both produce manifests that the existing `rollback <id>` flow can restore.

Out of scope (defer to Phase 11+):
- `settings.hook_path_dangling` (requires a new `json-fragment-edit` kind with JSON formatting preservation; non-trivial).
- `plugin.duplicate_registration` (which duplicate to keep is a judgment call).
- `registry.local_command_diverged` (intent-laden; never auto-cleanable).
- `plugin.expected_orphan` (locked by Q-USER-3 — never cleanable).

---

## 2. Where everything is

### Extension points to modify

| File | Where | What to add |
|---|---|---|
| `scripts/lib/clean-plan.mjs` line 146 | `CLEANABLE_DETECTORS_V02` Set | Add `"housekeeper.stale_lock"` and `"registry.local_command_identical"` |
| `scripts/lib/clean-plan.mjs` line 110 | `MUTATION_REGISTRY` Object.freeze | Add a `"file-unlink"` factory: `(args) => ({ apply: () => fs.unlinkSync(args.path) })` |
| `scripts/lib/clean-plan.mjs` around line 466 | `composeCleanPlan` operation builder | Branch on detector id: stale_lock → `mutationKind: "file-unlink"`; local_command_identical → same. Pass the absolute file path in args. |
| `scripts/lib/rollback-plan.mjs` line 197 | `ROLLBACK_REGISTRY` | Add a `"file-unlink"` inverse: copy snapshotted file back to `originalPath` |
| `scripts/lib/snapshot.mjs` | `takeSnapshot` | Already deletion-aware (per the T-704 architect+tie-breaker patches A/B). Verify it handles a single-file target alongside the existing directory snapshot path; if it doesn't, add a `--target-kind=file` branch that snapshots one file rather than walking a tree. |

### Already shipped — DO NOT reimplement

- Atomic snapshot protocol (`takeSnapshot` write-temp + rename + fsync-parent)
- Lockfile pattern (`O_EXCL` open of `<home>/.claude/housekeeper/lock`, 30-min staleness)
- Deletion-aware `applyOperation` and `verify` (Patches A/B from T-704)
- `composeCleanPlan` → `validateCleanPlan` → `executeCleanPlan` pipeline
- `composeRollbackPlan` → `validateRollbackPlan` → `executeRollbackPlan` pipeline
- Operation manifest schema v0.2 (`status: planned → snapshot_taken → applied → {verified, rolled_back, aborted}`)
- Per-operation budget (50 files / 10 MiB)
- 12-rule refusal classifier in `composeCleanPlan`
- The two new audit detectors (`plugin.cache_referenced_by_hook`, `housekeeper.stale_lock`) — both already fire; only `cache_referenced_by_hook` forces `protect` stance. `stale_lock` is `forceStance: "inform"` today; Phase 10 will need it to be eligible for cleaning, so re-check its stance is compatible with the cleanable gate (probably needs to become `prepare`, mirroring `cache_unreferenced`).

### Read first (in this order)

1. `docs/design/clean-design.md` §3 module layout and §4 snapshot bug fixes
2. `scripts/lib/clean-plan.mjs` — read end to end; this is your reference module
3. `scripts/lib/rollback-plan.mjs` — same; ROLLBACK_REGISTRY is the pattern to extend
4. `notes/PLAN-v0.2.md` §5 Decision Log — every locked decision
5. `test/clean-plan.test.mjs` and `test/rollback-plan.test.mjs` — mirror their shape for new tests

---

## 3. User decisions already locked (do not re-litigate)

From `notes/PLAN-v0.2.md` §5:

| Decision | Relevance to Phase 10 |
|---|---|
| Q1 — `--yes` flag, no stdin | Phase 10 reuses |
| Q2 — plan-mode + `--json` | Phase 10 reuses |
| Q3 — `rollback <id>` is the recovery surface | Already plumbed by Phase 8/9 |
| Q4 — GC NEVER during diagnose | Honored; only `executeCleanPlan`/`executeRollbackPlan` may GC |
| Q5 — auto-rollback only when status reached `applied` | Same crash-window contract applies to `file-unlink` |
| Q-USER-1 — lex order tiebreak | Apply when two `file-unlink` candidates have identical sizes |
| Q-USER-2 — `composeCleanPlan` re-runs `assembleReport` | Same; freshness invariant unchanged |
| Q-USER-3 — `plugin.expected_orphan` never cleanable | Reinforced; do NOT add it to `CLEANABLE_DETECTORS_V02` |

---

## 4. The four Phase 10 tasks

One PR per task. Branch from `origin/main`.

### T-1000 — Add `file-unlink` mutation kind

- File: `scripts/lib/clean-plan.mjs`
- Add to `MUTATION_REGISTRY`:
  ```js
  "file-unlink": (args) => ({
    apply: () => fs.unlinkSync(args.path),
    args,
  })
  ```
- Update the `MUTATION_REGISTRY` JSDoc to list both kinds.
- Verify: `MUTATION_REGISTRY["file-unlink"]({ path: tmp }).apply()` removes the file.

### T-1001 — Add `file-unlink` inverse to ROLLBACK_REGISTRY

- File: `scripts/lib/rollback-plan.mjs`
- Add to `ROLLBACK_REGISTRY`:
  ```js
  "file-unlink": async ({ snapshotPath, originalPath, sha256Before }) => {
    await fs.promises.cp(snapshotPath, originalPath);
    const restoredHash = await hashFile(originalPath);
    if (restoredHash !== sha256Before) {
      throw new SnapshotIntegrityError(`Restore drift on ${originalPath}`);
    }
  }
  ```
- Verify: rollback test creates a file, snapshots it, deletes it via `file-unlink`, rolls back, sees the file restored byte-for-byte.

### T-1002 — Gate `housekeeper.stale_lock` as cleanable

- File: `scripts/lib/clean-plan.mjs` — add `"housekeeper.stale_lock"` to `CLEANABLE_DETECTORS_V02`.
- File: `scripts/lib/audit.mjs` — confirm `housekeeper.stale_lock` carries `targetPath` (absolute path to `<home>/.claude/housekeeper/lock`) and a stance that the refusal classifier allows for cleaning. If it's currently `inform` (informational only), change to `prepare` so it survives the stance gate. **Read the existing rule ordering in `composeCleanPlan` first** — the cleanable-set check happens BEFORE the stance gate (per `clean-plan.mjs` line 357 commentary), so an `inform` detector that's in the set still passes the gate. Double-check that's actually how the rules run today; the agent who shipped T-704 noted moving the cleanable-set check ahead of the stance/missing-key rules specifically for `plugin.cache_unreferenced` (a `probe` detector). Same pattern applies here.
- Refusal cases to encode: lock is < 30 min old → emit refusal (`stale-lock-not-yet-eligible`). The audit detector should only fire when stale, but defense-in-depth in `composeCleanPlan` is correct.
- Verify: synthetic home with a stale lock file → `clean --target=housekeeper.stale_lock --confirm --yes` deletes the lock; rollback restores it; CLI test exercises both paths.

### T-1003 — Gate `registry.local_command_identical` as cleanable

- File: `scripts/lib/clean-plan.mjs` — add `"registry.local_command_identical"` to `CLEANABLE_DETECTORS_V02`.
- Build the operation: `mutationKind: "file-unlink"`, `args: { path: <absolute path of the local command file> }`.
- Refusal cases: if the local command is NOT in fact byte-identical at compose time (drift since the report was assembled, even though Q-USER-2 re-runs `assembleReport`), refuse with `drift-detected`. If the path is under a `doNotTouch` rule, refuse with `protected-path`. (Both should already be handled by the existing refusal classifier — verify they fire.)
- Verify: synthetic home with `commands/X.md` byte-identical to the plugin's `commands/X.md` → clean deletes the local; rollback restores it. Diverged variant → refused with `not-cleanable` reason. Diverged-then-reverted variant → still cleanable.

---

## 5. Workflow expectations

Identical to Phase 8 — see `notes/HANDOFF-CODEX-PHASE-8.md` §5 for full text. Highlights:

- GateGuard fact-forcing fires on every Edit/Write/Bash — present facts inline before retrying.
- One PR per task. Draft until CI green; `gh pr ready N`; `gh pr merge N --squash --delete-branch`.
- `npm test && npm run lint && npm run format` must pass before every commit.
- `MUTATION_ALLOWLIST` in `test/no-mutation.test.mjs` — `clean-plan.mjs` and `rollback-plan.mjs` are already allowlisted. No change needed.
- Conventional commits. Bodies explain *why*.

---

## 6. Tests to add

Coverage minimum (~20 new tests, mirroring Phase 8's allocation):

- `test/clean-plan.test.mjs`:
  - `composeCleanPlan` builds a `file-unlink` operation for a `housekeeper.stale_lock` finding
  - same for `registry.local_command_identical`
  - refusal: `drift-detected` when local command is no longer byte-identical at compose time
  - refusal: `protected-path` when the local command path matches a `doNotTouch` rule
  - refusal: `stale-lock-not-yet-eligible` for a fresh lock (defense-in-depth)
- `test/rollback-plan.test.mjs`:
  - `ROLLBACK_REGISTRY["file-unlink"]` restores a deleted file byte-for-byte
  - drift on restore (sha mismatch) → throws `SnapshotIntegrityError`
- `test/cli.test.mjs`:
  - `clean --target=housekeeper.stale_lock --confirm --yes` happy path
  - `clean --target=registry.local_command_identical --confirm --yes --path=<…>` happy path
  - `clean --target=registry.local_command_identical` (no path) → refused with explicit error
  - `rollback <id>` for a `file-unlink` op restores the file
- `test/snapshot.test.mjs`:
  - If you added a single-file snapshot branch, exercise it; otherwise document why the existing recursive snapshot handles single files (it should — `cp -r` on a file works).

---

## 7. After Phase 10 ships

Bump to `v0.2.1-beta.1` or `v0.2.0-rc.1` (your call — the version bump strategy is open; see `notes/PLAN.md` if it has guidance, otherwise propose).

Update README + `docs/index.html`:
- Move the broadening item from "Coming" to "Shipped" (with the two specific detector ids called out)
- Update the "Current Checks" list in README to mark which are cleanable

If no critical issues surface within a soak period (user's call), drop the `-beta` suffix and tag `v0.2.0`.

---

## 8. Surfaces NOT to touch

- `scripts/lib/audit.mjs` — the detector implementations are stable. You may need to adjust `housekeeper.stale_lock`'s `forceStance` if the existing one blocks cleaning (per T-1002 note); that's the only edit.
- `scripts/lib/snapshot.mjs` — feature-complete; only touch if the single-file snapshot path needs explicit branching.
- `scripts/claude-housekeeper.mjs` — the `clean` and `rollback` handlers already dispatch by detector and op-kind; no CLI changes needed unless `--target` validation needs the new detector ids added to an allowlist (check `parseArgs`).
- The `report` schema (`schemaVersion: "0.1"`) — do not touch.
- Fixture goldens under `fixtures/synthetic-homes/` — extend with new fixtures for the two new cleanable cases; do not modify existing ones.

---

## 9. Open questions you may encounter

Park decisions in `notes/PLAN-v0.2.md` §5 Decision Log with proposed default and trade-off.

- **Single-file vs directory snapshot semantics:** the v0.2.0 snapshot path was designed around `dir-rmtree`. `file-unlink` snapshots one file. If `takeSnapshot` needs a branch for "snapshot a single file, not a directory tree," that's a one-time architectural cost. Recommended default: extend `takeSnapshot` to accept either; the manifest entry has the same shape either way (path, sha256, snapshot path).
- **`registry.local_command_identical` and config-level overrides:** what if the user's `doNotTouch` rule names the local command path? Already handled — `protected-path` refusal pre-empts. No new policy.
- **Multi-target cleans:** `clean --target=A --target=B` is currently single-target (one `--target` flag, with an optional `--path`). Phase 10 does not change this. If you find you need batched cleans for the two new detectors, that's Phase 11 work; refuse with a clear "single-detector-only in v0.2.x" message instead.

---

## 10. Quick-start checklist

```bash
git checkout main
git pull --ff-only origin main
git log --oneline -3
# Expect: e933685 feat: remind on interrupted session operations (#62)

npm test            # → 358 passing

# T-1000
git checkout -b feat/v0.2-phase10-t1000-file-unlink-kind
# ... implement, push, PR, merge, repeat
```

---

## 11. Where to leave breadcrumbs

If you run out of context before all four tasks land:

- Commit any in-progress branch and push it.
- Update this file's §1 with what landed and what's in flight.
- Add a **PHASE_10_STATE** block at the top with current PR numbers.
- Park open questions in `notes/PLAN-v0.2.md` §5.

---

**Repo:** https://github.com/hemzaz/claude-housekeeper
**Last green tag:** `v0.2.0-beta.1` (HEAD as of this handoff)
**Project local dir:** `/Users/elad/PROJ/housekeeper`
