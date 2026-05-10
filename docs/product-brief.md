# Product Brief

## One-Liner

Claude Housekeeper is a Claude Code home inspector: it restores trust by making
the Claude home legible before it changes anything.

## Target User

The first users are heavy Claude Code operators who install plugins, maintain local commands and skills, run session hooks, and have enough accumulated state that failures become hard to attribute.

They do not need another cleanup script. They need a trustworthy diagnosis layer that explains the mess before touching it.

## Product Principles

1. No direct path from observation to action.
2. Surface first, finding second, action last.
3. Every finding carries evidence and a stance.
4. Protected means protected.
5. Claude checkpointing is not Housekeeper rollback.
6. No mutation until Housekeeper-owned rollback proof exists.

## Core Workflow

```bash
claude-housekeeper diagnose
claude-housekeeper plan --scope=registry
claude-housekeeper verify
```

Future mutation workflow, after rollback proof exists:

```bash
claude-housekeeper clean --scope=plugins --confirm
claude-housekeeper rollback 2026-05-09-plugin-cleanup
```

## MVP Boundary

The MVP is a read-only diagnostic preview for the first wedge:

> Safe out-of-band diagnosis of broken hooks and plugin cache drift.

It should be excellent at:

- saying "No files changed"
- classifying surfaces before findings
- distinguishing expected orphan from candidate stale cache
- showing direct missing hook paths without executing hooks
- explaining missing keys
- producing a stance summary
- refusing mutation until snapshot and rollback are implemented

Do not build automatic repairs, dashboards, telemetry, or background daemons before the trust model is proven.

## Stance Categories

- `inform`: orient without action pressure.
- `watch`: keep visible until freshness, retention, or field data changes.
- `review`: user intent or ownership decides the next step.
- `probe`: a live Claude key is needed before a stronger claim.
- `protect`: a do-not-touch or sector-boundary rule blocks action.
- `prepare`: draft a reversible plan, but do not mutate.
- `repair`: propose a targeted fix with backup and verification requirements.
- `block`: stop because the protocol is missing authority, scope, safety, or rollback proof.

Applied cleanup must be transaction-shaped: diagnose, plan, revalidate preconditions, snapshot, mutate, verify, record rollback metadata.

## Trust Language

Use precise language:

- "No changes have been made."
- "This finding is blocked until Housekeeper rollback proof exists."
- "Diverged local files require review."
- "Verification failed at probe N; later probes were skipped."

Avoid vague language:

- "Optimized"
- "Fixed everything"
- "Cleaned safely" without rollback proof
- "Healthy" unless `verify` passed

## Learning Philosophy

Housekeeper should improve from local, inspectable records:

- false positives become allowances
- sensitive areas become do-not-touch rules
- successful cleanups become operation history
- failed cleanups and rollbacks lower future confidence
- repeated outcomes become suggestions, not silent behavior changes

Learning should reduce repeated noise, not increase autonomy. Every classification change should be traceable to a config rule, operation record, or user-approved lesson.

## Differentiation

Generic disk cleaners see files. Claude Housekeeper understands Claude-specific relationships:

- installed plugin registry versus plugin cache
- plugin-provided commands and local shadows
- settings hooks that reference cache paths
- mode state files that keep hooks firing
- registry paths where moving files can accidentally create new namespaces

## Public Positioning

"A safe home inspector for serious Claude Code installations."

The site and README should lead with stance-first diagnosis, not broad cleanup
claims. The report proves the product immediately.

## Framework Docs

Start with:

- `docs/doc-map.md`
- `docs/north-star.md`
- `docs/mvp-cutline.md`
- `docs/build-readiness.md`
- `docs/implementation-blueprint.md`
- `docs/framework-kernel.md`
- `docs/field-validation.md`
