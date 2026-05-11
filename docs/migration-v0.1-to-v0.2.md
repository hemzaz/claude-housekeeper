# Migrating from v0.1.x to v0.2.0

This guide walks v0.1.x users through the v0.2 line. The headline is
simple: v0.1's read-only contract is unchanged. What's new is
**mutation with rollback proof** — `clean --confirm --yes` and
`rollback <id>` — and the bookkeeping that backs them.

If you only used `diagnose`, `plan`, and `verify` in v0.1, nothing
about that behavior changes in v0.2. The new commands are opt-in.

---

## What's new in v0.2

### Three new concepts

| Concept | Where it lives | Purpose |
|---|---|---|
| **Snapshot** | `<home>/.claude/housekeeper/snapshots/<op_id>/` | Byte-for-byte copy of the files an operation will touch, taken with a write-temp + rename + fsync-parent protocol before any deletion. |
| **Operation manifest** | `<home>/.claude/housekeeper/operations/<op_id>.json` | JSON record of one mutation. Status state machine: `planned → snapshot_taken → applied → {verified, rolled_back, aborted}`. `schemaVersion: "0.2"`. |
| **Rollback id** | `<op_id>` inside each manifest | Stable handle to undo or abort one operation. Matches `op_[0-9]{14}_[0-9a-f]{8}`. |

### Two new directories

After your first `clean --confirm --yes` or `rollback`, you will see:

```text
~/.claude/housekeeper/
├── operations/         # one JSON manifest per operation
├── snapshots/          # one tree per snapshot_taken operation
└── lock                # concurrency lockfile (30-min staleness)
```

Housekeeper creates these on demand. Nothing else in your home is touched.

### One new safety primitive

The **concurrency lockfile** at `<home>/.claude/housekeeper/lock` is
created with `O_EXCL` before any mutation. It expires after 30 minutes,
so a crashed process never permanently wedges the system. If a stale
lock blocks you, `clean --target=housekeeper.stale_lock` can remove it
(see "Broadened cleanable set" below).

---

## What's unchanged from v0.1

If your workflow is:

```bash
claude-housekeeper diagnose
claude-housekeeper plan --scope=registry
claude-housekeeper verify
```

…then nothing changes. Those commands are still read-only, still emit
the same report grammar, still honor `--safe`, `--redact`,
`--json`, and `--home=<path>`. The stable JSON schema is still
`schemaVersion: "0.1"`.

`harden` remains visible and still refuses mutation. It is planned
for v0.3.

The `HOUSEKEEPER_SESSION_HOOK=off` environment variable still silences
the SessionStart hook without removing the configuration.

---

## New commands in v0.2

### `clean --confirm --yes` — mutate, with snapshot proof

`clean` in v0.1 was a dry-run preview that refused mutation. In v0.2
the same dry-run is still the default; mutation is gated behind two
explicit flags:

```bash
# Preview only (default — refuses mutation)
claude-housekeeper clean

# Refuses without --yes
claude-housekeeper clean --confirm

# Actually mutates
claude-housekeeper clean --confirm --yes \
    --target=plugin.cache_unreferenced \
    --path=/absolute/path/to/plugin/cache/version
```

The order is fixed: `--confirm` must come before `--yes`. Both flags
are required for any mutation. There is no stdin prompt fallback;
this is by design (locked decision Q1).

**One operation per invocation.** v0.2 cleans exactly one finding per
run, then exits. Re-run to address the next one. This keeps the
rollback contract clean: each manifest covers one operation, and one
operation maps to one rollback id.

### `rollback <id>` — restore from snapshot

After a successful `clean`, every operation has a rollback id printed
in the report. Restore from it like this:

```bash
# See what restore would do
claude-housekeeper rollback <op_id> --dry-run

# Actually restore (same --confirm --yes gate as clean)
claude-housekeeper rollback <op_id> --confirm --yes
```

Rollback is terminal. The snapshot is retained for garbage collection,
but the manifest moves to `rolled_back` and the operation is closed.

### `rollback --abort <id>` — cancel an in-flight operation

If a `clean` is interrupted before it transitions to `applied`, the
manifest stays at `snapshot_taken` or `planned`. `--abort` cancels
the operation and removes its unused snapshot tree:

```bash
claude-housekeeper rollback --abort <op_id>
```

`--abort` works on `snapshot_taken` and `planned` operations. For an
`applied` operation that didn't reach `verified`, use plain
`rollback <id> --confirm --yes` to restore.

---

## What's new between v0.2.0-alpha.1 and v0.2.0-beta.1

The alpha shipped the first mutation surface. The beta adds three
follow-on phases:

### Phase 8 — Rollback CLI flow

`rollback <id>`, `rollback <id> --dry-run`, and
`rollback <id> --confirm --yes` were wired end to end. Same
`composeRollbackPlan → validateRollbackPlan → executeRollbackPlan`
pipeline shape as `clean`.

### Phase 9 — Interrupted-operation recovery

If a `clean` crashes between `snapshot_taken` and `verified`, the
manifest is left non-terminal. v0.2.0-beta.1 surfaces this:

- The SessionStart hook prints a one-line warning on session start
  when a non-terminal manifest exists.
- `diagnose` emits `housekeeper.interrupted_operation` findings with
  a `nextStep` naming the exact command to recover (`rollback <id>`
  or `rollback --abort <id>`).
