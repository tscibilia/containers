# containers

Standalone image build repo for `tscibilia`. The automation is the same shape as
[`home-operations/containers`](https://github.com/home-operations/containers):
`apps/<name>/` holds a `Dockerfile`, `docker-bake.hcl`, and a
`container_test.go`; the `app-builder` workflow builds each changed app on
`linux/amd64`, runs its test, and publishes `ghcr.io/tscibilia/<name>`.

## Apps

| App     | Image                     | Source                                                |
| ------- | ------------------------- | ----------------------------------------------------- |
| `paseo` | `ghcr.io/tscibilia/paseo` | [`getpaseo/paseo`](https://github.com/getpaseo/paseo) |

`paseo` is a child of the upstream daemon image. It adds OMP, OpenCode, Bun,
Node, Python/uv, Go, mise, akeyless, ansible-core, and the home-ops toolset so
the in-cluster daemon can run agents and validate repositories.

## Build locally

```bash
mise install
mise run local-build paseo
```

`mise run local-build` requires Docker with Buildx. The release workflow runs
the same bake and test on push to `main`.

## Renovate

`.github/workflows/renovate.yaml` runs every 12 hours as the Kube Skywalker
GitHub App. It reads `.renovaterc.json5` and opens PRs.

Dependencies covered:

- `docker-bake.hcl`: upstream paseo image, Bun, OpenCode, OMP, pi-memini, mise
- `Dockerfile`: akeyless CLI
- `apps/paseo/mise.toml` and `.mise/config.toml`: all mise tools
- `go.mod` and GitHub Actions

App updates auto-merge after CI passes. The release workflow rebuilds the
changed app.
