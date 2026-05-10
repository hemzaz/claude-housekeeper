---
name: Damaged environment report
about: Report suspected unexpected changes or damage after running Housekeeper
title: "Damaged environment: "
labels: damaged-environment
---

## Command run

Paste the exact command.

```text

```

## Invocation surface

Standalone CLI, plugin slash command, Claude-generated shell, or other.

## What changed unexpectedly?

Describe the observed change. Do not paste secrets or private tokens.

## Did Housekeeper print filesChanged: true?

In v0.1 this should be `false`.

## Operation id

Always `none` in v0.1 unless Housekeeper printed an operation id.

## Rollback attempted?

What did you try, if anything?

## Rollback output

```text

```

## Paths involved, redacted

Use `~/.claude/...` or `<project>/...`.

## Concurrent Claude sessions or shell commands running?

List anything relevant.

## Housekeeper version

## Claude Code version

## Operating system and shell

## Node version

## Redacted report JSON

Run with `--json --redact` if possible. Do not paste secrets, tokens, or
unredacted customer names.

```json

```

## Redacted operation manifest

Only include this if Housekeeper printed an operation id.

```json

```
