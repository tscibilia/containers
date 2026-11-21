/**
 * Host-wide secret guard.
 *
 * Hard deny, no prompt: agents never read secret values, so a blocked call
 * returns an error the agent can route around instead of interrupting the
 * user. Metadata and normal use pass untouched; only value reads are blocked.
 *
 * The allow shapes mirror `docs/context/secrets.md` in home-ops: keys,
 * lengths, hashes, existence, and value-free jq projections. If a command is
 * not one of those shapes, use the tool that consumes the secret (`git`,
 * `gh`, `kubectl`, `flux`, `talosctl`, `just`) instead of printing it.
 *
 * Lives in the user agent directory, so it applies to every repo.
 */

import type { HookAPI } from "@oh-my-pi/pi-coding-agent/extensibility/hooks";

const HOME = "/home/paseo";
const HOOK_PATH = `${HOME}/.omp/agent/hooks/pre/secret-guard.ts`;

/** Value-free jq programs allowed after a secret source. Whitespace-normalized. */
const SAFE_JQ: RegExp[] = [
  // kubectl: keys, lengths, existence, redacted values, metadata.
  /^\{\s*keys\s*:\s*\(\s*\.data\s*\|\s*keys\s*\)\s*\}$/,
  /^\{\s*keys\s*:\s*\(\s*\.data\s*\|\s*keys\s*\)\s*,\s*bytes\s*:\s*\(\s*\.data\s*\|\s*map_values\s*\(\s*length\s*\)\s*\)\s*\}$/,
  /^\.data\s*\|\s*keys(\s*\[\s*\])?\s*$/,
  /^\.data\s*\|\s*has\s*\(\s*"[^"]+"\s*\)\s*$/,
  /^\.data\s*\|\s*map_values\s*\(\s*length\s*\)\s*$/,
  /^\.data\s*\|\s*map_values\s*\(\s*"<redacted>"\s*\)\s*$/,
  /^\.metadata\s*\|\s*keys\s*$/,
  /^\.metadata\.annotations\s*\|\s*keys\s*$/,
  /^\.metadata\.annotations\s*\[\s*"[^"]+"\s*\]\s*$/,
  /^keys\s*$/,
  // akeyless: paths, existence, redacted walk.
  /^paths\s*\(\s*scalars\s*\)\s*\|\s*map\s*\(\s*tostring\s*\)\s*\|\s*join\s*\(\s*"\."\s*\)\s*$/,
  /^to_entries\s*\[\s*\]\s*\|\s*\.value\s*\|\s*has\s*\(\s*"[^"]+"\s*\)\s*$/,
  /^walk\s*\(\s*if\s+type\s*==\s*"string"\s+then\s+"<redacted>"\s+else\s+\.\s+end\s*\)\s*$/,
  /^del\s*\(\s*\.public_value\s*\)\s*\|\s*del\s*\(\s*\.custom_fields\s*\[\s*\]\?\s*\.value\s*\)\s*$/,
];

/** Files whose contents are credentials. */
const CREDENTIAL_FILES = [
  "/etc/paseo/signing_key",
  "/etc/paseo/talosconfig",
  "/var/run/secrets/kubernetes.io/serviceaccount/token",
  `${HOME}/.kube/config`,
  `${HOME}/.config/gh/hosts.yml`,
  `${HOME}/.paseo/local-credential`,
  `${HOME}/.paseo/push-tokens.json`,
  `${HOME}/.paseo/daemon-keypair.json`,
];

/** Directories that hold credentials. Every entry is blocked except the public exceptions. */
const CREDENTIAL_DIRS = [
  `${HOME}/.ssh`,
  `${HOME}/.aws`,
  `${HOME}/.kube`,
  `${HOME}/.talos`,
  `${HOME}/.akeyless`,
  `${HOME}/.paseo/secure-input`,
  "/var/run/secrets/kubernetes.io/serviceaccount",
];

const PUBLIC_SSH: Record<string, true> = {
  known_hosts: true,
  "known_hosts.old": true,
  config: true,
  authorized_keys: true,
};
const PUBLIC_SA: Record<string, true> = { "ca.crt": true, namespace: true };

// Commands that can put a file's contents into output or into another file.
const READ_CMDS =
  "cat|less|more|head|tail|strings|od|xxd|base64|jq|grep|rg|awk|sed|cp|mv|scp|rsync|tar|zip|ln|install|python|python3|node|bun|bash|sh|zsh|fish|dd|openssl|ssh-keygen|read|source";

