# Threat Model — v0.2 (Single-User Local)

This doc records what the v0.2 snapshot, rollback, and operation-manifest
surfaces defend against, what they explicitly do **not** defend against,
and the trust boundaries we assume. It addresses release-readiness gap
**G13** (no signature/HMAC on operation manifests) by documenting the
decision as a scoped trade-off rather than leaving it unaddressed.

If you operate Housekeeper outside the assumptions named below
(multi-user homes, remote operation, fleet management), the analysis
here is **not** sufficient. Those are v0.3+ concerns.

---

## 1. Scope

### In scope

- The snapshot tree at `<home>/.claude/housekeeper/snapshots/`.
- Operation manifests at `<home>/.claude/housekeeper/operations/`.
- The concurrency lockfile at `<home>/.claude/housekeeper/lock`.
- The mutation pipelines (`composeCleanPlan → validate → execute`,
  same for rollback).
- Surface classification, the do-not-touch boundary, the
  twelve-rule refusal taxonomy.

### Out of scope

- **Multi-user homes.** v0.2 assumes one operator owns the home.
- **Remote operation.** Housekeeper runs locally as the home owner;
  there is no daemon, no socket, no network surface.
- **Fleet management.** Coordinating Housekeeper across N machines is
  not a v0.2 feature.
- **Supply-chain attacks on the `claude-housekeeper` package
  itself.** Standard npm / GitHub Releases provenance applies; that's
  not addressed here.
- **Threats from a fully compromised kernel or filesystem.** If the
  filesystem lies, Housekeeper can be fooled. Same for every other
  user-space tool.

---

## 2. Trust boundaries

The single most important assumption:

> **The user's own home is trusted. Housekeeper runs as the user.
> Anything writable by the user is in the same trust domain as
> Housekeeper itself.**

Concretely:

| Surface | Trust | Why |
|---|---|---|
| `<home>/.claude/**` | Trusted | Owned by the user; written by the user's other tools. |
| `<home>/.claude/housekeeper/operations/*.json` | Trusted (see §3) | Plain JSON, no HMAC. Written by Housekeeper, mutable by the user. |
| `<home>/.claude/housekeeper/snapshots/<op_id>/**` | Trusted | Created with the same uid/gid as the user. |
| `<home>/.claude/housekeeper/lock` | Trusted | `O_EXCL` create; 30-min staleness; user can delete via `clean --target=housekeeper.stale_lock`. |
| Files Housekeeper reads to classify (settings.json, plugin caches, registry) | Trusted-as-input | Parsed defensively; failure routes to read-only degradation. |
| The `claude-housekeeper` bin itself | Trusted (installation contract) | Standard package install; out-of-scope per §1. |

What's outside the boundary:

- Other UIDs on the same host. v0.2 has no defenses against a
  second user with write access to the home — but a second user
  with write access could already corrupt the home directly.
- Network attackers. Housekeeper does not open sockets, fetch
  remote manifests, or speak to any service. There is no network
  attack surface.

---

## 3. Threats considered

### T1. Concurrent invocations corrupting state

**Defense:** Lockfile at `<home>/.claude/housekeeper/lock` opened
with `O_EXCL`. Stale after 30 minutes so a crashed process never
permanently wedges the system. Re-entry from the same process is
not supported and not needed (one mutation per invocation).

**Residual risk:** Two invocations within the 30-minute stale window
where the holder crashed cleanly — second invocation refuses.
User explicitly cleans the stale lock via
`clean --target=housekeeper.stale_lock`.

### T2. Crash mid-mutation leaving the home in a half-applied state

**Defense:** Snapshot is taken before any deletion. Manifest status
walks `planned → snapshot_taken → applied → {verified, rolled_back,
aborted}`. Crash at any step is recoverable:

- Crash before `applied`: `rollback --abort <id>` removes the unused
  snapshot.
- Crash between `applied` and `verified`: `rollback <id>` restores
  from the snapshot.

Phase 9 surfaces interrupted manifests at SessionStart with explicit
recovery hints.

### T3. Mutation of a do-not-touch path

**Defense:** Path matching against `doNotTouch` rules runs inside the
twelve-rule refusal classifier ahead of any mutation. Refusal
emits `protected-path` with `targetPath` and `reason`. Tested with
fixture goldens.

### T4. Mutation exceeding the safety budget

**Defense:** Hard cap of 50 files / 10 MiB per operation. Not
configurable. Refusal emits `budget-exceeded` with the budget and
the would-be cost. Both `clean` and `rollback` honor this.

### T5. Stale or stuck snapshot trees consuming disk space

**Defense:** Snapshot garbage collection runs inside
`executeCleanPlan` and `executeRollbackPlan` only (locked decision
Q4: never during `diagnose`/`plan`/`verify`). Manifest status
gates which snapshots are GC-eligible (terminal: `verified`,
`rolled_back`, `aborted`).

**Residual risk:** A user who never runs `clean` again will retain
old snapshot trees forever. They are bounded by the
50-files / 10-MiB-per-op budget so total cost stays small, but the
home will not shrink on its own.

### T6. Tampered operation manifest with a forged `sha256Before`

**Status:** Acknowledged residual risk; out of scope for v0.2
defenses. See §4.

