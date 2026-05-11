# T-704 Clean Flow — Final Design

Synthesis of four design memos for Claude Housekeeper's `clean --confirm --yes`
end-to-end flow. This is the buildable spec. All cross-memo conflicts are
resolved. All user-decision Q's are locked.

| Source | Lines | Role |
|---|---|---|
| [`clean-architecture-memo.md`](./clean-architecture-memo.md) | 1247 | Plan object schema, snapshot strategies, refusal taxonomy, threat model |
| [`clean-product-memo.md`](./clean-product-memo.md) | 1058 | Personas, mental model, interaction grammar, naming, ship gate |
| [`clean-claude-code-memo.md`](./clean-claude-code-memo.md) | 1013 | Platform constraints: grace window, MCP, concurrent sessions, lockfile |
| [`clean-tie-breaker.md`](./clean-tie-breaker.md) | 1241 | 17 conflicts identified, 17 rulings, aggregated spec |

The tie-breaker's Section 4 is the buildable surface; this synthesis restates
it in implementation order with the three user decisions baked in.

---

## 1. What ships in v0.2.0

A single command line, a single cleanable detector, a single mutation kind.

### Command form
```
claude-housekeeper clean --confirm --yes --target=plugin.cache_unreferenced --path=<absolute path>
```
- `--target=<detector-id>` and `--path=<absolute path>` together identify
  exactly one finding from the most recent `diagnose`.
- `--confirm` arms the mutation path (without it: dry-run, exit 0).
- `--yes` skips the consent prompt (without it: refuse with exit 2).
- `--json` is opt-in for tooling.
- Verb stays `clean`. Flag pair stays `--confirm` + `--yes`.

### Cleanable detector — exactly one
- **`plugin.cache_unreferenced`** — fires for plugin cache version directories
  OUTSIDE the 7-day grace window (per `scripts/lib/audit.mjs:528`).
- **`plugin.expected_orphan` is NOT cleanable** — and never will be, even in
  v0.3+. It fires WITHIN grace; deletion during grace breaks any concurrent
  Claude session still loading from that version. This is Claude Code's own
  contract, not a Housekeeper UX choice.

### Mutation kind — exactly one
- **`dir-rmtree`** — recursive delete of a plugin cache version directory.

The architect's other three mutation kinds (`file-replace`, `file-unlink`,
`json-fragment-edit`) are reserved in the `MutationKind` enum but unused in
v0.2.0. Adding them ships in v0.2.x patches.

---

## 2. Refusal taxonomy (final, merged)

Every other detector routes through `composeCleanPlan` and lands in `refused[]`.
The classifier runs these checks in this order — first match wins.

| # | Reason | Triggers |
|---|---|---|
| 1 | `plan-state-error` | Manifest already in a terminal status |
| 2 | `protected-path` | T-602 hard boundary; covers `doNotTouch` rules |
| 3 | `sector-boundary` | `~/.claude/credentials/**`, `.env`, etc. |
| 4 | `execution-class` | Surface's `executionClass != "inert"` |
| 5 | `rollback-class` | Surface's `rollbackClass == "not-applicable"` |
| 6 | `owner` | Surface's `ownerClass` outside `{claude-managed, user-owned}` |
| 7 | `plugin-symlinked-cache` | `lstat` shows the cache dir is a symlink |
| 8 | `plugin-cache-referenced-by-hook` | Any `~/.claude/settings.json` hook command string contains the target path |
| 9 | `plugin-cache-has-mcp-server` | The plugin's `plugin.json` declares an MCP server (live or stale) |
| 10 | `stance` | Finding stance not in `{review, prepare}` |
| 11 | `missing-key` | Finding's `evidence.missing[]` is non-empty |
| 12 | `no-mutation-mapping-in-v0.2` | Detector id is not in the v0.2.0 cleanable set |

Each refusal yields a structured error: `class`, `reason`, `targetPath`,
`message`, `exitCode=2`.