const CREDENTIAL_PATH =
  "(?:\\/etc\\/paseo\\/(?:signing_key|talosconfig)" +
  "|\\/var\\/run\\/secrets\\/kubernetes\\.io\\/serviceaccount\\/token" +
  "|(?:~|\\$HOME|\\/home\\/paseo)\\/\\.ssh\\/(?!known_hosts|config|authorized_keys|[^\\s/]*\\.pub)" +
  "|(?:~|\\$HOME|\\/home\\/paseo)\\/\\.kube\\/config" +
  "|(?:~|\\$HOME|\\/home\\/paseo)\\/\\.config\\/gh\\/hosts\\.yml" +
  "|(?:~|\\$HOME|\\/home\\/paseo)\\/\\.(?:talos|akeyless)\\b" +
  "|(?:~|\\$HOME|\\/home\\/paseo)\\/\\.paseo\\/(?:local-credential|push-tokens\\.json|daemon-keypair\\.json|secure-input))";

const CREDENTIAL_COLUMN =
  /\b(?:api_?key|access_?key|token|secret|password|passwd|pwd|cookie|session|jwt|private_key|webhook|dsn)\b/i;

/** Splits a shell line into command segments on `;`, `&&`, `||`, and `|`. */
function commandSegments(line: string): string[] {
  return line
    .split(/(?:;|&&|\|\||\|)/u)
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);
}

