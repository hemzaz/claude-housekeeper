# Migrating from v0.2.x to v0.3.0

This guide walks v0.2.x users through the v0.3 line. The headline is
simple: **nothing in v0.2 breaks**. `diagnose`, `plan`, `verify`,
`clean --confirm --yes`, `rollback <id>`, and `rollback --abort <id>`
behave byte-identically to v0.2.0.

What's new is **`harden --confirm --yes`** for guarded `settings.json`
rewrite, **`clean --batch`** for aggregating findings under a single
operation manifest, and a new **two-phase JSONC detection** path that
distinguishes a `settings.json` carrying comments from one that is
truly broken.

---

## What's new in v0.3

### Three new concepts

| Concept | Where it lives | Purpose |
|---|---|---|
| **`settings-rewrite` mutation kind** | `MUTATION_REGISTRY` in `scripts/lib/snapshot.mjs` | Third mutation kind, after `dir-rmtree` and `file-unlink`. Backs the new `harden` command. `preApply` runs strict `JSON.parse`, the JSONC tokenizer, applies the patch twice in memory for idempotency, and validates the output is still valid JSON before snapshotting. |
| **`hardenable: true` on `DetectorOutput`** | per-detector self-declaration | A *candidacy* signal that a detector has a meaningful patch. Surfaces in the README "Current Checks" table and in `--json` output. Compose-time refusals can still fire. |
| **Batch operation manifest** | `<home>/.claude/housekeeper/operations/<op_id>.json` | One manifest covers N `file-unlink` operations applied together. `status: verified` only when every op verifies; on per-op failure the manifest stays `applied` with `partialApply: true` per Q3 ruling. |

### What's unchanged from v0.2

If your workflow is:

```bash
claude-housekeeper diagnose
claude-housekeeper plan --scope=registry
claude-housekeeper verify
claude-housekeeper clean --confirm --yes \
    --target=plugin.cache_unreferenced \
    --path=/absolute/path/to/plugin/cache/version
claude-housekeeper rollback <op_id> --confirm --yes
claude-housekeeper rollback --abort <op_id>
```

…then nothing changes. Same stable JSON schema (`schemaVersion: "0.1"`).
Same operation-manifest schema (`schemaVersion: "0.2"` — no bump in
v0.3). Same `--safe`, `--redact`, `--json`, `--home=<path>`,
`--timeout=<seconds>`, and `nextStep`-on-refusal contracts.

Operation manifests written by v0.2.0 remain readable, restorable, and
abortable under v0.3 without conversion.

---

## New commands in v0.3

### `harden --confirm --yes` — guarded `settings.json` rewrite

`harden` was a visible-but-refused placeholder in v0.1 and v0.2. In
v0.3 it mirrors `clean`'s four-branch consent gate:

```bash
# Preview only (default — dry-run plan view)
claude-housekeeper harden

# Refuses without --target / --path
claude-housekeeper harden --confirm

# Refuses without --yes
claude-housekeeper harden --confirm \
    --target=settings.hook_path_dangling \
    --path=/Users/you/.claude/settings.json

# Actually mutates settings.json
claude-housekeeper harden --confirm --yes \
    --target=settings.hook_path_dangling \
    --path=/Users/you/.claude/settings.json
```

The order is fixed (`--confirm` before `--yes`), both flags are
required, and there is no stdin prompt fallback. One operation per
invocation — same single-op contract as `clean` in v0.2.

A successful harden takes a snapshot, applies the patch through the
atomic write-temp + rename + fsync-parent protocol, and verifies the
post-state sha256 against the planned bytes. Operation manifests
record `kind: settings-rewrite`. Restore through the existing
`rollback <id> --confirm --yes` flow.

#### `RELOAD HINT` block

Every successful harden prints a `RELOAD HINT` block:

```text
RELOAD HINT: Claude does not document hot-reload of settings.json.
             Restart your Claude session for the change to take effect.
```

Claude Code's re-read semantics for `settings.json` are not documented.
v0.3 does not attempt to signal Claude. The user is responsible for
restarting the session — Housekeeper just makes the prompt unmissable
(C11 ruling).

#### Three hardenable detectors in v0.3.0

| Detector id | What harden does |
|---|---|
| `settings.hook_path_dangling` | Removes every `hooks.<event>[i].hooks[j]` whose command references a missing absolute plugin-cache path. Healthy hook entries survive. |
| `settings.mcp_command_missing` | Removes every `mcpServers` entry whose absolute command path is missing. Healthy entries survive. |
| `settings.invalid_json` | Surfaces with `hardenable: true` so `diagnose` suggests `harden`, but invoking harden refuses with `settings-shape-unknown` per Q1 ruling — a `settings.json` that doesn't parse is in an unknown state. |

Each patch is naturally idempotent: a second apply re-derives the same
cleaned tree from the post-state.

