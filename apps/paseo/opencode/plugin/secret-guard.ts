/**
 * OpenCode side of the host secret guard.
 *
 * Reuses the OMP guard so both providers make the same decision: normal
 * commands pass, value reads return an error the agent routes around, and
 * nothing prompts. start.sh installs the hook next to this plugin.
 */

import { pathAccess, secretAccess } from "/home/paseo/.omp/agent/hooks/pre/secret-guard.ts";

const ROUTE_AROUND =
  "Use a metadata projection from docs/context/secrets.md (keys, lengths, hashes, existence) or the tool that consumes the secret (git, gh, kubectl, flux, talosctl, just). Never read the value and never retry this call.";

const PATH_KEYS = ["path", "paths", "file_path", "filePath", "uri", "url", "target", "source", "destination"];

export const SecretGuard = async () => ({
  "tool.execute.before": async (input: { tool: string }, output: { args?: Record<string, unknown> }) => {
    if (input.tool === "bash") {
      const command = output.args?.command;
      if (typeof command !== "string") return;
      const reason = secretAccess(command);
      if (reason) throw new Error(`Blocked by secret guard: ${reason}. ${ROUTE_AROUND}`);
      return;
    }

    for (const key of PATH_KEYS) {
      const value = output.args?.[key];
      const values = Array.isArray(value) ? value : typeof value === "string" ? value.split(";") : [];
      for (const item of values) {
        if (typeof item !== "string") continue;
        const reason = pathAccess(input.tool, item);
        if (reason) throw new Error(`Blocked by secret guard: ${reason}. ${ROUTE_AROUND}`);
      }
    }
  },
});
