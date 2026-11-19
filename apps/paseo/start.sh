#!/usr/bin/env bash
set -euo pipefail
umask 077

: "${PASEO_PASSWORD:?PASEO_PASSWORD must be set and non-empty}"
: "${LITELLM_API_KEY:?LITELLM_API_KEY must be set and non-empty}"
: "${GH_TOKEN:?GH_TOKEN must be set and non-empty}"
: "${MEMINI_API_KEY:?MEMINI_API_KEY must be set and non-empty}"

export PASEO_HOME="${PASEO_HOME:-/home/paseo/.paseo}"
OPENCODE_CONFIG_DIR="${HOME}/.config/opencode"
OMP_CONFIG_DIR="${HOME}/.omp/agent"

mkdir -p \
  "${PASEO_HOME}" \
  "${OPENCODE_CONFIG_DIR}" \
  "${OMP_CONFIG_DIR}" \
  "${HOME}/.ssh" \
  "${HOME}/.config/gh" \
  "${HOME}/.cache" \
  "${HOME}/.local/share" \
  /workspace/worktrees

install -m 600 /etc/paseo/paseo.json "${PASEO_HOME}/config.json"
install -m 600 /etc/paseo/opencode.json "${OPENCODE_CONFIG_DIR}/opencode.json"
install -m 600 /etc/paseo/omp-config.yml "${OMP_CONFIG_DIR}/config.yml"
install -m 600 /etc/paseo/omp-models.yml "${OMP_CONFIG_DIR}/models.yml"
install -m 600 /etc/paseo/signing_key "${HOME}/.ssh/paseo_signing"

# The plugin lives outside /home/paseo in the image because the PVC hides the
# image's home directory at runtime. Copy it into the writable home so OMP
# loads the version that ships with this image. The lockfile comparison keeps a
# 159 MB plugin tree from being recopied on every pod restart.
if [ -d /opt/omp-plugins ]; then
  if ! cmp -s /opt/omp-plugins/omp-plugins.lock.json "${HOME}/.omp/plugins/omp-plugins.lock.json"; then
    rm -rf "${HOME}/.omp/plugins"
    cp -a /opt/omp-plugins "${HOME}/.omp/plugins"
  fi
fi

# Paseo's base entrypoint hashes PASEO_PASSWORD, prepares HOME, and drops to
# uid 1000. Keep that behavior instead of starting the daemon directly.
exec /usr/local/bin/paseo-docker-entrypoint
