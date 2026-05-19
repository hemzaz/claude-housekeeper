# Taskboard — v0.4.1 (post-v0.4.0 backlog drain)

Status: in flight.
Driver: v0.4.0 carry-overs surfaced at GA shipping (2026-05-19).
Target: v0.4.1 patch release covering items executable without
runtime-data or hardware verification gates.

---

## Scope decision (recorded at kickoff)

| ID | Item | Source | Verdict |
|---|---|---|---|
| B1 | `release.yml` `--prerelease` for `-` tags | v0.4.0 ship log | **execute** — small workflow change, no design gate |
| B2 | `mcp-rewrite-foreign-owner` refusal class (T10b) | `docs/threat-model.md §10.2`, `docs/design/v0.4-design.md §3.2 step 4` | **execute** — refusal class is additive; uid check via `statSync(newPath).uid !== process.getuid()` is well-defined |
| PQ-1 | Skill-index canonical location | `docs/design/v0.4-design.md §9` | **defer** — requires runtime verification across Claude versions; no code change until divergence observed |
| PQ-2 | Plugin uninstall mutation kind | `docs/design/v0.4-design.md §3.3 + §8` | **defer to v0.4.2 design pass** — explicit 30-day data-collection window per design; shipping now violates the gating intent |
| PQ-3 | `MNT_LOCAL` correctness on APFS-over-SMB | `docs/design/v0.4-design.md §9`, `docs/threat-model.md §5` | **defer** — requires SMB-mounted APFS hardware to verify; opens only when telemetry from a real such mount appears |

---

## Phase 1 — release-workflow hygiene

- [ ] **T-x01** `.github/workflows/release.yml`: pass `--prerelease`
      to `gh release create` (and `gh release edit`) when the tag
      ref contains a `-` (e.g. `-beta`, `-alpha`, `-rc`).
  - Verify: `gh release view v0.4.0-beta.1` would have shown
    `isPrerelease: true` if this had shipped before v0.4.0-beta.1
    was tagged. No regression for stable tags (no `-`).

---

## Phase 2 — `mcp-rewrite-foreign-owner` (T10b)

- [ ] **T-x02a** `scripts/lib/harden-plan.mjs`:
  - Add `"mcp-rewrite-foreign-owner"` entry to `NEXT_STEP_BY_REASON`.
  - Insert uid check between `mcp-rewrite-target-not-executable`
    (line 612) and `mcp-rewrite-source-not-found` (line 614). Use
    the already-captured `newStat` to avoid a second `statSync`
    call.
  - Wire `safeAppendRefusal(home, finding.id, "mcp-rewrite-foreign-owner", tp)`.

- [ ] **T-x02b** `test/mcp-rewrite.test.mjs`: add 1+ test for the
      new refusal class. Use a system binary owned by uid 0 (e.g.
      `/bin/ls` on Linux/macOS) as the rewrite target. Skip when
      the test runner itself is uid 0.

- [ ] **T-x02c** `docs/threat-model.md §10.2 T10b`: remove the
      "not yet implemented" paragraph; record the refusal class as
      shipped in v0.4.1. Keep the residual-risk language about
      TOCTOU between stat and apply.

- [ ] **T-x02d** `docs/design/v0.4-design.md §5` (refusal taxonomy):
      add the new refusal-class row; the §3.2 step 4 design text
      already exists.

---

## Phase 3 — deferred-item documentation

- [ ] **T-x03** Document PQ-1, PQ-2, PQ-3 deferral with explicit
      re-open gates inside this taskboard's scope table (already
      done above). v0.4.2 design pass owns PQ-2 reactivation.

---

## Phase 4 — release prep

- [ ] **T-x04** `package.json` + `.claude-plugin/plugin.json` → `0.4.1`.
- [ ] **T-x05** `CHANGELOG.md` `[0.4.1]` entry with `Added`
      (`mcp-rewrite-foreign-owner` refusal class) and `Changed`
      (release workflow tags prereleases).
- [ ] **T-x06** `docs/index.html` version-pin → `v0.4.1`.
- [ ] **T-x07** `docs/compatibility-matrix.md`: rename `v0.4.0
      surface` → `v0.4.0 / v0.4.1 surface` (same matrix; the
      `mcp-rewrite-foreign-owner` row is the only addition).
- [ ] **T-x08** Full test suite green (`npm test`), lint green,
      release-checker PASS.
- [ ] **T-x09** Open release PR, squash-merge, tag `v0.4.1`,
      verify release workflow + GitHub release.
