# CODEX_HANDOFF — Phase 8: `rollback <id>` CLI

**Origin:** Claude session 2026-05-11, repo at v0.2.0-alpha.1 tag (commit on `main` HEAD).
**Reason for handoff:** Claude session hit 77% context. Phase 6 + Phase 7 of v0.2 are shipped and stable; Phase 8 is the natural next chunk and is well-scoped.
**Status of all upstream work:** complete, on `main`, CI green across Ubuntu+macOS × Node 20+22. **330 tests passing.**

---

## 1. What you are picking up

Implement **Phase 8 of v0.2** — the `rollback <id>` CLI command and its supporting primitives. The user has already acked the design (see §3). Five atomic tasks T-800..T-804 in `notes/TASKBOARD-v0.2.md`. After Phase 8 lands, the natural next step is Phase 9 (interrupted-operation recovery), but that is a separate handoff if you don't reach it.

Goal phrased operationally: a user can run

```bash
claude-housekeeper rollback op_20260512143022_a1b2c3d4 --confirm --yes
```

and Housekeeper reads the operation manifest, restores every snapshotted file to its original content (or absence, for deletions), transitions the manifest's `status` to `rolled_back`, and exits 0.

When this works end-to-end, v0.2.0 can drop the `-alpha` suffix.

---

## 2. Where everything is

### Already shipped — do NOT reimplement

- **`scripts/lib/snapshot.mjs`** (extensive)
  - `takeSnapshot(home, opts)` — atomic snapshot via write-temp + rename + fsync-parent
  - `applyOperation(id, home, ops)` — deletion-aware; sets `sha256After=null` on intended deletions
  - `verify(id, home)` — deletion-aware; transitions to `"verified"` or sets `verifyFailure`
  - `gcSnapshots(home)` — keeps last 10 terminal manifests; deletes older snapshots+manifests
  - `generateOpId()` — returns `op_<YYYYMMDDHHMMSS>_<8hex>`
  - `hashFile(path)` — sha256 hex
  - Error classes: `OperationStateError`, `SnapshotDriftError`, `SnapshotRefusedError`, `SnapshotBudgetError`
- **`scripts/lib/clean-plan.mjs`** (newly shipped — be familiar but DO NOT touch unless needed)
  - `composeCleanPlan`, `validateCleanPlan`, `executeCleanPlan`, `MUTATION_REGISTRY`
  - Error classes: `CleanPlanRefusal`, `PlanDriftError`, `LockHeldError`, `NotImplementedError`
- **`scripts/claude-housekeeper.mjs`** — has `clean` handler wired end-to-end. The `rollback` subcommand is already in the `VALID_COMMANDS` set; the handler is `runRollback(options)` and currently refuses mutation. Your job: replace that refusal with the real flow.
- **Operation manifests** at `<home>/.claude/housekeeper/operations/<op_id>.json` (schema in `docs/rollback-contracts.md`)
- **Snapshot tree** at `<home>/.claude/housekeeper/snapshots/<op_id>/...` (mirrors the snapshotted file paths under the op-id directory)
- **Lockfile** at `<home>/.claude/housekeeper/lock` (acquired by `executeCleanPlan`; reuse the same pattern)

### Read first (in this order)

