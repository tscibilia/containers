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
  "${HOME}/.akeyless/profiles" \
  "${HOME}/.cache" \
  "${HOME}/.local/share" \
  /workspace/worktrees

# Merge UI-installed plugin keys from the PVC's config.json into the GitOps
# copy. Declared keys win; a corrupt live file falls back to the plain install.
if [[ -f "${PASEO_HOME}/config.json" ]] && jq -e . "${PASEO_HOME}/config.json" >/dev/null 2>&1; then
  jq -s '
    .[0] as $gitops
    | .[1] as $live
    | $gitops + (
        { pluginsEnabled: $live.pluginsEnabled, plugins: $live.plugins }
        | with_entries(select(.value != null))
        | with_entries(select($gitops[.key] == null))
      )
  ' /etc/paseo/paseo.json "${PASEO_HOME}/config.json" > "${PASEO_HOME}/config.json.next"
  mv -f "${PASEO_HOME}/config.json.next" "${PASEO_HOME}/config.json"
else
  install -m 600 /etc/paseo/paseo.json "${PASEO_HOME}/config.json"
fi
install -m 600 /etc/paseo/opencode.json "${OPENCODE_CONFIG_DIR}/opencode.json"
install -m 600 /etc/paseo/omp-config.yml "${OMP_CONFIG_DIR}/config.yml"
install -m 600 /etc/paseo/omp-models.yml "${OMP_CONFIG_DIR}/models.yml"
install -m 600 /etc/paseo/signing_key "${HOME}/.ssh/paseo_signing"

# Reinstall host agent policy from the image: RULES.md for OMP and OpenCode,
# plus the shared secret-guard hook and plugin.
if [ -d /opt/omp ]; then
  install -d -m 700 "${OMP_CONFIG_DIR}/hooks/pre"
  install -m 600 /opt/omp/RULES.md "${OMP_CONFIG_DIR}/RULES.md"
  install -m 600 /opt/omp/RULES.md "${OPENCODE_CONFIG_DIR}/AGENTS.md"
  install -m 600 /opt/omp/hooks/pre/secret-guard.ts "${OMP_CONFIG_DIR}/hooks/pre/secret-guard.ts"
fi
if [ -d /opt/opencode ]; then
  install -d -m 700 "${OPENCODE_CONFIG_DIR}/plugin"
  install -m 600 /opt/opencode/plugin/secret-guard.ts "${OPENCODE_CONFIG_DIR}/plugin/secret-guard.ts"
fi

# The image's /home/paseo is hidden by the PVC. Seed a profile so the CLI never
# starts its interactive first-use wizard.
if [[ ! -f "${HOME}/.akeyless/settings" ]]; then
  printf 'dns="vault.akeyless.io"\nprotocol="https"\n' > "${HOME}/.akeyless/settings"
fi
if [[ ! -f "${HOME}/.akeyless/profiles/default.toml" ]]; then
  printf '["default"]\n  access_type = "access_key"\n  access_id = ""\n  access_key = ""\n' > "${HOME}/.akeyless/profiles/default.toml"
fi
chmod 700 "${HOME}/.akeyless" "${HOME}/.akeyless/profiles"
chmod 600 "${HOME}/.akeyless/settings" "${HOME}/.akeyless/profiles/default.toml"

if [[ -n "${AKEYLESS_ACCESS_ID:-}" && -n "${AKEYLESS_ACCESS_KEY:-}" ]]; then
  args=(
    --profile default
    --access-id "${AKEYLESS_ACCESS_ID}"
    --access-key "${AKEYLESS_ACCESS_KEY}"
    --access-type access_key
  )
  if [[ -n "${AKEYLESS_URL:-}" ]]; then
    args+=(--akeyless-url "${AKEYLESS_URL}")
  fi
  akeyless configure "${args[@]}" >/dev/null
fi

# The plugin lives outside the PVC-hidden home; copy it in when the lockfile
# differs. This avoids recopying a 159 MB tree on every restart.
if [ -d /opt/omp-plugins ]; then
  if ! cmp -s /opt/omp-plugins/omp-plugins.lock.json "${HOME}/.omp/plugins/omp-plugins.lock.json"; then
    rm -rf "${HOME}/.omp/plugins"
    cp -a /opt/omp-plugins "${HOME}/.omp/plugins"
  fi
fi

# Third-party skills also live outside the PVC-hidden home; copy only shipped
# names when the lockfile differs, leaving Paseo's and the user's skills alone.
if [ -d /opt/agents-skills ]; then
  install -d -m 700 "${HOME}/.agents/skills"
  if ! cmp -s /opt/agents-skills/.lock.json "${HOME}/.agents/skills/.image-lock.json" 2>/dev/null; then
    for src in /opt/agents-skills/*/; do
      name="$(basename "${src}")"
      rm -rf "${HOME}/.agents/skills/${name}"
      cp -a "${src}" "${HOME}/.agents/skills/${name}"
    done
    install -m 600 /opt/agents-skills/.lock.json "${HOME}/.agents/skills/.image-lock.json"
  fi
fi

# Paseo's base entrypoint hashes PASEO_PASSWORD, prepares HOME, and drops to
# uid 1000. Keep that behavior instead of starting the daemon directly.
exec /usr/local/bin/paseo-docker-entrypoint
