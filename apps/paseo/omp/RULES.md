# Host-wide agent rules

Commit and push with `git` and `gh` directly — stage explicit paths
(`git add <path>`), never the eval-based `commit` helper: it builds via
`commit-tree` and produces unsigned commits even though `commit.gpgsign=true`
(plain `git commit` signs with the SSH key).
