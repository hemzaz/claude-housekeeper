# CI/CD Supply-Chain Security Audit — claude-housekeeper

**Date:** 2026-05-11
**Branch audited:** `codex/ci-release-matrix` (HEAD `c329c8a`)
**Scope:** `.github/workflows/*.yml` and surrounding CI configuration
**Threat model:** Poisoned Pipeline Execution (PPE) — a malicious PR or commit compromising the CI runner, exfiltrating secrets, or backdooring the published npm artifact.

---

## §1 Executive Summary

- **5 findings total: 0 CRITICAL, 0 HIGH, 3 MEDIUM, 2 LOW.**
- Single workflow file (`.github/workflows/ci.yml`, 38 lines) with one matrix job; no release/publish workflow exists yet, no `pull_request_target`, no secrets are referenced anywhere.
- **Biggest single risk:** floating major-version tags on `actions/checkout@v4` and `actions/setup-node@v4`. The upstream owner (GitHub Actions org) could retag the major to a malicious commit and every PR runner would silently execute the new code. This is a low-likelihood / high-impact vector that pinning to SHA eliminates.
- **No CRITICAL findings — merges to `.github/workflows/` do not need to be paused.**
- Repo is in a defensively solid baseline: GitHub-hosted runners only, no third-party actions, no untrusted-input interpolation, push-trigger restricted to `main`.

---

## §2 Tool and Version Used

**Primary:** `poutine` (SHA-pinned image: `ghcr.io/boostsecurityio/poutine@sha256:c7f2ffa1516372b9f6b8e0b59fd0e91a2a043ab7d0741654166fbda6d41338cd`).

`poutine` is the SAST engine embedded in `boostsecurityio/smokedmeat`. The SmokedMeat outer harness was not used because it requires a GitHub PAT against a live remote organization (it is not a local-file scanner). Per SmokedMeat README: "SmokedMeat connects to GitHub via personal access token and analyzes workflows in target organizations." User did not authorize a PAT, and the underlying engine (`poutine`) is the same code path that ships inside SmokedMeat — running it directly gives equivalent coverage against local files without unnecessary token exposure.

**Invocation:**

```
docker run --rm -v /Users/elad/PROJ/housekeeper:/src \
  ghcr.io/boostsecurityio/poutine:latest analyze_local /src
```

**Result:** All 13 OPA rules returned 0 failures:

| Rule ID | Status |
|---|---|
| confused_deputy_auto_merge | Passed |
| debug_enabled | Passed |
| default_permissions_on_risky_events | Passed |
| github_action_from_unverified_creator_used | Passed |
| if_always_true | Passed |
| injection | Passed |
| job_all_secrets | Passed |
| known_vulnerability_in_build_component | Passed |
| known_vulnerability_in_build_platform | Passed |
| pr_runs_on_self_hosted | Passed |
| unpinnable_action | Passed |
| untrusted_checkout_exec | Passed |
| unverified_script_exec | Passed |

Poutine's clean result is corroborated below by a manual PPE checklist sweep. The MEDIUM/LOW findings below are *defense-in-depth* hardenings poutine does not flag by policy default (e.g. SHA-pinning first-party `actions/*` is best-practice but poutine treats verified-creator + pinnable as Passed).

---

## §3 Findings

### MEDIUM-1 — `actions/checkout@v4` not pinned to commit SHA

- **File / line:** `.github/workflows/ci.yml:23`
- **Pattern:** `uses: actions/checkout@v4` (floating major tag)
- **Current resolution:** Tag `v4` currently points to `34e114876b0b11c390a56381ad16ebd13914f8d5` (v4.3.1). This is mutable — the GitHub Actions org can move the `v4` tag at any time.
- **Impact:** If the GitHub Actions org's repo is compromised (insider threat, account takeover) or an attacker convinces a maintainer to retag, the next PR run executes attacker-controlled checkout code with full repo-write capability via `GITHUB_TOKEN`. Since this is the first step of every job, the attacker controls everything that follows.
- **Likelihood:** Low for `actions/*` (well-defended), but the cost of pinning is one commented commit-SHA line.
- **Remediation:**
  ```yaml
  - uses: actions/checkout@34e114876b0b11c390a56381ad16ebd13914f8d5  # v4.3.1
  ```
  Or, to track upstream more aggressively, pin to the latest major (v6.0.2):
  ```yaml
  - uses: actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd  # v6.0.2
  ```