- Legacy pre-v0.2 manifests (no `schemaVersion`) are detected and
  reported rather than silently ignored.
- `rollback --abort <id>` was added as the cancel surface.

### Phase 10 — Broadened cleanable set

v0.2.0-alpha.1 only cleaned `plugin.cache_unreferenced`.
v0.2.0-beta.1 adds two more, gated behind a new `file-unlink`
mutation kind:

- `housekeeper.stale_lock` — concurrency lockfile older than 30 min.
- `registry.local_command_identical` — local command file
  byte-identical to its plugin counterpart.

Other detectors stay refused with structured reasons. See
`README.md` "Current Checks" for the per-detector cleanable status,
and `docs/design/clean-design.md` §2 for the full refusal taxonomy.

---

## Configuration changes

### `doNotTouch` rules now matter for cleaning

In v0.1, `doNotTouch` rules were advisory; nothing mutated, so they
just changed how findings were rendered. In v0.2 they are a **hard
boundary** for the mutation pipeline. If a finding's `targetPath`
matches a `doNotTouch` rule, `clean` refuses with `protected-path`
regardless of the detector being cleanable.

The config format is unchanged:

```json
{
  "doNotTouch": [
    {
      "path": "commands/net-cables.md",
      "reason": "hand-maintained local command"
    },
    {
      "path": "skills/jewelry-box/**",
      "reason": "private local skill experiments"
    }
  ]
}
```

Default config locations (also unchanged):

```text
~/.claude/housekeeper/config.json
~/.claude/housekeeper.json
```

Pattern support is still deliberately small — exact paths, directories,
`dir/*`, and `dir/**`.

### Per-operation budget

Every mutation is capped at **50 files / 10 MiB**. Exceeding the budget
refuses with a structured reason. This is not configurable in v0.2; it
is a contract guard, not a tuning knob.

---

## What you will see in your home after upgrade

Before the first `clean --confirm --yes`:

```text
~/.claude/housekeeper/
└── (empty, or your existing config.json)
```

After the first successful `clean --confirm --yes`:

```text
~/.claude/housekeeper/
├── config.json
├── operations/
│   └── op_20260511T120000_abcd1234.json
└── snapshots/
    └── op_20260511T120000_abcd1234/
        └── (snapshotted files mirror their original paths)
```

After a `rollback` of that operation:

```text
~/.claude/housekeeper/
├── config.json
├── operations/
│   └── op_20260511T120000_abcd1234.json  # status: rolled_back
└── snapshots/
    └── op_20260511T120000_abcd1234/      # retained for GC
```

The snapshot tree is retained even after rollback so that the integrity
chain stays inspectable. Garbage collection of old snapshots only
happens inside `executeCleanPlan` / `executeRollbackPlan`, never during
`diagnose`, `plan`, or `verify` (locked decision Q4).

---

## Legacy operation manifests

If you ran any pre-v0.2 build that wrote operation manifests (none of
the tagged v0.1.x releases did, but a hand-rolled fork might have),
v0.2.0-beta.1 detects them by their missing `schemaVersion` field and
surfaces them as `housekeeper.interrupted_operation` findings with a
clear reason. The `rollback` and `--abort` flows refuse to act on
legacy manifests; delete them manually if you confirm they are stale.

---

## Things that look new but aren't

- **`<home>/.claude/housekeeper/config.json`** existed in v0.1.
  Nothing changed about its shape.
- **The `housekeeper.interrupted_operation` detector** existed in v0.1
  with informational stance. v0.2 reinforces it with recovery hints.
- **`--safe`, `--redact`, `--json`, `--home`, `--scope=*`** all
  behave identically.

---

## Quick upgrade checklist

1. **Read `CHANGELOG.md`** for the full per-tag delta.
2. **Re-run your existing `diagnose` / `plan` / `verify` workflow.**
   Output should be stance-identical to v0.1 on the same home.
3. **Read `README.md` "Current Checks"** to see which detectors are
   cleanable in v0.2.0.
4. **Try one mutation cycle** end to end, ideally against a fixture
   first:
   - `diagnose` → identify a `plugin.cache_unreferenced` finding.
   - `clean --confirm --yes --target=plugin.cache_unreferenced --path=<P>`.
   - Inspect `<home>/.claude/housekeeper/operations/` for the manifest.
   - `rollback <op_id> --dry-run` → preview restore.
   - `rollback <op_id> --confirm --yes` → actually restore.
   - `diagnose` again — the finding should re-fire.
5. **Read `docs/threat-model.md`** if you care about the trust
   boundaries the snapshot flow does and does not defend.

---

## Related docs

- [`CHANGELOG.md`](../CHANGELOG.md) — every tag, every change.
- [`docs/threat-model.md`](threat-model.md) — what the snapshot and
  manifest surfaces defend against, and what they don't.
- [`docs/rollback-contracts.md`](rollback-contracts.md) — the formal
  rollback contract, including legacy-manifest behavior in §6 and
  the manifest schema in §7.
- [`docs/snapshot-architecture.md`](snapshot-architecture.md) — the
  write-temp + rename + fsync-parent protocol.
- [`docs/design/clean-design.md`](design/clean-design.md) §2 — the
  twelve-rule refusal taxonomy.
- [`docs/compatibility-matrix.md`](compatibility-matrix.md) — tested
  platforms.
- [`docs/schema-stability.md`](schema-stability.md) — stable JSON
  fields across versions.
