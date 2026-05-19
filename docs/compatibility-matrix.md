# Compatibility Matrix

Housekeeper must publish what it has actually been tested against.

Compatibility is a product surface because Claude Code loader semantics and file
layout can change.

## States

- `supported`: tested and expected to work
- `degraded`: tested but missing keys or platform limits weaken conclusions
- `unknown`: not tested
- `unsupported`: known unsafe or unreliable

## First Matrix

The rows below record what `v0.2.0` is actually tested against on the CI
matrix in `.github/workflows/ci.yml` plus the maintainer's development
target. The v0.3.0 row below carries the same matrix forward and adds
the surfaces v0.3 introduces.

| Dimension | Tested entry | State | Notes |
| --- | --- | --- | --- |
| Claude Code version | N/A | not a dependency | Housekeeper runs out-of-band; the CLI is independent of Claude Code (see [mode-doctrine.md](./mode-doctrine.md)) and is designed to run even when Claude itself may be broken |
| macOS | `macos-latest` GitHub runner | supported | tested on every PR and main push |
| macOS (maintainer) | darwin 25.x (macOS 26 series) | supported | maintainer's development target |
| Linux | `ubuntu-latest` GitHub runner | supported | tested on every PR and main push |
| WSL | WSL2 | unknown until tested | path and shell behavior may differ; no CI coverage |
| Windows native | PowerShell and cmd | unknown until tested | path separators and file locks matter; no CI coverage |
| Shell | zsh, bash | degraded until fixtures cover quoting | shell parsing is conservative |
| Node | 20 LTS, 22 LTS | supported | both versions on the CI matrix (Ubuntu and macOS) |
| Plugin wrapper | `/claude-housekeeper:housekeep` slash command | degraded | requires Claude Code plugin loader to be functional; CI runs `claude plugin validate` only when `claude` is on PATH (currently never on GitHub-hosted runners — tracked under §6 of `notes/RELEASE-READINESS-v0.2.0.md`) |
| Standalone CLI | local Node bin / `node scripts/claude-housekeeper.mjs` | supported | recovery surface; works without Claude Code installed |
| MCP config | structural parse only | degraded | startup requires consent |
| Hooks | structural parse only | degraded | execution requires consent |

## v0.3.0 surface

`v0.3.0` carries the v0.2.0 matrix forward unchanged. The rows below
record the v0.3-specific surfaces. Atomic-rename guarantees and the
new `settings-network-filesystem` refusal class are documented in
[`docs/threat-model.md`](./threat-model.md) §8.

| Dimension | Tested entry | State | Notes |
| --- | --- | --- | --- |
| `harden --confirm --yes` | `settings.hook_path_dangling`, `settings.mcp_command_missing` fixtures + CLI tests | supported | rewrites `settings.json` through the `settings-rewrite` mutation kind under the snapshot contract |
| `harden` on `settings.invalid_json` | fixture + refusal test | supported | refuses with `settings-shape-unknown` per Q1 ruling — no JSON repair |
| `clean --batch=<n>` | `test/clean-batch.test.mjs` (17 tests) | supported | aggregates `file-unlink` operations; default cap 10, max 50; manifest-atomic per Q3 |
| `clean --batch` over `settings-rewrite` | refusal test | supported | refuses with `settings-rewrite-not-batchable` per C6 ruling |
| Two-phase JSONC detection | `test/audit.test.mjs` + `fixtures/synthetic-homes/jsonc-settings/` | supported | strict `JSON.parse`, then lex-aware comment scan; emits `settings.jsonc_detected` (disjoint from `settings.invalid_json`) |
| JSONC-bearing settings under `harden` | refusal test | supported | refuses with `settings-jsonc-detected`; deferred to v0.4 per Q2 ruling |
| Atomic rename — APFS (macOS) | `macos-latest` CI matrix | supported | POSIX `rename(2)` atomic on same-volume; see threat-model §8 |
| Atomic rename — ext4 (Linux) | `ubuntu-latest` CI matrix | supported | POSIX `rename(2)` atomic on same-volume; see threat-model §8 |
| Atomic rename — NFS/SMB | n/a — refused | unsupported | `settings-network-filesystem` refusal class per C10 — no POSIX atomic-rename guarantee |
| CI `version-pin` job | `.github/workflows/ci.yml` | supported | asserts `docs/index.html` contains `v$(jq -r .version package.json)`; closes G4 release-readiness gap |
| Q1–Q5 outcomes | recorded | n/a | Q1 refuse (`settings-shape-unknown`); Q2 refuse v0.3 (`settings-jsonc-detected`); Q3 manifest-atomic no auto-rollback; Q4 per-detector `hardenable` flag; Q5 CI check |

