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

The row below records the development environment used during the
v0.1 release prep cycle. Maintainer fills in the exact `claude
--version` value at tag time (see "How to update at release time").

| Dimension | First entry | State | Notes |
| --- | --- | --- | --- |
| Claude Code version | unknown until tag | unknown until tested | filled at release time from `claude --version`; do not promote to `supported` without recording the exact version |
| macOS | darwin 25.x (macOS 26 series) | supported | maintainer's development target |
| Linux | one common distro | unknown until tested | required before broad claim |
| WSL | WSL2 | unknown until tested | path and shell behavior may differ |
| Windows native | PowerShell and cmd | unknown until tested | path separators and file locks matter |
| Shell | zsh, bash | degraded until fixtures cover quoting | shell parsing is conservative |
| Node | 20 LTS, 22 LTS | supported | both versions on the CI matrix |
| Plugin wrapper | Claude plugin command | degraded | depends on Claude plugin loading |
| Standalone CLI | local Node bin / `node scripts/claude-housekeeper.mjs` | supported | recovery surface; Phase 0 + Phase 2 ship a working CLI |
| MCP config | structural parse only | degraded | startup requires consent |
| Hooks | structural parse only | degraded | execution requires consent |

## How to update at release time

Before tagging `v0.1.0`, the maintainer captures the exact environment
used to generate the release goldens and replaces the placeholder
entries above:

- `claude --version` — fill the Claude Code version row with the exact
  value (no `unknown until tag` left); promote the row to `supported`
  once the goldens are recaptured under that version.
- `node --version` — confirm both Node 20 and Node 22 still pass CI; if
  CI moves off Node 20, demote that entry.
- `uname -a` — record the exact macOS kernel and architecture used for
  the maintainer's row.
- Linux, WSL, and Windows native rows remain `unknown until tested`
  until a real fixture run on each platform has been completed and
  recorded; do not relabel them based on inference.

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

