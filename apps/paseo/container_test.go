package main

import (
	"testing"

	helpers "github.com/tscibilia/containers/tests"
)

func Test(t *testing.T) {
	image := helpers.GetTestImage("ghcr.io/tscibilia/paseo:rolling")

	helpers.RequireFileExists(t, image, "/usr/local/bin/paseo-start")
	helpers.RequireFileExists(t, image, "/opt/omp-plugins/omp-plugins.lock.json")
	helpers.RequireCommandSucceeds(t, image, nil, "/usr/local/bin/paseo", "--version")
	helpers.RequireCommandSucceeds(t, image, nil, "/opt/bun/bin/omp", "--version")
	helpers.RequireCommandSucceeds(t, image, nil, "/opt/bun/bin/opencode", "--version")
	helpers.RequireCommandSucceeds(t, image, nil, "/opt/bun/bin/omp", "plugin", "list")
	helpers.RequireCommandSucceeds(t, image, nil, "/usr/local/bin/mise", "--version")
	helpers.RequireCommandSucceeds(t, image, nil, "/usr/bin/git", "--version")
	helpers.RequireCommandSucceeds(t, image, nil, "/usr/bin/rg", "--version")
	helpers.RequireCommandSucceeds(t, image, nil, "/opt/mise/shims/kubectl", "version", "--client")
	helpers.RequireCommandSucceeds(t, image, nil, "/opt/mise/shims/flux", "version", "--client")
	helpers.RequireCommandSucceeds(t, image, nil, "/opt/mise/shims/kustomize", "version")
	helpers.RequireCommandSucceeds(t, image, nil, "/opt/mise/shims/sops", "--version")
	helpers.RequireCommandSucceeds(t, image, nil, "/opt/mise/shims/node", "--version")
	helpers.RequireCommandSucceeds(t, image, nil, "/opt/mise/shims/pnpm", "--version")
	helpers.RequireCommandSucceeds(t, image, nil, "/opt/mise/shims/python", "--version")
	helpers.RequireCommandSucceeds(t, image, nil, "/opt/mise/shims/go", "version")
	helpers.RequireCommandSucceeds(t, image, nil, "/opt/mise/shims/minijinja-cli", "--version")
	helpers.RequireCommandSucceeds(t, image, nil, "/opt/mise/shims/ansible-playbook", "--version")
	helpers.RequireCommandSucceeds(t, image, nil, "/opt/mise/shims/kubectl-browse-pvc", "--version")
	helpers.RequireCommandSucceeds(t, image, nil, "/opt/mise/shims/kubectl-kopiur", "--version")
	helpers.RequireCommandSucceeds(t, image, nil, "/usr/local/bin/akeyless", "--version")
}
