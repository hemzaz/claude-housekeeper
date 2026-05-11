# Plan — Claude Housekeeper v0.2

Date: 2026-05-11. Companion to `notes/TASKBOARD-v0.2.md`.

---

## 1. v0.2 Scope

v0.2 is the first release that allows mutation. Every mutation is gated behind
an explicit `--confirm` flag and a Housekeeper-owned snapshot + rollback proof.

**Four pillars:**

| Pillar | Command surface | Core capability |
|---|---|---|
| Snapshot writer | internal | `takeSnapshot()` before any mutation |
| Clean with confirm | `clean --confirm` | Apply approved clean operations with snapshot + verify |
| Rollback | `rollback <id>` | Restore files from a named operation snapshot |
| Interrupted-op recovery | `diagnose` SessionStart | Detect and offer recovery for non-terminal operations |

**v0.2 does NOT include:**

| Feature | Deferred to |
|---|---|
| `harden --confirm` (settings/hook patching) | v0.3 |
| Learning loop integration | Separate track (v0.3+) |
| Bulk / recursive operations | v0.3 — single-file ops only in v0.2 |
| MCP server repair | v0.3 |
| Plugin pruning automation | v0.3 |
| Multi-home / fleet support | Future — not scheduled |

---

## 2. Dependencies

| Dependency | Status | Notes |
|---|---|---|
| `docs/snapshot-architecture.md` | PR #29 | Snapshot layout, hashing, atomic write, failure modes |
| `docs/rollback-contracts.md` | PR #29 | Id format, manifest schema, status enum, migration |
| `scripts/lib/snapshot.mjs` | PR #30 | Type factories — `makeOperationManifest` etc. |
| `test/snapshot.test.mjs` | PR #30 | 25 contract tests, schema-match assertion |
| v0.1.x polish (Team A) | In parallel | Must not break existing `diagnose`/`plan` behaviour |

Implementation work in Phases 6–9 (see Taskboard) MUST NOT start until PR #29
and PR #30 are merged into main.

---

## 3. Architecture Notes

### Mutation gate
Every mutation-capable command checks three preconditions before calling
`takeSnapshot()`:

1. No protected path in the target set (`policy.protected_path` hard boundary).
2. Target set within budget (50 files / 10 MB per op).
3. No interrupted operation already exists for the same home (must resolve first).

### Snapshot → apply → verify → (rollback) lifecycle
Described in full in `docs/snapshot-architecture.md`. Status transitions are
pinned in `docs/rollback-contracts.md §4`. The `housekeeper.interrupted_operation`
detector fires for any non-terminal status.

### `clean --confirm` is NOT `clean --force`
`--confirm` means: "I have reviewed the plan output and I consent to these
specific operations." It does NOT suppress the snapshot, does NOT bypass
protected paths, and does NOT skip verify.

### Rollback is scoped to one operation id
`rollback <id>` restores exactly the files listed in `operations/<id>.json`.
It does not cascade, does not touch other operations, and does not delete
the snapshot directory after completion (GC handles that on the next run).

---

## 4. Open Design Questions

These questions could not be resolved from existing docs and are parked here
for the team to decide before Phase 6 implementation begins.

**Q1: Consent gate UX for `clean --confirm`**
Should `--confirm` accept a one-shot flag (`--confirm=once`) or require a
separate interactive prompt? The current `docs/consent-ux.md` describes an
interactive flow but the CLI currently has no stdin interaction. Decision
needed before T-701.

**Q2: `rollback --dry-run` output format**
Should `rollback --dry-run` emit a `RollbackPlan` in JSON (mirroring
`makeRollbackPlan` shape) or a human-readable diff? If JSON, it needs a
`schemaVersion` field to avoid the same v0.1 vocabulary drift problem.
Decision needed before T-801.

**Q3: Interrupted-op recovery action surface**
`docs/snapshot-architecture.md §8` says the detector presents options and
requires explicit user confirmation. Which command surface? Options:
a) `housekeeper recover <id>` — new dedicated command
b) `housekeeper rollback <id>` — reuses rollback
c) Inline in `diagnose` output with manual instructions only
Decision needed before T-901.