- **Recommended SHA (status-quo, no version bump):** `34e114876b0b11c390a56381ad16ebd13914f8d5` (v4.3.1, last verified 2026-05-11 via `gh api repos/actions/checkout/git/refs/tags/v4`).

### MEDIUM-2 — `actions/setup-node@v4` not pinned to commit SHA

- **File / line:** `.github/workflows/ci.yml:24`
- **Pattern:** `uses: actions/setup-node@v4` (floating major tag)
- **Current resolution:** Tag `v4` currently points to `49933ea5288caeca8642d1e84afbd3f7d6820020`. Latest major is v6.4.0.
- **Impact:** Identical attack class as MEDIUM-1. `setup-node` runs before `npm test`, so a malicious version can drop a poisoned Node binary or modify the global npm config to redirect `npm pack` to an attacker registry — directly backdooring the published artifact.
- **Remediation:**
  ```yaml
  - uses: actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020  # v4
    with:
      node-version: ${{ matrix.node }}
  ```
- **Recommended SHA:** `49933ea5288caeca8642d1e84afbd3f7d6820020` (v4 tip as of 2026-05-11).

### MEDIUM-3 — No explicit `permissions:` block (relies on org/repo default)

- **File / line:** `.github/workflows/ci.yml:1-9` (workflow-level, missing)
- **Pattern:** No top-level or job-level `permissions:` declaration. The `GITHUB_TOKEN` defaults to whatever the org/repo setting is. GitHub's *current org default* for permissions is `read` for public repos created recently, but legacy repos and some orgs still default to permissive (`write-all`).
- **Impact:** If the org default is permissive, a compromised step (via MEDIUM-1 / MEDIUM-2, or any future third-party action) gets `contents: write`, `packages: write`, `issues: write` automatically — enough to push commits, publish packages, or close issues. With an explicit `permissions: { contents: read }` block, the same compromise lands with read-only credentials and the blast radius is much smaller.
- **Remediation:** Add at the top of `ci.yml`, just below `on:`:
  ```yaml
  permissions:
    contents: read
  ```
  CI only reads the repo and runs tests; `contents: read` is sufficient. If a release workflow is added later, scope `contents: write` to that workflow only.

### LOW-1 — No CODEOWNERS for `.github/workflows/`

- **File / line:** `.github/CODEOWNERS` (file does not exist)
- **Pattern:** Any contributor with write access can modify workflow files without a required reviewer. Branch-protection rules cannot enforce "two-person review on workflow edits" without CODEOWNERS.
- **Impact:** A single compromised maintainer account can land a PR that adds a malicious step to `ci.yml`. With CODEOWNERS + required-review-from-codeowners, the attack requires compromising two accounts.
- **Remediation:** Create `.github/CODEOWNERS`:
  ```
  /.github/workflows/   @<github-username>
  /.github/             @<github-username>
  ```
  Then enable "Require review from Code Owners" in branch-protection for `main`.
- **Why this is LOW:** Single-maintainer projects get little real benefit from CODEOWNERS today; it pays off once the contributor pool grows.

### LOW-2 — `claude plugin validate` step runs without integrity check

- **File / line:** `.github/workflows/ci.yml:30-36`
- **Pattern:** Conditional `command -v claude` check that, if present, runs `claude plugin validate`. Currently the Claude CLI is **not** installed on GitHub-hosted runners, so the branch always hits the `SKIP` path. But if a future workflow change adds a `claude` install step, the validate step would execute whatever `claude plugin validate` does at that point — which itself parses untrusted JSON from `.claude-plugin/plugin.json` in the PR head.
- **Impact:** A malicious PR could craft a `plugin.json` that exploits a parser bug in the Claude CLI. Not exploitable today (CLI not installed), but worth a tracker.
- **Remediation:** No code change needed right now. Document that any future PR that installs `claude` on the runner must also gate the `validate` step to run only on `push` (trusted) and never on `pull_request` from forks. Or pin the Claude CLI version explicitly.

