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

