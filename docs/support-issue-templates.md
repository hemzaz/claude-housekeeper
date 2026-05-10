# Support Issue Templates

These are the public support templates Housekeeper should use before release.

They can later become GitHub issue forms.

## False Positive

```md
## Finding id

## Why this is intentional or wrong

## Expected stance

## Did a do-not-touch or allowance rule exist?

## Housekeeper version

## Claude Code version

## OS and shell

## Redacted report JSON
```

## Loader Behavior Report

```md
## Loader question

## Claude Code version

## OS and shell

## Fixture or minimal reproduction layout

## Command or probe used

## Observed behavior

## Expected behavior

## Redacted output
```

## Compatibility Report

```md
## Platform

## Install method

## Housekeeper command run

## Result

## Degraded or blocked message

## Claude Code version

## Node version

## Redacted report JSON
```

## Damaged Environment Report

```md
## Command run

## Invocation surface

## What changed unexpectedly?

## Did Housekeeper print filesChanged: true?

## Operation id, if any

## Rollback attempted?

## Rollback output

## Paths involved, redacted

## Concurrent Claude sessions or shell commands running?

## Housekeeper version

## Claude Code version / OS

## Redacted operation manifest
```

## Feature Request

```md
## Claude home problem

## Current Housekeeper output

## Desired finding or stance

## Evidence that would prove it

## Safety concerns
```

## Intake Rules

Maintainers must not ask for:

- raw secrets
- `.env` content
- private keys
- raw transcripts by default
- full shell history
- unredacted customer names

