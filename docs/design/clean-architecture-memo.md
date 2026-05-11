# T-704 Architecture Memo — `clean --confirm --yes` End-to-End

**Memo type:** Staff-engineer design memo, third-party "architect" voice
in the three-memo parallel design pass for T-704.
**Author:** architect (parallel pass, peer to product + claude-code memos)
**Repo:** `hemzaz/claude-housekeeper` @ `9ed5a64` (post #41 snapshot lifecycle)
**Scope:** the missing contract layer between `assembleReport()` and
`applyOperation()` — *target selection, mutation op specification, plan
composition, snapshot strategy per mutation kind, refusal taxonomy, and the
`CleanPlan` object*.
**Out of scope:** consent UX (T-701 already decided), CLI flag parsing,
report rendering, post-v0.2 features (`harden`, learning loop, bulk ops).

> The synthesizer will reconcile this memo with the product and claude-code
> memos into `docs/design/clean-design.md`. Where this memo recommends a
> specific shape (e.g. `mutationKind` enum members), the synthesizer should
> treat that as a **strong** recommendation — backed by the real shape of
> `applyOperation(id, home, ops)` in `scripts/lib/snapshot.mjs` and the
> manifest schema in `docs/rollback-contracts.md §3` — not a placeholder.

---

## 0. TL;DR — the three load-bearing decisions

The product and claude-code memos most need to react to these:

1. **`mutationKind` is a closed enum of 4 values for v0.2.0:
   `dir-rmtree`, `file-unlink`, `file-replace`, `json-fragment-edit`.**
   v0.2.0 ships ONLY `dir-rmtree` (for `plugin.cache_unreferenced`).
   The other three are *defined* in the enum so the type system enforces
   the contract, but the only `composeCleanPlan` path that produces a
   non-empty `operations[]` array in v0.2.0 is the one keyed by
   `plugin.cache_unreferenced`. Every other detector that could
   theoretically be cleaned routes through `composeCleanPlan` and falls
   into `refused[]` with a documented reason. This forces the product
   memo to scope its v0.2.0 promise narrowly and the claude-code memo to
   write only one `apply()` function. See §2 and §6.

2. **`composeCleanPlan(report, options)` is the new pure function that
   sits between `assembleReport()` and `takeSnapshot()`.** It is not
   inside `audit.mjs` (which is read-only by `no-mutation.test.mjs`
   convention — see Decision Log entry in `notes/PLAN-v0.2.md:124` that
   *only* allowlists `scripts/lib/snapshot.mjs`) and it is not inside
   `snapshot.mjs` (which is the I/O layer). It is a new file:
   `scripts/lib/clean-plan.mjs`. Pure, no I/O. Test-friendly. See §4.

3. **The `CleanPlan.operations[i].mutationOp` field carries an inert
   *descriptor* (`{ kind, args }`), not a function reference.** The
   `apply()` callable that `applyOperation()` receives is materialised
   at `executeCleanPlan()` time by a registry keyed on
   `mutationKind`. This separates the plan (serialisable, testable,
   loggable, audit-trail-friendly) from the action (effectful,
   non-serialisable, mockable). It is also the only way to round-trip
   a plan through `--dry-run` rendering and consent confirmation
   without smuggling closures through the renderer. See §1.4 and §4.3.

The rest of the memo backs these three with concrete schema, every
runtime detector mapped to a verdict, and a threat model.

---

## 1. The `CleanPlan` object — the missing contract

### 1.1 Why this needs a name

`applyOperation(id, home, ops)` in `scripts/lib/snapshot.mjs:534` accepts
a generic `ops` array. The signature is:

```js
// scripts/lib/snapshot.mjs:534
export async function applyOperation(id, home, ops) {
  // ...
  for (let i = 0; i < manifest.files.length; i++) {
    const entry = manifest.files[i];
    // ...
    await ops[i].apply(entry.originalPath);
    // ...
  }
}
```

That `ops[i].apply(filePath)` callback is the integration seam. Nothing
in the code today decides:

- which detector findings produce a mutation target,
- what `apply()` does for each detector id,
- how `manifest.files[i]` is paired 1:1 with `ops[i]`,
- which detectors are *cleanable* in v0.2 vs. blocked vs. deferred,
- which snapshot strategy (whole-dir, file, JSON-fragment) is appropriate
  for each mutation kind,
- how a 10-finding `Report` becomes a 3-file `CleanPlan`.

The missing object is the **`CleanPlan`**.

### 1.2 Layering — where `CleanPlan` lives in the pipeline

```
                                            (user types `clean --confirm --yes`)
                                                          │
                          ┌───────────────────────────────┼───────────────────────────────┐
                          │                               ▼                               │
                          │                     scripts/claude-housekeeper.mjs            │
                          │                          runClean(options)                    │
                          │                               │                               │
                          │   ┌───────────────────────────┴───────────────────────────┐   │
                          │   ▼                                                       ▼   │
                          │  assembleReport(home, opts)                     loadConfig(home)│
                          │  scripts/lib/audit.mjs:84                       scripts/lib/policy.mjs:10
                          │   │                                                       │   │
                          │   │   Report{findings:[Finding], stanceSummary, ...}      │   │
                          │   ▼                                                       │   │
                          │  composeCleanPlan(report, { home, scope, policy })  ◀─────┘   │
                          │  scripts/lib/clean-plan.mjs   ← NEW FILE                      │
                          │   │                                                           │
                          │   │   CleanPlan{ operations:[Op], refused:[Refusal], ... }    │
                          │   ▼                                                           │
                          │  validateCleanPlan(plan, home)                                │
                          │  scripts/lib/clean-plan.mjs   ← NEW FILE                      │
                          │   │                                                           │
                          │   ▼                                                           │
                          │  renderCleanPlan(plan, opts)  ← surface for --dry-run / -y   │
                          │  scripts/lib/report.mjs       ← EXTEND (planMode-shaped)      │
                          │   │                                                           │
                          │   ▼                                                           │
                          │  executeCleanPlan(plan, home)                                 │
                          │  scripts/lib/clean-plan.mjs   ← NEW FILE                      │
                          │   │                                                           │
                          │   │   for each op: materialise apply() from mutationOp        │
                          │   │   call takeSnapshot(home, { targets, command, mode,       │
                          │   │     consentSummary }) →   opId, manifest                  │
                          │   │   call applyOperation(opId, home, materialisedOps)        │
                          │   │   call verify(opId, home)                                 │
                          │   ▼                                                           │
                          │  Result{ opId, finalStatus, perFile, refused, errors }        │
                          └───────────────────────────────────────────────────────────────┘
```

Three contracts in this picture are pre-existing:

- `Report` — defined in `docs/schemas.md` and constructed by
  `makeReport()` in `scripts/lib/contracts.mjs`.
- `Finding` — same module, `makeFinding()`.
- `OperationManifest` — `makeOperationManifest()` in
  `scripts/lib/snapshot.mjs:135`.

The new contract is the `CleanPlan`.

### 1.3 `CleanPlan` schema

```ts
// scripts/lib/clean-plan.mjs (proposed)

type SnapshotStrategy =
  | "dir-rmtree"          // snapshot every file in the dir, then remove the dir
  | "file-replace"        // snapshot the file, then write new bytes
  | "file-unlink"         // snapshot the file, then unlink
  | "json-fragment-edit"; // snapshot the JSON file, then write edited JSON

type MutationKind =
  | "dir-rmtree"
  | "file-unlink"
  | "file-replace"
  | "json-fragment-edit";

type MutationOpDescriptor =
  | { kind: "dir-rmtree";       args: { dirPath: string } }
  | { kind: "file-unlink";      args: { filePath: string } }
  | { kind: "file-replace";     args: { filePath: string; nextBytes: Buffer | string } }
  | { kind: "json-fragment-edit"; args: { filePath: string; jsonPointer: string; nextValue: unknown | typeof DELETE_SENTINEL } };

type PolicyCheck = {
  kind: "protected-path" | "out-of-scope" | "sector-boundary";
  matched: boolean;
  rule?: string;
  reason?: string;
};

type ExpectedExitState = {
  // Expressed as "after apply, this finding id MUST no longer fire for
  // this targetPath". Verification consumes this.
  detectorId: string;
  predicate: "absent-from-report" | "no-finding-for-targetPath";
};

type CleanOperation = {
  // ── identity ──────────────────────────────────────────────────────
  opIndex: number;            // 0-based, stable within this plan
  detectorId: string;         // exactly the finding.id that motivated this op
  findingRef: string;         // the finding.targetPath that motivated it
  // ── target ────────────────────────────────────────────────────────
  targetPath: string;         // absolute path; for dir-rmtree, the dir
  expandedFiles: string[];    // 1:N expansion; for file-* ops, [targetPath]
                              // for dir-rmtree, every file under targetPath
                              // (this is what takeSnapshot snapshots, 1:1
                              // with manifest.files[])
  // ── mutation ──────────────────────────────────────────────────────
  mutationKind: MutationKind;
  snapshotStrategy: SnapshotStrategy;
  mutationOp: MutationOpDescriptor;     // inert; materialised at execute time
  // ── safety ────────────────────────────────────────────────────────
  policyChecks: PolicyCheck[];          // every check we ran; all must be `matched: false` for protect/sector-boundary
  expectedExitState: ExpectedExitState; // what we expect to be true after verify
  // ── budgets (sub-budgets within the per-op snapshot budget) ───────
  estimatedBytes: number;     // sum of expandedFiles sizes
  fileCount: number;          // expandedFiles.length
};

type Refusal = {
  detectorId: string;
  findingRef: string;
  reason:
    | "policy-protected-path"
    | "policy-sector-boundary"
    | "policy-out-of-scope"
    | "stance-not-prepare"           // stance ≠ prepare or repair
    | "execution-class-not-inert"    // surface.executionClass ≠ inert
    | "missing-evidence-key"         // finding has missingKeys != []
    | "rollback-class-checkpoint-only"
    | "rollback-class-irreversible"
    | "unknown-owner"
    | "out-of-scope"
    | "no-mutation-mapping-in-v0.2"  // detector is cleanable in principle but mapping deferred
    | "budget-would-exceed-per-op"
    | "budget-would-exceed-aggregate"
    | "plan-state-error";            // e.g. duplicate detectorId+targetPath in plan
  detail: string;                    // human-readable; mirrors finding.summary
  policyMatches?: PolicyCheck[];
};

type CleanPlan = {
  schemaVersion: "0.1";              // new schema; bumps independently from report/manifest
  generatedAt: string;               // ISO 8601 UTC ms
  home: string;
  reportRef: { generatedAt: string; primary: string | null };
  // ── operations actually planned ───────────────────────────────────
  operations: CleanOperation[];
  // ── findings that were considered but cannot be cleaned ───────────
  refused: Refusal[];
  // ── plan-level rollups ────────────────────────────────────────────
  totals: {
    operationCount: number;
    fileCount: number;
    estimatedBytes: number;
  };
  budgets: {
    perOpMaxFiles: number;      // mirrors MAX_OPERATION_FILES = 50
    perOpMaxBytes: number;      // mirrors MAX_OPERATION_BYTES = 10 MiB
    aggregateMaxFiles: number;  // total across all operations in this plan
    aggregateMaxBytes: number;
  };
  warnings: string[];           // non-fatal diagnostics (e.g. "1 finding with stance probe could not be cleaned")
};
```

### 1.4 Why `mutationOp` is a descriptor, not a function

In the current `applyOperation()` signature
(`scripts/lib/snapshot.mjs:534`), `ops[i].apply` is a function. The
naïve composition would be:

```js
// NAIVE — don't do this
operations.push({
  apply: async (filePath) => {
    await rm(filePath); // executes at apply time
  }
});
```

That has three bad properties:

1. **Not serialisable.** `--dry-run` would have to invent a separate
   description string per operation; the description and the action can
   drift.
2. **Not loggable.** The operation manifest's `consentSummary` field
   (`docs/rollback-contracts.md:124`) is a string. We need to render
   "delete plugin cache dir `<X>`" before consent and *also* execute
   that exact deletion after consent. A function reference is opaque.
3. **Not auditable.** Tests want to assert "the plan composed for
   fixture `plugin-cache-unreferenced-7days` contains exactly one op
   with `mutationKind: "dir-rmtree"` and `mutationOp.args.dirPath`
   matching `<expected>`". Function equality is not introspectable in
   JS.

The descriptor pattern keeps the plan inert. A small registry inside
`clean-plan.mjs` materialises descriptors into callables only at
`executeCleanPlan()` time:

```js
// scripts/lib/clean-plan.mjs (proposed)
const MUTATION_REGISTRY = {
  "dir-rmtree": async (origPath, { dirPath }) => {
    // origPath is the *individual file* from manifest.files[]
    // dirPath is the parent we're removing
    // applyOperation calls us once per file in expandedFiles;
    // for dir-rmtree, every per-file call is a no-op except the LAST,
    // which removes the dir. See §3.2 for ordering.
    // ... (see §3.2 for the actual implementation sketch)
  },
  "file-unlink": async (origPath /*, args */) => {
    await rm(origPath);  // single file
  },
  "file-replace": async (origPath, { nextBytes }) => {
    await writeFile(origPath, nextBytes); // atomic write contract is takeSnapshot's job
  },
  "json-fragment-edit": async (origPath, { jsonPointer, nextValue }) => {
    const current = JSON.parse(await readFile(origPath, "utf8"));
    const next = applyJsonPointerEdit(current, jsonPointer, nextValue);
    await writeFile(origPath, JSON.stringify(next, null, 2) + os.EOL);
  }
};
```

### 1.5 Mapping `CleanPlan` to the existing `OperationManifest`

The manifest schema (`docs/rollback-contracts.md §3`) is the authoritative
record on disk. The `CleanPlan` is the in-memory contract between
`composeCleanPlan` and `executeCleanPlan`. The two must round-trip:

| `CleanPlan` field            | → `OperationManifest` field                                              |
|------------------------------|--------------------------------------------------------------------------|
| `operations[i].expandedFiles` | `files[j].originalPath`   (1:N expansion across the manifest)            |
| `operations[i].opIndex`       | NOT persisted; replaced by manifest `id`                                 |
| `operations[i].detectorId`    | `consentSummary` (rendered string includes detector id)                  |
| `operations[i].mutationKind`  | NOT persisted; reconstructible from `consentSummary` + future schema v0.3 |
| `operations[i].mutationOp`    | NOT persisted; runtime-only                                              |
| `operations[i].policyChecks`  | Cross-checked at `takeSnapshot()` against current policy; populates `blockedByProtection[]` if any drift |
| `plan.totals.fileCount`       | `files.length` (sum across the single manifest, since v0.2 = one op per plan, see §1.6) |
| `plan.totals.estimatedBytes`  | `sum(files[].size)`                                                      |

**Critical asymmetry:** v0.2 takes ONE snapshot per `takeSnapshot()`
invocation, producing ONE manifest. A `CleanPlan` with N operations
therefore requires N successive `takeSnapshot → applyOperation → verify`
cycles, or a constraint that v0.2 plans contain exactly one operation.

### 1.6 v0.2 constraint: one operation per plan

`notes/PLAN-v0.2.md:30` says:

> Bulk / recursive operations — Deferred to v0.3 — single-file ops only
> in v0.2

This memo recommends interpreting "single-file ops" as "**single
`CleanOperation` per `CleanPlan`**", not "one byte". A single
`CleanOperation` can have `expandedFiles.length > 1` (e.g. a dir-rmtree
of a plugin cache version with 30 files) — that's normal — but the
plan as a whole has `operations.length === 1`.

Rationale:

- `takeSnapshot()` already supports up to 50 files per op
  (`MAX_OPERATION_FILES`, `scripts/lib/snapshot.mjs:25`). One
  `dir-rmtree` of a typical plugin cache version is well under that.
- Multi-operation plans need atomicity decisions (all-or-nothing? best
  effort? interleaved apply/verify?) that are out of scope for v0.2.
- Rollback in v0.2 is scoped to a single `op_id`
  (`notes/PLAN-v0.2.md:70`). Multi-op plans break the rollback model.

If a `Report` has 3 cleanable findings, v0.2 produces 3 separate
`clean --confirm --yes` invocations or refuses 2 of them with reason
`no-mutation-mapping-in-v0.2`. **The product memo must address which
of these UXes ships in v0.2.0.** This memo recommends: pick one
finding (the one with the highest-priority stance per
`audit.mjs:324 PRIMARY_PRIORITY`), clean it, refuse the rest with a
clear "re-run clean to address the next one" message.

---

## 2. Detector → mutation mapping — every runtime detector enumerated

The complete list of detector ids that can appear in a `Report` is
sourced from `scripts/lib/audit.mjs:38-76`:

```
ALWAYS_ON_DETECTORS  (audit.mjs:69):
  housekeeper.interrupted_operation
  housekeeper.config_invalid
  housekeeper.operations_unreadable
  home.not_found
  home.scan_budget_hit
  home.clean

SCOPE_TO_DETECTORS  (audit.mjs:38):
  settings: settings.invalid_json, settings.hook_path_dangling,
            settings.hook_command_shell_ambiguous, settings.mcp_command_missing
  plugins:  plugin.expected_orphan, plugin.cache_unreferenced,
            plugin.duplicate_registration, plugin.cache_size,
            settings.hook_path_dangling, settings.hook_command_shell_ambiguous
  registry: registry.local_skill_shadow, registry.local_command_identical,
            registry.local_command_diverged, registry.broken_frontmatter
  housekeeper: housekeeper.interrupted_operation,
               housekeeper.config_invalid, housekeeper.operations_unreadable
```

Across both sets, the union is 18 detector ids. Verdict per id:

| Detector id                              | v0.2 cleanable? | mutationKind          | snapshotStrategy       | apply() spec / refusal reason                                                                                                                                                                                                                                                            |
|------------------------------------------|-----------------|------------------------|------------------------|--|
| `home.not_found`                         | **REFUSE**      | —                      | —                      | `home.not_found` is a `block` finding (`audit.mjs:891` forceStance). No filesystem entity exists to clean. Refusal: `out-of-scope`. |
| `home.scan_budget_hit`                   | **REFUSE**      | —                      | —                      | `inform` orientation (`audit.mjs:929`). No mutation surface. Refusal: `stance-not-prepare`. |
| `home.clean`                             | **REFUSE**      | —                      | —                      | Inverse of clean's purpose. Refusal: `stance-not-prepare`. |
| `housekeeper.config_invalid`             | **REFUSE**      | —                      | —                      | `forceStance: "inform"` (`audit.mjs:824`). Repairing housekeeper's own config from inside `clean` is recursive and out of v0.2 scope. Refusal: `unknown-owner` (housekeeper-owned, no v0.2 self-repair channel). |
| `housekeeper.operations_unreadable`      | **REFUSE**      | —                      | —                      | `forceStance: "inform"` (`audit.mjs:861`). Permissions issue; not a clean target. Refusal: `policy-out-of-scope`. |
| `housekeeper.interrupted_operation`      | **REFUSE**      | —                      | —                      | `forceStance: "block"` (`audit.mjs:785`). Explicitly handled by `rollback <id>` per Q3 decision (`PLAN-v0.2.md:127`). Refusal: `plan-state-error` — must resolve before clean. **This is the gate `notes/PLAN-v0.2.md §3.1` calls out: "No interrupted operation already exists for the same home (must resolve first)."** |
| `settings.invalid_json`                  | **REFUSE**      | —                      | —                      | Cleanable in principle via `file-replace`, but generating a correct repaired JSON requires human intent. v0.1 stance forces `prepare`, not `repair` (`decision-calculus.md:367` v0.1 degradation). Defer to v0.3 `harden`. Refusal: `no-mutation-mapping-in-v0.2`. |
| `settings.hook_path_dangling`            | **REFUSE**      | (would be `json-fragment-edit`) | (would be `json-fragment-edit`) | The fix is to remove the offending hook entry from `settings.json`. Requires JSON-pointer-level edit + user intent ("delete this hook or fix the path?"). Defer to v0.3 `harden`. Refusal: `no-mutation-mapping-in-v0.2`. |
| `settings.hook_command_shell_ambiguous`  | **REFUSE**      | —                      | —                      | Stance is `probe` (`audit.mjs:441`). Missing evidence key: shell parse certainty. Refusal: `missing-evidence-key`. |
| `settings.mcp_command_missing`           | **REFUSE**      | (would be `json-fragment-edit`) | (would be `json-fragment-edit`) | Same shape as `settings.hook_path_dangling`; defer to v0.3. Refusal: `no-mutation-mapping-in-v0.2`. |
| `plugin.expected_orphan`                 | **REFUSE**      | —                      | —                      | Stance is `watch` (within grace period per `audit.mjs:511`). Decision calculus §6 row "expected orphan within grace period" → `watch`. Stance-driven refusal: `stance-not-prepare`. |
| **`plugin.cache_unreferenced`**          | **YES — v0.2.0 only cleanable detector** | **`dir-rmtree`** | **`dir-rmtree`** | The plugin cache version directory under `<home>/plugins/cache/<market>/<plugin>/<version>/` is `housekeeper-owned`-ish (claude-managed, manifest-backed via `installed_plugins.json`). Beyond grace period. Stance is `probe` by default but the snapshot+verify machinery *is* the live probe — once snapshotted, the dir can be safely removed. `apply()`: `rm -rf <dirPath>` (Node `fs/promises.rm({ recursive: true, force: true })`). See §3.2. |
| `plugin.duplicate_registration`          | **REFUSE**      | —                      | —                      | Stance is `review` (`audit.mjs:583`); missing key is `user-intent`. Cannot clean without resolving "which scope to keep?". Refusal: `missing-evidence-key`. |
| `plugin.cache_size`                      | **REFUSE**      | —                      | —                      | Orientation only (`claimLevel: "observation"`, `audit.mjs:624`). Refusal: `stance-not-prepare`. |
| `registry.local_skill_shadow`            | **REFUSE**      | —                      | —                      | Stance is `review`; missing key is `user-intent` (`audit.mjs:660`). Refusal: `missing-evidence-key`. |
| `registry.local_command_identical`       | **REFUSE**      | (would be `file-unlink`) | (would be `file-unlink`) | Defensible v0.3 target (byte-identical local copy is a clear delete-candidate per `decision-calculus.md §6`). Defer for v0.2.0 because the "delete the local shadow" UX needs careful framing — user may not realise the file exists. Refusal: `no-mutation-mapping-in-v0.2`. |
| `registry.local_command_diverged`        | **REFUSE**      | —                      | —                      | Stance is `review`; missing key is `user-intent`. Refusal: `missing-evidence-key`. |
| `registry.broken_frontmatter`            | **REFUSE**      | (would be `file-replace` or `file-unlink`) | (would be `file-replace`) | Stance is `prepare`. The fix is "patch the frontmatter" which is a `file-replace` requiring `nextBytes` synthesis. Defer to v0.3 `harden`. Refusal: `no-mutation-mapping-in-v0.2`. |

### 2.1 Net: v0.2.0 cleans exactly one finding class

**v0.2.0 ships exactly one cleanable detector: `plugin.cache_unreferenced`.**

Every other detector that *could* eventually be cleaned routes through
`composeCleanPlan` and is refused with `no-mutation-mapping-in-v0.2`.

This is intentional. The four-pillar promise in `PLAN-v0.2.md §1` says
v0.2 is the first release that allows mutation — singular, hedged.
Promising a comprehensive clean surface in v0.2.0 invites either scope
creep or a release that ships broken cleanable detectors. **The product
memo should validate this narrowing.**

### 2.2 Why `plugin.cache_unreferenced` is the right v0.2.0 cut

Five reasons it is the safest cleanable detector:

1. **Surface classification is uniformly clean-eligible.** Per
   `audit.mjs:528-548`, the surface is implicitly `claude-app-data`
   (under `<home>/plugins/cache/`), `claude-managed` owner,
   `not-load-bearing` once outside grace, `inert` execution,
   `snapshot-possible` rollback. Every axis aligns.
2. **The mutation is geometrically obvious.** A version directory is
   either gone or present. No JSON-fragment ambiguity, no patch
   synthesis.
3. **The grace-period gate already discriminates** between cleanable
   and watch — `audit.mjs:30` `PLUGIN_ORPHAN_GRACE_DAYS = 7`.
   `plugin.expected_orphan` exists precisely to keep watch findings out
   of the clean target.
4. **It's the bulk-cleanup user motivation.** Plugin cache versions are
   the only Claude home surface that grows monotonically. Cleaning them
   is the most common user request the product hears.
5. **It exercises the most failure modes.** Recursive dir read,
   per-file snapshot, atomic write of N files, dir-level mutation. If
   the v0.2 pipeline handles this end-to-end, every other v0.3
   mutation kind is a strict simplification.

### 2.3 What the refusal UX looks like

A finding that is refused appears in the rendered `--dry-run` plan as:

```
REFUSED (no-mutation-mapping-in-v0.2) settings.hook_path_dangling
  target:      <home>/settings.json
  why:         clean cannot patch settings hook entries in v0.2;
               deferred to v0.3 harden
  next step:   review the finding manually and edit settings.json
```

The same finding does NOT appear in `plan.operations[]`. It is in
`plan.refused[]`.

---

## 3. Snapshot strategy taxonomy

`takeSnapshot()` snapshots files, not directories
(`scripts/lib/snapshot.mjs:324-364`). The `expandedFiles` list in a
`CleanOperation` is what gets passed as `opts.targets`. The
`snapshotStrategy` field is therefore advisory metadata that drives:

1. How `composeCleanPlan` expands `targetPath` → `expandedFiles`.
2. How `executeCleanPlan` orders the `apply()` calls within an op.
3. How `verify()` interprets the post-mutation state.

Four named strategies. Three are placeholders for v0.3.

### 3.1 `file-replace`

**Used by:** `mutationKind: "file-replace"`.
**Snapshotted:** exactly one file = `expandedFiles[0] = targetPath`.
**Reverse-apply logic:** copy `snapshots/<op_id>/files/0000_<basename>`
back to `originalPath`. Already implemented by the rollback flow in
`snapshot-architecture.md §10` `rollback()`.
**Atomicity:** single atomic write at apply time (write-temp → rename
→ fsync-parent per `snapshot-architecture.md §4`). The mutation
function MUST use the atomic protocol (or `takeSnapshot`'s
`atomicWrite()` helper at `snapshot.mjs:214` — but that's a private
helper; the architecture memo recommends exposing a per-mutation
atomic-write primitive from `snapshot.mjs` in a follow-up).
**Failure modes:** snapshot write failure → status `planned`, no
mutation. Apply write failure → `partialApply: true` on that file
entry; `applyOperation` already handles this at `snapshot.mjs:559`.
**v0.2.0 status:** **not used by any cleanable detector.** Reserved for
v0.3 `harden` (settings patch).

### 3.2 `dir-rmtree`

**Used by:** `mutationKind: "dir-rmtree"`. v0.2.0's only live strategy.
**Snapshotted:** every regular file recursively under `dirPath`, each
as its own entry in `manifest.files[]`. Symlinks are snapshotted per
`snapshot-architecture.md §3` (target string hashed, not dereferenced).

**Pre-snapshot expansion (in `composeCleanPlan`):**

```js
// scripts/lib/clean-plan.mjs (proposed sketch)
function expandDirRmtree(dirPath) {
  const out = [];
  walk(dirPath, (filePath, stat) => {
    if (stat.isDirectory()) return;        // dirs are not snapshotted
    if (stat.isFile() || stat.isSymbolicLink()) out.push(filePath);
    // Anything else (sockets, devices, fifos) → refuse the whole op.
    // We do not snapshot non-regular files.
  });
  return out;
}
```

**Reverse-apply logic:** the snapshot already contains every file's
bytes. To reverse: `mkdir` the dir, then for each `manifest.files[i]`,
write `bytes(snapshotPath)` to `originalPath`. The directory hierarchy
must be reconstructed from `dirname(originalPath)` calls in stable
sort order so parents exist before children. This is **not** the same
as the file-replace rollback logic and the rollback flow in
`snapshot-architecture.md §10` needs an additive case for dir-rmtree.
**This memo flags the rollback flow as needing a v0.2 update** (see
§7 Open Questions, Q-ARCH-A).

**Atomicity at apply time:** the per-file `apply(filePath)` callback
must be careful. The naïve implementation deletes each file in turn,
then the dir at the end. But `applyOperation` iterates
`manifest.files[]` in order and calls `ops[i].apply(originalPath)` for
each. The proposed callable:

```js
// MUTATION_REGISTRY["dir-rmtree"]
async function dirRmtreeApply(origPath, { dirPath, isLast }) {
  // origPath is one file under dirPath; isLast tells us if this is
  // the final file. We delete each file individually so that
  // applyOperation can record per-file sha256After (which is empty
  // for a deleted file, but we mark sha256After = null to signal
  // "intended deletion" — see §3.5 Verify semantics for deletions).
  await rm(origPath, { force: true });
  if (isLast) {
    // After all files are gone, remove the directory itself.
    // (At this point the dir contains only sub-directories, which
    // are empty because we deleted their files in earlier iterations.)
    await rm(dirPath, { recursive: true, force: true });
  }
}
```

The `isLast` flag must be threaded by `executeCleanPlan` when
materialising callables. A small refinement: `applyOperation` doesn't
currently know about `isLast`; `executeCleanPlan` knows the count and
sets `args.isLast = (i === expandedFiles.length - 1)` per entry.

**Verify semantics for deletions:** §3.5 below.

**Failure modes:**

- Mid-walk failure during snapshot (file became unreadable between
  walk and read) → snapshot writer aborts; status stays `planned`.
- Apply fails on file 5 of 30 → `partialApply: true`; rollback flow
  must distinguish "restore the partially-deleted dir" from
  file-replace rollback.
- The `rm` of the dir fails after all file deletes succeed → manifest
  status is `applied` with `partialApply: true` because the apply
  intent ("dir is gone") is not satisfied. `verify()` catches this
  via the deletion semantics in §3.5.

**v0.2.0 status:** **live. The only strategy in the registry that
runs.**

### 3.3 `file-unlink`

**Used by:** `mutationKind: "file-unlink"`.
**Snapshotted:** the single target file.
**Reverse-apply logic:** write `bytes(snapshotPath)` to
`originalPath`. Standard rollback path.
**Atomicity:** single `unlink()` at apply time.
**Failure modes:** unlink permission denied → caught in
`applyOperation` per-file try/catch (`snapshot.mjs:555`); marks
`partialApply: true`.
**Verify semantics:** §3.5.
**v0.2.0 status:** reserved for v0.3 (would target
`registry.local_command_identical`). Defined in the enum but no
detector mapping in v0.2.0.

### 3.4 `json-fragment-edit`

**Used by:** `mutationKind: "json-fragment-edit"`.
**Snapshotted:** the entire JSON file as bytes. The fragment-edit
nature is preserved in the mutation descriptor (`jsonPointer`,
`nextValue`), not in the snapshot.
**Reverse-apply logic:** standard file-replace from snapshot.
**Atomicity:** read JSON → mutate → write JSON atomically. Mutation
function uses RFC 6901 JSON Pointer for addressing fragments. The
DELETE sentinel signals "remove this key/index".
**Failure modes:** JSON parse error on read → caller's responsibility
to detect at plan-compose time; `composeCleanPlan` should refuse to
emit a `json-fragment-edit` op against a file that does not currently
parse cleanly. Mutation write error → `partialApply: true`.
**Verify semantics:** standard `sha256After` comparison.
**v0.2.0 status:** reserved for v0.3 `harden` (would target
`settings.hook_path_dangling`, `settings.mcp_command_missing`).
Defined in the enum but no detector mapping in v0.2.0.

### 3.5 Verify semantics for deletions

`verify()` at `snapshot.mjs:590` recomputes `sha256(originalPath)` and
compares to `manifest.files[i].sha256After`. For a deletion
(`dir-rmtree` or `file-unlink`), `originalPath` no longer exists.
`hashFile(originalPath)` will throw ENOENT.

**Decision:** the convention for deletions is to set
`manifest.files[i].sha256After = null` at apply time. Then `verify()`
must treat `sha256After === null` as "intended-deletion: confirm the
file is absent". Concretely:

```js
// proposed addition to verify() in scripts/lib/snapshot.mjs
for (const entry of manifest.files) {
  if (entry.sha256After === null || entry.sha256After === undefined) {
    // Intended deletion. Verify by absence.
    if (existsSync(entry.originalPath)) {
      entry.verifyFailure = true;
      allMatch = false;
    }
    continue;  // skip the hash comparison branch
  }
  const actual = await hashFile(entry.originalPath);
  if (actual !== entry.sha256After) {
    entry.verifyFailure = true;
    allMatch = false;
  }
}
```

`scripts/lib/snapshot.mjs:600` currently `continue`s on null
`sha256After`, which means a deletion is silently considered verified
even if the file is still present. **This is a bug for v0.2 the
moment any deletion mutation lands.** The claude-code memo must
flag the fix and the architecture memo recommends a one-line patch in
the T-704 PR. See §7 Q-ARCH-B.

---

## 4. Plan composition pipeline — module boundaries

### 4.1 New file: `scripts/lib/clean-plan.mjs`

Pure functions, no I/O except via injected helpers. The walk for
dir-rmtree expansion is the one exception (needs `readdir`/`stat`),
and it can be passed in as a parameter (`expandFn`) for testability.

Exports:

```js
// scripts/lib/clean-plan.mjs
export function composeCleanPlan(report, options) { /* ... */ }
export function validateCleanPlan(plan, home, options) { /* ... */ }
export async function executeCleanPlan(plan, home, options) { /* ... */ }

export const MUTATION_REGISTRY = { /* see §1.4 */ };
export const REFUSAL_REASONS = Object.freeze([
  "policy-protected-path", "policy-sector-boundary", "policy-out-of-scope",
  "stance-not-prepare", "execution-class-not-inert", "missing-evidence-key",
  "rollback-class-checkpoint-only", "rollback-class-irreversible",
  "unknown-owner", "out-of-scope", "no-mutation-mapping-in-v0.2",
  "budget-would-exceed-per-op", "budget-would-exceed-aggregate",
  "plan-state-error"
]);
export const MUTATION_KINDS = Object.freeze([
  "dir-rmtree", "file-unlink", "file-replace", "json-fragment-edit"
]);
```

### 4.2 `composeCleanPlan(report, options)` — pure

Pseudocode:

```js
export function composeCleanPlan(report, { home, expandFn = defaultExpand }) {
  const operations = [];
  const refused = [];

  for (const finding of report.findings) {
    const verdict = classifyForClean(finding);

    if (verdict.refuse) {
      refused.push({
        detectorId: finding.id,
        findingRef: finding.targetPath,
        reason: verdict.reason,
        detail: verdict.detail,
        policyMatches: finding.policyMatches
      });
      continue;
    }

    // verdict.cleanable: true
    const op = buildOperation(finding, expandFn, operations.length);
    operations.push(op);
  }

  // Enforce "one operation per plan in v0.2" — keep only the first
  // (highest-priority by PRIMARY_PRIORITY), refuse the rest.
  if (operations.length > 1) {
    const [kept, ...rest] = sortByStancePriority(operations, report);
    for (const o of rest) {
      refused.push({
        detectorId: o.detectorId,
        findingRef: o.findingRef,
        reason: "no-mutation-mapping-in-v0.2",
        detail: "v0.2 cleans one finding per invocation; re-run clean to address this one"
      });
    }
    operations.length = 0;
    operations.push(kept);
  }

  return makeCleanPlan({
    schemaVersion: "0.1",
    home,
    reportRef: { generatedAt: report.generatedAt, primary: report.primary },
    operations,
    refused,
    totals: tallyTotals(operations),
    budgets: { /* mirrors snapshot.mjs constants */ },
    warnings: collectWarnings(report, operations, refused),
    generatedAt: new Date().toISOString()
  });
}
```

`classifyForClean(finding)` is the table from §2 encoded as a function.
The decision order, in this memo's recommendation:

```
1. finding.id === "housekeeper.interrupted_operation"
   → refuse: "plan-state-error" (must rollback first)
2. finding.stance === "protect"
   → refuse: "policy-protected-path" (or sector-boundary / unknown by sub-classifier)
3. finding.policyMatches.length > 0
   → refuse: "policy-protected-path"
4. finding.surface.scopeClass in {"out-of-scope", "sector-boundary"}
   → refuse: "policy-sector-boundary" or "policy-out-of-scope"
5. finding.surface.executionClass !== "inert"
   → refuse: "execution-class-not-inert"
6. finding.surface.rollbackClass in {"checkpoint-only", "irreversible"}
   → refuse: corresponding refusal reason
7. finding.surface.ownerClass === "unknown"
   → refuse: "unknown-owner"
8. finding.stance not in {"prepare", "repair"}
   → refuse: "stance-not-prepare"
9. finding.evidence.missing.length > 0  OR  finding.missingKey
   → refuse: "missing-evidence-key"
10. lookup finding.id in v0.2.0 mutation map (§2.1)
    if absent → refuse: "no-mutation-mapping-in-v0.2"
11. otherwise → cleanable, build op
```

Order is load-bearing: protection checks first; missing evidence last
(so we surface "we would have cleaned this, but evidence is short"
rather than "no v0.2 mapping" when both could apply).

### 4.3 `validateCleanPlan(plan, home, options)` — annotates + throws

Validates the plan against current filesystem and current policy. Runs
after `composeCleanPlan` but before any `takeSnapshot()` call.

```
- Re-load policy from disk (it could have changed since report was generated).
  For each operation.policyChecks, re-evaluate against current policy.
  If any check transitions to matched: true (policy added a rule between
  report and validate), throw PlanInvalidError.

- Re-check fileCount and estimatedBytes against snapshot budgets
  (MAX_OPERATION_FILES, MAX_OPERATION_BYTES from snapshot.mjs). If the
  expansion grew (someone added files to the dir between compose and
  validate), throw if over budget. Otherwise update totals.

- Check that home still exists (paranoid; assembleReport already does
  this, but plan compose could be hours later if a long --dry-run loop
  is involved).

- Check for inflight interrupted operations: read operations/ dir,
  refuse if any non-terminal manifest exists. (Q3 enforcement at the
  validation layer, not just the assemble layer.)

Returns the plan (possibly with updated totals), or throws.
```

### 4.4 `executeCleanPlan(plan, home, options)` — effectful

```
- gcSnapshots(home)               # already implemented at snapshot.mjs:446
                                  # Q4 says GC runs at the start of clean.

- for each operation in plan.operations (currently just 1 in v0.2):
    consentSummary = renderConsentString(operation, plan)

    { opId, manifest } = await takeSnapshot(home, {
      targets: operation.expandedFiles,
      command: "clean",
      mode: "confirm",
      consentSummary
    })

    # materialise mutation callables from descriptors
    ops = operation.expandedFiles.map((f, i) => ({
      apply: (origPath) => MUTATION_REGISTRY[operation.mutationKind](
        origPath,
        { ...operation.mutationOp.args, isLast: i === operation.expandedFiles.length - 1 }
      )
    }))

    manifest = await applyOperation(opId, home, ops)

    if (manifest.partialApply) {
      # Q5 decision: auto-rollback only when status reached "applied"
      # with partialApply: true. Implementation defers to T-802 once
      # the rollback() function lands; until then, leave applied and
      # let housekeeper.interrupted_operation surface it.
      return { opId, finalStatus: "applied-partial", manifest, refused: plan.refused }
    }

    manifest = await verify(opId, home)

- return { opId, finalStatus: manifest.status, manifest, refused: plan.refused }
```

### 4.5 Module ownership and the no-mutation invariant

`notes/PLAN-v0.2.md:124` records the existing decision:
`no-mutation.test.mjs` allowlists only `scripts/lib/snapshot.mjs`.

This memo recommends extending the allowlist to include
`scripts/lib/clean-plan.mjs`. The rationale aligns: clean-plan.mjs is
the designated mutation-plan surface; everything else stays read-only.
The allowlist edit is a single-line addition. **The architecture memo
flags this as a required T-704 prerequisite the executor must not
miss.**

---

## 5. Refusal taxonomy — every category, with error class and exit code

The exit-code model continues `claude-housekeeper.mjs` conventions:

- `0` = clean ran, plan executed (or `--dry-run` rendered)
- `1` = clean ran, refusals occurred but execution succeeded for what
        was eligible
- `2` = clean refused entirely (no eligible operations, OR a blocking
        precondition forbids any clean — interrupted op, protected
        target, missing home)

Mapping refusal categories:

| Refusal reason                       | Error class                  | User-visible message (template)                                                                 | Exit code (when sole / when partial) |
|--------------------------------------|------------------------------|-------------------------------------------------------------------------------------------------|--------------------------------------|
| `policy-protected-path`              | `PolicyRefusedError`         | "Path `<target>` is protected by rule `<rule>` — `<reason>`. Remove the rule to clean."         | 2 / 1                                |
| `policy-sector-boundary`             | `PolicyRefusedError`         | "Path `<target>` is inside a sector boundary (`<segment>`) and cannot be cleaned without an exception." | 2 / 1                                |
| `policy-out-of-scope`                | `PolicyRefusedError`         | "Path `<target>` is outside the clean scope `<scope>`."                                         | 2 / 1                                |
| `stance-not-prepare`                 | `StanceRefusedError`         | "Finding `<id>` has stance `<stance>`; clean only acts on stance `prepare`."                    | 2 / 1                                |
| `execution-class-not-inert`          | `SurfaceRefusedError`        | "Surface for `<target>` is `<executionClass>`; clean only acts on inert surfaces."              | 2 / 1                                |
| `missing-evidence-key`               | `EvidenceRefusedError`       | "Finding `<id>` is missing evidence key(s): `<missing>`. Resolve before clean."                 | 2 / 1                                |
| `rollback-class-checkpoint-only`     | `RollbackRefusedError`       | "Path `<target>` is checkpoint-only rollback; clean requires manifest-backed rollback."         | 2 / 1                                |
| `rollback-class-irreversible`        | `RollbackRefusedError`       | "Path `<target>` is irreversible; clean cannot proceed."                                        | 2 / 1                                |
| `unknown-owner`                      | `SurfaceRefusedError`        | "Owner of `<target>` is unknown; clean only acts on classified surfaces."                       | 2 / 1                                |
| `out-of-scope`                       | `PolicyRefusedError`         | "Path `<target>` is outside the requested scope."                                               | 2 / 1                                |
| `no-mutation-mapping-in-v0.2`        | `PlanRefusedError`           | "Detector `<id>` is not cleanable in v0.2; deferred to v0.3 (`<reference>`)."                   | 2 / 1                                |
| `budget-would-exceed-per-op`         | `BudgetRefusedError`         | "Operation would exceed per-op budget (`<actual>` vs `<limit>`)."                               | 2 / 1                                |
| `budget-would-exceed-aggregate`      | `BudgetRefusedError`         | "Plan would exceed aggregate budget (`<actual>` vs `<limit>`)."                                 | 2 / 1                                |
| `plan-state-error`                   | `PlanStateError`             | "Cannot clean: interrupted operation `<op_id>` is `<status>`. Run `rollback <op_id>` first."    | 2 / 2                                |

The "sole" column is the exit code when EVERY finding routes into
`refused[]`. The "partial" column is the exit code when at least one
operation succeeded.

`plan-state-error` is always exit 2 because it's a precondition
violation — no operation can run while an interrupted op exists.

### 5.1 The `housekeeper.interrupted_operation` interlock

`composeCleanPlan` must consult the live operations/ dir, not just
findings, before emitting any operation. Recommended placement: a
dedicated precondition check at the top of `composeCleanPlan`, before
the per-finding loop. If `interrupted_operation` fires anywhere in
`report.findings`, the plan is empty (no operations) and
`refused[]` contains exactly one entry with reason
`plan-state-error`. The CLI exits 2.

This is the "no interrupted operation already exists for the same
home" precondition that `notes/PLAN-v0.2.md §3.1` lists.

---

## 6. v0.2.0 scope decision

### 6.1 Recommended subset

| Capability                                       | Ship in v0.2.0 | Why |
|--------------------------------------------------|----------------|------|
| `clean --confirm --yes` end-to-end               | **YES**        | Definition of T-704. |
| `composeCleanPlan` for `plugin.cache_unreferenced` | **YES**     | The only well-supported cleanable detector (§2). |
| `dir-rmtree` mutation kind, snapshot strategy    | **YES**        | Required by the above. |
| `file-replace`, `file-unlink`, `json-fragment-edit` enum entries | **YES (enum only, no live mapping)** | Type-system anchor for v0.3; refused paths reference them in error messages. |
| One-operation-per-plan constraint                | **YES**        | Constrains the manifest model (§1.6). |
| Refusal taxonomy + structured refused[]          | **YES**        | Hard requirement for "did clean see this finding?" auditability. |
| Auto-rollback on `partialApply: true`            | **NO** (defer to T-704 follow-up) | Q5 says auto-rollback only when status reached `applied`; T-802 (rollback function) is gated by T-702 in the taskboard, which is now landed. Architecture says the wiring is straightforward (call `rollback(opId, home)`), but it requires the rollback function which lands separately. Recommend: in v0.2.0, leave `partialApply: true` manifests for `housekeeper.interrupted_operation` to surface — that's exactly what the detector is for. Document the behaviour. |
| Deletion-aware `verify()`                        | **YES**        | Required because `dir-rmtree` produces null `sha256After` (§3.5). Without this, a dir-rmtree manifest auto-`verified`s even if files survive. |
| `--scope` filter on clean targets                | **NO**         | v0.1 surface; clean inherits `--scope` from `assembleReport` but in v0.2 it has no effect because only one detector is cleanable. Document but do not act. |
| `--max-files` budget override                    | **NO**         | The per-op budget is a safety rail; let it be discovered in v0.2.1 if needed. |
| JSON output for the plan (`clean --confirm --json`) | **YES (mirror plan-mode output)** | Symmetric with `diagnose --json` and `plan --json`. Use the existing JSON renderer pattern. |
| `clean --confirm` (no `--yes`)                   | already shipped (#40) | No change needed. |
| GC of old snapshots before take                  | **YES**        | Already implemented via `gcSnapshots()`; just call it. Q4 says only from clean/rollback paths. |

### 6.2 Anti-recommendations

These are *tempting* but should NOT ship in v0.2.0:

- **`settings.hook_path_dangling` clean.** Looks straightforward — delete
  the offending hook entry from settings.json. But the user-intent gap
  is large (delete the hook? fix the path? add the missing file?). The
  product memo should make this case for v0.3 `harden`.
- **`registry.local_command_identical` clean.** The byte-identical
  shadow is a clear delete candidate by stance, but the UX of "delete
  a file the user wrote" needs work that doesn't fit v0.2.
- **Plan stacking** (clean N findings in one invocation). One op per
  plan is the v0.2 constraint; relaxing it requires the multi-op
  manifest design (out of scope).
- **Auto-rollback hook.** Tempting because the rollback function lands
  in T-802, but: Q5 explicitly says auto-rollback only for the narrow
  `applied + partialApply` case; broader auto-rollback risks
  surprising users. Defer.
- **`clean --abort` / `clean --status`** as separate subcommands. The
  `rollback --abort` UX from `notes/TASKBOARD-v0.2.md:177` covers
  pre-apply aborts; clean's surface should not duplicate.

---

## 7. Open architectural questions

### Q-ARCH-A — `rollback()` for `dir-rmtree`

`docs/snapshot-architecture.md §10` `rollback()` pseudocode writes
`bytes(snapshotPath)` to `originalPath`. For a deleted directory, the
parent directory must be re-created first. The current `rollback()`
function is not yet implemented (T-802 in the taskboard at
`notes/TASKBOARD-v0.2.md:132`).

**Proposed default:** `rollback()` calls `mkdir(dirname(originalPath),
{ recursive: true })` before each file restore. This works for both
file-replace (no-op, dir already exists) and dir-rmtree (creates the
dir hierarchy). The cost is one mkdir per file restored; negligible
for v0.2's per-op-50-file limit.

**When the default is wrong:** if the user has rebuilt the directory
structure between apply and rollback (e.g. installed the same plugin
version again), the mkdir is a no-op but the file write OVERWRITES
the new install. This is the `entry.sha256After !== currentHash`
case at `snapshot-architecture.md §10` `rollback()` — already flagged
to require `--force` (T-803).

### Q-ARCH-B — Deletion-aware `verify()`

§3.5 above identified that the current `verify()` at
`scripts/lib/snapshot.mjs:600` `continue`s on null `sha256After`,
silently passing deletion verifications. **This must be patched in
the T-704 PR**, not deferred.

**Proposed default:** the snippet in §3.5 — treat `sha256After ===
null` as intended-deletion, verify by absence (`!existsSync`).

**When the default is wrong:** if some future mutation kind legitimately
sets `sha256After = null` to mean "we did not apply to this file"
(distinct from "we intended to delete it"), the semantics collide. To
avoid this, the architecture memo recommends adopting a sentinel:
`sha256After = "DELETED"` (or a separate `intent: "delete" |
"replace"` field on the file entry). Pragmatically, v0.2.0 has only
one mutation kind that deletes; the null overload works. Re-evaluate
when adding the next deletion mutation.

### Q-ARCH-C — `executeCleanPlan` cancellation between snapshot and apply

The full flow is `takeSnapshot → applyOperation → verify`. Q5 covers
the `applied → partialApply` window. But there's a smaller window:
between `takeSnapshot` (status becomes `snapshot_taken`) and the
first line of `applyOperation` (status still `snapshot_taken`).

If the process dies in that window, the manifest is `snapshot_taken`,
the snapshot dir is complete, and no mutation has occurred.
`housekeeper.interrupted_operation` fires on the next session with
message "Snapshot taken but apply never ran"
(`rollback-contracts.md:193`).

**Proposed default:** no `executeCleanPlan`-level catch. Let the
process die; the next session catches via the standing detector. The
user gets `rollback --abort <op_id>` (T-902 — `notes/TASKBOARD-v0.2.md:177`).

**When the default is wrong:** if the dispatcher wraps clean in a
parent process that catches SIGINT and *can* set status to `aborted`
before exiting, we should let it do so. Architecture memo: leave
this as a hook point in `executeCleanPlan` (no implementation in
v0.2.0) and document the cleanup contract.

### Q-ARCH-D — Multi-detector plans (the "one op per plan" gate)

The §1.6 / §4.2 constraint refuses N-1 of N findings. Two UX paths:

a. **Strict refusal.** "Plan would include 3 ops; v0.2 supports 1.
   Refused 2." User re-runs clean. Each run is one op.

b. **Highest-priority pick.** "Plan would include 3 ops; v0.2 cleans
   the highest-priority one." User sees the plan with op 1
   actionable and ops 2-3 in refused[].

**Proposed default:** (b). Aligns with `audit.mjs:324 PRIMARY_PRIORITY`
ordering. The product memo should explicitly endorse or reject.

**When the default is wrong:** if the user has 5 `plugin.cache_unreferenced`
findings (e.g. cleaning five plugin version dirs), priority ordering
doesn't disambiguate (all stance `prepare`, same surface). Default:
pick the smallest by `estimatedBytes` (cheap test of the pipeline).
Document.

### Q-ARCH-E — `consentSummary` rendering

The `consentSummary` field on the manifest
(`docs/rollback-contracts.md:124`) is "Non-empty human-readable consent
record". For `dir-rmtree` of a plugin cache version, the recommended
template:

```
clean --confirm --yes — remove plugin cache version directory
  detector: plugin.cache_unreferenced
  target:   <home>/plugins/cache/<market>/<plugin>/<version>
  files:    <N>
  bytes:    <M>
  reasons:  unreferenced for <D> days (grace = 7)
```

Single-line is also acceptable:
`clean dir-rmtree <target> [<N> files / <M> bytes]`.

**Proposed default:** multi-line. Easier to spot drift in fixtures.

---

## 8. Threat model

Four credible failure modes where each piece works but the whole goes
wrong.

### 8.1 TOCTOU between snapshot and apply (concurrent Claude sessions)

**Scenario:** Two Claude Code sessions are running. Session A runs
`clean --confirm --yes`. Between `takeSnapshot()` and
`applyOperation()`, session B (or a `plugin reload`) writes a new file
into the plugin cache version directory. The snapshot doesn't include
that file. `apply()` deletes the dir (and the new file) — the user
loses bytes that were never snapshotted.

**Detection:** `applyOperation()` re-hashes each snapshotted file
before mutating (`snapshot.mjs:543`). For `dir-rmtree`, this catches
modifications to existing snapshotted files, but **not** new files
that appeared after the snapshot.

**Mitigation:**

- The `dir-rmtree` apply must re-list the directory at apply time and
  refuse if new files appeared. Proposed: just before
  `await rm(origPath)` for the LAST entry (which is when we also `rm`
  the dir), call `readdir(dirPath)` and assert every entry is either
  in the original `expandedFiles[]` or has already been deleted.
- Alternatively: lock the operation via `fcntl` advisory lock on
  `<home>/housekeeper/operations/.lock`. Concurrent
  `clean`/`rollback`/`harden` invocations block. This is heavier and
  cross-platform-fragile; defer.

**Residual risk:** If a process writes to the cache dir *while* the
`rm` is iterating files, the rm may fail partway (file appeared then
disappeared mid-iteration). `partialApply: true` flag fires;
`housekeeper.interrupted_operation` surfaces on next session. The user
sees the state and can rollback. Acceptable.

**Architecture recommendation:** ship the re-list check at apply time
in v0.2.0. It's a 5-line addition to the dir-rmtree apply callable
and closes the biggest TOCTOU window.

### 8.2 Symlink attacks on a clean target

**Scenario:** A symlink inside the plugin cache version directory
points outside the `<home>/.claude/` tree (e.g. into `/etc` or into
`<home>/credentials/`). The `dir-rmtree` walker either follows the
symlink (catastrophic) or hashes the symlink target string (per
`snapshot-architecture.md §3`).

**Detection:** `lstat()` is already used in `snapshot.mjs:326-328`,
correctly identifying symlinks without following them. `hashFile()`
at `snapshot.mjs:194-200` hashes the symlink target string, not the
content.

**Mitigation:** When the symlink is *deleted*, only the symlink itself
is removed — the target is untouched. So `rm(<symlinkPath>)` is safe
even when the target is outside the home.

**Residual risk:** If the walker recurses into a symlinked directory,
files inside the symlinked target appear in `expandedFiles`. The
snapshot stores their bytes (good), and apply deletes them (very bad,
because they may be elsewhere on disk). **`expandDirRmtree` MUST NOT
recurse into symlinks.** Architecture recommendation: explicit
`stat.isSymbolicLink() → record but do not recurse` in the
expansion walk. Add a fixture test.

### 8.3 Plugin cache where one file is a symlink outside the home

**Scenario:** A plugin author ships a symlink in their cache that
points to a system file, e.g. `cache/<market>/<plugin>/<v>/lib.so → /usr/lib/something.so`.
`expandDirRmtree` correctly records this as a symlink (not a regular
file). The snapshot hashes the target string. Apply deletes the
symlink file. So far, fine.

**Concern:** the architecture's `mode` recording at
`snapshot.mjs:349` is `lstats.mode`, which captures the symlink's
mode (0777 typically), not the target's mode. Rollback recreates the
symlink with `mode = "0777"` — usually fine, but the rollback should
use `symlink(target, path)`, not `writeFile(path, target)`. **Current
rollback is not yet implemented (T-802); the architecture memo flags
the symlink-restore case as a required test fixture before T-802 PR
opens.**

**Detection / mitigation:** test fixture for symlink-in-cache-dir.

**Residual risk:** none if the test covers the restore path.

### 8.4 Race with Claude's plugin reload mid-clean

**Scenario:** A Claude Code session is open. The user runs
`clean --confirm --yes` from another terminal. Claude has an active
reference to a file in the cache version we're cleaning (e.g. it has
opened a `SKILL.md` to read).

**Detection:** Claude's plugin reload re-reads `installed_plugins.json`
on session start, not continuously. An open file handle survives
deletion on POSIX (the inode persists until the handle closes); on
Windows it would fail. Per `notes/PLAN-v0.2.md §6` Risks: macOS/Linux
are the supported platforms.

**Mitigation:** The grace period check
(`audit.mjs:30 PLUGIN_ORPHAN_GRACE_DAYS = 7`) already separates
`plugin.expected_orphan` (in grace, watch only) from
`plugin.cache_unreferenced` (out of grace, eligible for clean). A
cache version outside grace has had 7 days without being referenced
in `installed_plugins.json`. The race window with "active session" is
narrow.

**Residual risk:** If a session is open AND a plugin is downgraded
mid-session, the cache version we're about to clean *was* referenced
30 seconds ago. The snapshot writer doesn't check Claude's live state
(per `docs/safe-mode.md` and the no-loader-key safe-mode tokens
catalogued at `audit.mjs:243`). The detector's
`missingKeys: ["live active-session reference check"]`
(`audit.mjs:541`) already discloses this gap. v0.2 ships with this
gap documented and not closed; the user is responsible for not
running `clean --confirm --yes` during active Claude sessions.

**Architecture recommendation:** document the gap in the `clean`
help text (`scripts/claude-housekeeper.mjs:43-46`) and add a
`SessionStart` hook check (T-904 in the taskboard) that warns when
clean would run against a cache that's been referenced by a session
in the last hour. This is a v0.2.1 follow-up, not a v0.2.0 blocker.

---

## 9. Open architectural questions — recap

| # | Question                                                                          | Default | When default is wrong |
|---|-----------------------------------------------------------------------------------|---------|------------------------|
| A | `rollback()` for `dir-rmtree`                                                     | `mkdir` parent before each file restore | User rebuilt dir between apply and rollback → `--force` already covers (T-803) |
| B | Deletion-aware `verify()`                                                          | Treat `sha256After === null` as intended-deletion; verify by absence | Future mutation kinds need a separate "did not apply" sentinel |
| C | Cancellation between snapshot and apply                                            | Let process die; `interrupted_operation` catches on next session | Parent process can set `aborted` if it has a handler |
| D | One-op-per-plan when N findings are cleanable                                      | Pick highest-priority via `PRIMARY_PRIORITY`; refuse rest with "re-run clean" | All findings have same priority → pick smallest by `estimatedBytes` |
| E | `consentSummary` format                                                            | Multi-line template (see §7) | Fixtures want single-line for golden-test brevity → degrade to single-line |

---

## 10. What this memo did NOT decide

These were considered and explicitly punted:

- **The consent-rendering format** (plan-mode vs. JSON vs. structured
  human). Already locked by Q2 → plan-mode default, `--json` opt-in.
  This memo defers to the report renderer extensions.
- **The CLI gate order** (`--confirm` then `--yes` vs.
  `--confirm-and-yes`). Already shipped in #40. This memo treats the
  gate as a precondition.
- **The rollback function signature.** Defined in
  `snapshot-architecture.md §10`. T-704 is upstream of T-802; this
  memo only flags the dir-rmtree-rollback gap (Q-ARCH-A) and the
  symlink-restore test fixture (§8.3).
- **The schema-stability claim** for `CleanPlan`. This memo proposes
  `schemaVersion: "0.1"` as a new contract. `docs/schema-stability.md`
  needs a row added in the T-704 PR; that doc is not in the
  read-only set this memo touches.
- **Fixture coverage for the v0.2.0 cleanable detector.** The
  `fixtures/synthetic-homes/` tree presumably contains a
  `plugin-cache-unreferenced` golden. The architecture memo assumes
  this exists or will be added in T-704; the executor must verify.

---

## 11. Decision summary — for the synthesizer

If the synthesizer takes only one section from this memo:

- §1 (the `CleanPlan` schema) is the contract.
- §2.1 (one cleanable detector for v0.2.0) is the scope decision.
- §4 (the three-function module) is the implementation seam.
- §5 (refusal taxonomy) is the user-visible surface.
- §3.5 + §7 Q-ARCH-B (deletion-aware verify) is the bug that must be
  fixed in T-704, not deferred.

If the product memo argues for a broader v0.2.0 cleanable set, this
memo's §2 enumeration tells you exactly which findings are
underdetermined (missing user-intent key, `review` stance, `probe`
stance) and which are technically tractable but unsafe
(settings/registry edits without `harden`'s patch-synthesis).

If the claude-code memo proposes a different module layout (e.g. put
plan composition inside `audit.mjs`), this memo's §4.5 tells you why:
the `no-mutation.test.mjs` allowlist is the existing convention, and
the cleanest extension is a new file.

---

*End of memo.*