Two refusals add new always-on detectors to `scripts/lib/audit.mjs`:
- `plugin.cache_referenced_by_hook` (stance `protect`) — proactively warns the user
- `housekeeper.stale_lock` (stance `inform`) — surfaces a lockfile past its
  30-minute staleness window

---

## 3. Module layout

| File | Status | Purpose |
|---|---|---|
| `scripts/lib/clean-plan.mjs` | NEW | `composeCleanPlan`, `validateCleanPlan`, `executeCleanPlan`, `MUTATION_REGISTRY` |
| `scripts/lib/snapshot.mjs` | extend | Patch A: deletion-aware `applyOperation`. Patch B: deletion-aware `verify`. |
| `scripts/lib/audit.mjs` | extend | New `plugin.cache_referenced_by_hook` + `housekeeper.stale_lock` detectors |
| `scripts/claude-housekeeper.mjs` | extend | `clean` handler calls `composeCleanPlan` → `validateCleanPlan` → `executeCleanPlan` |
| `test/no-mutation.test.mjs` | extend | Allowlist `lib/clean-plan.mjs` (the second designated mutation surface) |
| `test/clean-plan.test.mjs` | NEW | Plan composition + validation + refusal tests |
| `test/clean-execute.test.mjs` | NEW | End-to-end with snapshot lifecycle |

---

## 4. The two snapshot.mjs bug fixes (load-bearing for T-704)

The tie-breaker confirmed and extended the architect's bug report. Both must
ship in the T-704 PR (NOT deferred).

### Patch A — `applyOperation` (`scripts/lib/snapshot.mjs:558`)
Currently calls `hashFile(entry.originalPath)` unconditionally after
`ops[i].apply()`. For a `dir-rmtree` deletion, the path no longer exists →
ENOENT → catch block → `partialApply: true` spuriously set for every
successful deletion.

**Fix:** skip the post-apply `hashFile` call when the file no longer exists.
Leave `sha256After = null` to signal intended-deletion. Distinguish from a
real `ENOENT` (use `existsSync` before vs after as the disambiguator).

### Patch B — `verify` (`scripts/lib/snapshot.mjs:600`)
Currently `continue`s on null `sha256After`, silently passing deletions.

**Fix:** treat null `sha256After` as intended-deletion. Assert
`!existsSync(entry.originalPath)`. If the file still exists, the deletion
silently failed — flip `verifyFailure: true` on that entry.

Both patches are tested in `test/snapshot-writer.test.mjs` extensions
(new "deletion-aware" suite).

---

## 5. Concurrency lockfile (new infrastructure)

Claude Code provides no session lock primitive. Housekeeper-on-Housekeeper
concurrency (parallel agents in worktrees, two terminals, CI + manual) is a
real risk. Ship a self-managed lockfile.

- **Path:** `<home>/.claude/housekeeper/lock`
- **Schema:** `{ pid, hostname, opId, startedAt, stalenessAt }` (JSON)
- **Acquire:** atomic create-with-O_EXCL; fail if exists and `now < stalenessAt`.
- **Release:** unlink on terminal manifest status.
- **Staleness window:** 30 minutes (the longest plausible legitimate clean op).
- **Stale-lock recovery:** `housekeeper.stale_lock` inform finding tells the
  user to manually delete the lockfile and rerun.

The lock is acquired by `executeCleanPlan` AFTER `composeCleanPlan` and
`validateCleanPlan` succeed — refusals don't take the lock.

---

## 6. Three user decisions (acked, locked)

| # | Question | Decision | Rationale |
|---|---|---|---|
| **Q-USER-1** | Tie-break between equal-sized findings | Lexicographic order of `targetPath` | Deterministic, cheap, testable |
| **Q-USER-2** | Does `composeCleanPlan` re-run `assembleReport`? | **Yes** | ~100 ms cost prevents stale-report targeting (user runs `diagnose`, waits, runs `clean`; report may be hours old). The freshness invariant is worth the cost. |
| **Q-USER-3** | Does `plugin.expected_orphan` ever become cleanable in v0.3+? | **No** | It's Claude Code's own contract per the platform memo §8.2 R2 — concurrent sessions hold that version. A user can't consent on behalf of their other live session. |