### T7. Race between snapshot and target mutation

**Defense:** The atomic write protocol (write-temp + rename +
fsync-parent) guarantees the snapshot is durable before the
mutation runs. Q-USER-2 (`composeCleanPlan` re-runs
`assembleReport` for freshness) ensures the target hasn't drifted
since the last report. If it has, refusal emits `drift-detected`.

**Residual risk:** A TOCTOU window between `composeCleanPlan`
re-running `assembleReport` and `executeCleanPlan` running the
mutation — bounded to milliseconds. A concurrent attacker who can
write to the target path within that window already has full home
access (see §2).

### T8. Symlink traversal escaping the home

**Defense:** Symlinks in target paths refuse with `symlink-refused`.
The classifier checks this before any deletion. Settings the
detector considers (paths under `~/.claude`) are resolved with
`realpath`.

---

## 4. Out of scope: operation-manifest integrity (G13)

### What G13 names

Operation manifests are plain JSON, written without HMAC or
digital signature. An attacker with write access to
`<home>/.claude/housekeeper/operations/` could:

- Forge a manifest with `status: "applied"` and an empty
  `filesChanged` array, then trick `rollback <id>` into a no-op
  while the actual home stays mutated.
- Tamper with `sha256Before` so a `verify` step passes against a
  separately corrupted file.
- Insert manifests for operations that never happened.

### Why this is not a v0.2 blocker

The defense would be an HMAC keyed on a user-resident secret. But:

> An attacker who can write to
> `<home>/.claude/housekeeper/operations/` **already has full write
> access to the home** (same uid, same trust domain). They can
> bypass Housekeeper entirely by editing files directly. The
> manifest forgery threat reduces to "an attacker who already owns
> your home wants to confuse you about which files they touched."
> That is a real concern, but it is the same concern as auditing
> any user-space tool on a compromised account, and the defense is
> filesystem auditing (auditd, fs_usage, OSQuery), not application
> HMAC.

The trust boundary in §2 is therefore consistent: the home owns
itself; Housekeeper is a tool the home owner runs.

### What would change for v0.3 multi-user support

If Housekeeper grows multi-user or fleet semantics, this trade-off
no longer holds. Concretely:

- **HMAC on manifests** keyed on a secret that is not writable by
  the same uid that wrote the manifest (e.g., a system keychain
  entry or a per-fleet KDF).
- **File ownership checks** on every operation's `targetPath`,
  refusing to act if the path is not owned by the same uid running
  Housekeeper.
- **Append-only manifest log** signed by a separate process so a
  compromised tool can't rewrite history.
- **Tamper-evident snapshot manifests** that record file mode and
  ownership in addition to sha256.

None of these are needed for v0.2's stated scope. All are tracked
under `docs/versioning-policy.md` (when added) as v0.3 candidates.

---

## 5. Defenses-in-depth that ARE present

Even within the single-user trust boundary, v0.2 layers protection
beyond what the threat model strictly requires:

- **Surface-first classification.** Before any action is considered,
  the surface kind is recorded (`claude-managed`, `user-owned`,
  `sector-boundary`, etc.). Action paths only fire on a subset.
- **Twelve-rule refusal taxonomy.** First-match-wins. Each refusal
  carries `class`, `reason`, `message`, `targetPath`, `exitCode`.
  Tested.
- **Per-operation budget.** 50 files / 10 MiB. Caps blast radius
  even from a forged manifest (if the attacker tried to plant a
  rollback that would touch thousands of files, the budget refuses).
- **`doNotTouch` as a hard boundary.** A protected path is never
  mutated regardless of detector or rollback request.
- **One mutation per invocation.** Limits the worst case from a
  bad call. To mutate more, the user runs `clean` again — each
  with its own refusal-classifier pass.
- **Atomic write protocol.** Half-written snapshots cannot be
  visible to the rollback flow; the rename step is the commit
  boundary.
- **Read-only degradation.** If any of Housekeeper's own state is
  unreadable, `diagnose` still runs and reports the degraded
  state instead of throwing.
- **No path from observation to action.** `--confirm --yes` is
  always required, in addition to a target detector and an
  explicit path.

---

## 6. Reporting a security issue

If you believe you have found a vulnerability that exceeds the
threat model recorded here — e.g., a way for a non-home-owner to
mutate the home through Housekeeper, or a defect in the snapshot
atomicity protocol — please open a GitHub issue using the
"damaged environment" template. Mark the title `SECURITY` and
include reproduction steps. The project does not yet have a
private disclosure channel; the issue tracker is public.

---

## 7. Related docs

- [`CHANGELOG.md`](../CHANGELOG.md) — when each defense landed.
- [`docs/migration-v0.1-to-v0.2.md`](migration-v0.1-to-v0.2.md) —
  what users see in their home after upgrading.
- [`docs/rollback-contracts.md`](rollback-contracts.md) — formal
  rollback contract and manifest schema (§7).
- [`docs/snapshot-architecture.md`](snapshot-architecture.md) —
  write-temp + rename + fsync-parent protocol.
- [`docs/team-governance-threat-model.md`](team-governance-threat-model.md) —
  governance-side threat model (separate from the rollback flow
  covered here).
