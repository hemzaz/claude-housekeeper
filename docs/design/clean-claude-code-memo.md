# T-704 Platform Memo — Claude Code Safety Rails for `clean --confirm --yes`

**Author lane:** Claude Code platform engineer.
**Companion memos:** architect (mutation mechanics), product (consent / framing).
**Status:** draft. Synthesizer will reconcile across the three lanes.
**Sources of truth cited inline:** `docs/loader-semantics.md` §1–§10,
`docs/snapshot-architecture.md`, `docs/rollback-contracts.md`, `scripts/lib/audit.mjs`,
`commands/housekeep.md`, `hooks/session-start.mjs`, `notes/LOADER-SEMANTICS-AUDIT.md`.

## 0. What this memo is and is not

This is the platform-safety lane. It does **not** redesign mutation flow (architect)
or the consent gate (product). It pins what Claude Code itself requires of any
process that touches `~/.claude/` while sessions may be running. The output is
a set of invariants, refusal rules, and reload semantics the architect's mutation
engine must satisfy and that the product's UX must surface to the user.

The bias of this memo is conservative: Housekeeper exists because the operator
has stopped trusting their own `~/.claude/`. `clean` cannot trade one trust loss
for a worse one (Claude Code crashing mid-session because a plugin disappeared).

The single most consequential platform fact: **Claude Code holds plugin code in
memory.** Concurrent sessions are the norm in this project's own user base (the
operator runs OMC, ECC, Codex, and worktree fleets simultaneously). Anything
this memo permits must remain safe in that setting.

---

## 1. Plugin Cache Invariants

The architect's mutation engine MUST treat these as preconditions on every
target path and postconditions on every applied operation.

### 1.1 Pre-conditions (what must be true before `clean --confirm --yes` mutates)

| # | Precondition | Source |
|---|---|---|
| P1 | Target is inside `<home>/.claude/` (no `..` traversal, no symlink crossing out) | implicit in `docs/snapshot-architecture.md` §2 home-locality requirement |
| P2 | Target path matches **none** of the v0.1 protection rules | `scripts/lib/audit.mjs` `collectPolicyMatches`; `docs/snapshot-architecture.md` §7 |
| P3 | Target is **not** the currently-active version of a plugin per `~/.claude/plugins/installed_plugins.json` | `docs/loader-semantics.md` §2 ("Plugins can be enabled via settings"; installed registry is the live key) |
| P4 | If target is a plugin cache version dir, it must be reported as `plugin.cache_unreferenced` (outside the documented grace window) — never `plugin.expected_orphan` | `docs/loader-semantics.md` §2 + §7: "Orphaned previous versions are removed automatically about 7 days later. The grace period exists so concurrent Claude Code sessions that already loaded the old version keep running." |
| P5 | Target's containing plugin does not define an MCP server that the user's current settings show as connectable | `docs/loader-semantics.md` §6: "enabled plugin MCP servers start automatically at session startup" |
| P6 | No `housekeeper.interrupted_operation` finding exists for this `<home>` | `docs/rollback-contracts.md` §5; enforced today in `scripts/lib/audit.mjs detectInterruptedOperation` |
| P7 | `<home>/.claude/housekeeper/operations/<id>.json` for the new id does not already exist | `docs/rollback-contracts.md` §1 (id stability) |
| P8 | No concurrent Housekeeper process is mutating this same `<home>` (lockfile check, §2.2 below) | new; this memo |

### 1.2 Post-conditions (what must hold after `clean --confirm --yes` returns)

| # | Postcondition | Failure response |
|---|---|---|
| Q1 | Every file present before mutation has either: (a) been deleted with an entry in the snapshot manifest, or (b) been preserved byte-identical | rollback |
| Q2 | No partial cache directory exists (a plugin cache version dir is either entirely present or entirely absent — never half) | rollback (§5.3 below: half-directory is worse than full-stale) |
| Q3 | `installed_plugins.json` and `settings.json` are unchanged in v0.2.0 (registry/settings writes are deferred — see §5) | n/a — v0.2.0 refuses these edit types |
| Q4 | The operation manifest is `verified` (or terminally failed) — never `applied` without verify | architect's verify pass; required by `docs/rollback-contracts.md` §4 |
| Q5 | If clean removed any plugin cache version dir, no MCP child process that plugin started in any session has been signalled by Housekeeper directly. Housekeeper does not kill processes (§7.4 below). | refuse, do not signal |

### 1.3 The single load-bearing invariant

If P1–P8 and Q1–Q5 all hold, the architect's mutation engine has met its
contract with Claude Code. Any one of them failing is a release-blocker bug,
not a degraded mode. The product memo's consent UX MUST surface P3–P5 in
plan output — they are the cases where a user could legitimately think the
operation is safe but the platform disagrees.

---

## 2. Concurrent-Session Safety Matrix

Claude Code does not advertise a session registry. There is no documented
process inventory, no documented lockfile, and no documented way to enumerate
which `<home>/.claude/` consumers are live. This memo treats that gap as a
core constraint rather than a side problem.

### 2.1 The matrix

For each mutation kind the architect is expected to propose for v0.2.0,
cross-referenced against Claude Code session states. Cell legend:

- **SAFE** — operation cannot harm a concurrent session
- **UNSAFE-BLOCK** — operation may corrupt a concurrent session; refuse
- **UNSAFE-WAIT** — operation may corrupt; allow only after preflight drain
- **UNSAFE-MITIGATE** — operation can be made safe with a documented mitigation

| Mutation kind | No live session | One session, idle (no plugin load active) | One session loading plugins (within session start window) | One session, hook running | Multiple sessions any state |
|---|---|---|---|---|---|
| Delete plugin cache version dir (cache_unreferenced, outside grace) | SAFE | UNSAFE-MITIGATE (§2.3 freshness preflight) | UNSAFE-BLOCK | UNSAFE-BLOCK | UNSAFE-BLOCK |
| Delete plugin cache version dir (expected_orphan, inside grace) | n/a — refused by P4 | n/a | n/a | n/a | n/a |
| Delete a local command file under `~/.claude/commands/` | SAFE | UNSAFE-MITIGATE (live skill watcher; §4 below) | UNSAFE-MITIGATE | UNSAFE-MITIGATE | UNSAFE-MITIGATE |
| Delete a local skill dir under `~/.claude/skills/<name>/` | SAFE | UNSAFE-MITIGATE | UNSAFE-MITIGATE | UNSAFE-MITIGATE | UNSAFE-MITIGATE |
| Edit `~/.claude/settings.json` | n/a — refused by §5 in v0.2.0 | n/a | n/a | n/a | n/a |
| Edit `.claude/settings.json` (project) | n/a — refused | n/a | n/a | n/a | n/a |
| Delete a Housekeeper-owned file (snapshot, operation manifest) | SAFE | SAFE | SAFE | SAFE | UNSAFE-BLOCK (two Housekeeper processes; §2.2) |

