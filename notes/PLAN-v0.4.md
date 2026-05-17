# Plan — Claude Housekeeper v0.4

Date: 2026-05-17. Companion to `notes/TASKBOARD-v0.4.md`.

Predecessor: `notes/PLAN-v0.3.md`. v0.3.0 tagged 2026-05-17 (`CHANGELOG.md
[0.3.0]`) shipped `harden --confirm --yes`, `clean --batch`, `settings-rewrite`,
two-phase JSONC detection, and `hardenable` self-declaration on
`DetectorOutput`. v0.4 picks up the six v0.4-deferred pillars from
`docs/design/v0.3-design.md §1` plus three pending N-items from
`notes/RELEASE-READINESS-v0.2.0.md §3`.

---

## 1. v0.4 Scope

**Six pillars**, all v0.3-deferred per `docs/design/v0.3-design.md §1` and
`PLAN-v0.3.md §1`. Independently shippable; P1 and P5 carry the most design
risk.

| Pillar | Command surface | Core capability |
|---|---|---|
| P1. Learning loop | `housekeeper learn` (new); `diagnose`/`clean`/`harden` write trace records | Persist false-positives, accepted plans, and rollback outcomes under `<home>/.claude/housekeeper/learning/`; surface as scoring signal in `composeCleanPlan` / `composeHardenPlan` |
| P2. MCP repair beyond stripping | `harden --target=settings.mcp_command_missing --strategy=rewrite` | `mcpServers.<name>` install-command rewrite (not just removal) for known-shape entries — e.g. swap a missing absolute path for a discovered `which`-found binary |
| P3. Plugin pruning automation | `clean --target=plugin.cache_unreferenced --grace=<days>`; new `plugin.disused` detector | Uninstall plugins that have not been referenced by hooks, settings, or commands for ≥ grace window (default 30 days) |
| P4. Harden for non-settings surfaces | `harden --target=registry.*` and `harden --target=hooks.*` | Extend `composeHardenPlan` to act on `<home>/.claude/registry/` entries and on hook config blocks beyond `settings.json` (rewrite, not only remove) |
| P5. JSONC v2 support | (transparent: parsers in `audit.mjs`, `harden-plan.mjs`) | Revisit Q2 ruling from v0.3. Comment-preserving rewrite via `jsonc-parser` (or equivalent) so `settings.jsonc_detected` → hardenable, not blocked |
| P6. Batch beyond N=50 | `clean --batch=stream --confirm --yes` | Stream-based mutation for larger homes; per-op snapshot under one parent manifest, bounded RAM, no 50-cap |

**v0.4 does NOT include** (deferred to v0.5+ or unscheduled):

| Feature | Deferred to |
|---|---|
| Multi-home / fleet support; telemetry beyond local learning loop | v0.5+ |
| Interactive consent (TTY prompts), `clean --interactive` | v1.0 |
| Operation manifest HMAC / signature (G13); schema `0.3` | v0.5+ |
| `housekeeper repair --network-filesystem`; refusal-taxonomy DSL | unscheduled / v0.5+ |
| Cross-kind `clean --batch` including `settings-rewrite` (per C6) | v0.5+ |

---

## 2. Dependencies

| Dependency | Status | Used by |
|---|---|---|
| v0.3.0 tag on `main` | Shipped 2026-05-17 | All v0.4 branches from here |
| `MUTATION_REGISTRY` extension point | Shipped v0.2/v0.3 | P2/P3/P4/P5/P6 |
| `harden` pipeline (compose / validate / execute) | Shipped v0.3 | P2, P4 (sibling `composeRegistryHardenPlan`) |
| `hardenable` flag on `DetectorOutput` | Shipped v0.3 | P3 (`plugin.disused`), P5 (jsonc flip) |
| Refusal classifier with `allowedExecutionClasses` | Shipped v0.3 (T-099) | P4 (registry surfaces) |
| Two-phase JSONC detection | Shipped v0.3 | P5 (comment-preserving rewrite) |
| `atomicWrite` helper (`snapshot.mjs`) | Shipped v0.2 | All pillars |
| Design memos (architect / product / platform / tie-breaker) | Phase 0 | Phase 1+ blocked on T-D04 |

Phase 1 code work MUST NOT start until the four design memos land and the
tie-breaker resolves cross-memo conflicts (same protocol as T-D04 in v0.3).

---

## 3. Architecture Notes

### 3.1 Learning loop schema (P1)

Persistent under `<home>/.claude/housekeeper/learning/`: `events.jsonl`
(append-only), `index.json` (rebuildable summary), `schema.json` (pinned
event shape). Read-only from `clean`/`harden` mutation paths.

Event shape (one JSON object per `events.jsonl` line):

