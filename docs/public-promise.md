# Public Promise

This is the canonical public wording for README, npm, plugin listings, and the
first website.

## One Paragraph

Claude Housekeeper is a read-only Claude Code home inspector. It checks the
parts of a Claude setup that commonly drift over time, especially broken hook
paths and plugin cache confusion, then reports what it found, what evidence it
has, what key is missing, and what it refuses to touch. The preview does not
repair, delete, quarantine, harden, or rely on Claude checkpointing as rollback.

## Short Tagline

Read-only Claude Code home inspection for broken hooks, plugin cache drift, and
protected local state.

## What It Does Now

- parses settings structurally
- checks direct hook paths without running hooks
- maps plugin registry and cache versions
- applies do-not-touch protection rules
- reports stance, evidence, missing keys, and boundaries
- states that no files changed

## What It Refuses Now

- mutate files
- delete or quarantine cache
- run hooks
- start MCP servers
- execute plugin code
- call a cache version unused without freshness proof
- treat Claude checkpointing as rollback proof

## Promise Test

Every public claim must fit this sentence:

> Housekeeper helps you understand your Claude home before anything changes.

