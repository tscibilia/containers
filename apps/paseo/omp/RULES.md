# Host-wide agent rules

Commit and push with `git` and `gh` directly — stage explicit paths
(`git add <path>`), never the eval-based `commit` helper. Two reasons, both
verified on this host: `tools.approval.eval` is `prompt`, so every eval call
stops for approval; and the helper builds via `commit-tree`, producing
unsigned commits even though `commit.gpgsign=true` (plain `git commit` signs
with the SSH key).
