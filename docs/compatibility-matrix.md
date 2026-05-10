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

| Dimension | Minimum first entry | State | Notes |
| --- | --- | --- | --- |
| Claude Code version | exact version used during release | supported or degraded | record `claude --version` |
| macOS | current maintainer OS | supported | first development target |
| Linux | one common distro | unknown until tested | required before broad claim |
| WSL | WSL2 | unknown until tested | path and shell behavior may differ |
| Windows native | PowerShell and cmd | unknown until tested | path separators and file locks matter |
| Shell | zsh, bash | degraded until fixtures cover quoting | shell parsing is conservative |
| Node | current LTS | supported after CI | package runtime |
| Plugin wrapper | Claude plugin command | degraded | depends on Claude plugin loading |
| Standalone CLI | local Node bin/package runner | supported after packaging | recovery surface |
| MCP config | structural parse only | degraded | startup requires consent |
| Hooks | structural parse only | degraded | execution requires consent |

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

