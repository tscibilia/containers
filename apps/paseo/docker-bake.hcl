target "docker-metadata-action" {}

variable "APP" {
  default = "paseo"
}

variable "VERSION" {
  // renovate: datasource=docker depName=ghcr.io/getpaseo/paseo
  default = "0.16.2"
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
  default = "docker.io/oven/bun"
}

variable "BUN_VERSION" {
  // renovate: datasource=docker depName=oven/bun versioning=docker
  default = "1.4.5-debian"
}

variable "PI_MEMINI_VERSION" {
  // renovate: datasource=npm depName=@eleboucher/pi-memini
  default = "0.7.32"
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
    VERSION           = "${VERSION}"
    OPENCODE_VERSION  = "${OPENCODE_VERSION}"
    OMP_VERSION       = "${OMP_VERSION}"
    MISE_VERSION      = "${MISE_VERSION}"
    BUN_IMAGE         = "${BUN_IMAGE}"
    BUN_VERSION       = "${BUN_VERSION}"
    PI_MEMINI_VERSION = "${PI_MEMINI_VERSION}"
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