/** Strips leading env assignments and wrappers so a command can be matched at position 0. */
function stripPrefixes(segment: string): string {
  return segment
    .trim()
    .replace(/^(?:[A-Za-z_][A-Za-z0-9_]*=(?:"[^"]*"|'[^']*'|\S*)\s+)+/u, "")
    .replace(/^(?:sudo|command|time|nice)\s+/u, "");
}

/** True when `command` starts a segment (not just an argument to grep/echo/...). */
function isCommand(line: string, command: RegExp): boolean {
  return commandSegments(line).some((segment) => command.test(stripPrefixes(segment)));
}

/** Extracts the jq program that follows `| jq` on a line, if any. */
function jqProgram(line: string): string | null {
  const match = /\|\s*jq\s+((?:-[A-Za-z-]+\s+)*(?:'([^']*)'|"([^"]*)"|(\S+)))/.exec(line);
  if (!match) return null;
  const program = match[2] ?? match[3] ?? match[4] ?? "";
  return program.trim().replace(/\s+/gu, " ");
}

/** A hash of the value is metadata; the value itself never reaches output. */
function hashOnly(line: string): boolean {
  if (!/\|\s*(?:sha256sum|sha1sum|md5sum)\b/.test(line)) return false;
  return !/\|\s*(?:tee|cat|less|head|tail|sed|awk|base64|xxd|od|strings)\b/.test(line);
}

/** `diff <(...) <(...) >/dev/null` compares without printing either side. */
function diffOnly(line: string): boolean {
  if (!/\bdiff\b/.test(line) || !/>\s*\/dev\/null/.test(line)) return false;
  return !/\|\s*(?:tee|cat|less|head|tail|cut|sed|awk|base64|xxd|od|strings)\b/.test(line);
}

/** `kubectl get secret` prints values only for structured output. */
function kubectlSecret(line: string): string | null {
  if (!isCommand(line, /^kubectl\b/)) return null;
  if (/\bkubectl\s+auth\s+can-i\b/.test(line)) return null;
  if (/\bdescribe\s+secrets?\b/i.test(line)) return null;
  // Standalone `secret`/`secrets`, not ExternalSecret, SealedSecret,
  // SecretStore, secretKeyRef, secretName, or a path like /secrets/.
  if (!/(?<![A-Za-z])secrets?(?![A-Za-z])/i.test(line)) return null;
  if (diffOnly(line)) return null;
  if (/\bkubectl\b[^\n]*\b(?:exec|cp)\b/.test(line))
    return "kubectl exec/cp can read pod credentials";
  if (/\s(?:-o|--output)(?:=|\s+)(?:yaml|yml)\b/.test(line)) return "prints Secret values as YAML";
  if (/\s(?:-o|--output)(?:=|\s+)(?:jsonpath|go-template|template)\b/.test(line)) {
    return "prints Secret values through a template";
  }
  if (/\s(?:-o|--output)(?:=|\s+)json\b/.test(line)) {
    const program = jqProgram(line);
    if (program && SAFE_JQ.some((pattern) => pattern.test(program))) return null;
    return "prints Secret values; pipe it to a metadata projection (keys, lengths, has, <redacted>)";
  }
  // Table/name output lists objects, not values.
  return null;
}

/** akeyless prints the value to stdout unless a value-free jq program or a hash follows. */
function akeylessSecret(line: string): string | null {
  if (!isCommand(line, /^akeyless\b/)) return null;
  if (!/\bakeyless\s+get-secret-value\b/i.test(line)) return null;
  if (hashOnly(line) || diffOnly(line)) return null;
  const program = jqProgram(line);
  if (program && SAFE_JQ.some((pattern) => pattern.test(program))) return null;
  return "prints an akeyless value; pipe it to a metadata projection (paths, keys, has, <redacted>) or a hash";
}

function databaseSecret(line: string): string | null {
  if (isCommand(line, /^(?:pg_dump|pg_restore)\b/)) return "dumps a database";
  if (isCommand(line, /^sqlite3\b/)) {
    if (/\.dump\b|\.backup\b|\.restore\b/i.test(line)) return "dumps a database";
    if (/\bselect\s+\*/i.test(line)) return "SELECT * reads credential columns";
    if (/\bselect\b/i.test(line) && CREDENTIAL_COLUMN.test(line))
      return "selects a credential column";
  }
  if (isCommand(line, /^psql\b/)) {
    if (/\bcopy\b[^\n]*\bto\s+stdout\b/i.test(line)) return "exports table rows";
    if (/\bselect\s+\*/i.test(line)) return "SELECT * reads credential columns";
    if (/\bselect\b/i.test(line) && CREDENTIAL_COLUMN.test(line))
      return "selects a credential column";
  }
  return null;
}

function environmentSecret(line: string): string | null {
  for (const segment of commandSegments(line)) {
    const command = stripPrefixes(segment);
    if (/^printenv\b/.test(command)) return "dumps the environment";
    if (/^env\s*$/.test(command) || /^env\s+-\S/.test(command)) return "dumps the environment";
    if (/^ps\s+eww\b/.test(command)) return "dumps process environments";
  }
  return null;
}

const TEXT_PATTERNS: Array<[RegExp, string]> = [
  [new RegExp(`^(?:${READ_CMDS})\\b[^\\n]*${CREDENTIAL_PATH}`, "i"), "reads a credential file"],
  [/^kubectl\b[^\n]*\bcp\b/, "kubectl cp can read pod credentials"],
  [
    /^kubectl\b[^\n]*\bexec\b[^\n]*--\s*(?:env|printenv|export|cat|less|more|head|tail|strings|od|xxd|base64|sh|bash|zsh|fish|python|python3|node|perl|ruby)\b/,
    "kubectl exec runs a command that can read pod credentials",
  ],
  [
    /^kubectl\b[^\n]*\bexec\b[^\n]*(?:\/etc\/paseo|\/var\/run\/secrets|\.env|kubeconfig|talosconfig|signing_key)/,
    "kubectl exec targets a credential path",
  ],
  [/^gh\s+secret\b/i, "touches GitHub Actions secrets"],
  [/^gh\s+auth\s+token\b/i, "prints the GitHub token"],
  [/^gh\s+api\b[^\n]*\/secrets\b/i, "reads GitHub secrets through the API"],
  [/^sops\b[^\n]*?(?:\s-d\b|\s--decrypt\b|\bdecrypt\b|\bexec-env\b)/i, "decrypts a sops file"],
  [/^helm\s+get\s+(?:values|manifest|all)\b/i, "prints Helm release values or manifests"],
  [/^kubectl\s+config\s+view\b[^\n]*--raw\b/i, "prints kubeconfig credentials"],
  [
    /^kubectl\b[^\n]*\bget\b[^\n]*\bhelmrelease\b[^\n]*(?:-o|--output)(?:=|\s+)(?:yaml|json)\b/i,
    "prints Helm release values",
  ],
  [/^talosctl\b[^\n]*\betcd\s+snapshot\b/i, "dumps etcd"],
  [
    /^talosctl\b[^\n]*\bread\b[^\n]*(?:kubeconfig|cert|\.crt|\.key|secret|token|talosconfig|\/var\/lib\/)/i,
    "reads a Talos credential",
  ],
  [/^talosctl\b[^\n]*\bkubeconfig\b[^\n]*-o\s*-/, "prints a Talos kubeconfig"],
  [/^aws\s+secretsmanager\s+get-secret-value\b/i, "reads an AWS secret value"],
  [/^gcloud\s+secrets\s+versions\s+access\b/i, "reads a GCP secret value"],
  [/^vault\s+kv\s+get\b/i, "reads a Vault secret value"],
  [/^doppler\s+secrets\s+(?:download|--plain)\b/i, "downloads Doppler secrets"],
  [/^op\s+item\s+get\b[^\n]*--reveal\b/i, "reveals a 1Password item"],
  [/^base64\s+-d\b|^base64\s+--decode\b/i, "decodes base64 data"],
  [/\/proc\/(?:self|\d+)\/environ/, "reads the process environment"],
  [
    /\b(?:print|console\.log|json\.dumps)\s*\(\s*(?:os\.environ|process\.env)\b/,
    "dumps the environment",
  ],
  [
    /(?:^|[;&|]\s*)(?:cat|less|more|head|tail|strings|od|xxd|source|\.)\s+[^\s;|&]*\.env(?:rc)?\b(?!\.(?:example|sample|template|dist))/i,
    "reads an environment file",
  ],
];

/** Returns a reason when bash/eval text reads secret material. */
export function secretAccess(text: string): string | null {
  if (!text) return null;
  for (const line of text.split(/\r?\n/)) {
    if (line.trim().length === 0) continue;
    const direct =
      kubectlSecret(line) ??
      akeylessSecret(line) ??
      databaseSecret(line) ??
      environmentSecret(line);
    if (direct) return direct;
    for (const segment of commandSegments(line)) {
      const match = TEXT_PATTERNS.find(([pattern]) => pattern.test(stripPrefixes(segment)));
      if (match) return match[1];
    }
  }
  return null;
}

function normalize(raw: string): string {
  let path = raw.trim();
  if (path.startsWith("file://")) path = path.slice("file://".length);
  path = path.replace(/^~(?=\/|$)/, HOME).replace(/^\$HOME(?=\/|$)/, HOME);
  // read/grep selectors: keep only the path.
  path = path.replace(/:\d+(?:-\d+)?$/, "");
  return path;
}

function credentialDirReason(path: string): string | null {
  for (const dir of CREDENTIAL_DIRS) {
    // A directory listing is metadata; the recursive-search check below
    // handles grep/glob roots that equal or contain the directory.
    if (path === dir || !path.startsWith(`${dir}/`)) continue;
    const base = path.slice(dir.length + 1).split("/")[0];
    if (dir.endsWith("/.ssh") && (PUBLIC_SSH[base] || base.endsWith(".pub"))) continue;
    if (dir.endsWith("/serviceaccount") && PUBLIC_SA[base]) continue;
    return `touches ${dir}`;
  }
  return null;
}

/** Returns a reason when a path-taking tool targets secret material. */
export function pathAccess(toolName: string, raw: string): string | null {
  if (!raw) return null;
  const path = normalize(raw);
  if (!path.startsWith("/")) return null;
  if (
    (toolName === "write" || toolName === "edit" || toolName === "ast_edit") &&
    path === HOOK_PATH
  ) {
    return "edits the secret guard";
  }
  if (CREDENTIAL_FILES.some((file) => path === file)) return "reads a credential file";
  const inside = credentialDirReason(path);
  if (inside) return inside;
  if (
    toolName === "grep" ||
    toolName === "glob" ||
    toolName === "find" ||
    toolName === "ast_grep"
  ) {
    const root = path.split(/[*?[{]/)[0].replace(/\/+$/, "");
    // A search root that is a credential directory, or a parent of one,
    // would walk into credentials. Repo roots stay allowed.
    for (const target of [...CREDENTIAL_FILES, ...CREDENTIAL_DIRS]) {
      if (root !== "" && (target === root || target.startsWith(`${root}/`)))
        return `searches into ${target}`;
    }
  }
  return null;
}

const PATH_KEYS: Record<string, true> = {
  path: true,
  paths: true,
  file_path: true,
  filePath: true,
  uri: true,
  url: true,
  target: true,
  source: true,
  destination: true,
};

function pathValues(input: Record<string, unknown>): string[] {
  const values: string[] = [];
  for (const [key, value] of Object.entries(input)) {
    if (!PATH_KEYS[key]) continue;
    if (typeof value === "string") values.push(...value.split(";"));
    else if (Array.isArray(value)) {
      for (const item of value) if (typeof item === "string") values.push(...item.split(";"));
    }
  }
  return values;
}

function commandText(toolName: string, input: Record<string, unknown>): string {
  if (toolName === "bash") return typeof input.command === "string" ? input.command : "";
  if (toolName === "eval") {
    const parts: string[] = [];
    if (typeof input.code === "string") parts.push(input.code);
    if (typeof input.title === "string") parts.push(input.title);
    return parts.join("\n");
  }
  return "";
}

const ROUTE_AROUND =
  "Use a metadata projection from docs/context/secrets.md (keys, lengths, hashes, existence) or the tool that consumes the secret (git, gh, kubectl, flux, talosctl, just). Never read the value and never retry this call.";

export default function secretGuard(pi: HookAPI): void {
  pi.on("tool_call", async (event) => {
    if (event.toolName === "bash" || event.toolName === "eval") {
      const reason = secretAccess(commandText(event.toolName, event.input));
      if (reason)
        return { block: true, reason: `Blocked by secret guard: ${reason}. ${ROUTE_AROUND}` };
      return;
    }
    for (const value of pathValues(event.input)) {
      const reason = pathAccess(event.toolName, value);
      if (reason)
        return { block: true, reason: `Blocked by secret guard: ${reason}. ${ROUTE_AROUND}` };
    }
  });
}
