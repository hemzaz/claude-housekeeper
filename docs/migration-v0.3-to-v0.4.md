# Migrating from v0.3.x to v0.4.0-beta.1

This guide walks v0.3.x users through the v0.4 line. The headline is
simple: **nothing in v0.3 breaks**. Every command, flag, refusal class,
schema field, and operation manifest from v0.3.0 works byte-identically
under v0.4.0-beta.1.

What's new is a full **on-disk learning loop** (`learn`, `prune`), **MCP
command rewrite** (`harden --mcp-command-rewrite=`), **JSONC-aware
settings rewrite** (comments now survive), **batch streaming**
(`clean --batch=N --stream`), and four new detectors. One new runtime
dependency (`jsonc-parser`) is added.

---

## TL;DR

v0.4 adds capabilities; it removes nothing. Run your v0.3 workflow
unchanged and then optionally try `learn` and `prune` as read-only
audit steps. If you set `HOUSEKEEPER_SESSION_HOOK=off` today, that
still works. If you have operation manifests from v0.3, they remain
readable and rollback-able without conversion.

---

## New commands you can run today

### `housekeeper learn` — what Housekeeper has observed

```bash
# Plain-text learning summary (counts + top recurrers)
claude-housekeeper learn

# Machine-readable summary
claude-housekeeper learn --json

# Remove entries older than 30 days and report how many were pruned
claude-housekeeper learn --prune --older-than=30

# Mark an operation's refusal as a false positive
claude-housekeeper learn --mark-false-positive op_20260518T120000_abcd1234
```

`learn` reads from four JSONL files under
`<home>/.claude/housekeeper/learning/` (`refusals.jsonl`,
`applied.jsonl`, `rollbacks.jsonl`) and a lightweight `state.json`
counter file. It never mutates your Claude home — only the learning
directory itself on `--prune`.

### `housekeeper prune` — candidate stale plugin audit

```bash
claude-housekeeper prune
```

Filters `diagnose` to `plugin.unused_past_grace` findings and prints a
table of installed plugins that have not appeared in any applied
operation within the 7-day grace window. **Audit only in v0.4.0** — no
mutation. The table gives you the information to decide whether to
uninstall manually; v0.4.1 will wire the uninstall mutation after the
audit window validates the heuristic.

---

## New flags

### `harden --mcp-command-rewrite=<old>=<new>`

Rewrites an MCP server's `command` path in `settings.json`:

```bash
# Preview (dry-run)
claude-housekeeper harden \
    --mcp-command-rewrite=/old/path/to/server=/new/path/to/server

# Actually rewrite (same four-branch consent gate as v0.3 harden)
claude-housekeeper harden --confirm --yes \
    --mcp-command-rewrite=/old/path/to/server=/new/path/to/server
```

Three pre-snapshot refusal classes:

| Class | Trigger |
|---|---|
| `mcp-rewrite-source-not-found` | The `<old>` path does not match any MCP entry in `settings.json` |
| `mcp-rewrite-target-missing` | The target MCP entry exists but the key is missing |
| `mcp-rewrite-target-not-executable` | The `<new>` path exists but is not executable |

Each refusal carries a `nextStep`. On success, a `RELOAD HINT` is
printed (same as `harden --confirm --yes` in v0.3) — restart your
Claude session for the rewrite to take effect.

### `clean --batch=N --stream`

Streams a large batch in configurable chunks:

```bash
# Stream 200 operations in default chunks
claude-housekeeper clean --confirm --yes --batch=200 --stream \
    --target=plugin.cache_unreferenced --path=/abs/path/1 \
    --target=plugin.cache_unreferenced --path=/abs/path/2 \
    [...]
```

`--stream` requires `--batch=N` with N > 50. Each chunk gets its own
snapshot + apply + verify cycle; on any chunk failure the runtime halts
and rolls back completed chunks in reverse order. Refusal classes:
`stream-chunk-budget-exceeded` and `stream-resume-not-supported`
(stream resume across invocations is not supported in v0.4).

---

## New on-disk surfaces

After your first v0.4 `clean` or `harden` invocation you will see:

```text
~/.claude/housekeeper/
├── config.json
├── lock
├── lock.history          ← new in v0.4 (N6)
├── learning/             ← new in v0.4 (Phase 1)
│   ├── refusals.jsonl
│   ├── applied.jsonl
│   ├── rollbacks.jsonl
│   └── state.json
├── operations/
│   └── op_*.json
└── snapshots/
    └── op_*/
```

**`lock.history`** is an append-only JSONL file. One line per acquire /
release: `{ts, pid, action, holder, releaseReason?}`. You may remove it
manually if it grows large; Housekeeper will recreate it.

**`learning/`** accumulates over time. Files in this directory are
append-only; they grow with each operation. Use
`learn --prune --older-than=<days>` to trim entries beyond a retention
horizon.

Neither surface affects `diagnose`, `plan`, `verify`, `clean`, or
`rollback` behavior — they are read-only for those commands.

---

## JSONC settings now hardenable

In v0.3, `settings.json` files containing `//` or `/* */` comments
surfaced as `settings.jsonc_detected` at `inform` stance and were not
hardenable (comments could not be safely preserved through the
`settings-rewrite` round-trip).

