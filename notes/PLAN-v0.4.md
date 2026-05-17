# Plan — Claude Housekeeper v0.4

Date: 2026-05-17. Companion to `notes/TASKBOARD-v0.4.md`.

Predecessor: `notes/PLAN-v0.3.md` — v0.3 shipped `harden --confirm --yes`,
the `settings-rewrite` mutation kind, `clean --batch`, two-phase JSONC
detection, and promoted three settings detectors to `hardenable`. v0.4
builds on that and addresses the six deferrals enumerated in
`docs/design/v0.3-design.md §1` plus three carry-over N-items from
`notes/RELEASE-READINESS-v0.2.0.md §3`.

---

## 1. v0.4 Scope

**Six pillars** — each independently shippable. P1 introduces a new
on-disk surface that P2/P3/P4 write to, so its schema lands first.

| Pillar | Command surface | Core capability |
|---|---|---|
| P1. Learning loop | new `housekeeper learn`; passive writes from clean/harden/rollback | Track false positives, accepted plans, rollback outcomes under `<home>/.claude/housekeeper/learning/` |
| P2. MCP repair beyond stripping | `harden --target=settings.mcp_command_missing --mcp-command-rewrite=` | Rewrite `mcpServers.<name>` command, not just remove |
| P3. Plugin pruning automation | new `housekeeper prune` (audit-only in v0.4.0; mutation in v0.4.1) | Flag unused plugins past a configurable grace window |
| P4. Harden non-settings surfaces | `harden --target=registry.*`, `--target=hooks.*`, `--target=skills.*` | Registry, hooks, skills-index rewrites beyond removal |
| P5. JSONC v2 support | internal (revisits v0.3 Q2) | Comment-preserving rewrite via `jsonc-parser` or `comment-json` round-trip |
| P6. Batch beyond N=50 | `clean --batch=<n> --stream` | Stream-based mutation for larger homes |

**v0.4 carry-over items from v0.2 readiness review:**

| Item | Source | Folded into |
|---|---|---|
| N5 — Plugin marketplace listing prep | `RELEASE-READINESS-v0.2.0.md §3 N5` | Phase 6 release prep (T-606) |
| N6 — Lockfile observability (`lock.history` append-only log) | `§3 N6` | Phase 1 cross-pillar (T-099a) — same JSONL pattern as learning |
| N8 — Pre-commit forbidden-language hook | `§3 N8` | Phase 0 tooling (T-D05) — dev-only, no runtime impact |

**v0.4 does NOT include:**

| Feature | Deferred to |
|---|---|
| Multi-home / fleet support | not scheduled |
| Interactive TTY consent | v1.0 — `--yes` remains required |
| Auto-rollback of partial-apply batches | v1.0 — Q3 v0.3 ruling holds |
| Cross-detector batch composition | v0.5 — kept disjoint per v0.3 C6 |
| `learn` suggestion engine | v0.5 — v0.4 records only, no inference |
| Plugin install via `prune --reverse` | v1.0 — prune is uninstall-only |

---

## 2. Dependencies

| Dependency | Status | Notes |
|---|---|---|
| v0.3.0 tag on `main` (`46c6179`) | Shipped 2026-05-17 | All v0.4 work branches from this |
| `settings-rewrite` mutation kind | Shipped in v0.3 | P2 extends; P4 may generalize per Q2 |
| `MUTATION_REGISTRY` extension protocol | Per `v0.3-design.md §4.1` | New kinds add via registry; no schema bump |
| `composeHardenPlan` 17-rule classifier | Shipped in v0.3 | P2/P4 add 5+ new refusal classes, first-match-wins shape |
| Operation manifest schema `"0.2"` | Frozen in v0.3 line | No bump in v0.4 unless Q1 couples learning to manifests |
| Four-voice design memos | Phase 0 of this plan | Must land + tie-breaker before Phase 1 code |

Phase 1 code MUST NOT start until T-D04 resolves cross-memo conflicts.

---

## 3. Architecture Notes

### 3.1 Learning loop (P1)

New on-disk surface at `<home>/.claude/housekeeper/learning/`:
`refusals.jsonl` (one line per refusal), `applied.jsonl` (one per
verified or `applied+partialApply` manifest), `rollbacks.jsonl` (one
per terminal rollback), `state.json` (counters + last-N false-positive
markers).

