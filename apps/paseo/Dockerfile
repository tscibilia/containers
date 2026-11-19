# syntax=docker/dockerfile:1
ARG VERSION=0.16.2
ARG PASEO_DIGEST=sha256:44e9f10a192478e4906b37dbf097f555d48e9683194797f80a4f4bb132409a9a
ARG BUN_IMAGE=docker.io/oven/bun:1.3-debian
ARG BUN_DIGEST=sha256:9dba1a1b43ce28c9d7931bfc4eb00feb63b0114720a0277a8f939ae4dfc9db6f
FROM ${BUN_IMAGE}@${BUN_DIGEST} AS bun

FROM ghcr.io/getpaseo/paseo:${VERSION}@${PASEO_DIGEST}

ARG VERSION
ARG OPENCODE_VERSION=1.18.28
ARG OMP_VERSION=18.22.2
ARG MISE_VERSION=v2026.11.9
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
         actionlint age cilium flate flux gh go gofmt gum helm helmfile jq just \
         kopiur kubectl kustomize lefthook minijinja-cli node npm npx oxfmt pip \
         pip3 pnpm python python3 rg shellcheck sops talosctl uv yamlls yq zizmor; do \
         path="$(mise which "$bin" 2>/dev/null)" || continue; \
         ln -sf "$path" "/opt/mise/shims/$bin"; \
       done \
    && kubectl version --client \
    && flux version --client \
    && kustomize version \
    && sops --version

ENV MISE_DATA_DIR=/home/paseo/.local/share/mise \
    MISE_CACHE_DIR=/home/paseo/.cache/mise \
    MISE_STATE_DIR=/home/paseo/.local/state/mise

ENV HOME=/opt/omp-home
RUN mkdir -p /opt/omp-home \
    && omp plugin install "@eleboucher/pi-memini@0.7.32" \
    && omp plugin list | grep -q "pi-memini" \
    && mkdir -p /opt/omp-plugins \
    && cp -a /opt/omp-home/.omp/plugins/. /opt/omp-plugins/ \
    && chown -R 1000:1000 /opt/omp-plugins
ENV HOME=/home/paseo

USER root
COPY start.sh /usr/local/bin/paseo-start
RUN chmod 0755 /usr/local/bin/paseo-start \
    && chown -R 1000:1000 /home/paseo

USER 1000:1000
WORKDIR /workspace
EXPOSE 6767
CMD ["/usr/local/bin/paseo-start"]