---

## 7. T-704 implementation order

Build in this sequence, each step a focused commit/PR:

1. **Fix the snapshot.mjs bugs first** — Patches A + B from §4. Add deletion-aware tests. Ship as its own PR before T-704 lands. (The cleanest possible separation: bug fixes vs feature.)
2. **Add the new detectors** — `plugin.cache_referenced_by_hook` + `housekeeper.stale_lock` in `scripts/lib/audit.mjs`. Tests in `test/audit.test.mjs`.
3. **Create `scripts/lib/clean-plan.mjs`** — three pure functions + `MUTATION_REGISTRY`. Allowlist in `test/no-mutation.test.mjs`. Tests in `test/clean-plan.test.mjs` (composeCleanPlan classifier, validateCleanPlan drift detection).
4. **Wire `executeCleanPlan` into the `clean` handler** — `scripts/claude-housekeeper.mjs`. Lockfile acquire/release. Reload-hint output. Tests in `test/clean-execute.test.mjs` (full end-to-end with a synthetic `plugin.cache_unreferenced` fixture).

Step 1 is independent. Steps 2-4 are sequential.

---

## 8. Deferred to v0.2.x patches

These were considered and explicitly cut:

| Item | Why deferred |
|---|---|
| `registry.local_command_identical` cleanable | Tractable but ships after the dir-rmtree flow is proven |
| `settings.hook_path_dangling` cleanable | Requires JSON-fragment-edit mutationKind; complex precedence (user/project/local); deferred per the Claude Code memo §5 |
| `registry.broken_frontmatter` cleanable | User intent ambiguous — might be a WIP; refused for safety |
| Auto-rollback on `partialApply: true` | Tie-breaker Ruling 9: deferred to v0.2.x; partial applies surface via existing `housekeeper.interrupted_operation` and route to `rollback <id>` (Phase 8) |

---

## 9. What the user sees

### Happy path
```
$ claude-housekeeper clean --confirm --yes --target=plugin.cache_unreferenced --path=/Users/u/.claude/plugins/cache/agentsys/perf/1.0.1
HOUSEKEEPER CLEAN
1 operation planned. Op id: op_20260512143022_a1b2c3d4

  dir-rmtree  /Users/u/.claude/plugins/cache/agentsys/perf/1.0.1  (32.4 MiB)

  snapshot taken    → ~/.claude/housekeeper/snapshots/op_.../...
  applied           → directory removed
  verified          → no residual files

DONE. Operation verified.

RELOAD HINT
  Run /reload-plugins in any active Claude Code session to drop the
  cache reference. The plugins/data/ directory was preserved.

To roll back: claude-housekeeper rollback op_20260512143022_a1b2c3d4
```

### Refusal path (no `--yes`)
```
$ claude-housekeeper clean --confirm --target=... --path=...
Refusing mutation: --yes not passed. Pass --confirm --yes to skip the
prompt and apply.
$ echo $?
2
```

### Refusal path (detector not cleanable)
```
$ claude-housekeeper clean --confirm --yes --target=registry.local_command_diverged --path=...
Refusing: registry.local_command_diverged is not cleanable in v0.2.0.
Reason: no-mutation-mapping-in-v0.2.
$ echo $?
2
```

---

## 10. Surface area summary (for changelog)

When T-704 ships in v0.2.0:
- New command: `clean --confirm --yes --target=<id> --path=<path>` (and `--json`)
- New detector: `plugin.cache_referenced_by_hook` (stance `protect`)
- New detector: `housekeeper.stale_lock` (stance `inform`)
- New file: `scripts/lib/clean-plan.mjs`
- New file: `<home>/.claude/housekeeper/lock` (per-operation; auto-cleaned)
- Two bug fixes: deletion-aware `applyOperation` + deletion-aware `verify`

Schema-stable JSON adds (per `docs/schema-stability.md`): nothing new at the
report level (still 0.1). The operation manifest schema is 0.2 (already locked
in `docs/rollback-contracts.md`).
