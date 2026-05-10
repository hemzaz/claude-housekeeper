# /local-build (synthetic out-of-home target)

This file represents the resolved target of the symlink at
`home/.claude/commands/local-build.md`. It deliberately lives OUTSIDE
the simulated Claude home root (`home/`).

Housekeeper walkers MUST NOT dereference the symlink and reach this
file by default; surfacing it as a finding requires explicit traversal
consent (see card.yaml `evidence.missing`).