### 2.2 The Housekeeper-on-Housekeeper case: lockfile

There is no Claude-Code-provided cross-process registry, but Housekeeper
controls itself. Adopt a lockfile protocol scoped to `<home>`:

```
<home>/.claude/housekeeper/lock
```

Protocol:

1. **Acquire** before any mutation flow (`clean --confirm`, `rollback <id>`):
   write `{ pid, hostname, startedAt, command }` atomically (write-temp +
   rename per `docs/snapshot-architecture.md` §4). `startedAt` is ISO 8601
   UTC millisecond precision, matching the manifest convention.
2. **Refuse** if lock exists and `Date.now() - startedAt < 30 minutes`. The
   30-minute window is conservative for a single op (snapshot budget is 50
   files / 10 MB per `docs/snapshot-architecture.md` §9).
3. **Stale-lock recovery**: if the lock is older than 30 minutes, treat as
   stale and emit a `housekeeper.stale_lock` informational finding. Do NOT
   auto-clear; require the user to remove the lock file manually. Auto-clear
   races against a real concurrent Housekeeper.
4. **Release** on terminal status (`verified`, `rolled_back`, `aborted`) and
   on process exit (POSIX `EXIT` handler; no signal trap — let SIGKILL leave
   stale lock for the next run to surface).

The lock file is NOT a Claude Code construct. It only protects Housekeeper
from itself. It is necessary because the operator's own `CLAUDE.md` describes
parallel agent worktrees that could each invoke `clean --confirm --yes`
against the same `<home>`.

### 2.3 The concurrent Claude-session case: freshness preflight

Because there is no documented process registry, Housekeeper cannot prove a
plugin cache version dir is unmapped. The 7-day grace exists precisely
because Claude Code itself cannot prove this either — it uses time as a
proxy.

**Recommended preflight (v0.2.0)**: time-based only, mirroring Claude Code's
own logic.

| Check | Threshold | Rationale |
|---|---|---|
| Cache dir mtime age | ≥ 7 days | `docs/loader-semantics.md` §2/§7 documented retention |
| Cache dir atime age | ≥ 30 minutes | An mtime-old dir whose contents were read recently is likely in-use. atime is unreliable on macOS APFS with `noatime`, so this is a **soft signal** — `inform` finding, not refusal |
| The Plugin's `${CLAUDE_PLUGIN_ROOT}` does not match this cache dir in `installed_plugins.json` | required | Active version detection per §1.1 P3 |

**Not recommended for v0.2.0**: process-list scanning. `ps -ef | grep claude`
is brittle (the binary name varies — `claude`, `node`, `electron` for IDE
hosts, anonymous subagent processes), platform-specific (`lsof` on macOS
vs `/proc` on Linux), and likely to false-negative on the very session
states it is supposed to detect. Defer to v0.3.

### 2.4 What the matrix means for v0.2.0 scope

Re-reading §2.1: every `UNSAFE-MITIGATE` cell exists because a live Claude
session that has loaded the plugin/skill/command will keep a stale reference
in memory. **v0.2.0 should ship `clean --confirm --yes` ONLY for cells that
are SAFE or UNSAFE-MITIGATE.** Specifically:

- `plugin.cache_unreferenced` deletion (outside grace) — ship with §2.3
  preflight + user-facing reload instruction (§3 below).
- Housekeeper-owned file cleanup (e.g. expired `aborted` snapshots) — ship
  with §2.2 lockfile.

Defer to v0.3:
- Local skill/command cleanup (UNSAFE-MITIGATE; live skill-watcher per
  `notes/LOADER-SEMANTICS-AUDIT.md` §4 NEW_RULE_AVAILABLE makes this safer
  than expected, but not free).
- Settings edits (UNSAFE-BLOCK in current state; see §5).

This narrowing is the single platform call this memo asks the synthesizer
to enforce against the architect memo. If the architect proposes a broader
v0.2.0 mutation surface, push back to the matrix.

---

## 3. Reload Model — When Does a Mutation Actually Take Effect?

This section answers: "After `clean --confirm --yes` returns success, what
does the user need to do for Claude to see the change?"

The matrix below assumes the user is in **at least one** Claude Code session
when clean runs — the empty-session case is trivial (next session start
loads everything fresh).

| Mutation kind | Effect timing | User-facing instruction required? | Inconsistent-state window? |
|---|---|---|---|
| Delete cache version dir for an inactive plugin (not in `installed_plugins.json`) | Immediate at filesystem level. Claude's Glob/Grep already skip orphaned versions per `docs/loader-semantics.md` §7. No loader memory pressure on this version. | **No** | None |
| Delete cache version dir for the active plugin (forbidden by P3) | n/a — refused | n/a | n/a |
| Delete a local command file (`~/.claude/commands/foo.md`) | Live: skill-watcher picks it up "within the current session without restarting" per `notes/LOADER-SEMANTICS-AUDIT.md` §4. The matched skill/command becomes unavailable mid-session. | **Yes** — "Claude removed `/foo` from your active sessions. If you have a session pending an invocation of `/foo`, it will fail." | Brief — during the watcher's debounce window. Acceptable. |
| Delete a local skill dir (`~/.claude/skills/<name>/`) | Same as above. Skill becomes hidden in active sessions per §4 NEW_RULE_AVAILABLE. | **Yes** | Brief |
| Delete a newly-created top-level skills dir | `notes/LOADER-SEMANTICS-AUDIT.md` §4: "Creating a top-level skills directory that did not exist when the session started requires restarting Claude Code so the new directory can be watched." Inversely, **deleting** the only top-level skills dir leaves no watcher attached but does not crash. | No, but inform user that `/skills` will report differently | None at user level |
| Delete a Housekeeper-owned file under `~/.claude/housekeeper/` | Invisible to Claude (not in any documented loader path) | No | None |
| Edit `~/.claude/settings.json` | **Mixed**: some keys hot-reload, some require restart. Authoritative key-by-key matrix is not in the public docs. Spec audit §5 leaves merge order undocumented. | **Yes** + explicit "restart Claude" caveat | Yes, undocumented duration |
| Edit a hook command string in settings | Hook registry is read at session start per `docs/loader-semantics.md` §5. `/reload-plugins` does NOT reload settings hooks (only plugin hooks, by inference from §6). | **Yes** — "restart Claude" | Yes |
| Edit `.mcp.json` | Plugin MCP servers connect at session start per §6. Manual `.mcp.json` likely same. `/reload-plugins` covers **plugin** MCP servers, not project `.mcp.json`. | **Yes** — "restart Claude" | Yes |