**Write path:** compose-time refusals append; execute-time success
appends; rollback execute appends; `housekeeper learn
--mark-false-positive <op_id>` rewrites `state.json`.

**Read path:** `housekeeper learn` (no args) prints a one-screen summary
— top 5 refusal classes by 30-day count, top 5 cleaned detectors, last
10 rollbacks, false-positive count. `--json` for piping. `diagnose`
decorates matching findings with `falsePositiveSeenBefore: N`
(informational — no ranking change; suggestion engine = v0.5).

**Invariants:** JSONL append-only; truncation only via `learn --prune
--older-than=<days>` (default never); same redaction posture as
`diagnose --redact`; `state.json` carries `schemaVersion: "0.4"` (its
own line, per Q1).

### 3.2 MCP repair beyond stripping (P2)

v0.3 strips broken `settings.mcp_command_missing` entries. v0.4 adds
rewrite via `--mcp-command-rewrite=<old>=<new>` on `harden`. If new
path exists and is `+x`, the patch rewrites; single `settings-rewrite`
op; idempotency still checked. New refusal classes:
`mcp-rewrite-target-missing`, `mcp-rewrite-target-not-executable`,
`mcp-rewrite-source-not-found`.

### 3.3 Plugin pruning automation (P3)

`housekeeper prune` is **audit-only in v0.4.0** to validate the
grace-window heuristic before risking destruction. v0.4.1 adds
mutation.

**Audit:** walk installed plugins; read `installed-at`; query
`learning/applied.jsonl` for recent activity touching the plugin;
best-effort shell-history scan for slash-command invocations; emit
`plugin.unused_past_grace` at `inform` for plugins past grace with
zero activity.

**Mutation (v0.4.1, NOT THIS RELEASE):** new kind `plugin-uninstall`;
snapshot cache; subprocess `claude plugin uninstall <name> --scope
<scope>`; verify cache gone.

### 3.4 Harden non-settings surfaces (P4)

| Surface | Target id | Action |
|---|---|---|
| Registry | `registry.command_dangling` | Remove entries whose plugin is uninstalled |
| Project hooks | `hooks.config_dangling` | Patch entries with missing `cwd`/`command` |
| Skill index | `skills.entry_dangling` | Remove entries whose skill file is missing |

Reuses `settings-rewrite` if the JSON-merge contract is identical;
otherwise introduces `json-rewrite` and aliases `settings-rewrite` to
it (Q2). Each target gets a fixture + acceptance card before code,
mirroring v0.3 T-300..T-302.

### 3.5 JSONC v2 (P5)

v0.3 Q2 ruled REFUSE. v0.4 revisits two candidates: `jsonc-parser`
(Microsoft, MIT — strips on serialise, `modify` API preserves AST) and
`comment-json` (MIT — preserves via custom `stringify`, trailing-comma
edge cases). Architect memo (T-D01) benchmarks round-trip fidelity
against 5 JSONC fixtures. `settings-jsonc-detected` becomes
`settings-jsonc-rewrite-failed`; plain JSONC is now hardenable.

### 3.6 Batch beyond N=50 (P6)

v0.3 capped `--batch=N` at 50. v0.4 adds opt-in `--stream` for N>50:
plan composition becomes a generator; snapshots taken in 50-item chunks;
each chunk gets a sub-manifest under one parent `streamId`; per-chunk
verify; on per-chunk failure stream halts and parent records
`streamPartial: true`; rollback rolls back completed sub-manifests in
reverse. New refusal classes: `stream-chunk-budget-exceeded`,
`stream-resume-not-supported` (resume deferred to v0.5).

---

## 4. Open Design Questions

**Q1: Learning loop schema versioning.** Own schema `"0.4"` (a) /
reuse manifest `"0.2"` (b) / no field, freeze shape (c)? Needed before
T-101.

**Q2: MCP rewrite scope — `settings-rewrite` vs `json-rewrite`.** Keep
`settings-rewrite` and add three more kinds (a) / generalize to one
`json-rewrite` and alias (b) / drop P4 to v0.5 (c)? Needed before T-400.

**Q3: Plugin pruning grace window default.** 30 days matching plugin
cache GC (a) / 7 days matching `plugin.cache_unreferenced` (b) / 90
days conservative (c) / require explicit config, refuse if unset (d)?
Needed before T-300.