In v0.4, `jsonc-parser`'s `modify()` + `applyEdits()` preserves
comments through the rewrite. Harden now acts on JSONC-bearing settings
files. The refusal class `settings-jsonc-rewrite-failed` fires only when
the parser's round-trip output diverges from the input on an identity
check — a conservative safety net.

If you previously saw `settings.jsonc_detected` and were told to remove
comments before hardening, you no longer need to. Run:

```bash
claude-housekeeper harden --confirm --yes \
    --target=settings.hook_path_dangling \
    --path=/Users/you/.claude/settings.json
```

…and comments will be preserved in the output.

---

## New runtime dependency

v0.4 adds **one** runtime dependency: `jsonc-parser` (Microsoft, MIT
licence, zero transitive dependencies). It is already in `package.json`
`dependencies` and will be installed automatically by `npm install`.

All other modules remain pure Node.js built-ins. The zero-deps invariant
for the recovery surface (standalone CLI) holds for every module except
the JSONC rewrite path.

---

## No breaking changes from v0.3.0

The following v0.3 contracts are unchanged in v0.4.0-beta.1:

- **CLI surface:** `diagnose`, `plan`, `verify`, `clean --confirm --yes`,
  `clean --batch=<n>`, `harden --confirm --yes`, `rollback <id>`,
  `rollback --abort <id>` — all flags, exit codes, and output formats
  are identical.
- **Report JSON schema** (`schemaVersion: "0.1"`): no new required
  fields. `falsePositiveSeenBefore` is optional and omitted when zero.
- **Operation-manifest schema** (`schemaVersion: "0.2"`): unchanged.
  v0.3 manifests read and roll back without conversion.
- **`settings-rewrite` mutation kind:** remains as a back-compat alias.
  All v0.3 `settings-rewrite` manifests are restorable under v0.4.
- **Refusal classes from v0.3:** `settings-shape-unknown`,
  `settings-jsonc-detected`, `batch-exceeds-aggregate-budget`,
  `batch-pair-cap-exceeded`, `settings-rewrite-not-batchable` — all
  preserved with the same `nextStep` copy.
- **Per-operation budget** (50 files / 10 MiB) and batch aggregate cap
  (default 10, max 50 without `--stream`): unchanged.
- **`--safe`, `--redact`, `--json`, `--home=`, `--timeout=<seconds>`**:
  all unchanged.

All v0.3 tests pass byte-for-byte against the v0.4 build. Run
`npm test` to confirm before upgrading your CI or soak runner.

---

## Migration steps for advanced users

### Opt out of the SessionStart hook learning writes

If you have the optional `hooks/session-start.mjs` hook installed and
want to prevent it from writing to `learning/`, set:

```bash
export HOUSEKEEPER_SESSION_HOOK=off
```

in your shell profile. The hook checks this variable at startup and
exits 0 immediately without reading or writing anything.

### Retention policy for learning files

Learning files accumulate indefinitely. To enforce a rolling 60-day
window:

```bash
claude-housekeeper learn --prune --older-than=60
```

Add this to a cron job or to your session cleanup scripts. The command
prints how many entries were pruned and exits 0.

### Clearing all learning data

To reset the learning loop entirely (e.g. after a fresh Claude home
setup):

```bash
rm -rf ~/.claude/housekeeper/learning/
```

Housekeeper recreates the directory and files on the next invocation.
No other surfaces are affected.

---

## Quick upgrade checklist

1. **Read `CHANGELOG.md`** for the full per-tag delta.
2. **`npm install`** to get `jsonc-parser`.
3. **Re-run your existing v0.3 workflow** — output should be
   stance-identical to v0.3.0 on the same home (modulo new
   `plugin.unused_past_grace`, `registry.command_dangling`,
   `hooks.config_dangling`, or `registry.skills_entry_dangling` findings
   if those detectors fire on your home).
4. **Try `learn`** after a few clean/harden invocations to see what the
   learning loop has recorded.
5. **Try `prune`** to audit plugins outside the grace window.
6. **If you have JSONC settings**, try `harden --confirm --yes
   --target=settings.hook_path_dangling` — comments survive.
7. **Read `docs/threat-model.md` §9** for the MCP rewrite surface trust
   boundaries (added in v0.4).

---

## Related docs

- [`CHANGELOG.md`](../CHANGELOG.md) — every tag, every change.
- [`docs/migration-v0.2-to-v0.3.md`](migration-v0.2-to-v0.3.md) — the
  preceding migration guide if you are still on v0.2.x.
- [`docs/schema-stability.md`](schema-stability.md) — `json-rewrite`
  documented alongside `dir-rmtree`, `file-unlink`, and `settings-rewrite`
  as stable mutation kinds.
- [`docs/threat-model.md`](threat-model.md) §9 — MCP rewrite surface and
  the foreign-owner threat mitigation deferred to v0.4.x.
- [`docs/compatibility-matrix.md`](compatibility-matrix.md) — v0.4.0-beta.1
  row with Q1–Q5 rulings and the `jsonc-parser` runtime dep notice.
- [`docs/design/v0.4-design.md`](design/v0.4-design.md) — the buildable
  spec and Q1–Q5 rulings for v0.4.