| Field | Type | Notes |
|---|---|---|
| `schemaVersion` | string | `"0.1"` for v0.4 (independent of manifest schema) |
| `eventId` | string | `learn_YYYYMMDDhhmmss_<hex8>` |
| `ts` | string | ISO 8601 UTC |
| `kind` | enum | `false_positive` \| `accepted_plan` \| `rollback_outcome` \| `refusal_observed` |
| `detectorId` | string | e.g. `plugin.cache_unreferenced` |
| `outcome` | enum | `success` \| `failure` \| `aborted` |
| `signals` | object | Detector-specific evidence — bounded ≤ 4 KiB |
| `userMark` | enum | `useful` \| `noise` \| `unset` — set only via `learn mark` |

`events.jsonl` bounded at **10 MiB** by ring rotation; oldest events moved
to `events.jsonl.<unix-ts>`, latest archive GC'd after 90 days. No external
storage.

### 3.2 `housekeeper learn` subcommand (P1)

Read-only: `learn` (summary), `learn show --detector=<id>`,
`learn export --json [--redact]`, `learn purge --older-than=90d` (advisory).
Append-only write: `learn mark <eventId> [--useful|--noise]` (no `--confirm`
— appends a metadata line, not a mutation).

### 3.3 MCP repair beyond stripping (P2)

v0.3 `settings.mcp_command_missing` → harden removes. v0.4 adds
`--strategy=rewrite` (opt-in; default remains `remove`): reads broken
entry's `command`, runs `which` on basename, and IF exactly one match
within allow-listed prefixes (`/usr/local/bin`, `/opt/homebrew/bin`,
`~/.local/bin`, `~/.npm-global/bin`) rewrites the `command` field via
`settings-rewrite`. Otherwise refuses (`mcp-rewrite-ambiguous` for ≥2
matches, `mcp-rewrite-out-of-allowlist` for single outside, `mcp-rewrite-no-match`
for zero). Opt-in design prevents silent re-pointing.

### 3.4 Plugin pruning automation (P3)

New detector `plugin.disused`: plugin not touched in ≥ N days (default 30)
AND not referenced by any active hook/command/settings entry. Disjoint from
`plugin.cache_unreferenced` (which targets cache versions, 7-day grace).
Mutation kind **`plugin-uninstall`** wraps `claude plugin uninstall <name>@<mp>
--scope <scope>` (R8 from global CLAUDE.md lifecycle rules); captures
stdout/stderr into the manifest; snapshots the cache tree as defense-in-depth
before invoking. Rollback re-installs via `claude plugin install <spec>
--scope <scope>`. Grace window per-invocation via `--grace=<days>`.

### 3.5 Harden for non-settings surfaces (P4)

v0.3 `harden` acts only on `settings.json`. v0.4 extends to
`<home>/.claude/registry/*.json` (rewrite the registry pointer instead of
deleting the file — `registry.local_command_identical` currently
clean-only) and hook config blocks (when the fix is "rewrite the path"
via `--strategy=rewrite-path=<new>`, not just "remove the entry"). Reuses
`settings-rewrite` for JSON surfaces, no new mutation kind required.
New refusal classes: `registry-shape-unknown`, `registry-not-rewriteable-in-v0.4`.

### 3.6 JSONC v2 support (P5)

Q2 from v0.3 was REFUSE. v0.4 revisits with a comment-preserving path.
Two candidates evaluated by platform memo: `jsonc-parser` (editor-grade,
manual edit API) and `comment-json` (round-trip API, license review).
Tie-breaker picks one. Surface change: `settings.jsonc_detected` flips
from `inform` → `hardenable: true`; new mutation kind
`settings-jsonc-rewrite` parallels `settings-rewrite` but parse/serialize
via the JSONC layer; new refusal class `jsonc-comment-orphaned` if a
patch would detach a comment from its anchor key.

### 3.7 Batch beyond N=50 (P6)

v0.3 `clean --batch` caps aggregate at 50 ops under one snapshot. v0.4
adds **stream mode** (`--batch=stream`): no aggregate cap, each op gets
its own snapshot subtree under one parent manifest (`<op_id>/sub/<seq>/`),
RAM-bounded because only one op's pre/post shas are held at a time.
Manifest stays at `"0.2"` — adds `subOperations[]`; parent `status`
follows Q3 rule (verified iff all sub-ops verified; else `applied +
partialApply: true`). `settings-rewrite`, `settings-jsonc-rewrite`, and
`plugin-uninstall` remain non-batchable (per C6).

---

## 4. Open Design Questions

These could not be resolved from existing docs and are parked for the team
to decide before Phase 1 implementation begins.