### 3.1 Required user-facing instruction text

After every successful `clean --confirm --yes` run, the report MUST include
a `RELOAD HINT` block. Pin the text:

```
RELOAD HINT
The following Claude Code state may need to be refreshed:
  - <if cache version dir deleted>: No action needed. Claude's plugin cache
    was already ignoring this version. New sessions will see the smaller cache.
  - <if local command/skill deleted>: Active sessions have already removed
    this resource via the live file watcher. Pending invocations of /<name>
    will fail. Start a new session if you need to re-invoke.
  - <if settings.json edited>: Restart Claude Code. Settings.json is read at
    session start; mid-session edits are not guaranteed to apply.
  - <if plugin MCP-bearing dir deleted>: Run /reload-plugins in each active
    Claude Code session to drop the stale MCP connection. Claude will not
    auto-reconnect.
```

The report renderer (`scripts/lib/report.mjs` per Phase 2 of `notes/PLAN.md`)
must emit this block whenever `command == "clean"` and `status == "verified"`
in the operation manifest.

### 3.2 The `/reload-plugins` semantics gap

`docs/loader-semantics.md` §6 documents `/reload-plugins` as the mechanism
to connect/disconnect plugin MCP servers when plugins are enabled/disabled
during a session. The doc set does NOT cover:

- Whether `/reload-plugins` re-reads plugin component code from disk for an
  already-enabled plugin (vs. only re-scanning enable state)
- Whether `/reload-plugins` drops cached `${CLAUDE_PLUGIN_ROOT}` paths
- Whether `/reload-plugins` is idempotent

**v0.2.0 policy**: Housekeeper recommends `/reload-plugins` in the RELOAD
HINT for cache version dir deletions, but does NOT execute it (it requires
a live Claude session — `docs/loader-semantics.md` §9.1 build implication).
The user runs it. The product memo should confirm this fits the consent UX.

---

## 4. Hook Context — SessionStart Can Surface, Not Recover

The existing `hooks/session-start.mjs` is the right model. Pin its
constraints as platform contract for v0.2.0:

### 4.1 What the SessionStart hook is allowed to do

From `hooks/session-start.mjs`:

- Runs `claude-housekeeper diagnose --safe --json` with a 5-second timeout.
- Exits 0 unconditionally — "a slow or failed Housekeeper run must NEVER
  block session start" (file comment).
- Emits a one-line stderr summary only when `block` or `probe` findings
  exist.
- Drains stdin defensively (the SessionStart context payload).
- Honors `HOUSEKEEPER_SESSION_HOOK=off` opt-out.

These constraints are correct and stay in v0.2.0. The hook MUST NOT call
`clean --confirm --yes` from inside SessionStart, period. Rationale:

1. `docs/loader-semantics.md` §8 "SessionStart should be fast" — clean is
   slow (snapshot writes, hash checks, verify pass).
2. Concurrent-session matrix §2.1 — at SessionStart, by definition, a
   session is loading. UNSAFE-BLOCK row.