### `clean --batch=<n>` — aggregate findings under one manifest

`clean` in v0.2 acts on exactly one finding per invocation. v0.3 adds
batching for `file-unlink` operations:

```bash
# Default aggregate cap is 10
claude-housekeeper clean --confirm --yes \
    --target=plugin.cache_unreferenced --path=/abs/path/1 \
    --target=plugin.cache_unreferenced --path=/abs/path/2 \
    --target=registry.local_command_identical --path=/abs/path/3

# Raise the aggregate cap (max 50)
claude-housekeeper clean --confirm --yes --batch=25 \
    --target=plugin.cache_unreferenced --path=/abs/path/1 \
    --target=plugin.cache_unreferenced --path=/abs/path/2 \
    [...]
```

Repeated `--target=` and `--path=` flags pair positionally — first
`--target=` with first `--path=`, second with second, and so on.

**Manifest-atomic, no auto-rollback** (Q3 ruling). The batch reaches
`status: verified` only when every operation verifies. If one operation
fails mid-batch, the manifest stays at `status: applied` with
`partialApply: true`. The `housekeeper.interrupted_operation` detector
surfaces it on the next `diagnose`, and `nextStep` routes to
`rollback <id>` which restores **all** files in the manifest (the
snapshot tree holds the pre-state of every operation in the batch).

The runtime never silently undoes work the user explicitly authorised.

#### New batch refusal classes

| Class | Trigger | `nextStep` |
|---|---|---|
| `batch-exceeds-aggregate-budget` | Combined op count exceeds `--batch=N` or 50 files / 10 MiB aggregate | Run a smaller batch, or split across multiple invocations. |
| `batch-pair-cap-exceeded` | Unbalanced `--target=` / `--path=` pair count, or default cap reached without `--batch=N` | Add explicit `--batch=N`, or split into multiple runs. |
| `settings-rewrite-not-batchable` | A `settings-rewrite` target was included in the batch | Use `harden --confirm --yes` instead — one settings rewrite per invocation. |

#### Why `settings-rewrite` is not batchable

Per the C6 ruling, `clean --batch` excludes `settings-rewrite`
operations in v0.3. `harden` is the right surface for rewriting
`settings.json`. Cross-kind batches (file-unlink + settings-rewrite)
are deferred — they would need a richer manifest schema and an
extended idempotency story that v0.3 didn't take on.

---

## What's new in detection

### Two-phase JSONC detection

In v0.2, any non-parseable `settings.json` surfaced as
`settings.invalid_json`. In v0.3 the detector runs in two phases:

1. **Phase 1 — strict `JSON.parse`.** If the file parses, no finding.
2. **Phase 2 — JSONC tokenizer.** If `JSON.parse` raises `SyntaxError`,
   a lex-aware scanner looks for `//` or `/*` outside string context.
   - **Comments found** → emit `settings.jsonc_detected` at `inform`
     stance. The file is not broken; Housekeeper just cannot safely
     round-trip comments through `settings-rewrite` in v0.3.
   - **No comments found** → emit `settings.invalid_json` as before.

The two findings are **disjoint**: a fixture with comments now emits
`jsonc_detected` only; a corrupt file without comments emits
`invalid_json` only. If you previously had a `settings.invalid_json`
finding fire on a JSONC-bearing settings file, it now fires as
`jsonc_detected` instead — same surface, more accurate classification.

#### Why refuse JSONC in v0.3?

Comment round-trip is an unsolved problem with current parsers.
`jsonc-parser` parses but doesn't preserve comments on serialise.
`comment-json` has edge cases around comments inside merged objects.
Refusing in v0.3 is conservative-correct. Revisit deferred to **v0.4**
(not v0.3.x), per the Q2 ruling.

If `harden` is invoked against a JSONC-bearing settings file the
refusal class is `settings-jsonc-detected` with a `nextStep`
explaining that comments cannot be safely preserved.

---

## CI version-pin check

A new `version-pin` job runs on every PR and main push. It asserts
that `docs/index.html` contains `v$(jq -r .version package.json)`.
This closes the G4 release-readiness gap from v0.2: shipping a GA tag
with a stale site version pin will now fail CI.

If you maintain a fork:

- Bump `package.json` `version` and the `docs/index.html` nav pin in
  the same commit.
- The job runs against `ubuntu-latest` only; the test matrix is
  unchanged (Ubuntu + macOS × Node 20 + 22).

User-facing impact: none if you don't fork. Documented here so the
field name `version-pin` in your PR checks isn't a surprise.

---

## Configuration changes

None. The `~/.claude/housekeeper/config.json` (and
`~/.claude/housekeeper.json`) format is unchanged. The `doNotTouch`
hard boundary applies identically to `clean`, `harden`, and
`clean --batch` — a finding whose `targetPath` matches a `doNotTouch`
rule refuses with `protected-path` regardless of which surface
invoked it.

