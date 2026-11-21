/**
 * Host-wide secret guard.
 *
 * Runs before approval on every bash and eval call. Ordinary work passes
 * untouched; a call whose command/code touches secret material is confirmed
 * interactively, and blocked outright when no UI can answer (subagents, print
 * mode). This replaces the per-call `tools.approval.eval: prompt` speed bump,
 * which gated one tool while `kubectl get secret` ran free through bash.
 */

import type { HookAPI } from "@oh-my-pi/pi-coding-agent/extensibility/hooks";

const REASONS: Array<[RegExp, string]> = [
	[/\bakeyless\s+get-secret-value\b/i, "reads a value from akeyless"],
	[/\bsops\b[^\n]*?(?:\s-d\b|\s--decrypt\b|\bdecrypt\b|\bexec-env\b)/i, "decrypts a sops file"],
	[/\bgh\s+secret\b/i, "touches GitHub Actions secrets"],
	[/\bgh\s+auth\s+token\b/i, "prints the GitHub token"],
	[/\bgh\s+api\b[^\n]*\/secrets\b/i, "reads GitHub secrets through the API"],
	[/\bprintenv\b/, "dumps the environment"],
	[/\b(?:cat|less|head|tail|strings|grep|od|xxd)\b[^\n]*\/proc\/(?:self|\d+)\/environ/, "reads the process environment"],
	[/\b(?:print|console\.log|json\.dumps)\s*\(\s*(?:os\.environ|process\.env)\b/, "dumps the environment"],
	[/\b(?:cat|less|head|tail|cp|scp|rsync|base64)\b[^\n]*(?:\/etc\/paseo\b|paseo_signing|\.kube\/config)/, "reads a pod credential file"],
	[/\b(?:cat|less|head|tail|cp|scp|rsync|base64)\b[^\n]*(?:~|\$HOME|\/home\/paseo)\/\.(?:ssh|talos|akeyless)\b/, "reads a private key or credential store"],
	[/\b(?:cat|less|head|tail|cp|scp|rsync|base64)\b[^\n]*\bkubeconfig\b/i, "reads a kubeconfig"],
	[/\bkubectl\s+config\s+view\b[^\n]*--raw\b/i, "prints kubeconfig credentials"],
	[/\b(?:cat|less|head|tail|source|\.)\s+[^\s;|&]*\.env(?:rc)?\b(?!\.(?:example|sample|template|dist))/i, "reads an environment file"],
];

function kubectlSecret(text: string): string | null {
	for (const line of text.split(/\r?\n/)) {
		if (!/\bkubectl\b/.test(line)) continue;
		if (/\bkubectl\s+auth\s+can-i\b/.test(line)) continue;
		// Standalone `secret`/`secrets`, not ExternalSecret, SealedSecret,
		// SecretStore, secretKeyRef, secretName, or a path like /secrets/.
		if (/(?<![A-Za-z])secrets?(?![A-Za-z])/i.test(line)) return `kubectl touches Secrets: ${line.trim()}`;
		if (/\bkubectl\b[^\n]*\b(?:exec|cp)\b/.test(line)) return `kubectl exec/cp can read pod credentials: ${line.trim()}`;
	}
	return null;
}

/** Returns a human-readable reason when the text touches secret material. */
export function secretAccess(text: string): string | null {
	if (!text) return null;
	const kubectl = kubectlSecret(text);
	if (kubectl) return kubectl;
	for (const [pattern, reason] of REASONS) {
		if (pattern.test(text)) return reason;
	}
	return null;
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
	pi.on("tool_call", async (event, ctx) => {
		if (event.toolName !== "bash" && event.toolName !== "eval") return;
		const input: Record<string, unknown> = event.input;
		const text = commandText(event.toolName, input);
		const reason = secretAccess(text);
		if (!reason) return;
		if (!ctx.hasUI) return { block: true, reason: `Blocked by secret guard: ${reason}.` };
		const ok = await ctx.ui.confirm(
			"Secret access",
			`${reason}.\n\n${text.length > 1200 ? `${text.slice(0, 1200)}\n…` : text}`,
		);
		return ok ? undefined : { block: true, reason: `Denied by secret guard: ${reason}.` };
	});
}