3. No consent. SessionStart cannot prompt. Auto-mutation at session start
   violates `docs/snapshot-architecture.md` §1 ("snapshot is taken before
   ANY mutation, never as a side-effect").

### 4.2 What the SessionStart hook MUST do for `housekeeper.interrupted_operation`

When the SessionStart probe sees a `block` finding for
`housekeeper.interrupted_operation`, the user has an incomplete operation
from a previous `clean` invocation. The architect memo will define recovery
(`rollback <id>` per v0.2 decision Q3 in `notes/PLAN-v0.2.md`). The hook's
job is only to surface.

Pin the SessionStart stderr message for this case:

```
[housekeeper] 1 block finding(s) need attention before session.
Run 'claude-housekeeper plan' to inspect, or set HOUSEKEEPER_SESSION_HOOK=off to silence.
```

The existing message is already correct. v0.2.0 should not change it. The
specific recommendation `rollback <id>` should appear in `plan` output, not
the SessionStart stderr line — keep SessionStart minimal per §8.

### 4.3 What the SessionStart hook MUST NOT do

- Run `clean`, `rollback`, or `harden`.
- Mutate any file (even `~/.claude/housekeeper/cache/diagnose-summary.json`
  for caching — defer until v0.3 with proven need).
- Block longer than 5 seconds.
- Print to stdout if stdout adds context to Claude per `docs/loader-semantics.md`
  §5 (current hook prints to stderr — correct).
- Read settings files outside `<home>/.claude/` (sector boundary).

### 4.4 Open question: SessionStart handler types

`notes/LOADER-SEMANTICS-AUDIT.md` §8 flags as CHANGED: the spec claims
SessionStart accepts only command + mcp_tool handlers, but the docs now
list five handler types globally and the per-event matrix was truncated
in the audit. Housekeeper ships a `command` handler today, which is the
universally-supported type. Defer the handler-type question. No risk
for v0.2.0.

---

## 5. Settings.json Edit Policy — DEFER

The architect memo will likely propose editing `~/.claude/settings.json`
to repair the `settings.hook_path_dangling` case. Recommended platform
posture for v0.2.0: **REFUSE.**

Reasons, in priority order:

### 5.1 Precedence chain is irreducible

Per `docs/loader-semantics.md` §1:

```
Managed > CLI args > Local > Project > User
```

A hook command at the user-level (`~/.claude/settings.json`) may be
overridden, shadowed, or merged with project-level (`.claude/settings.json`)
or local (`.claude/settings.local.json`) settings. The merge order is
explicitly Unknown in `docs/loader-semantics.md` §5: "exact merge order of
hooks from all sources" is not documented.

If clean repairs a dangling-path hook at user level and the user has the
same hook (intentionally) defined at project level pointing somewhere
valid, has clean fixed a problem or corrupted the user's intent? We
cannot know.

### 5.2 No comment-preservation primitive

JSON has no native comments. `~/.claude/settings.json` files in the wild
may contain JSONC-style `//` lines (Claude Code's own `/doctor` tolerates
schema deviations per `docs/loader-semantics.md` §5). Any settings rewrite
either:

- Strips comments (data loss for the user; violates `CLAUDE.md` §3 surgical
  change rule), or
- Preserves them via a JSONC parser (adds a dependency and a corner-case
  surface — comment placement on object/property boundaries, trailing
  commas, etc.).

Neither is cheap. Neither is critical for v0.2.0.

### 5.3 Claude itself writes settings

Claude Code's own `/permissions`, `/hooks`, plugin-install commands, and
others write to settings. If Housekeeper edits `settings.json` while
Claude has the file open (or worse, between Claude's read and Claude's
write), the user gets corruption with no clean signal. Detecting "is
Claude about to write?" is not possible from outside Claude.

### 5.4 The dangling-hook problem has a non-mutation answer

When `clean` detects `settings.hook_path_dangling`, the v0.2.0 right action
is: emit the `prepare` finding (already the case in current
`scripts/lib/audit.mjs detectHookPathDangling`), show the user the exact
JSON path and the offending command string, recommend `/doctor` or
`claude --debug hooks` per `docs/loader-semantics.md` §9.1, and stop.
The user edits the file. This is acceptable for v0.2.0 because the
operator population is engineers comfortable with text editors.

### 5.5 What changes by v0.3

By v0.3, with the learning loop and `harden --confirm`:
- Comment-preservation primitive built once and reused.
- Settings-edit protocol with a `.claude/settings.json.tmp + rename`
  atomicity wrapper.
- Settings precedence inspection (`/status` probe per
  `docs/loader-semantics.md` §9.1) to confirm user-level edit will
  actually be effective.
- Claude-concurrent-write detection (mtime-watch + retry with backoff).

Until then, v0.2.0 ships `clean --confirm --yes` with **zero settings
edit capability**. The product memo should align the consent UX with this
narrowed scope.

### 5.6 If the architect overrules and ships settings edits

If consensus is to ship settings edits in v0.2.0 anyway, platform-engineering
non-negotiables:

| # | Rule | Failure mode if violated |
|---|---|---|
| S1 | Touch ONLY `~/.claude/settings.json` (user scope). Refuse project/local/managed paths. | Higher-precedence overrides leak; users blame Housekeeper for non-fix |
| S2 | Refuse if the file is not parseable as strict JSON (no JSONC, no comments). | Comment loss |
| S3 | Refuse if mtime changes between snapshot read and apply by more than 0 (not just hash-check; the file was reopened) | Concurrent write |
| S4 | Tell the user "Restart Claude Code" in RELOAD HINT for every settings edit. | Mid-session inconsistency |
| S5 | Never edit the `hooks` block without proof that the dangling path is unambiguously a plugin cache path (`docs/loader-semantics.md` §5 build implication on shell-ambiguity) | False positive on `${CLAUDE_PLUGIN_ROOT}` expansions |

---

## 6. Hook Contract for `housekeeper.interrupted_operation`

This is the v0.1 detector that already exists in `scripts/lib/audit.mjs
detectInterruptedOperation` (lines 738–787). v0.2 adds the recovery action
surface. Platform-engineering contract:

### 6.1 Detector firing condition (unchanged from v0.1)

Per `docs/rollback-contracts.md` §5: fires for any operation manifest in
`<home>/.claude/housekeeper/operations/` whose `status` is **not** in:

```
terminal = { "verified", "rolled_back", "aborted" }
```

Non-terminal statuses surfaced today:
- `planned` — "Operation planned but snapshot never written."
- `snapshot_taken` — "Snapshot taken but apply never ran."
- `applied` (no `partialApply`) — "Operation applied but not verified."
- `applied` (`partialApply: true`) — "Partial apply detected; rollback may be needed."

### 6.2 Stance is always `block`

The current code sets `forceStance: "block"` (line 785). This stays. The
stance engine MUST NOT downgrade interrupted-operation findings. Pin in
report invariants test: "no `housekeeper.interrupted_operation` finding
renders as anything other than `block`."

### 6.3 SessionStart hook surfacing — exact wording

From `hooks/session-start.mjs` lines 81–84 — already correct. Do not
change for v0.2.0:

```
[housekeeper] N block finding(s) need attention before session. Run 'claude-housekeeper plan' to inspect, or set HOUSEKEEPER_SESSION_HOOK=off to silence.
```

Plan output then shows the operation id, current status, when it was
captured, and the available recovery actions.

### 6.4 Recovery action surface (per v0.2 Q3 decision)

`notes/PLAN-v0.2.md` Decision Log Q3: recovery surface is `rollback <id>`
(reuse). Platform contract:

| Status at detection | Available action | Behavior |
|---|---|---|
| `planned` | `rollback <id>` (no-op semantics) | Mark manifest `aborted`; no file restoration needed |
| `snapshot_taken` | `rollback <id>` | Snapshot directory exists; restore is unnecessary, mark `aborted`. If user explicitly wants the snapshot bytes restored over the live files anyway, use `rollback <id> --force` (out of v0.2.0 scope) |
| `applied` no `partialApply` | `rollback <id>` | Restore from snapshot; mark `rolled_back` |
| `applied` `partialApply: true` | `rollback <id>` | Same |
| Mid-rollback crash (manifest stuck `applied`) | `rollback <id>` (idempotent re-run) | Per `docs/snapshot-architecture.md` §6.3: re-read manifest, identify unrestored files, complete restoration |

### 6.5 The detector must not auto-fire mutation

`scripts/lib/audit.mjs detectInterruptedOperation` line 786 declares
`blockedActions: ["start new mutation operation", ...]`. This blocks the
NEXT `clean --confirm --yes` until the user explicitly resolves. The
SessionStart hook MUST NOT call `rollback` automatically. The hook only
surfaces; the user invokes `rollback`.

This is the most important hook-contract invariant. If the architect
proposes an "auto-resolve on session start" path, push back: the user
loses agency the moment we automate this, and the operator already
described (in their global CLAUDE.md) that they run autonomous agent
fleets where auto-resolve would silently complete operations they did
not consent to.

---

## 7. MCP / Plugin Interaction

`docs/loader-semantics.md` §6 documents the MCP lifecycle for plugin
servers. Pin the consequences for `clean --confirm --yes`.

### 7.1 What we know

1. Plugins define MCP servers in plugin `.mcp.json` or inline in
   `plugin.json` (`docs/loader-semantics.md` §6).
2. Enabled plugin MCP servers **start automatically at session startup**
   (§6). This implies a Claude process spawns child processes for each
   enabled plugin MCP server.
3. Enable/disable mid-session requires `/reload-plugins` to connect or
   disconnect (§6).
4. Plugin MCP servers have access to the same env vars as manually
   configured servers (§6) — so the process is real, not a stub.
5. `docs/loader-semantics.md` §6 build implication: "Safe mode must parse
   config only; it must not start servers."

### 7.2 What we do NOT know

- Whether Claude reconnects automatically when the plugin's cache version
  dir is removed mid-session. The doc set is silent.
- Whether the MCP child process exits cleanly when its plugin is disabled,
  or whether Claude SIGKILLs it. Likely SIGTERM-then-SIGKILL, but
  undocumented.
- Whether `/reload-plugins` works after the plugin cache dir is removed,
  or whether it crashes because the disable path is non-existent.

### 7.3 v0.2.0 policy: refuse if the plugin defines an MCP server

The matrix in §2.1 says cache-version-dir deletion for the active plugin
is forbidden by P3. The platform addition for plugins that **define MCP
servers**: refuse deletion **of any cache version** (not just the active
one) until v0.3, when Housekeeper has MCP-aware verification.

Rationale: even an "orphaned outside grace" version dir could be referenced
by an MCP server that crashed and is being respawned by Claude. The cost
of false-positive refusal is low (the cache version stays on disk an extra
release). The cost of false-positive deletion is high (Claude's MCP
subsystem crashes when it tries to respawn a missing binary).

Detection: read `<cache_version_dir>/.claude-plugin/plugin.json` and
`<cache_version_dir>/.mcp.json`. If either declares an MCP server (or
`mcpServers` block), refuse with:

```
plugin.cache_unreferenced (refused — has MCP server declaration)
target: ~/.claude/plugins/cache/<market>/<plugin>/<version>/
reason: plugin defines an MCP server; Housekeeper cannot verify Claude
  has no live reference to this version. Defer until v0.3.
next: run /mcp in your active sessions to confirm no server from this
  plugin is connected, then re-run after grace expires
```

### 7.4 Housekeeper does NOT signal processes

Even if Housekeeper could enumerate Claude-spawned MCP child PIDs, it
must not signal them. Reasons:

1. Process ownership: Claude owns those processes. Killing them violates
   the broader "Housekeeper is read-only, then opt-in mutation of FILES"
   contract per `docs/snapshot-architecture.md` §1.
2. Restart semantics: Claude probably re-spawns. Housekeeper signalling
   creates a SIGTERM/respawn loop until the plugin is disabled at the
   settings level.
3. State: MCP servers can be stateful (a long-running connector). Killing
   loses state silently.

The architect memo's mutation engine must not include any `process.kill`
call against non-Housekeeper PIDs.

---

## 8. Refusal Taxonomy — The Five Categories Claude Code Requires

These are the categories where `clean --confirm --yes` refuses on
platform grounds, even when the user explicitly confirms. Each has
detection logic, refusal text, and the loader-semantics citation.

### 8.1 R1: Active plugin version

**Detection:** `~/.claude/plugins/installed_plugins.json` lists this
plugin as enabled, and the cache version dir matches the installed
version path per `scripts/lib/audit.mjs flattenPluginEntries`.

**Refusal text:**
```
plugin.active (refused — active version)
target: <path>
reason: Plugin is currently registered and enabled in installed_plugins.json.
  Deletion would cause Claude to crash on the next plugin load attempt.
next: disable via `claude plugin disable <name>@<marketplace> --scope=<scope>`,
  then re-run after grace expires
```

**Citation:** `docs/loader-semantics.md` §2 ("Plugins can be enabled via
settings"); installed registry is the live key.

### 8.2 R2: Cache version inside grace window

**Detection:** mtime of cache version dir is < 7 days old AND it is not
the currently-active version (i.e., it is in the documented orphan grace
window).

**Refusal text:**
```
plugin.expected_orphan (refused — within grace window)
target: <path>
reason: This plugin version was orphaned <N> days ago. Claude Code keeps
  orphaned versions for ~7 days so concurrent sessions that already loaded
  the old version keep running. Deletion now could crash an active session.
next: wait <7 - N> day(s) for grace expiry; re-run then
```

**Citation:** `docs/loader-semantics.md` §2 + §7 verbatim.

### 8.3 R3: Settings.json hook entries we have not been authorized to touch

**Detection:** target path is `~/.claude/settings.json` or any
`.claude/settings.json` / `.claude/settings.local.json`.

**Refusal text (v0.2.0):**
```
settings.* (refused — settings edits deferred to v0.3)
target: <path>
reason: Settings.json edits require comment preservation, precedence-chain
  awareness, and Claude-concurrent-write detection that are deferred to
  v0.3. v0.2.0 does not modify settings.
next: edit the file manually; run `/doctor` in Claude to validate
```

**Citation:** `docs/loader-semantics.md` §1 (precedence) + §5 (hook merge
order undocumented).

### 8.4 R4: Project-level `.mcp.json`

**Detection:** target path is any `.mcp.json` (the architect's mutation
engine should never propose this, but the platform layer enforces).

**Refusal text:**
```
project_mcp (refused — project-shared file)
target: <path>
reason: .mcp.json is shared via version control per Claude Code MCP
  scopes (Local/Project/User). Editing it affects every collaborator on
  the project, not just this machine. Housekeeper does not modify shared
  configuration in v0.2.0.
next: edit via your repository's normal review flow
```

**Citation:** `docs/loader-semantics.md` §6 ("Project | Current project
only | Yes, via version control | `.mcp.json` in project root").

### 8.5 R5: Files under live skill/command watcher path

**Detection:** target path is under `~/.claude/skills/`, `~/.claude/commands/`,
project `.claude/skills/`, or project `.claude/commands/`. Note: for v0.2.0
this is a **refusal** category. v0.3 will lift this once we've shipped the
RELOAD HINT integration test.

**Refusal text (v0.2.0):**
```
registry.local_watched (refused — live skill/command path)
target: <path>
reason: Claude Code watches skill and command directories for changes
  within active sessions. v0.2.0 does not yet ship the RELOAD HINT
  integration for local registry deletions.
next: deferred to v0.3; remove manually with full session restart
```

**Citation:** `notes/LOADER-SEMANTICS-AUDIT.md` §4 NEW_RULE_AVAILABLE
("Claude Code watches skill directories for file changes... takes effect
within the current session without restarting").

### 8.6 The five categories, summarized

| Id | Category | Refusal type | v0.3 lift? |
|---|---|---|---|
| R1 | Active plugin version | Hard (always) | No |
| R2 | Cache inside grace window | Hard (until grace expires) | No — Claude's own contract |
| R3 | Settings.json edits | Soft (v0.2.0 only) | Yes |
| R4 | Project `.mcp.json` | Hard (always) | Unlikely |
| R5 | Local skill/command path | Soft (v0.2.0 only) | Yes |

R1, R2, R4 stay refused forever (or until Claude Code itself changes its
contract). R3, R5 lift in v0.3 when the supporting infrastructure exists.

---

## 9. Open Platform Questions

Questions the doc set cannot resolve. Each has a recommended default and
a marker for when the default would be wrong.

### 9.1 Q-PLAT-1: Is there a way to enumerate live Claude PIDs?

**Status:** No documented API. `/status` (per `docs/loader-semantics.md`
§9.1) reports active settings sources for one session, not a process list.

**Default:** Do not attempt process enumeration. Treat the 7-day grace
window (R2) as the canonical proxy for "no active session has this
version loaded."

**Default fails when:** A user has a single long-running Claude session
that has loaded an old plugin version more than 7 days ago and never
restarted. The mtime is now > 7 days; the session still has the version
in memory; clean deletes it; the session crashes on next tool call. This
is rare in interactive use, common in long-running daemon-style sessions
(future Claude Code use case).

**Mitigation if this becomes a real problem in v0.2.x:** Add a startup
check that writes `<home>/.claude/sessions/<sessionId>/started_at` files
(Claude already may do this — needs research), and Housekeeper reads them
to find sessions older than the cache version's mtime. Defer the research
until a real bug report arrives.

### 9.2 Q-PLAT-2: Does `/reload-plugins` rebuild loaded plugin code?

**Status:** Docs say `/reload-plugins` connects/disconnects plugin MCP
servers on enable/disable. They do not say it reloads code for an
already-enabled plugin.

**Default:** Assume `/reload-plugins` is sufficient when clean removes a
non-active orphaned cache dir (no enable/disable required). Do not rely
on it for code-reload.

**Default fails when:** User has manually edited a file inside a
`${CLAUDE_PLUGIN_ROOT}` cache dir (anti-pattern per
`docs/loader-semantics.md` §2 NEW_RULE_AVAILABLE: "treat as ephemeral and
do not write state here"). Out of v0.2.0 scope.

### 9.3 Q-PLAT-3: Can SessionStart hook stdout reach Claude when the hook exits early?

**Status:** `docs/loader-semantics.md` §5: "SessionStart stdout can add
context to Claude." Existing `hooks/session-start.mjs` writes only to
stderr.

**Default:** Stick with stderr. Adding context to Claude from a
read-only diagnostic is feature creep; the user reads the report
explicitly via `plan`.

**Default fails when:** Product memo proposes auto-injecting reload
hints into the next-session context. If they do, this becomes a
stdout-vs-stderr decision and the hook output contract grows.
Recommend rejecting in v0.2.0.

### 9.4 Q-PLAT-4: Are there hidden cache-naming guarantees?

**Status:** `docs/loader-semantics.md` §7 Unknown: "cache directory
naming guarantees".

**Default:** Treat `<cache_root>/<market>/<plugin>/<version>/` as the
authoritative path shape per `scripts/lib/audit.mjs listCacheVersionDirs`.
Refuse to operate on directories that do not match this shape.

**Default fails when:** Claude Code ships a new cache layout (e.g.,
content-addressed). The audit detector will stop firing (no
findings). v0.2.x compatibility matrix should pin a tested Claude Code
version range per `notes/PLAN.md` Phase 4.

### 9.5 Q-PLAT-5: What is the marker-file semantics for orphans?

**Status:** `docs/loader-semantics.md` §2 Unknown: "exact local marker
file semantics" (e.g., `.in_use`).

**Default:** Do not inspect for marker files. If Claude Code ships a
`.in_use` file in the future, our detector will simply not consult it
— we lose the additional signal but gain no risk.

**Default fails when:** A future Claude Code version uses a marker file
to extend the grace window past 7 days for hot plugins. We may delete
within the new (longer) grace window. Mitigation: pin v0.2.x to a
specific Claude Code version range in `docs/compatibility-matrix.md`
and document a re-validation requirement on version bumps.

### 9.6 Q-PLAT-6: Does `claude plugin uninstall` itself clean caches synchronously?

**Status:** `docs/loader-semantics.md` §7: orphans removed automatically
about 7 days later (background, not immediate).

**Default:** Assume `claude plugin uninstall` orphans synchronously but
deletes asynchronously. Housekeeper's cache cleanup is therefore
complementary, not duplicative.

**Default fails when:** Claude Code begins eagerly removing caches on
uninstall (would break user expectation but possible). Then Housekeeper's
cache deletion finds nothing — no harm done, but the detector becomes
inert. No code change required.

### 9.7 Q-PLAT-7: Does `${CLAUDE_PLUGIN_DATA}` survive `clean`?

**Status:** `docs/loader-semantics.md` §7 + `notes/LOADER-SEMANTICS-AUDIT.md`
§2 NEW_RULE_AVAILABLE: `${CLAUDE_PLUGIN_DATA}` lives at
`~/.claude/plugins/data/<mangled-id>/` and is deleted on uninstall from
the last scope unless `--keep-data`.

**Default:** `clean --confirm --yes` MUST NOT touch
`~/.claude/plugins/data/`. v0.2.0 cache-cleanup is scoped strictly to
`~/.claude/plugins/cache/`.

**Default fails when:** A user runs `clean` expecting it to free disk
space and discovers the data dir is the actual culprit. RELOAD HINT
should mention this case:

```
NOTE: <NN MB> of plugin-related data lives under ~/.claude/plugins/data/
(separate from cache). This is plugin state that survives updates per
Claude Code's contract. Housekeeper does not modify it.
```

---

## 10. Five Claude-Code-Specific Risks

Each risk: description, probability under v0.2.0 scope (with this memo's
narrowing applied), severity, mitigation. Probability assumes the refusal
taxonomy of §8 holds.

### 10.1 Risk-A: Mid-session plugin disappearance

**Description:** Concurrent Claude session has loaded plugin X cache
version Y. Housekeeper deletes `~/.claude/plugins/cache/<market>/X/Y/`.
Session's next tool call into X triggers code-load against a missing
path. Claude crashes or returns a fatal error.

**Probability with §8 refusal:** Low. R1 (active version) and R2 (within
grace) refusals cover the documented danger zone. Risk remaining:
long-lived sessions still holding a > 7-day-old version (Q-PLAT-1).

**Severity:** High — user experience is "Claude crashed mid-task" with
no obvious connection to Housekeeper.

**Mitigation:**
1. R2 refusal (grace window) — already in §8.
2. RELOAD HINT for "run `/reload-plugins` in active sessions" — §3.1.
3. v0.2.x release note explicitly recommends users not run `clean` while
   long-running Claude sessions are active.
4. Future v0.3: process-list-based active-session check (Q-PLAT-1
   mitigation).

### 10.2 Risk-B: Settings.json corruption

**Description:** Clean edits `settings.json`, leaves invalid JSON or
loses comments, Claude refuses to start on next launch.

**Probability with §8 refusal:** Near-zero. R3 refusal means v0.2.0
never edits settings.

**Severity:** Critical (Claude does not start) if it ever happens.

**Mitigation:** R3 is the mitigation. The mitigation is "don't do it in
v0.2.0." When v0.3 lifts R3, §5.6 rules S1–S5 become hard requirements.

### 10.3 Risk-C: Stale plugin cache dir is actually a symlink to project workspace

**Description:** A developer (or a damaged install) has replaced a cache
version dir with a symlink to their local plugin development workspace.
`rm -rf` of that "cache version" actually deletes the dev workspace.

**Probability with §8 refusal:** Low — `docs/loader-semantics.md` §3
documents symlink preservation in cache, but the install path is
ordinarily a real directory. However, plugin developers using
`--plugin-dir` per `notes/LOADER-SEMANTICS-AUDIT.md` §4 NEW_RULE_AVAILABLE
may have non-standard layouts.

**Severity:** Catastrophic if it occurs (user's dev workspace gone).

**Mitigation:**
1. Snapshot writer's atomic-write protocol (`docs/snapshot-architecture.md`
   §4) does NOT defend against this — snapshot only copies file bytes
   before deletion; if the deletion follows the symlink, the snapshot
   captured the target bytes but rollback restores them to the symlink
   target which has now been deleted.
2. **Required**: clean MUST use `lstat` (not `stat`) and refuse any
   target whose `isSymbolicLink()` returns true under
   `~/.claude/plugins/cache/`. Symlinks are a Claude-Code-supported
   feature (§3) but Housekeeper does not modify them in v0.2.0.
3. Refusal text:
   ```
   plugin.symlinked_cache (refused — symlink at cache version)
   target: <path>
   reason: This cache version is a symbolic link to <target>. Claude Code
     supports symlinks in cache, but Housekeeper does not modify them in
     v0.2.0.
   next: resolve the link manually or wait for v0.3
   ```

### 10.4 Risk-D: Plugin's `bin/` is on PATH while clean removes it mid-command

**Description:** Plugin X has a `bin/` dir added to Bash PATH per
`docs/loader-semantics.md` §3 ("`bin/` executables are added to Bash
tool PATH while plugin is enabled"). User has a Bash tool invocation
in flight that calls a binary from that path. Clean removes the cache
version dir while the binary is mid-execution.

**Probability with §8 refusal:** Low — R1 refuses active versions. But
PATH may include old versions if Claude's bin-PATH handling is sticky
across plugin updates (undocumented).

**Severity:** Medium — running process gets SIGPIPE or "command not
found" mid-execution. User's Bash invocation fails.

**Mitigation:**
1. R1 covers active versions.
2. RELOAD HINT for cache deletions includes: "If you were running a
   Bash command from this plugin, restart it."
3. Defer to v0.3: bin-PATH-aware detection.

### 10.5 Risk-E: Self-clean (Housekeeper deletes its own SessionStart hook)

**Description:** Housekeeper itself is installed as a plugin. Its
SessionStart hook lives in the plugin's cache version dir. Clean
identifies an old cache version of Housekeeper, deletes it. If that
old version was still in the SessionStart hook command string (because
settings.json points at it), session startup fails.

**Probability with §8 refusal:** Low — Housekeeper installed as a
plugin would appear in `installed_plugins.json` (R1 active-version
refusal). But the SessionStart hook in `hooks/session-start.mjs` uses
`process.execPath` + CLI-relative paths, not `${CLAUDE_PLUGIN_ROOT}`,
which suggests an OOB installation path. If the user has installed
Housekeeper as a plugin AND configured a SessionStart hook pointing
into a specific cache version, R1 covers the active version but not
historical ones.

**Severity:** Medium — session startup fails with a hook error; user
runs `claude --debug hooks` and discovers the missing path.

**Mitigation:**
1. R1 refusal for the active version.
2. **Add a self-detection invariant**: clean MUST refuse to delete any
   cache version dir whose path appears in any hook command string in
   `~/.claude/settings.json`. This is the existing
   `settings.hook_path_dangling` detector inverted — instead of "dangling
   path", it's "non-dangling path currently in use."
3. New finding id: `plugin.cache_referenced_by_hook` with stance
   `protect` (per `docs/loader-semantics.md` §10: "protected" is the
   correct vocabulary).

### 10.6 Risks summary

| Risk | Probability (v0.2.0) | Severity | New code required |
|---|---|---|---|
| A: Mid-session plugin disappearance | Low | High | RELOAD HINT (§3.1) |
| B: Settings.json corruption | Near-zero | Critical | R3 refusal (§8.3) |
| C: Symlink-cache dev workspace deletion | Low | Catastrophic | `lstat` check + refusal (§10.3) |
| D: `bin/` PATH binary disappearance | Low | Medium | RELOAD HINT note |
| E: Self-clean of Housekeeper's hook | Low | Medium | Hook-reference detector (§10.5) |

The two risks requiring new detector logic are **C** (symlink check)
and **E** (hook-reference back-check). Both should land in v0.2.0 as
preconditions to `clean --confirm --yes`.

---

## 11. Concrete v0.2.0 Ship Rules — Bake These In

In dependency order:

1. **R1 (active version) refusal** — implement against
   `installed_plugins.json` parse already in `scripts/lib/audit.mjs`.
2. **R2 (grace window) refusal** — already enforced in
   `scripts/lib/audit.mjs detectPluginExpectedOrphan` vs
   `detectPluginCacheUnreferenced` split. Extend to refuse delete on
   `expected_orphan` findings even when the user passes `--confirm --yes`.
3. **R3 (settings refusal)** — refuse any mutation target whose path
   ends `settings.json`.
4. **R4 (`.mcp.json` refusal)** — refuse any mutation target whose
   basename is `.mcp.json`.
5. **R5 (local skill/command refusal)** — refuse any mutation target
   under `<home>/skills/` or `<home>/commands/` for v0.2.0.
6. **§2.2 lockfile** — acquire/release `<home>/.claude/housekeeper/lock`.
7. **§7.3 MCP-declaring-plugin refusal** — refuse cache-version-dir
   deletion if `<cache_version_dir>/.mcp.json` or
   `<cache_version_dir>/.claude-plugin/plugin.json` declares an MCP
   server.
8. **§10.3 symlink refusal** — `lstat` check on every target.
9. **§10.5 hook-reference detector** — refuse delete if cache dir path
   appears in any settings.json hook command string.
10. **§3.1 RELOAD HINT** — emit after every successful clean run.

---

## 12. What this memo asks of the architect and product lanes

**Architect memo (mutation mechanics):**
- Build the snapshot + apply + verify flow as already specified.
- Wire the §11 ship rules as preconditions inside `takeSnapshot()` per
  `docs/snapshot-architecture.md` §10 pseudocode.
- Do not propose settings.json edits in v0.2.0 (see §5 — defer to v0.3).
- Do not propose `process.kill` against non-Housekeeper PIDs (see §7.4).
- Wire `housekeeper.interrupted_operation` recovery to `rollback <id>`
  per v0.2 Q3 decision; do not auto-resolve.

**Product memo (consent + framing):**
- The consent UX for `clean --confirm --yes` must surface every refusal
  category from §8 with the exact text and "next" line.
- The plan-output renderer must emit RELOAD HINT per §3.1 for verified
  operations.
- Confirm the SessionStart stderr line stays as-is per §6.3.
- Confirm `/reload-plugins` is user-invoked, never Housekeeper-invoked
  (§3.2).
- Confirm the `~/.claude/plugins/data/` exclusion is surfaced in
  user-facing docs (§9.7).

**The synthesizer:** these three lanes must converge on the §11 rule
list. If any one of those rules is dropped during synthesis, the v0.2.0
ship surface is broader than the doc set can defend.

---

## Appendix A — Loader semantics paragraph citation index

| This memo § | `docs/loader-semantics.md` § | Specific claim |
|---|---|---|
| §1.1 P3 | §2 | Plugins enabled via settings; installed registry is the key |
| §1.1 P4, §8.2 R2, §10.1 | §2 + §7 | 7-day grace window for concurrent sessions |
| §1.1 P5, §7.1 | §6 | Enabled plugin MCP starts at session startup |
| §3 reload matrix | §5 (hook merge order) + §6 (`/reload-plugins`) + §7 (`${CLAUDE_PLUGIN_ROOT}` changes on update) | Reload timing per change kind |
| §4.1 timeout/stderr | §8 + `hooks/session-start.mjs` | SessionStart should be fast |
| §4.2 | §8 + golden report #10 | SessionStart surfaces, doesn't recover |
| §5.1 | §1 | Settings precedence Managed > CLI > Local > Project > User |
| §5.4 | §9.1 | `/doctor`, `claude --debug hooks` are user-invoked probes |
| §7.1 facts 1–5 | §6 | Plugin MCP lifecycle |
| §8.3 R3 | §1 + §5 | Settings + hook merge undocumented |
| §8.4 R4 | §6 | `.mcp.json` shared via version control |
| §8.5 R5 | `notes/LOADER-SEMANTICS-AUDIT.md` §4 NEW_RULE_AVAILABLE | Skill watcher live |
| §9.7, §10.4 | §3 | `bin/` on PATH while plugin enabled |
| §10.3 | §3 | Symlinks preserved in cache |

All citations are to paragraphs that survived the 2026-05-10 audit
(`notes/LOADER-SEMANTICS-AUDIT.md` STILL_ACCURATE entries) or to CHANGED
entries whose updated form is reflected in this memo.

---

## Appendix B — Why this memo is conservative

The operator's own `CLAUDE.md` (project root) says:
> "Touch only what you must. Clean up only your own mess."
> "No features beyond what was asked."

The operator's global `CLAUDE.md` describes parallel agent fleets
running OMC autopilot, ECC hooks, Codex rescue, and worktree-based
agents simultaneously. That environment is exactly the multi-session
case §2.1 worries about. A v0.2.0 ship that ignores §2 would,
predictably, be the first thing the operator's own toolchain breaks.

Conservatism here is not abstract risk aversion. It is the load-bearing
constraint that v0.2.0 must hold for the people most likely to run it
first.