**Q4: JSONC parser choice (round 2).** `jsonc-parser` (a) /
`comment-json` (b) / hand-rolled lex-aware patcher (c) / stay refused,
revisit v0.5 (d)? Needed before T-500.

**Q5: Batch stream chunking model.** Fixed 50 (a) / adaptive size
shrinks under 10-MiB budget pressure (b) / time-bounded chunks (c)?
Needed before T-600.

---

## 5. Decision Log

_Placeholder — record decisions here as T-D04 resolves Q1–Q5. Format
mirrors v0.3 PLAN §5: date, Q#, decision, rationale, decided by._

| Date | Q# | Decision | Rationale | Decided by |
|---|---|---|---|---|
| _pending_ | Q1–Q5 | _pending T-D04 synthesis_ | one row per Q on resolution | tie-breaker |

---

## 6. Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| Learning append adds visible per-command cost | Low | O(1) JSONL append; bench in T-107; same pattern as N6 lock.history |
| Learning files grow unbounded | Medium | `learn --prune --older-than=<days>` ships in v0.4.0; doc rotation policy |
| MCP rewrite accepts hostile user-supplied path (PATH-shadowing) | Medium | pre-snapshot existence + `+x` checks; threat-model addendum T-701b |
| Plugin pruning false-positives uninstall wanted plugins | High in v0.4.1 only | v0.4.0 audit-only is the mitigation; gather data via learning before v0.4.1 |
| JSONC round-trip silently mangles comments | Medium | T-501 fidelity test; refuse with `settings-jsonc-rewrite-failed` on divergence |
| Stream chunks crash mid-stream, inconsistent state | Medium | Per-chunk rollback in reverse; `streamPartial: true` surfaces to interrupted-op detector |
| `json-rewrite` generalization (Q2 b) breaks v0.3 callers | Low | Alias preserves back-compat; integration test against v0.3 fixtures must pass byte-for-byte |
| `lock.history` racing with lock acquire deadlocks | Low | `O_APPEND` is atomic on POSIX; not under the lock itself |
| Pre-commit hook (N8) blocks non-git environments | Low | Hook skipped if `.git` absent |
| Schema `"0.4"` collides with future report/manifest bumps | Low | Three independent schema lines documented per v0.3 versioning-policy |

---

## 7. Phase summary

| Phase | Goal | Output |
|---|---|---|
| Phase 0 | Design memos (architect / product / platform / tie-breaker) + N8 pre-commit | 4 docs in `docs/design/` + dev hook |
| Phase 1 | Learning loop schema + writer + read path + lock.history (N6) | `scripts/lib/learning.mjs`, `scripts/lib/lock-history.mjs`, tests |
| Phase 2 | MCP repair beyond stripping (P2) | `composeHardenPlan` extension + `--mcp-command-rewrite=` + tests |
| Phase 3 | Plugin pruning audit (P3, v0.4.0) | `plugin.unused_past_grace` detector + `prune` audit + fixtures |
| Phase 4 | Harden non-settings surfaces (P4) | 3 new target ids + `json-rewrite` (or 3 kinds, per Q2) + tests |
| Phase 5 | JSONC v2 (P5) | parser adoption + round-trip test + `settings-jsonc-rewrite-failed` |
| Phase 6 | Batch stream (P6) + marketplace prep (N5) + release | `--stream` + plugin.json polish + CHANGELOG / migration |

---

## 8. The success state

v0.4.0 ships when a user can:

1. Run `housekeeper learn` and see a one-screen 30-day summary.
2. Run `harden --target=settings.mcp_command_missing
   --mcp-command-rewrite=/old=/new` and have the MCP entry rewritten
   (not stripped) with snapshot + verify + reload hint.
3. Run `housekeeper prune` and see plugins unused past the grace
   window — audit only, no mutation.
4. Run `harden --target=registry.command_dangling` (and `hooks.*`,
   `skills.*`) with the same snapshot + verify behavior as v0.3.
5. Run `harden` against a settings file with `//` comments and have
   the comments preserved through round-trip.
6. Run `clean --batch=100 --stream --confirm --yes` and have 100
   findings processed in 50-item chunks with per-chunk snapshots.
7. Inspect `<home>/.claude/housekeeper/lock.history` and see an
   append-only audit of every lock acquire/release.

Everything else (auto-rollback, multi-home, interactive consent,
suggestion engine, `prune --uninstall`) waits for v0.5 or v1.0.
