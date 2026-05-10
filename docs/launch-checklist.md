# Launch Checklist

## Repository

- Initialize git in this directory.
- Commit one logical scaffold change.
- Create `hemzaz/claude-housekeeper`.
- Push `main`.
- Enable GitHub Pages from the `docs/` directory.
- Add repository topics: `claude-code`, `claude-plugin`, `developer-tools`, `diagnostics`.
- Keep the first public tag framed as a read-only home-inspection preview.

## Required Before Public Announcement

- `npm test` passes.
- `npm run lint` passes.
- `npm run format` passes.
- `claude plugin validate .claude-plugin/plugin.json` passes.
- `npm pack --dry-run` contains only intended files.
- README documents the read-only limitation clearly.
- README and site lead with the first wedge: broken hooks and plugin cache drift.
- README and site say "No files changed" for diagnose/plan.
- README and site avoid deletion-authority language.
- README and site explain that Claude checkpointing is not Housekeeper rollback.
- `clean`, `harden`, and `rollback` refusal paths say that no files were changed.
- Issue templates exist for false positive reports and cleanup requests.
- `operational-readiness.md` gates are either satisfied or explicitly waived.

## CI

Run on every pull request:

- Node test suite on the current LTS and latest Node.
- Syntax lint.
- Format check.
- Plugin manifest validation when `claude` is available.
- Package dry-run with an isolated npm cache.

## GitHub Pages

Use `docs/index.html` as the first site. It should show:

- The product promise.
- A stance-first report example.
- The safety model.
- The first wedge.
- Current commands.
- Current status versus roadmap.

Do not over-design the site. This is a developer tool; the product artifact is the CLI output.

## Suggested Repo Description

Read-only Claude Code home inspection for broken hooks, plugin cache drift, and protected local state.

## Suggested First Release Notes

```md
## v0.1.0 - Read-only home inspection preview

Claude Housekeeper now provides a conservative first pass at Claude Code home inspection.

- Adds `diagnose` output for the current broad scanner.
- Adds `plan` with concrete paths and proposed next steps.
- Adds the framework docs for surface classification, evidence keys, stances, and rollback boundaries.
- Defines the first wedge: safe diagnosis of broken hooks and plugin cache drift.
- Adds a Claude plugin command wrapper and local Node CLI.
- Keeps `clean`, `harden`, and `rollback` read-only until snapshot and rollback support land.

No cleanup mutation is implemented in this release.
```

## Release Readiness

Version `0.1.0` should be tagged only after:

- `clean` still refuses mutation or snapshot-backed mutation is fully implemented.
- All refusal messages are explicit.
- First-wedge docs are internally consistent.
- Acceptance cards exist for broken hook, expected orphan, candidate stale cache, protected secret path, invalid settings, degraded scan, and checkpoint-only rollback.
- Golden reports exist for the first wedge.
- Compatibility matrix exists for the tested Claude Code versions and OSes.
- Release blockers have been checked.
- Public promise matches README, package listing, plugin listing, and site.
- Real-world diagnose output has been reviewed for false positives.
- Known limitations are listed in the README.
