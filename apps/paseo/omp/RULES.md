# Agent rules (all repos)

- Never read, decode, decrypt, or print a secret or credential value from any
  store: Kubernetes Secrets, aKeyless, SOPS, Talos, app databases, config files,
  `.env`, volumes, or backups. Inspect metadata only: names, keys, lengths,
  hashes, existence. If a value reaches output, say so, stop, and rotate at the
  source.
- The secret guard blocks value reads and returns an error. Route around it:
  use the tool that consumes the secret (`git`, `gh`, `kubectl`, `flux`,
  `talosctl`, `just`) or a metadata projection from the repo's docs. Never
  retry a blocked call or rewrite it to defeat the guard.
- Commit and push with `git` and `gh` directly — stage explicit paths
  (`git add <path>`), never the eval-based `commit` helper: it builds via
  `commit-tree` and produces unsigned commits even though `commit.gpgsign=true`
  (plain `git commit` signs with the SSH key). Follow the repository's commit
  protocol; when it says commit, commit.
- Do not commit, push, or open a PR unless the task asks for it. Ask before
  destructive or hard-to-reverse actions.
- Read the repo's `AGENTS.md` and `.omp/RULES.md` first; they override this file
  for repo-specific work.
