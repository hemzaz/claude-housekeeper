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
target.

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

