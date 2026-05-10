# symlinked-home fixture

`home/.claude/commands/local-build.md` is a relative symlink whose target
(`../../../outside-home-root/local-build.md`) resolves outside the simulated
home root (`home/`) but stays inside this fixture directory. A non-dangling
target lets `node --test` walk the tree on CI without I/O errors; the
classification semantics (target outside the observed home) are unchanged.

## Runner contract

- Walkers MUST detect the symlink without dereferencing it.
- Reports MUST cite both the observed path (`~/.claude/commands/local-build.md`)
  and the resolved target as `<outside-home>` / unknown.
- `scopeClass` for the symlinked path is `parent-contains-boundary`.
- The symlink is committed with git mode `120000`. Verify with
  `git ls-tree HEAD home/.claude/commands/local-build.md`.
