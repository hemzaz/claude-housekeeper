# Plan — Claude Housekeeper v0.3

Date: 2026-05-15. Companion to `notes/TASKBOARD-v0.3.md`.

Predecessor: `notes/PLAN-v0.2.md` — v0.2 introduced snapshot-backed mutation
for `plugin.cache_unreferenced`, `housekeeper.stale_lock`, and
`registry.local_command_identical` via the `dir-rmtree` and `file-unlink`
mutation kinds. v0.3 builds on that foundation.

---

## 1. v0.3 Scope

**Four pillars** — each is independently shippable, but the order matters
because P1 ships a new mutation kind that P2 and P4 consume.

| Pillar | Command surface | Core capability |
|---|---|---|
| P1. `settings-rewrite` mutation kind | internal | Atomic JSON merge with snapshot proof; foundation for settings/hook patching |
| P2. `harden --confirm` | `harden --confirm --yes --target=<id> --path=<path>` | Apply approved settings/hook patches with snapshot + verify, mirroring `clean` |
| P3. Batch operations | `clean --batch --confirm --yes` | Multiple findings per invocation under one operation manifest |
| P4. Detector promotion | n/a (audit-only) | Move `settings.invalid_json`, `settings.hook_path_dangling`, `settings.mcp_command_missing` from `planned` → `cleanable` |

**v0.3 does NOT include:**

| Feature | Deferred to |
|---|---|
| Learning loop (false-positive memory, accepted-plan history) | v0.4 — separate track |
| MCP server repair beyond `settings.mcp_command_missing` | v0.4 |
| Plugin pruning automation (e.g. uninstall on disuse) | v0.4 |
| Multi-home / fleet support | not scheduled |
| `harden` for non-settings surfaces (e.g. registry rewriting) | v0.4 |
| Bulk operations beyond `--batch=10` cap | v0.4 |
| Interactive consent (TTY prompts) | v1.0 — `--yes` remains required for now |

---

## 2. Dependencies

| Dependency | Status | Notes |
|---|---|---|
| v0.2.0 GA tag on `main` | In flight (`release/v0.2.0` PR pending) | All v0.3 work branches from v0.2.0 |
| Snapshot writer (`scripts/lib/snapshot.mjs`) | Shipped | `MUTATION_REGISTRY` extension point exists |
| Refusal classifier (`scripts/lib/clean-plan.mjs`) | Shipped | 12-rule taxonomy; will be reused by `harden-plan.mjs` |
| Rollback writer (`scripts/lib/rollback-plan.mjs`) | Shipped | `executeRollbackPlan` is mutation-kind-agnostic |
| Operation manifest schema (`schemaVersion: "0.2"`) | Shipped | Adds new mutation kinds without bumping schema |
| Design memos (architect / product / platform / tie-breaker) | Phase 0 of this plan | Must land before Phase 1 code work |

Phase 1 code work MUST NOT start until the four design memos land and the
tie-breaker resolves cross-memo conflicts (same protocol as T-704 in v0.2).

---

## 3. Architecture Notes

### `settings-rewrite` mutation kind

A new entry in `MUTATION_REGISTRY` alongside `dir-rmtree` and `file-unlink`.
Unlike file deletion, settings rewrite reads, transforms, and writes JSON
content atomically through the snapshot pipeline.

**Pre-apply checks:**

1. Target file parses as valid JSON (no JSONC comments — v0.2 readme already
   notes JSONC support is limited).
2. The proposed patch produces a syntactically valid output (validate before
   commit).
3. `sha256Before` matches the snapshot, just like file deletion.
4. The patch is **idempotent** — applying it twice yields the same output.
   This protects against double-apply on rerun-after-crash.

**Apply protocol:** read → transform → validate → write atomically (write-temp
+ rename + fsync-parent), then record `sha256After`.

**Rollback protocol:** identical to existing file-restore-from-snapshot. The
snapshot tree holds the pre-patch original; rollback writes it back.

### Refusal taxonomy extension

`composeHardenPlan` mirrors `composeCleanPlan`'s 12-rule classifier with
harden-specific reasons:

- `settings-jsonc-detected` — file uses JSONC comments; harden refuses
- `settings-shape-unknown` — top-level shape doesn't match documented schema
- `patch-not-idempotent` — applying twice diverges (caught in dry-run)
- `patch-produces-invalid-json` — caught before snapshot
- ... plus all reusable refusal reasons from clean

### Batch flow

`clean --batch` aggregates multiple findings into one manifest:

1. Diagnose runs once at start.
2. For each finding the user authorized (via `--target=` repeated), build a
   single combined plan whose `operations[]` lists every file across every
   finding.
3. The 50-files / 10-MiB budget is enforced against the **aggregate**, not
   per-finding.
4. Snapshot is taken once for the whole batch.
5. Apply runs per-operation; `partialApply: true` if any fails.
6. Rollback rolls back ALL operations or none — no partial rollback in v0.3.

Batch is **capped at 10 findings per invocation** to keep the manifest
human-readable and the snapshot tree bounded.

### Detector promotion

Three currently-`planned` detectors graduate to cleanable in v0.3:

| Detector | Mutation kind | Risk |
|---|---|---|
| `settings.invalid_json` | `settings-rewrite` to a backup-and-replace? OR mark as `block` since we can't infer intent | Open Q1 |
| `settings.hook_path_dangling` | `settings-rewrite` to remove the broken hook entry | Medium — user may want to fix the path instead |
| `settings.mcp_command_missing` | `settings-rewrite` to remove the broken MCP entry | Medium — user may want to install the missing binary instead |

Each promotion gets an acceptance card + golden fixture before code lands.

---

## 4. Open Design Questions

These could not be resolved from existing docs and are parked for the team
to decide before Phase 1 implementation begins.

**Q1: `settings.invalid_json` recovery semantics**
Should harden act on a settings file that doesn't parse as JSON?
Options:
a) Refuse (block-stance only — user must fix manually).
b) Move the broken file aside (`settings.json.broken-YYYYMMDD`) and write an
   empty `{}` settings; user re-edits from scratch.
c) Run JSON repair heuristics (risky — may produce silently-wrong settings).
Decision needed before T-100.

**Q2: Settings JSONC support**
Claude Code accepts JSONC (`//` comments) in `settings.json`. Housekeeper's
parser is strict JSON. Should harden:
a) Refuse JSONC files with a clear refusal class.
b) Strip comments before reading, write them back on save (round-trip risk).
c) Adopt a tolerant JSONC parser (e.g. `jsonc-parser` from npm).
Decision needed before T-101.

**Q3: Batch atomicity model**
If a batch of 5 operations completes the first 3 then crashes:
a) Auto-rollback all 5 (consistent state, but the 3 successful operations are
   undone — wasted work).
b) Leave the partial state and rely on `housekeeper.interrupted_operation`
   to surface it; user runs `rollback <id>` to restore.
c) Continue the batch on next invocation (resume semantics — complex).
Q-USER-5 (v0.2 partial-apply) leans toward auto-rollback for "applied" state;
batch may want the same.
Decision needed before T-300.

**Q4: Per-detector harden eligibility**
Should each detector declare `hardenable: true/false` in its raw output (like
detectors already declare what they emit) so the audit pipeline knows which
findings to surface as `prepare` stance vs leaving as `review`?
Decision needed before T-200.

**Q5: Site / docs version-pinning automation**
v0.2 GA cut had to manually update `docs/index.html`'s version pin (G4).
v0.3 should either:
a) Add a CI check that `docs/index.html` version matches `package.json`.
b) Replace the hardcoded version with a build-time substitution.
Decision needed before Phase 5.

---

## 5. Decision Log

_Placeholder — record decisions here as the team resolves the open
questions above. Format: date, question id, decision, rationale, decided by._

| Date | Q# | Decision | Rationale | Decided by |
|---|---|---|---|---|
| — | — | — | — | — |

---

## 6. Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| JSONC handling produces silently-wrong settings | Medium | Refuse JSONC by default until Q2 is settled (Q2.a) |
| Batch rollback partial-fails leave home in worse state than refuse | Medium | Q3 ruling + atomic-only model; test partial-failure paths |
| Settings schema drift across Claude Code versions breaks hardener | Medium | Pin schema reading to documented shape; refuse unknown top-level keys |
| `settings-rewrite` mutation kind regresses v0.2 clean tests | Low | Mutation registry is keyed by `kind`; v0.2 paths unaffected |
| Detector promotion accidentally cleanable on protected paths | Low | Existing protection-policy check runs first; new detectors inherit it |
| Settings file is read by Claude mid-write, race condition | Low | Atomic rename guarantees Claude sees either old or new, never partial |

---

## 7. Phase summary

| Phase | Goal | Output |
|---|---|---|
| Phase 0 | Design memos (architect / product / platform / tie-breaker) | 4 docs in `docs/design/` |
| Phase 1 | `settings-rewrite` mutation kind + tests | `scripts/lib/snapshot.mjs` ext + new test file |
| Phase 2 | `composeHardenPlan` / `validateHardenPlan` / `executeHardenPlan` | New `scripts/lib/harden-plan.mjs` + tests |
| Phase 3 | Promote 3 detectors to cleanable | `scripts/lib/audit.mjs` edits + acceptance cards + fixtures |
| Phase 4 | `harden --confirm --yes` CLI wiring | `scripts/claude-housekeeper.mjs` + CLI tests |
| Phase 5 | `clean --batch` flow | CLI + clean-plan extension + tests |
| Phase 6 | Release prep | CHANGELOG, migration, README, site version pin |

---

## 8. The success state

v0.3.0 ships when a user can:

1. Run `diagnose` → see a `settings.hook_path_dangling` finding with
   `nextAllowedStep: "harden --confirm --yes --target=... --path=..."`.
2. Run `harden --confirm --yes --target=settings.hook_path_dangling --path=<path>`
   and get a snapshot-backed patch applied to `settings.json`.
3. Run `rollback <id> --confirm --yes` and have the original `settings.json`
   restored byte-for-byte.
4. Run `clean --batch --confirm --yes` against multiple findings in one
   operation manifest.
5. Trust that nothing on disk changed without snapshot proof, and that any
   `harden` failure routes through the existing interrupted-operation
   detector for recovery.

Everything else (learning loop, MCP repair, plugin pruning) waits for v0.4.
