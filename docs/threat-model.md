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

---

## 8. Settings-write surface (v0.3)

v0.3 adds `harden --confirm` and the `settings-rewrite` mutation kind,
which read-modify-writes `<home>/.claude/settings.json` via the same
atomic-write protocol that v0.2's `dir-rmtree` / `file-unlink` use.
The trust boundary from §2 is unchanged — Housekeeper still runs as
the home owner, with no remote surface, no signing, and no
multi-user defense. This section pins what the settings-write surface
adds and what it does not.

### 8.1 Atomic-rename guarantees

The settings rewrite protocol (per
[`docs/design/v0.3-design.md §3.1`](./design/v0.3-design.md#31-settings-rewrite-mutation-kind)
and the v0.3 platform memo
[`docs/design/v0.3-platform-memo.md §4`](./design/v0.3-platform-memo.md#4-race-condition-analysis-atomic-rename-mid-read))
is:

1. Read original, parse, apply patch in memory.
2. Validate output (re-parse, idempotency).
3. Snapshot the original byte-for-byte under the operation tree.
4. Write `settings.json.tmp.<pid>`, `fsync` the tmp fd.
5. `rename(2)` tmp → `settings.json`.
6. `fsync` the parent dir.

POSIX `rename(2)` is required to be atomic for paths within the same
filesystem (IEEE Std 1003.1). The macOS APFS BSD `rename(2)` man page
and the Linux man-pages 6.x `rename(2)` entry both document atomic
replacement of an existing destination: any concurrent reader sees
either the old name pointing at the old inode or the new name
pointing at the new inode, never an intermediate state where the
file is missing or partially written.

This is the v0.3 supported-platform contract:

| Platform | `rename(2)` atomicity | Open-fd preserves old inode | Source |
| --- | --- | --- | --- |
| macOS APFS | Yes | Yes | BSD `man 2 rename` |
| Linux ext4 (`data=ordered`) | Yes | Yes | Linux `man 2 rename` |

### 8.2 Race window: Claude reading mid-write

The race window between step 4 (tmp written) and step 5 (rename
committed) is bounded by the `rename` syscall itself — microseconds.
For a concurrent Claude Code process reading `settings.json`:

- A read in progress against the old inode completes against the old
  inode's data. The rename does not interrupt an in-flight `read(2)`.
- A read that started before the rename and holds the fd continues
  reading the old inode (now unlinked from the name); subsequent
  reads on the same fd remain consistent with the old content.
- A read that `open()`s after the rename gets the new inode and the
  new content.

**Claude sees old or new, never partial.** This is the load-bearing
guarantee that justifies omitting a settings-write lock against
Claude itself.

The v0.3 platform memo §1.4 records that Claude Code's re-read
semantics for `settings.json` are undocumented — Claude almost
certainly reads at session start and may or may not watch the file.
Housekeeper does not promise hot-reload; every successful `harden`
emits a `RELOAD HINT` block instructing the user to restart their
Claude session for the change to take effect in-flight (per
v0.3-design.md §3.6). This is a UX guarantee, not a security one.

### 8.3 Network filesystem exclusion

NFS and SMB do not guarantee POSIX atomic-rename semantics
(implementation-dependent client behavior; some return `-EBUSY`,
some leave behind a `.nfsXXXX` ghost, none reliably preserve
open-fd-against-old-inode across the swap). Allowing
`settings-rewrite` on such a home would silently violate the §8.2
race-window guarantee.

v0.3 therefore adds a new refusal class
**`settings-network-filesystem`** to the `composeHardenPlan`
classifier (per v0.3-design.md §3.3). The check inspects the
target's filesystem type (via `statfs.f_fstypename` on macOS,
`statfs.f_type` on Linux) and refuses if the type is `nfs`, `smb`,
`cifs`, or any other non-local filesystem not on the supported list.
The refusal carries a `nextStep` directing the user to copy the
home to a local filesystem before retrying.

### 8.4 Threats considered (settings-write specific)

These extend the §3 threat list with surface-specific cases. The
existing threats T1–T8 still apply.

#### T9. Mid-write read returning partial JSON

**Defense:** Atomic `rename(2)` per §8.1; the rename is the commit
boundary. The pre-rename `fsync` of the tmp fd plus the post-rename
`fsync` of the parent dir orders the data write ahead of the metadata
swap so a crash between `rename` and parent `fsync` still leaves either
the durable old file or the durable new file.

**Residual risk:** None on macOS APFS or Linux ext4 under default
journaling modes (§8.1 table). Network filesystems are excluded
under §8.3.

#### T10. Patch that produces structurally-invalid JSON

**Defense:** The `settings-rewrite` `preApply` hook re-parses the
serialized output before the snapshot is taken. A failed re-parse
fires the refusal class `patch-produces-invalid-json` and aborts
before any on-disk state changes. Tested in
`test/harden-plan.test.mjs` (T-204, Phase 2).

#### T11. Non-idempotent patch corrupting state on re-apply

**Defense:** The `preApply` hook applies the patch twice to the same
in-memory tree and asserts byte-equality. A non-idempotent patch
fires `patch-not-idempotent` and aborts. This catches patches that
append instead of merge, or whose result depends on the input
(e.g. timestamp-based mutations).

#### T12. JSONC settings file silently mis-rewritten

**Defense:** Comments cannot be safely round-tripped through a
strict-JSON serialize / atomic-rewrite cycle (per the v0.3 platform
memo §2.4 and design §2.2). A two-phase detection (strict JSON.parse
first; on `SyntaxError`, lex-aware tokenizer scan for `//` or `/*`
outside string context) fires the refusal `settings-jsonc-detected`
before any mutation. The user is routed to manual edit.

#### T13. Settings file on network filesystem

**Defense:** §8.3 — `settings-network-filesystem` refusal.

### 8.5 Trust boundary unchanged from v0.2

The v0.3 settings-write surface does **not** change the §2 trust
boundary:

- Still single-user local. Housekeeper runs as the home owner.
- No remote operation, no daemon, no socket. The atomic-rename
  protocol is local-filesystem only.
- No signing, no HMAC. An attacker with write access to
  `<home>/.claude/settings.json` already has write access to the
  home (same uid, same trust domain) and could mutate the file
  directly. The same G13 trade-off that applies to operation
  manifests (§4) applies here: HMAC on the settings target would
  not raise the bar against a same-uid attacker.
- The `harden --confirm --yes` contract mirrors v0.2's
  `clean --confirm --yes`: explicit consent, explicit target,
  explicit path. No path from observation to action.

If you operate Housekeeper outside the single-user-local assumption,
the analysis here is not sufficient — settings-write defenses for
multi-user / fleet / remote scenarios remain v0.4+ concerns, listed
under the v0.3-candidates note in §4.

---

## 9. Learning loop (v0.4)

v0.4 introduces the learning loop: `scripts/lib/learning.mjs` appends
one JSON line per refusal, applied mutation, and rollback to JSONL
files under `<home>/.claude/housekeeper/learning/`, and maintains a
mutable summary in `learning/state.json`. The `learn` subcommand reads
these files and the `--mark-false-positive` flag writes a marker into
state.json. The `lock.history` JSONL (T-099a) records acquire/release
events for the concurrency lockfile.

### 9.1 Trust boundary (unchanged from v0.2)

The trust boundary from §2 is unchanged. Learning files are
local-only, written and read by the same uid that runs Housekeeper.
There is no network surface, no daemon, and no multi-user access
pattern. All learning surfaces are within the same single-user trust
domain as the operation manifests and snapshot trees they complement.

### 9.2 New surfaces

| Path | Access pattern | Notes |
| --- | --- | --- |
| `<home>/.claude/housekeeper/learning/refusals.jsonl` | append-only write, sequential read | One line per refusal from `composeCleanPlan` / `composeHardenPlan` |
| `<home>/.claude/housekeeper/learning/applied.jsonl` | append-only write, sequential read | One line per successful mutation |
| `<home>/.claude/housekeeper/learning/rollbacks.jsonl` | append-only write, sequential read | One line per rollback executed |
| `<home>/.claude/housekeeper/learning/state.json` | read-modify-write via atomic rename | Summary counters + false-positive markers; `learnSchemaVersion: "0.4"` on every write |
| `<home>/.claude/housekeeper/lock.history` | append-only write | One line per lock acquire/release |

### 9.3 Append-only atomicity

JSONL files are opened with `O_APPEND`. On POSIX-conforming local
filesystems (macOS APFS, Linux ext4), writes up to `PIPE_BUF` bytes
(≥ 512 bytes; 65536 on Linux, 512 on macOS) are atomic at the kernel
level: concurrent appenders cannot interleave partial lines within a
single write call sized below the limit. Each learning record is a
single JSON line well under `PIPE_BUF`, so the atomicity guarantee
holds on supported local filesystems.

**Network filesystem degradation:** NFS and SMB do not guarantee
`O_APPEND` atomicity (client-side buffering may reorder or interleave
appends from concurrent processes). The existing `looksLikeNetworkFs`
check (introduced in §8.3 for `settings-rewrite`) is extended to
cover learning file writes in v0.4 per
`docs/design/v0.4-platform-memo.md §5`. If a network filesystem is
detected, Housekeeper skips learning writes for that invocation and
emits a `degraded` entry in the diagnose output rather than risking
corrupt JSONL.

`state.json` uses the same atomic rename protocol as `settings.json`
(write-temp + `rename(2)` + fsync-parent), so it inherits the same
guarantees and the same network-filesystem exclusion.

### 9.4 Threats considered (learning-loop specific)

#### T9a. Tampering with state.json to forge false-positive markers

An attacker with write access to `<home>/.claude/housekeeper/learning/`
could modify `state.json` to insert false-positive markers, causing
the `diagnose` output to suppress findings via
`falsePositiveSeenBefore`. **Status:** out of scope. The same-uid
attacker already owns the home and can corrupt any Housekeeper state
directly. The trust-boundary argument from §4 applies unchanged:
HMAC on state.json would not raise the bar against a same-uid
attacker.

#### T9b. PII leakage in refusals.jsonl

Refusal records include `targetPath` values, which are absolute paths
under the user's home. These paths may contain the username and
directory names that a user considers private. **Mitigation:** the
`--redact` flag collapses home paths to `~` in all output, including
learning file entries, per the redaction posture documented in
`scripts/lib/redact.mjs`. Users who share learning files (e.g., for
support) should use `--redact`.

### 9.5 Acknowledged residuals

- **HMAC on learning files:** deferred per the same G13 trade-off
  recorded in §4. The single-user trust domain makes HMAC on
  learning files provide no additional protection against a same-uid
  attacker.
- **JSONL corruption recovery:** if a learning file is truncated
  mid-line by a crash, `readSummary` skips the malformed trailing
  line and logs the skip. No repair is attempted automatically.

---

## 10. MCP command rewrite (v0.4)

v0.4 adds `harden --mcp-command-rewrite=<old>=<new>`, which reads the
current `mcpServers` table from `<home>/.claude/settings.json`, finds
the entry whose `command` field matches `<old>`, and writes a
`settings-rewrite` mutation that replaces it with `<new>`. The
`<new>` value is a filesystem path supplied by the user.

### 10.1 Surface

The `--mcp-command-rewrite=<old>=<new>` flag extends the existing
`harden` command (§8). It is gated behind the same
`--confirm --yes` requirement. `--safe` mode does not run `harden` at
all (existing rule), so the MCP rewrite surface only opens when the
user explicitly opts in.

The resulting mutation is a `settings-rewrite` operation (§8) with
the MCP `command` field patched in memory before the atomic rename.
All §8 guarantees — atomic rename, JSONC refusal, network-filesystem
refusal, snapshot + rollback — apply unchanged.

### 10.2 Threats considered (MCP rewrite specific)

#### T10a. PATH-shadowing — user-supplied path under attacker write control

A user could supply a `<new>` path that points to a location the
user's own account can write to, then later replace the target binary
with a malicious one. When Claude next invokes the MCP server, it
would execute the attacker-controlled binary.

**Mitigation:** Two refusal classes guard against the common cases:

- `mcp-rewrite-target-missing` — refuses if `<new>` does not exist at
  plan-composition time. The user cannot rewrite to a path that
  hasn't been created yet.
- `mcp-rewrite-target-not-executable` — refuses if `<new>` exists but
  is not executable by the running uid. This eliminates the class of
  attacks where a non-executable placeholder is written first.

**Residual risk:** A path that exists and is executable at
plan-composition time could be replaced between `composeHardenPlan`
and `executeHardenPlan`. The TOCTOU window is bounded to milliseconds
(same argument as T7 in §3). A user who controls both the Housekeeper
invocation and the target path already owns the home.

#### T10b. Foreign-owner — supplied path owned by another uid

A user could supply a `<new>` path whose inode is owned by a
different uid (e.g. a system binary, a shared library directory).
Claude would then invoke a binary not under the user's exclusive
control, which is a wider attack surface than before the rewrite.

**Status:** mitigation deferred to v0.4.x. The refusal class
`mcp-rewrite-foreign-owner` is **not yet implemented**. The v0.4.0
release does not check the owner uid of `<new>`. This is recorded
as a known residual per architect memo
`docs/design/v0.4-architect-memo.md §3.4`. The T10b refusal class
will be added in a v0.4.x patch once the uid-check helper is
validated across macOS and Linux.

### 10.3 Trust boundary unchanged

The v0.4 MCP rewrite surface does not change the §2 trust boundary.
Housekeeper still runs as the home owner, with no remote surface and
no multi-user defense. The `<new>` path is supplied by the user
interactively; Housekeeper does not fetch remote paths or resolve
redirects.
