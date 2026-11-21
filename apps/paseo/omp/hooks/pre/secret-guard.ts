/**
 * Host-wide secret guard.
 *
 * Hard deny, no prompt: the handling rules say agents never read secret
 * values, so a blocked call returns an error the agent can route around
 * (use git/gh/kubectl/talosctl, or a just recipe that consumes the secret)
 * instead of interrupting the user. Metadata and usage are allowed; only
 * value reads are blocked.
 *
 * Lives in the user agent directory, so it applies to every repo.
 */

import type { HookAPI } from "@oh-my-pi/pi-coding-agent/extensibility/hooks";

const HOME = "/home/paseo";

// Files whose contents are credentials.
const CREDENTIAL_FILES = [
	"/etc/paseo/signing_key",
	"/etc/paseo/talosconfig",
	"/var/run/secrets/kubernetes.io/serviceaccount/token",
	`${HOME}/.kube/config`,
	`${HOME}/.config/gh/hosts.yml`,
];

// Directories that hold credentials; every entry is blocked except the
// public exceptions below.
const CREDENTIAL_DIRS = [
	`${HOME}/.ssh`,
	`${HOME}/.aws`,
	`${HOME}/.kube`,
	`${HOME}/.config/gh`,
	`${HOME}/.talos`,
	`${HOME}/.akeyless`,
	`${HOME}/.paseo`,
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
	"cat|less|more|head|tail|strings|od|xxd|base64|jq|grep|rg|awk|sed|cp|mv|scp|rsync|tar|zip|ln|install|python|python3|node|bun|read";

const CREDENTIAL_PATH =
	"(?:\\/etc\\/paseo\\/(?:signing_key|talosconfig)" +
	"|\\/var\\/run\\/secrets\\/kubernetes\\.io\\/serviceaccount\\/token" +
	"|(?:~|\\$HOME|\\/home\\/paseo)\\/\\.(?:ssh|aws|kube|talos|akeyless|paseo)\\b" +
	"|\\/home\\/paseo\\/\\.config\\/gh\\/hosts\\.yml)";

const TEXT_PATTERNS: Array<[RegExp, string]> = [
	[
		new RegExp(`\\b(?:${READ_CMDS})\\b[^\\n]*${CREDENTIAL_PATH}`, "i"),
		"reads a credential file",
	],
	[/\bprintenv\b/, "dumps the environment"],
	[/\b(?:cat|less|head|tail|strings|grep|od|xxd)\b[^\n]*\/proc\/(?:self|\d+)\/environ/, "reads the process environment"],
	[/\b(?:print|console\.log|json\.dumps)\s*\(\s*(?:os\.environ|process\.env)\b/, "dumps the environment"],
	[/\bgh\s+secret\b/i, "touches GitHub Actions secrets"],
	[/\bgh\s+auth\s+token\b/i, "prints the GitHub token"],
	[/\bgh\s+api\b[^\n]*\/secrets\b/i, "reads GitHub secrets through the API"],
	[/\bsops\b[^\n]*?(?:\s-d\b|\s--decrypt\b|\bdecrypt\b|\bexec-env\b)/i, "decrypts a sops file"],
	[/\bkubectl\s+config\s+view\b[^\n]*--raw\b/i, "prints kubeconfig credentials"],
	[/\bkubectl\b[^\n]*\b(?:exec|cp)\b/, "kubectl exec/cp can read pod credentials"],
];

function kubectlSecret(text: string): string | null {
	for (const line of text.split(/\r?\n/)) {
		if (!/\bkubectl\b/.test(line)) continue;
		if (/\bkubectl\s+auth\s+can-i\b/.test(line)) continue;
		// Standalone `secret`/`secrets`, not ExternalSecret, SealedSecret,
		// SecretStore, secretKeyRef, secretName, or a path like /secrets/.
		if (/(?<![A-Za-z])secrets?(?![A-Za-z])/i.test(line)) return "reads Kubernetes Secrets";
	}
	return null;
}

/** akeyless prints the value to stdout; a redirect keeps it out of the transcript. */
function akeylessAccess(text: string): string | null {
	if (!/\bakeyless\s+get-secret-value\b/i.test(text)) return null;
	if (/>/.test(text) && !/\btee\b/.test(text)) return null;
	return "prints an akeyless secret; redirect it to a file instead";
}

/** Returns a reason when bash/eval text reads secret material. */
export function secretAccess(text: string): string | null {
	if (!text) return null;
	const kubectl = kubectlSecret(text);
	if (kubectl) return kubectl;
	const akeyless = akeylessAccess(text);
	if (akeyless) return akeyless;
	for (const [pattern, reason] of TEXT_PATTERNS) {
		if (pattern.test(text)) return reason;
	}
	return null;
}

function normalize(raw: string): string {
	let p = raw.trim();
	if (p.startsWith("file://")) p = p.slice("file://".length);
	p = p.replace(/^~(?=\/|$)/, HOME).replace(/^\$HOME(?=\/|$)/, HOME);
	// read/grep selectors: keep only the path.
	p = p.replace(/:\d+(?:-\d+)?$/, "");
	return p;
}

function credentialDirReason(p: string): string | null {
	for (const dir of CREDENTIAL_DIRS) {
		// A directory listing is metadata; the recursive-search check below
		// handles grep/glob roots that equal the directory.
		if (p === dir || !p.startsWith(`${dir}/`)) continue;
		const base = p.slice(dir.length + 1).split("/")[0];
		if (dir.endsWith("/.ssh") && (PUBLIC_SSH[base] || base.endsWith(".pub"))) continue;
		if (dir.endsWith("/serviceaccount") && PUBLIC_SA[base]) continue;
		return `touches ${dir}`;
	}
	return null;
}

/** Returns a reason when a path-taking tool targets secret material. */
export function pathAccess(toolName: string, p: string): string | null {
	if (!p) return null;
	const path = normalize(p);
	if (!path.startsWith("/")) return null;
	if (CREDENTIAL_FILES.some(file => path === file)) return "reads a credential file";
	const inside = credentialDirReason(path);
	if (inside) return inside;
	if (toolName === "grep" || toolName === "glob" || toolName === "find" || toolName === "ast_grep") {
		const root = path.split(/[*?[{]/)[0].replace(/\/+$/, "");
		for (const target of [...CREDENTIAL_FILES, ...CREDENTIAL_DIRS]) {
			if (root !== "" && (target === root || target.startsWith(`${root}/`))) return `searches into ${target}`;
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

export default function secretGuard(pi: HookAPI): void {
	pi.on("tool_call", async event => {
		if (event.toolName === "bash" || event.toolName === "eval") {
			const reason = secretAccess(commandText(event.toolName, event.input));
			if (reason) {
				return {
					block: true,
					reason: `Blocked by secret guard: ${reason}. Use the tool that consumes it (git, gh, kubectl, talosctl) or a just recipe; never read the value.`,
				};
			}
			return;
		}
		for (const value of pathValues(event.input)) {
			const reason = pathAccess(event.toolName, value);
			if (reason) {
				return {
					block: true,
					reason: `Blocked by secret guard: ${reason}. Never read secret values; use the consuming tool instead.`,
				};
			}
		}
	});
}
