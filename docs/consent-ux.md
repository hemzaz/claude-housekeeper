# Consent UX

Consent is how Housekeeper receives bounded authority.

Consent must be specific enough that the user knows what will happen and
Housekeeper knows what is still forbidden.

## 1. Consent Shape

Every consent request should include:

- target
- action
- reason
- surface class
- risk
- rollback proof
- verification
- expiration
- exclusions

Template:

```text
CONSENT REQUIRED
target: ~/.claude/settings.json
action: patch one hook command
reason: direct missing plugin cache path
risk: repair
rollback: Housekeeper snapshot manifest
verification: parse settings, then /hooks if live probe approved
expires: this run
excluded: secrets, auth helpers, plugin cache deletion
```

## 2. Consent Types

### Inspect Consent

Allows scoped reading or metadata collection.

Does not allow mutation.

### Probe Consent

Allows a live probe that may invoke Claude, load plugins, start MCP servers, or
run hooks.

Must say what may execute.

### Plan Consent

Allows Housekeeper to draft an operation plan.

Does not allow mutation.

### Action Consent

Allows one exact operation.

Requires rollback and verification.

### Standing Consent

Allows a narrow recurring action.

Must be revocable, visible, and bounded by risk.

Cannot cross sector boundaries.

## 3. Partial Approval

Users should be able to approve only selected items.

A plan should be addressable:

```text
approve item 2
skip item 3
protect item 4
probe item 5
```

Partial approval does not authorize omitted items.

## 4. Expiration

Consent expires when:

- the run ends
- evidence expires
- target changes
- scope changes
- rollback precondition fails
- user revokes it
- Housekeeper version changes major behavior

Expired consent becomes report context, not authority.

## 5. Anti-Nag Rule

If a user refuses or protects a target, Housekeeper should not keep asking.

It may show:

```text
1 protected finding hidden from action. Use --show-protected to review.
```

## 6. Consent Cannot Cure Missing Proof

User approval cannot make an unrollbackable action reversible.

If rollback proof is missing:

```text
Consent cannot proceed because rollback proof is missing.
```

The correct stance is `block`, not "ask harder."