1. `docs/design/clean-design.md` — final synthesized spec for the clean flow. Phase 8 mirrors its shape.
2. `docs/snapshot-architecture.md` §7 — rollback flow pseudocode
3. `docs/rollback-contracts.md` — manifest schema, status enum (`planned → snapshot_taken → applied → {verified, rolled_back, aborted}`), op-id format
4. `notes/PLAN-v0.2.md` §5 — Decision Log. Every user decision (Q1–Q5, Q-USER-1/2/3) is locked here.
5. `notes/TASKBOARD-v0.2.md` — T-800..T-804 exact scope + verify criterion
6. `scripts/lib/clean-plan.mjs` — your reference for module layout. Phase 8 introduces an analogous `scripts/lib/rollback-plan.mjs` (or extends `clean-plan.mjs` — your judgment, but the architect's memo argues for separation).

---

## 3. User decisions already locked (do not re-litigate)

From `notes/PLAN-v0.2.md` §5 Decision Log:

| Decision | Locked value | Why it matters to you |
|---|---|---|
| **Q1** consent UX | `--yes` flag; no interactive stdin | Phase 8 reuses this pattern: `rollback --confirm --yes <id>` |
| **Q2** dry-run format | Plan-mode rendering by default; `--json` opt-in | `rollback --dry-run` shows a `RollbackPlan` in plan-mode; `--json` emits the JSON envelope |
| **Q3** recovery surface | Reuse `rollback <id>` (NOT a separate `recover` command) | Phase 9 will route interrupted operations through your same handler |
| **Q4** GC during diagnose | NEVER | If you add `gcSnapshots` calls, they go in `executeRollbackPlan` only, not in any read path |
| **Q5** partial-apply | Auto-rollback only when status reached `applied`; earlier discards snapshot | Phase 8 is the consumer of this. Mid-rollback crashes flow through `housekeeper.interrupted_operation` |
| **Q-USER-1** tiebreak | Lex order of `targetPath` for equal-sized findings | Probably not relevant to Phase 8 (rollback targets one specific op id) |
| **Q-USER-2** plan freshness | `composeCleanPlan` re-runs `assembleReport` | Same principle: `composeRollbackPlan` should re-read the manifest fresh, not trust a cached copy |
| **Q-USER-3** expected_orphan | Never cleanable | Not directly relevant to rollback |

---

## 4. The five Phase 8 tasks

From `notes/TASKBOARD-v0.2.md`. Implement in order. **One PR per task.**

### T-800 — Add `rollback <id>` to CLI parser

- File: `scripts/claude-housekeeper.mjs`
- `parseArgs` already accepts positional `<id>` for the `rollback` command (line ~46 in current main). Verify it still does. If not, add it.
- Add `--dry-run` flag (boolean, default `false`).
- Add `--confirm` and `--yes` flag plumbing (already exist in current code from Phase 7).
- HELP_TEXT entry for the rollback command with all flags.
- Verify: `claude-housekeeper rollback --help` prints usage; `claude-housekeeper rollback op_X --dry-run` parses but doesn't yet do anything (handler stub).

### T-801 — `composeRollbackPlan(home, id)`

- File: new `scripts/lib/rollback-plan.mjs` (analogous to `clean-plan.mjs`)
- Reads the operation manifest at `<home>/.claude/housekeeper/operations/<id>.json`.
- Validates:
  - Manifest exists and parses
  - `status` is in `{"applied", "verified", "snapshot_taken"}` (rolling back from `snapshot_taken` means "discard the snapshot, no file was mutated")
  - Snapshot tree at `<home>/.claude/housekeeper/snapshots/<id>/` exists and contains the file rows from the manifest
- Returns a `RollbackPlan`:
  ```
  {
    schemaVersion: "0.2",
    opId, home,
    sourceManifestPath,
    operations: [RollbackOperation],
    refused: [RollbackRefusal],
    composedAt
  }
  ```
- Each `RollbackOperation`:
  ```
  {
    originalPath,
    sha256Before, sha256After,  // copied from source manifest
    snapshotPath,               // <home>/.claude/housekeeper/snapshots/<id>/<rel path>
    mutationKind,               // "dir-rmtree" in v0.2.0; future kinds use this to dispatch
    rollbackOp: { kind, args }  // serialisable descriptor for the inverse operation
  }
  ```
- For `dir-rmtree`: the rollback is "restore-dir-from-snapshot" — copy the snapshot directory tree back to the original path.
- Refusals to encode:
  - `manifest-not-found`, `manifest-malformed`, `manifest-not-rollbackable` (status not in the rollback-eligible set)
  - `snapshot-tree-missing`, `snapshot-tree-incomplete` (file count mismatch)
  - `drift-detected` — current file at `originalPath` (or its absence) doesn't match what the manifest says the post-apply state should be
- Per Q-USER-2: re-read the manifest from disk every time; don't trust caller-provided manifests.

### T-802 — `validateRollbackPlan(plan, home)`

- File: `scripts/lib/rollback-plan.mjs`
- Re-reads the manifest, recomputes the hashes, ensures no drift since `composeRollbackPlan` ran. Throws `PlanDriftError` if drift detected.
- For each operation: ensure the snapshot file still exists and its sha256 matches `sha256Before` from the manifest. If anything in the snapshot tree has been corrupted, throw `SnapshotIntegrityError`.

### T-803 — `executeRollbackPlan(plan, home)`

- File: `scripts/lib/rollback-plan.mjs`
- **Acquire the lockfile first** (reuse the exact pattern from `clean-plan.mjs` — atomic `O_EXCL` open of `<home>/.claude/housekeeper/lock`).
- For each operation:
  - Look up the inverse function in a `ROLLBACK_REGISTRY` (analogous to `MUTATION_REGISTRY`)
  - For `dir-rmtree`: copy the snapshot tree back via `fs/promises` `cp(source, dest, { recursive: true })`
  - Verify the restored file's sha256 matches `sha256Before`
- Update manifest:
  - `status` → `"rolled_back"`
  - `rolledBackAt` → ISO timestamp
  - Per file: `rollbackVerified: true|false`
- Atomic manifest write (reuse `atomicWrite` from `snapshot.mjs`)
- Release the lockfile (in `finally`)
- Return the updated manifest.

### T-804 — Wire `executeRollbackPlan` into the `rollback` CLI handler

- File: `scripts/claude-housekeeper.mjs`
- Replace the `runRollback` mutation-refusal stub with:
  ```
  1. Parse args: id (positional), --dry-run, --confirm, --yes
  2. composeRollbackPlan(home, id)
     - if refused[].length > 0: print refusals; exit 2
  3. If --dry-run: print the plan in plan-mode (or JSON if --json); exit 0
  4. If !--confirm: print "Refusing: --confirm not passed"; exit 2
  5. If --confirm && !--yes: print plan + "Refusing: --yes not passed"; exit 2
  6. validateRollbackPlan(plan, home)
     - if PlanDriftError or SnapshotIntegrityError: print message; exit 2
  7. executeRollbackPlan(plan, home)
  8. Print success report (mirror clean's RELOAD HINT pattern; no rollback-of-rollback hint needed)
  9. Exit 0 if status === "rolled_back", else 1
  ```
- Output format: model on `clean`'s output (see `docs/design/clean-design.md` §9 and the existing `printSuccessReport` in `scripts/claude-housekeeper.mjs`).

---

## 5. Workflow expectations

This repo has hard rules; please honor them:

- **GateGuard fact-forcing:** before every `Edit`/`Write`/`Bash` call, the hooks require you to present facts inline: file importers (via grep), public symbols affected, data files read/written with field shapes, user instruction verbatim. The hooks will block otherwise.
- **One PR per task** (T-800 through T-804 = 5 PRs). Each:
  - Branch from `origin/main`: `feat/v0.2-phase8-tNNN-<slug>`
  - Open as draft until CI green
  - `gh pr ready N` to promote
  - `gh pr merge N --squash --delete-branch`
  - Sync `main` (`git pull --ff-only origin main`) between PRs
- **CI matrix:** Ubuntu+macOS × Node 20+22 — must be green before merging. Branch protection enforces it.
- **Test budget:** 330 tests pass on main now. Add ~20–30 across Phase 8. If you hit a flaky test, fix it; don't `.skip`.
- **`npm test`, `npm run lint`, `npm run format`** all must pass before every commit. The format check is in `scripts/format-check.mjs` (trailing newlines, etc.).
- **Conventional commits:** `feat:`, `fix:`, `polish:`, `docs:`, `chore:`, `test:`. Include a body explaining the why.
- **`MUTATION_ALLOWLIST` in `test/no-mutation.test.mjs`:** if you create `rollback-plan.mjs`, add `"lib/rollback-plan.mjs"` to the allowlist. The v0.1 read-only invariant test must continue guarding everything else.
- **`package.json` lint chain:** add `node --check scripts/lib/rollback-plan.mjs && node --check test/rollback-plan.test.mjs` to the `scripts.lint` chain.

---

## 6. Tests you should add

Mirror the shape of `test/clean-plan.test.mjs`:

- `test/rollback-plan.test.mjs` — pure planner tests (compose + validate + registry)
- Extend `test/cli.test.mjs` — end-to-end via `spawnSync` against a synthetic home where a clean op has already been run

Coverage minimum:
- composeRollbackPlan happy / drift / missing-manifest / malformed-manifest / snapshot-tree-missing / wrong-status
- validateRollbackPlan re-detects drift between compose and validate
- executeRollbackPlan happy: dir-rmtree clean then rollback restores the directory tree
- executeRollbackPlan lock-held → throws LockHeldError
- executeRollbackPlan releases lockfile on every failure path
- CLI: `rollback id` (no flags) prints plan + refusal-needs-confirm
- CLI: `rollback id --confirm` without `--yes` refuses
- CLI: `rollback id --confirm --yes` happy path → directory restored, manifest status `rolled_back`
- CLI: `rollback id --dry-run` exits 0 with plan; never writes anything
- CLI: `rollback nonexistent-id` refuses with manifest-not-found

---

## 7. After Phase 8 ships

Bump version to `v0.2.0-beta.1`. Update README + `docs/index.html`:
- Move `rollback <id>` from "Coming" to "Shipped"
- Update the `clean` flow's success output (the existing "To roll back: claude-housekeeper rollback <opId>" hint now actually does something)

Then Phase 9 (interrupted-operation recovery) is the next handoff. It will be smaller — mostly wiring the existing `housekeeper.interrupted_operation` detector's output to suggest `rollback <id>` as the next action, plus any retry/abort semantics for stale operations.

---

## 8. Surfaces NOT to touch

- `scripts/lib/audit.mjs` detectors — stable; the two new ones (`plugin.cache_referenced_by_hook`, `housekeeper.stale_lock`) just shipped
- `scripts/lib/snapshot.mjs` — feature-complete for v0.2; the two recent deletion-aware patches are load-bearing for Phase 8
- `scripts/lib/clean-plan.mjs` — don't modify; only import from
- `docs/design/*.md` — historical; Phase 8 doesn't get its own design memo (the synthesis covers it)
- The `report` schema (`schemaVersion: "0.1"`) — do not touch
- The fixture goldens under `fixtures/synthetic-homes/` — fixtures are stable

---

## 9. Open questions you may encounter

If you hit a design ambiguity, **park it in `notes/PLAN-v0.2.md` §5 Decision Log** with a proposed default and the trade-off. Likely candidates:

- **Rollback partial-failure semantics:** if file 3 of 5 fails to restore, what happens to files 4-5? Recommendation: continue; mark `partialRollback: true`; transition to `rolled_back` with `verifyFailure` on the failed entries. Mirrors Q5's partial-apply pattern.
- **Idempotency:** running `rollback id` twice — second invocation should refuse with `manifest-not-rollbackable` (status already `rolled_back`).
- **Pluggable rollback for future mutation kinds:** `ROLLBACK_REGISTRY` is the extension point. v0.2.0 only registers `dir-rmtree`. Future kinds (`file-replace`, `file-unlink`, `json-fragment-edit`) get their inverses registered as they ship.

---

## 10. Quick-start checklist

```bash
# 0. Verify you have the right state
git checkout main
git pull --ff-only origin main
git log --oneline -3
# Expect: most recent commit is "release: v0.2.0-alpha.1" or similar

# 1. Verify tests pass
npm test            # → 330 passing

# 2. Read the four required docs (§2 above)

# 3. Start T-800
git checkout -b feat/v0.2-phase8-t800-cli-parser

# ... implement T-800, push, PR, merge, repeat for T-801..T-804
```

When all five PRs land, run:

```bash
node ./scripts/claude-housekeeper.mjs rollback <some-existing-op-id> --confirm --yes
```

against a synthetic home and verify a directory got restored. That's done.

---

## 11. Where to leave breadcrumbs for the next handoff

If you run out of context before finishing:

- Commit any in-progress branch and push it
- Update this file's §1 with what you completed and which task is in flight
- Add a **CODEX_HANDOFF_STATE** block at the top with current PR numbers and any uncommitted state
- Park any open questions in `notes/PLAN-v0.2.md` §5

---

**Repo URL:** https://github.com/hemzaz/claude-housekeeper
**Last green tag:** v0.2.0-alpha.1 (commit on `main` HEAD as of this handoff)
**Project local dir:** `/Users/elad/PROJ/housekeeper`
