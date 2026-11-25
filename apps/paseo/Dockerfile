# syntax=docker/dockerfile:1
ARG VERSION
ARG BUN_IMAGE
ARG BUN_VERSION
FROM ${BUN_IMAGE}:${BUN_VERSION} AS bun

FROM ghcr.io/getpaseo/paseo:${VERSION}

ARG VERSION
ARG OPENCODE_VERSION
ARG OMP_VERSION
ARG MISE_VERSION
ARG PI_MEMINI_VERSION
# renovate: datasource=custom.akeyless depName=akeyless-cli
ARG AKEYLESS_VERSION=1.157.0
# renovate: datasource=github-tags depName=mattpocock/skills
ARG MATTPOCOCK_SKILLS_VERSION=v1.3.2
# The build fetches the pinned commit below, never the moving branch.
# renovate-unlazy: datasource=github-digest depName=Leonxlnx/unlazy ref=main
ARG UNLAZY_COMMIT=16671491f6679ad9378f52604d3bc2415b4120c7
ARG TARGETARCH

USER root

RUN apt-get update && apt-get install -y --no-install-recommends \
      build-essential \
      ca-certificates \
      curl \
      git \
      jq \
      libatomic1 \
      libbz2-dev \
      libffi-dev \
      libjpeg-dev \
      liblzma-dev \
      libncursesw5-dev \
      libreadline-dev \
      libsqlite3-dev \
      libssl-dev \
      libyaml-dev \
      pkg-config \
      python3 \
      python3-dev \
      python3-pip \
      python3-venv \
      python3-yaml \
      ripgrep \
      tk-dev \
      unzip \
      xz-utils \
      zlib1g-dev \
    && rm -rf /var/lib/apt/lists/*

COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun

RUN case "${TARGETARCH}" in \
      'amd64') MISE_ARCH='linux-x64' ;; \
      'arm64') MISE_ARCH='linux-arm64' ;; \
      *) echo "unsupported arch ${TARGETARCH}" >&2; exit 1 ;; \
    esac \
    && curl -fsSL "https://github.com/jdx/mise/releases/download/${MISE_VERSION}/mise-${MISE_VERSION}-${MISE_ARCH}.tar.xz" -o /tmp/mise.tar.xz \
    && tar -xJf /tmp/mise.tar.xz -C /tmp \
    && install /tmp/mise/bin/mise /usr/local/bin/mise \
    && rm -rf /tmp/mise /tmp/mise.tar.xz

RUN case "${TARGETARCH}" in \
      'amd64') AKEYLESS_ARCH='amd64' ;; \
      'arm64') AKEYLESS_ARCH='arm64' ;; \
      *) echo "unsupported arch ${TARGETARCH}" >&2; exit 1 ;; \
    esac \
    && curl -fsSL "https://akeyless-cli.s3.us-east-2.amazonaws.com/cli/${AKEYLESS_VERSION}/cli-linux-${AKEYLESS_ARCH}" -o /usr/local/bin/akeyless \
    && chmod 0755 /usr/local/bin/akeyless \
    && mkdir -p /home/paseo/.akeyless/profiles \
    && printf 'dns="vault.akeyless.io"\nprotocol="https"\n' > /home/paseo/.akeyless/settings \
    && printf '["default"]\n  access_type = "access_key"\n  access_id = ""\n  access_key = ""\n' > /home/paseo/.akeyless/profiles/default.toml \
    && chmod 700 /home/paseo/.akeyless /home/paseo/.akeyless/profiles \
    && chmod 600 /home/paseo/.akeyless/settings /home/paseo/.akeyless/profiles/default.toml \
    && chown -R 1000:1000 /home/paseo/.akeyless \
    && gosu paseo akeyless --version

# Third-party agent skills, pinned and fetched at build time. They live outside
# /home/paseo & start.sh copies them into the writable home directory. Flat layout.
RUN set -eux; \
    mkdir -p /tmp/skills/mattpocock /tmp/skills/unlazy /opt/agents-skills; \
    curl -fsSL "https://github.com/mattpocock/skills/archive/refs/tags/${MATTPOCOCK_SKILLS_VERSION}.tar.gz" -o /tmp/mattpocock-skills.tar.gz; \
    tar -xzf /tmp/mattpocock-skills.tar.gz -C /tmp/skills/mattpocock --strip-components=1; \
    curl -fsSL "https://github.com/Leonxlnx/unlazy/archive/${UNLAZY_COMMIT}.tar.gz" -o /tmp/unlazy.tar.gz; \
    tar -xzf /tmp/unlazy.tar.gz -C /tmp/skills/unlazy --strip-components=1; \
    for dir in /tmp/skills/mattpocock/skills/engineering/*/ /tmp/skills/mattpocock/skills/productivity/*/; do \
      test -f "${dir}SKILL.md"; \
      cp -a "${dir}" /opt/agents-skills/; \
    done; \
    mkdir -p /opt/agents-skills/unlazy; \
    cp -a /tmp/skills/unlazy/SKILL.md /tmp/skills/unlazy/agents /tmp/skills/unlazy/scripts /tmp/skills/unlazy/templates /tmp/skills/unlazy/references /opt/agents-skills/unlazy/; \
    find /opt/agents-skills -type f -print0 > /tmp/skill-files; \
    LC_ALL=C sort -z -o /tmp/skill-files /tmp/skill-files; \
    xargs -0 -a /tmp/skill-files sha256sum > /tmp/skill-hashes; \
    skills_hash="$(sha256sum /tmp/skill-hashes)"; \
    printf '{"hash":"%s","mattpocock":"%s","unlazy":"%s"}\n' "${skills_hash%% *}" "$MATTPOCOCK_SKILLS_VERSION" "$UNLAZY_COMMIT" > /opt/agents-skills/.lock.json; \
    rm -rf /tmp/skills /tmp/mattpocock-skills.tar.gz /tmp/unlazy.tar.gz /tmp/skill-files /tmp/skill-hashes; \
    chown -R 1000:1000 /opt/agents-skills

ENV BUN_INSTALL=/opt/bun \
    HOME=/home/paseo \
    PASEO_HOME=/home/paseo/.paseo

ENV PATH=/home/paseo/.local/share/mise/shims:/opt/mise/shims:/opt/bun/bin:/usr/local/bin:/usr/bin:/bin

RUN bun add -g \
      "@oh-my-pi/pi-coding-agent@${OMP_VERSION}" \
      "opencode-ai@${OPENCODE_VERSION}" \
    && omp --version \
    && opencode --version

COPY mise.toml /etc/mise/config.toml

ENV MISE_DATA_DIR=/opt/mise \
    MISE_CACHE_DIR=/tmp/mise-cache \
    MISE_STATE_DIR=/tmp/mise-state

RUN mkdir -p /opt/mise /tmp/mise-cache /tmp/mise-state /etc/mise \
    && cd /etc/mise \
    && mise trust \
    && mise install \
    && mise reshim \
    && for bin in \
         actionlint age ansible ansible-galaxy ansible-playbook cilium flate flux gh go gofmt gum helm helmfile jq just \
         kopiur kubectl kubectl-browse-pvc kustomize lefthook minijinja-cli node npm npx oxfmt pip \
         pip3 pnpm python python3 rg shellcheck sops talosctl uv yamlls yq zizmor; do \
         path="$(mise which "$bin" 2>/dev/null)" || continue; \
         ln -sf "$path" "/opt/mise/shims/$bin"; \
       done \
    && ln -sf "$(mise which kopiur)" /opt/mise/shims/kubectl-kopiur \
    && kubectl version --client \
    && flux version --client \
    && kustomize version \
    && sops --version

ENV MISE_DATA_DIR=/home/paseo/.local/share/mise \
    MISE_CACHE_DIR=/home/paseo/.cache/mise \
    MISE_STATE_DIR=/home/paseo/.local/state/mise

ENV HOME=/opt/omp-home
RUN mkdir -p /opt/omp-home \
    && omp plugin install "@eleboucher/pi-memini@${PI_MEMINI_VERSION}" \
    && omp plugin list | grep -q "pi-memini" \
    && mkdir -p /opt/omp-plugins \
    && cp -a /opt/omp-home/.omp/plugins/. /opt/omp-plugins/ \
    && chown -R 1000:1000 /opt/omp-plugins
ENV HOME=/home/paseo

USER root
COPY omp /opt/omp
RUN chown -R 1000:1000 /opt/omp
COPY opencode /opt/opencode
RUN chown -R 1000:1000 /opt/opencode
COPY start.sh /usr/local/bin/paseo-start
RUN chmod 0755 /usr/local/bin/paseo-start \
    && chown -R 1000:1000 /home/paseo

USER 1000:1000
WORKDIR /workspace
EXPOSE 6767
CMD ["/usr/local/bin/paseo-start"]
