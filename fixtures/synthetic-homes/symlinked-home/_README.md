# symlinked-home fixture

`home/.claude/commands/local-build.md` is a relative symlink whose target
(`../../../../outside-fixture-root/local-build.md`) resolves outside the
simulated home root. The target file does not exist and intentionally
must not be created.

## Runner contract

- Walkers MUST detect the symlink without dereferencing it.
- Reports MUST cite both the observed path (`~/.claude/commands/local-build.md`)
  and the resolved target as `<outside-home>` / unknown.
- `scopeClass` for the symlinked path is `parent-contains-boundary`.
- The symlink is committed with git mode `120000`. Verify with
  `git ls-tree HEAD home/.claude/commands/local-build.md`.