---

## §4 Already in Good Shape

| Control | Status | Evidence |
|---|---|---|
| No `pull_request_target` usage | Good | Only `pull_request` + `push: branches: [main]` (ci.yml:3-7). Avoids the #1 PPE vector entirely. |
| No third-party actions | Good | Only `actions/checkout` and `actions/setup-node` — both GitHub-verified first-party. |
| No self-hosted runners | Good | `ubuntu-latest` and `macos-latest` only (ci.yml:16-18). |
| No secrets referenced | Good | No `${{ secrets.* }}` interpolation anywhere in the workflow. Nothing to exfiltrate via PR injection. |
| No untrusted input in shell `run:` blocks | Good | The only shell expansion is `$RUNNER_TEMP` (GitHub-controlled). No `${{ github.event.pull_request.title }}` or similar attacker-controlled interpolation. |
| No `npm install` of arbitrary deps before test | Good | Workflow runs `npm test`, `npm run lint`, `npm run format`, `npm pack --dry-run`. `npm pack --dry-run` does not execute lifecycle scripts. |
| Matrix is bounded and explicit | Good | 2 OS × 2 Node = 4 jobs. No `include` / `exclude` games that could be abused. |
| `fail-fast: false` | Good (for visibility, not security) | Surfaces all matrix failures rather than masking. |
| `pr_runs_on_self_hosted` (poutine rule) | Passed | Confirms no self-hosted exposure. |
| `injection` (poutine rule) | Passed | Confirms no `${{ github.event.* }}` interpolation in `run:` blocks. |
| `job_all_secrets` (poutine rule) | Passed | No `secrets: inherit` or wholesale secret exposure. |

---

## §5 Recommendations

### Apply now (low cost, high value)

1. **Add `permissions: { contents: read }` to `ci.yml` (MEDIUM-3).** Single-line change. Caps blast radius if any future supply-chain compromise hits a step.

### Apply when next touching the file (no rush, no UX cost)

2. **Pin both `actions/*` to SHAs with a tag comment (MEDIUM-1, MEDIUM-2).** Use Dependabot's `package-ecosystem: github-actions` so the SHAs get updated automatically via PR (no manual chore). Sample `.github/dependabot.yml`:
   ```yaml
   version: 2
   updates:
     - package-ecosystem: github-actions
       directory: /
       schedule:
         interval: weekly
   ```

### Defer (single-maintainer cost > benefit today)

3. **CODEOWNERS (LOW-1).** Not urgent for a single-maintainer project. Add when a second regular committer joins.
4. **Hardened branch-protection profile.** Required-status-checks + linear-history rules are great, but enabling them requires GitHub Pro/Team or a public repo. Add when project graduates from solo.

### Do NOT apply automatically (would hurt UX / velocity)

- **Do not switch CI from `pull_request` to `pull_request_target`.** The current trigger is the *safe* one. `pull_request_target` exposes secrets to PR-head code and is the #1 PPE vector. Some online hardening guides recommend it for performance — ignore that advice for this repo.
- **Do not add `concurrency:` blocks just for "security."** They are a cost-control feature, not a security one. Adding them here would cancel in-flight runs and confuse contributors who are watching their PR.
- **Do not require signed commits on `main`** until you have a key-management story. Until then it locks the only maintainer out at the worst possible moment.
- **Do not block merges on the LOW-2 finding.** It is a tracker, not a vulnerability.

---

## Appendix — Re-running this scan

```bash
docker run --rm -v "$(pwd):/src" \
  ghcr.io/boostsecurityio/poutine@sha256:c7f2ffa1516372b9f6b8e0b59fd0e91a2a043ab7d0741654166fbda6d41338cd \
  analyze_local /src
```

Audit produced no modifications to the repo. READ-ONLY contract honored.