**Q1: Learning loop persistence format** — (a) JSON Lines append-only
(default, §3.1); (b) SQLite via `better-sqlite3` (binary dep, richer
queries); (c) plain JSON array (doesn't scale). Decision before T-D04.

**Q2: MCP rewrite scope** — (a) rewrite only when exactly one match in
allow-listed prefixes (§3.3 default); (b) refusal class granularity —
one class or three (`mcp-rewrite-ambiguous`, `-out-of-allowlist`,
`-no-match`); (c) user-supplied `--mcp-rewrite-allowlist=<path>`
(security review). Decision before T-200.

**Q3: Plugin pruning grace window default** — (a) 30 days (default, §3.4);
(b) 7 days (matches cache grace; too eager); (c) 90 days (conservative,
plugins accumulate). Default drives the README cleanable column.
Decision before T-300.

**Q4: JSONC parser choice (revisits v0.3 Q2)** — (a) `jsonc-parser`,
editor-grade, manual edit API; (b) `comment-json`, round-trip API,
edge cases; (c) hand-rolled tokenizer reusing v0.3's detection scanner.
Decision before T-500.

**Q5: Stream batch ordering guarantees** — (a) strict insertion order;
(b) parallel sub-ops (race surface explodes); (c) strict order in v0.4,
revisit parallelism post-v1.0. Decision before T-600.

---

## 5. Decision Log

_Placeholder — append rows as the team resolves Q1–Q5._

| Date | Q# | Decision | Rationale | Decided by |
|---|---|---|---|---|
| _pending_ | Q1–Q5 | _pending T-D04_ | _pending_ | _pending_ |

---

## 6. Risks

| Risk | Mitigation |
|---|---|
| Learning loop file grows unbounded | 10 MiB cap + ring rotation (§3.1); soak-end CI size assertion |
| MCP rewrite re-points server at malicious binary | Allow-list prefixes; `--strategy=rewrite` opt-in (default `remove`) |
| `plugin-uninstall` cannot snapshot dynamic plugin state | Snapshot cache tree only; rollback via `claude plugin install` (idempotent per global R-rules) |
| Registry rewrites race with concurrent `claude` writes | Same lockfile as `settings.json`; registry path in lock scope |
| JSONC v2 patch orphans a comment from its anchor | Refusal class `jsonc-comment-orphaned` + CI fixtures |
| Stream batch leaves orphan sub-snapshot trees on crash | Parent manifest atomic per sub-op; T-604 GC sweep in `housekeeper.interrupted_operation` |
| `plugin.disused` misclassifies an active plugin | 30-day default + `hardenable` flag + acceptance card + golden fixture |
| Concurrency lockfile observability (N6) missed again | Phase 7 explicitly lands `lock.history` (T-706) |

---

## 7. Carry-over N-items from v0.2 readiness

From `notes/RELEASE-READINESS-v0.2.0.md §3`, the still-pending N-items
not picked up by the parallel automation agent: **N5** marketplace
listing prep → T-705; **N6** lockfile observability (`lock.history`) →
T-706; **N8** pre-commit forbidden-language hook → T-707. All land in
Phase 7.

---

## 8. Phase summary

| Phase | Goal |
|---|---|
| 0 | Design memos (architect / product / platform / tie-breaker) |
| 1 | P1 — learning loop (`scripts/lib/learning.mjs` + `learn` subcommand) |
| 2 | P2 — MCP `--strategy=rewrite` |
| 3 | P3 — `plugin.disused` detector + `plugin-uninstall` mutation kind |
| 4 | P4 — registry/hook rewrite paths |
| 5 | P5 — JSONC v2 parser + `settings-jsonc-rewrite` kind |
| 6 | P6 — `--batch=stream` + sub-op snapshots |
| 7 | Release prep + N5/N6/N8 sweep |

---

## 9. The success state

v0.4.0 ships when a user can:

1. Read `housekeeper learn` summary after a week of `diagnose`/`clean`
   runs and see top noisy detectors with `userMark=noise` counts.
2. Run `harden --target=settings.mcp_command_missing --strategy=rewrite`
   and watch the entry's `command` re-point at an allow-listed binary
   under snapshot + rollback.
3. Run `clean --target=plugin.disused` and have `claude plugin uninstall`
   invoked with explicit `--scope`, cache snapshotted, rollback re-installs.
4. Run `harden --target=registry.local_command_identical` and have the
   registry pointer rewritten (not deleted) under `settings-rewrite`.
5. Run `harden --target=settings.jsonc_detected` and have the
   comment-preserving rewrite land; refusal if any comment would be orphaned.
6. Run `clean --batch=stream --confirm --yes` on > 50 findings under one
   parent manifest with per-op snapshots — no aggregate-budget refusal.
7. Trust nothing on disk changed without snapshot proof, that `learn`
   writes are append-only and bounded, and every refusal carries
   `nextStep` (v0.2 G7 contract held forward).

Signed manifests, multi-home, interactive consent, schema `0.3` wait for v0.5+.