## v0.4.0 surface

`v0.4.0` (and the `0.4.0-beta.1` prerelease it promotes) carries the
v0.3.0 matrix forward unchanged. The rows below record the v0.4-specific
surfaces. The `jsonc-parser` runtime dependency is the one addition to
the dependency graph — all other modules remain pure Node.js built-ins.

Q1–Q5 rulings from the v0.4 design memo (`docs/design/v0.4-design.md`)
are recorded in the notes column below.

| Dimension | Tested entry | State | Notes |
| --- | --- | --- | --- |
| `housekeeper learn` subcommand | `test/learning.test.mjs` (12+ tests), `test/cli-learn.test.mjs` | supported | Q1: schema version field on every JSONL write; `--json` / `--prune --older-than=` / `--mark-false-positive` all tested |
| `housekeeper prune` subcommand | `test/plugin-prune.test.mjs` (8+ tests) | supported | audit-only in v0.4.0; uninstall mutation deferred to v0.4.1; `prune-history-unavailable` refusal class tested |
| `plugin.unused_past_grace` detector | `test/plugin-prune.test.mjs` + fixture `plugin-not-referenced-past-grace/` | supported | grace-window boundary + false-positive interaction + history-unavailable path all covered |
| `harden --mcp-command-rewrite=<old>=<new>` | `test/mcp-rewrite.test.mjs` (10+ tests) | supported | happy path, all three refusal classes (`mcp-rewrite-target-missing`, `mcp-rewrite-target-not-executable`, `mcp-rewrite-source-not-found`), idempotency, snapshot/rollback round-trip |
| `clean --batch=N --stream` | `test/clean-batch-stream.test.mjs` (12+ tests) | supported | Q5: chunk boundary, per-chunk failure halt, rollback-of-stream; `stream-chunk-budget-exceeded` and `stream-resume-not-supported` refusal classes; `--stream` rejected without `--batch=N > 50` |
| `json-rewrite` mutation kind | `test/jsonc-rewrite.test.mjs` (10+ tests) | supported | Q2: comment-preserving round-trip via `jsonc-parser`; identity patch yields byte-equal output on 5 JSONC fixtures; divergence-refusal class fires on parser mismatch |
| `settings-rewrite` as back-compat alias | all v0.3 `settings-rewrite` tests | supported | v0.3 tests pass byte-for-byte; alias routes through the same `json-rewrite` implementation |
| `registry.command_dangling` detector + harden | `test/harden-nonsettings.test.mjs` | supported | Q2: patch removes dangling entry, preserves others byte-for-byte; happy / refusal / rollback all covered |
| `hooks.config_dangling` detector + harden | `test/harden-nonsettings.test.mjs` | supported | same test suite; three surface types × happy / refusal / rollback |
| `registry.skills_entry_dangling` detector + harden | `test/harden-nonsettings.test.mjs` | supported | same test suite |
| `lock.history` JSONL | `test/lock.test.mjs` | supported | N6: acquire+release round-trips produce correct line count and order |
| `falsePositiveSeenBefore` field on `Finding` | `test/learning.test.mjs` | supported | field present on matching finding only; omitted when count is zero |
| `jsonc-parser` runtime dependency | `package.json` `dependencies`, `npm install` | supported | pinned at `^3.3.1`; MIT, zero transitive deps; ratified per architect §6.5 and platform §4.4 |
| Pre-commit forbidden-language hook | `.husky/pre-commit` + `test/forbidden-language.test.mjs` | supported | T-D05: commit with forbidden term fails hook with same message CI emits |
| Q1 ruling | learning schema version field | recorded | every JSONL write carries `schemaVersion` field |
| Q2 ruling | `json-rewrite` canonical kind; `settings-rewrite` alias | recorded | comment-preserving rewrite via `jsonc-parser`; refusal class `settings-jsonc-rewrite-failed` on divergence |
| Q3 ruling | manifest-atomic batch semantics (carried from v0.3) | recorded | unchanged from v0.3; stream adds per-chunk manifest-atomic semantics |
| Q4 ruling | `hardenable` flag on `DetectorOutput` (carried from v0.3) | recorded | three Phase-4 detectors declare `hardenable: true` |
| Q5 ruling | `--stream` chunk model | recorded | chunks applied sequentially; per-chunk rollback in reverse on failure; no cross-chunk resume |

