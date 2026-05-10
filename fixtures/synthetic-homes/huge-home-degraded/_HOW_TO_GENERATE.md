# Fixture loader: huge-home-degraded

This fixture intentionally ships only 30 representative shards under
`home/.claude/projects/syn-session-001/`. To exercise the scan-budget
detector (T-402, default `maxFiles: 5000`), the fixture loader must
multiply the seeds at test time so the audit hits its budget before
finishing traversal.

## What the loader must do

Before invoking `auditClaudeHome` on this fixture's `home/`:

1. Read every `shard-*.json` file under
   `home/.claude/projects/syn-session-001/` (the 30 committed seeds).
2. For each seed, write `N` additional copies into the same directory
   with names `shard-<seq>-copyNN.json`, where `seq` is the original
   seed's sequence number and `NN` is the copy index.
3. Choose `N` so total file count exceeds the audit's `maxFiles`
   budget by at least 20% (default budget is 5000, so create roughly
   6000 total files: 200 copies of each of the 30 seeds).
4. Optionally fan out into more `syn-session-NNN/` directories if the
   detector also tests per-directory caps.
5. After the audit run, the loader must clean up the generated copies
   so subsequent runs see only the committed seeds.

## Why this design

- Git would balloon if 6000 tiny JSON files were committed, hurting
  every clone, diff, and review.
- The 30 seeds are enough to verify content shape (each has
  `{type, seq, role, content}` with synthetic `syn-message-NN` body)
  and per-shard parsing.
- The generated copies have identical shape, so the audit's traversal
  and budget logic see a realistic distribution without surprising
  parser corner cases.

## Synthetic content note

All shards contain only synthetic placeholder content. No real
session transcripts, usernames, or paths appear. Every `content`
value matches the pattern `syn-message-NN`.

## Expected audit result

With multiplied shards in place, the audit must:

- emit a single `home.scan_budget_hit` finding (id may differ in code;
  see `docs/golden-reports.md` §8)
- mark `degraded: yes` in the SCAN section
- list `~/.claude/projects` as the path where traversal stopped
- list `remaining project history after budget` in the `skipped`
  field
- block actions like `summarize scan as complete` and
  `propose action from partial project-history evidence`