**Q4: GC trigger for snapshot directories**
§9 of the snapshot architecture says GC runs at the start of each
`clean --confirm` or `rollback` invocation. Should GC also run during
`diagnose`? Running it in read-only mode risks confusing the "no side
effects" invariant. Decision needed before T-604.

**Q5: Partial-apply auto-rollback vs. manual**
§6.2 says rollback is triggered "automatically" on `partialApply: true`.
Auto-rollback without user confirmation may surprise users. Should it be
auto-rollback or a blocked state that requires `rollback <id>` explicitly?
Decision needed before T-702.

---

## 5. Decision Log

_Placeholder — record decisions here as the team resolves the open questions
above. Format: date, question id, decision, rationale, decided by._

| Date | Q# | Decision | Rationale | Decided by |
|---|---|---|---|---|
| 2026-05-11 | T-600 | Op id length is 26 chars, not 28 | `op_<3>+<14>+_<1>+<8>=26`. The spec §1 says "28 characters exactly" but the canonical example `op_20260511143022_a1b2c3d4` is 26. Implementation and tests use 26 per the example. Spec doc has a typo — propose fixing in a follow-up docs PR. | executor T-600 |
| 2026-05-11 | T-600 | fsync-parent EINVAL on macOS is swallowed | macOS returns EINVAL when fsync is called on a directory fd. The rename is already durable on APFS/HFS+. Swallowing the error preserves cross-platform compatibility without weakening the durability guarantee on Linux (ext4 ordered). | executor T-600 |
| 2026-05-11 | T-600 | no-mutation.test.mjs allowlists lib/snapshot.mjs | The v0.1 read-only invariant test must remain the guard for all other scripts/. snapshot.mjs is explicitly the T-600 designated mutation surface. An allowlist (not a wholesale relaxation) preserves the invariant for everything else. | executor T-600 |
| 2026-05-11 | Q1 | `clean --confirm` accepts a `--yes` flag (no interactive stdin) | Scriptable; matches the no-stdin convention used by other Claude tooling. Keeps `--confirm` semantic free for a future write-path arming flag. No interactive prompt fits the read-only-by-default surface. | user (Elad) |
| 2026-05-11 | Q2 | `rollback --dry-run` renders the plan in plan-mode by default; JSON via `--json` | One toggle pattern across all commands. The plan renderer already shows path / next step / blocked actions per finding — the rollback plan reuses the same shape with snapshot rows. | user (Elad) |
| 2026-05-11 | Q3 | Recovery surface is `rollback <id>` (reuse) | Fewer concepts on the command surface. The `housekeeper.interrupted_operation` detector already points at an op id; `rollback <id>` is the natural action. `recover` may become a thin alias later if UX research finds it useful. | user (Elad) |
| 2026-05-11 | Q4 | GC NEVER runs during `diagnose` | Read-only must stay read-only — the no-side-effects invariant is non-negotiable. GC ships as a function (T-604) but is only invoked from `clean --confirm` and `rollback <id>` invocations. A `housekeeper.snapshot_gc_needed` informational finding can surface the need without doing the work. | user (Elad) |
| 2026-05-11 | Q5 | Partial-apply: auto-rollback only when status reached `applied`. Earlier failures discard the snapshot; mid-rollback crashes flow through `housekeeper.interrupted_operation` | Two crash windows distinguish: (a) between `snapshot_taken` and `applied` — just delete the snapshot, no rollback needed; (b) mid-apply with `partialApply: true` — auto-rollback the partial; (c) mid-rollback — manifest persists as `rolled_back: partial`, next session routes through the existing interrupted_operation detector. Keeps the user out of the loop for safe cases; routes genuinely-ambiguous cases through the standing recovery flow. | user (Elad) |

---

## 6. Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| Atomic write not truly atomic on network filesystems (NFS, SMB) | Low | Document as unsupported; detect with `fs.statSync` after rename |
| Snapshot storage fills disk on large homes | Medium | Per-op budget (50 files / 10 MB) enforced before snapshot |
| Mid-rollback crash leaves home in mixed state | Low | `interrupted_operation` detector surfaces it on next session |
| Team A v0.1.x changes conflict with snapshot.mjs exports | Very low | snapshot.mjs is a new file in Team B's domain; no Team A imports |
| `node:crypto` sha256 differs across Node versions | Very low | sha256 is stable; verified on Node 20 + 22 in CI |
