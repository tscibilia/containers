target "docker-metadata-action" {}

variable "APP" {
  default = "paseo"
}

variable "VERSION" {
  // renovate: datasource=docker depName=ghcr.io/getpaseo/paseo
  default = "0.16.2"
}

variable "PASEO_DIGEST" {
  default = "sha256:44e9f10a192478e4906b37dbf097f555d48e9683194797f80a4f4bb132409a9a"
}

variable "OPENCODE_VERSION" {
  // renovate: datasource=npm depName=opencode-ai
  default = "1.18.28"
}

variable "OMP_VERSION" {
  // renovate: datasource=npm depName=@oh-my-pi/pi-coding-agent
  default = "18.22.2"
}

variable "MISE_VERSION" {
  // renovate: datasource=github-releases depName=jdx/mise
  default = "v2026.11.9"
}

variable "BUN_IMAGE" {
  // renovate: datasource=docker depName=oven/bun
  default = "docker.io/oven/bun:1.4.4-debian"
}

variable "BUN_DIGEST" {
  default = "sha256:93d5032fe06d163427822dc1598f420363759bb18155c9cc90eb1be05a64a19e"
}

variable "SOURCE" {
  default = "https://github.com/getpaseo/paseo"
}

group "default" {
  targets = ["image-local"]
}

target "image" {
  inherits = ["docker-metadata-action"]
  args = {
    VERSION          = "${VERSION}"
    PASEO_DIGEST     = "${PASEO_DIGEST}"
    OPENCODE_VERSION = "${OPENCODE_VERSION}"
    OMP_VERSION      = "${OMP_VERSION}"
    MISE_VERSION     = "${MISE_VERSION}"
    BUN_IMAGE        = "${BUN_IMAGE}"
    BUN_DIGEST       = "${BUN_DIGEST}"
  }
  labels = {
    "org.opencontainers.image.source" = "${SOURCE}"
  }
}

target "image-local" {
  inherits = ["image"]
  output   = ["type=docker"]
  tags     = ["${APP}:${VERSION}"]
}

target "image-all" {
  inherits = ["image"]
  platforms = [
    "linux/amd64"
  ]
}