Per-operation budget (50 files / 10 MiB) is unchanged. The batch
aggregate cap (default 10, max 50) is in addition, not instead.

---

## What you will see in your home after upgrade

A successful `harden --confirm --yes` writes a new operation manifest
of `kind: settings-rewrite`:

```text
~/.claude/housekeeper/
├── config.json
├── operations/
│   ├── op_20260517T120000_abcd1234.json  # v0.2 cleanable, kind: file-unlink
│   └── op_20260517T123000_ef567890.json  # v0.3 harden,    kind: settings-rewrite
└── snapshots/
    ├── op_20260517T120000_abcd1234/
    └── op_20260517T123000_ef567890/
        └── (snapshot of settings.json under its absolute path)
```

A successful `clean --batch` writes one manifest with multiple
operations:

```text
~/.claude/housekeeper/operations/op_20260517T130000_aaaaaaaa.json
  status: verified
  operations: [
    { kind: file-unlink, targetPath: /abs/path/1, sha256: ... },
    { kind: file-unlink, targetPath: /abs/path/2, sha256: ... },
    { kind: file-unlink, targetPath: /abs/path/3, sha256: ... }
  ]
```

A partial-apply batch manifest:

```text
status: applied
partialApply: true
operations: [
  { ... status: verified ... },
  { ... status: applied ... },
  { ... status: planned  ... }
]
```

`housekeeper.interrupted_operation` surfaces this next session, and
`rollback <op_id> --confirm --yes` restores all three files from the
batch's snapshot tree.

---

## Things that look new but aren't

- **`MUTATION_REGISTRY`** existed in v0.2 with `dir-rmtree` and
  `file-unlink`. v0.3 adds `settings-rewrite` as a third kind under
  the same registry contract; the registry shape itself is unchanged.
- **The atomic write protocol** (write-temp + rename + fsync-parent)
  has been the snapshot path since v0.2.0-alpha.1. v0.3's
  `settings-rewrite.apply` reuses the same `atomicWrite` helper.
- **The four-branch consent gate** (no flags / `--confirm` only /
  `--confirm --yes` missing required flags / full happy path) is the
  same shape `clean` has carried since v0.2.0-alpha.1.
- **`--timeout=<seconds>`** existed on `clean` since v0.2.0 (G15).
  `harden --timeout=<seconds>` reuses the same `armOperationTimeout`
  helper; exit code 124 still matches GNU `timeout(1)`.

---

## Quick upgrade checklist

1. **Read `CHANGELOG.md`** for the full per-tag delta.
2. **Re-run your existing `diagnose` / `plan` / `verify` /
   `clean` / `rollback` workflow.** Output should be stance-identical
   to v0.2.0 on the same home — modulo any `settings.jsonc_detected`
   findings that previously surfaced as `settings.invalid_json`.
3. **Read `README.md` "Current Checks"** — note the new fourth column
   marking three settings detectors as **hardenable** in v0.3.0.
4. **Try one harden cycle** end to end, ideally against a fixture
   first:
   - `diagnose` → identify a `settings.hook_path_dangling` finding
     (`hardenable: true`).
   - `harden --confirm --yes --target=settings.hook_path_dangling \
       --path=<absolute settings.json path>`.
   - Inspect `<home>/.claude/housekeeper/operations/` for the
     `settings-rewrite` manifest.
   - Restart your Claude session per the `RELOAD HINT`.
   - `rollback <op_id> --dry-run` → preview restore.
   - `rollback <op_id> --confirm --yes` → byte-identical restore.
   - `diagnose` again — the finding should re-fire.
5. **Try one batch cycle** if you have multiple `file-unlink`
   findings (e.g. several `plugin.cache_unreferenced` paths outside
   grace).
6. **Read `docs/threat-model.md` §8** for the settings-write surface
   trust boundaries.

---

## Related docs

- [`CHANGELOG.md`](../CHANGELOG.md) — every tag, every change.
- [`docs/migration-v0.1-to-v0.2.md`](migration-v0.1-to-v0.2.md) — the
  preceding migration if you are still on v0.1.x.
- [`docs/threat-model.md`](threat-model.md) §8 — settings-write
  surface, atomic-rename guarantees, `settings-network-filesystem`
  refusal class.
- [`docs/schema-stability.md`](schema-stability.md) — `settings-rewrite`
  documented alongside `dir-rmtree` and `file-unlink` as a stable
  mutation kind.
- [`docs/versioning-policy.md`](versioning-policy.md) §2.1 — additive
  rationale for the v0.3 minor.
- [`docs/design/v0.3-design.md`](design/v0.3-design.md) — the
  buildable spec and Q1–Q5 rulings.
- [`docs/compatibility-matrix.md`](compatibility-matrix.md) — tested
  platforms (v0.3.0 row).