## What Housekeeper does NOT depend on

Housekeeper is explicitly designed to run when the Claude Code surface is
broken. The CLI carries no runtime dependency on:

- **The `claude` CLI being installed or on PATH.** Safe mode and diagnose
  run structurally over the home directory without invoking Claude. See
  [mode-doctrine.md §1](./mode-doctrine.md) for the safe-mode contract.
- **Any specific Anthropic API version.** Housekeeper does not call
  Anthropic APIs.
- **Any specific MCP server being reachable.** MCP config is parsed
  structurally; servers are not started.
- **Any specific plugin marketplace being reachable.** Plugin registry
  files are read from disk; no network calls.
- **Any specific Claude Code version.** Loader semantics are inspected
  structurally; if a settings schema changes, unknown keys degrade to
  weakened evidence per [Feature Detection Rules](#feature-detection-rules)
  below — they do not crash the scan.

The plugin slash command path (`/claude-housekeeper:housekeep`) is the
single surface that requires the Claude Code plugin loader to be
functional. The standalone CLI surface remains usable when that loader is
broken — that is the entire point of mode doctrine.

## How to update at release time

Before tagging a release, confirm the CI matrix and maintainer environment
rows still match reality:

- `node --version` — confirm both Node 20 and Node 22 still pass CI; if
  CI moves off Node 20, demote that entry.
- `uname -a` — record the exact macOS kernel and architecture used for
  the maintainer's row.
- `.github/workflows/ci.yml` matrix — confirm `ubuntu-latest` and
  `macos-latest` are still on the matrix; if either is removed, demote
  the corresponding OS row.
- Linux, WSL, and Windows native rows remain `unknown until tested`
  until a real fixture run on each platform has been completed and
  recorded; do not relabel them based on inference. The `ubuntu-latest`
  CI row is supported but does NOT generalize to arbitrary Linux distros
  without per-distro fixtures.

## Feature Detection Rules

Prefer feature detection over version guessing:

- if `claude` is missing, safe mode still runs structural scan
- if plugin registry is missing, cache conclusions requiring registry evidence
  are blocked or weakened
- if `/hooks` is unavailable, hook loader keys are missing
- if `/mcp` is unavailable, MCP loader keys are missing
- if settings schema changes, unknown keys become degraded evidence, not crash
- if platform path parsing is uncertain, stance becomes `probe` or `review`

## Compatibility Report Fields

Every shareable report should include:

- Housekeeper version
- Claude Code version, if available
- OS
- shell, if relevant
- Node version
- invocation surface
- scan mode
- degraded compatibility notes

## Release Gate

The first public release may be narrow, but it must be honest:

- publish the tested matrix
- label unknown platforms as unknown
- avoid implying Windows support before Windows fixtures or tests exist
- avoid implying live Claude loader support before probes are implemented

