import { describe, expect, test } from "bun:test";
import { pathAccess, secretAccess } from "./secret-guard.ts";

// Every safe command in home-ops docs/context/secrets.md must pass; every
// value read must block. Add a case here when the guard gains a shape.
const allowed = [
  "grep -rn foo .",
  "rg -n secret kubernetes/",
  "git status",
  "just docs test",
  "just kube registry-auth",
  "kubectl get pods -A",
  "kubectl exec -n ai paseo -- ls /tmp",
  "kubectl exec -n ai paseo -- nginx -t",
  "kubectl get externalsecret -n ai paseo -o json | jq '{ready:.status.conditions, refreshTime:.status.refreshTime}'",
  "kubectl auth can-i get secrets",
  "helm list -A",
  "cat README.md",
  "cat .env.example",
  "jq -S /etc/paseo/opencode.json",
  "cat /etc/paseo/kubeconfig",
  "cat ~/.ssh/known_hosts",
  "cat ~/.ssh/id_rsa.pub",
  "sqlite3 app.db '.tables'",
  "sqlite3 app.db '.schema settings'",
  "sqlite3 app.db 'select count(*) from settings'",
  "psql -c '\\dt'",
  "psql -c 'select count(*) from settings'",
  "talosctl -n 10.0.0.1 get members",
  "env FOO=bar git status",
  "kubectl -n ai get secret paseo -o json | jq '{keys:(.data|keys), bytes:(.data|map_values(length))}'",
  "kubectl -n ai get secret paseo -o json | jq '.metadata.annotations | keys'",
  "kubectl -n ai get secret paseo -o json | jq -e '.data | has(\"FIELD\")' >/dev/null",
  "kubectl -n ai get secret paseo -o json | jq '.data | map_values(\"<redacted>\")'",
  "kubectl -n ai describe secret paseo",
  "akeyless describe-item --name /ai/memini --json | jq 'del(.public_value) | del(.custom_fields[]?.value)'",
  "akeyless get-secret-value --name /ai/memini --json | jq -r 'paths(scalars) | map(tostring) | join(\".\")'",
  "akeyless get-secret-value --name /ai/memini --json | jq -e 'to_entries[] | .value | has(\"FIELD\")' >/dev/null",
  'akeyless get-secret-value --name /ai/memini --json | jq \'walk(if type == "string" then "<redacted>" else . end)\'',
  "akeyless get-secret-value --name /ai/memini --json | jq -r '.FIELD' | sha256sum | cut -c1-12",
];

const blocked = [
  "kubectl -n ai get secret paseo -o yaml",
  "kubectl -n ai get secret paseo -o json",
  "kubectl -n ai get secret paseo -o jsonpath='{.data.X}'",
  "kubectl -n ai get secret paseo -o json | jq -r '.data.FIELD'",
  "kubectl exec -n ai paseo -- env",
  "kubectl exec -n ai paseo -- cat /etc/paseo/signing_key",
  "kubectl exec -n ai paseo -- sh -c 'echo x'",
  "kubectl cp ai/paseo:/etc/paseo/signing_key /tmp/k",
  "akeyless get-secret-value --name /ai/memini",
  "akeyless get-secret-value --name /ai/memini > /tmp/x",
  "akeyless get-secret-value --name /ai/memini | tee /tmp/x",
  "akeyless get-secret-value --name /ai/memini | jq -r '.FIELD'",
  "printenv",
  "env",
  "ps eww",
  "cat /proc/self/environ",
  "cat .env",
  "source .env",
  "cat ~/.ssh/id_ed25519",
  "bash -c 'cat ~/.ssh/id_ed25519'",
  "dd if=/etc/paseo/signing_key",
  "cat ~/.kube/config",
  "cat ~/.config/gh/hosts.yml",
  "cat ~/.akeyless/profiles/default.toml",
  "cat ~/.paseo/local-credential",
  "cat /etc/paseo/signing_key",
  "cat /etc/paseo/talosconfig",
  "cat /var/run/secrets/kubernetes.io/serviceaccount/token",
  "talosctl -n 10.0.0.1 read /etc/kubernetes/kubeconfig",
  "talosctl -n 10.0.0.1 etcd snapshot /tmp/x",
  "sops -d secrets.yaml",
  "helm get values paseo -n ai",
  "gh auth token",
  "gh secret list",
  "aws secretsmanager get-secret-value --secret-id x",
  "vault kv get secret/x",
  "op item get x --reveal",
  "base64 -d file",
  "sqlite3 app.db '.dump'",
  "sqlite3 app.db 'select * from settings'",
  "sqlite3 app.db 'select api_key from settings'",
  "pg_dump db",
  "psql -c 'select * from settings'",
  "kubectl config view --raw",
];

const paths: Array<[string, string, boolean]> = [
  ["read", "/etc/paseo/opencode.json", false],
  ["read", "/etc/paseo/signing_key", true],
  ["read", "/home/paseo/.ssh/known_hosts", false],
  ["read", "/home/paseo/.ssh/id_ed25519", true],
  ["read", "/var/run/secrets/kubernetes.io/serviceaccount/ca.crt", false],
  ["read", "/var/run/secrets/kubernetes.io/serviceaccount/token", true],
  ["grep", "/workspace/worktrees/x", false],
  ["grep", "/home/paseo", true],
  ["grep", "/home/paseo/.ssh", true],
  ["write", "/home/paseo/.omp/agent/hooks/pre/secret-guard.ts", true],
  ["read", "/home/paseo/.omp/agent/hooks/pre/secret-guard.ts", false],
  ["read", "/home/paseo/.paseo/config.json", false],
];

describe("bash and eval", () => {
  for (const command of allowed) {
    test(`allows: ${command}`, () => expect(secretAccess(command)).toBeNull());
  }
  for (const command of blocked) {
    test(`blocks: ${command}`, () => expect(secretAccess(command)).not.toBeNull());
  }
});

describe("path tools", () => {
  for (const [tool, path, block] of paths) {
    test(`${block ? "blocks" : "allows"} ${tool} ${path}`, () =>
      expect(pathAccess(tool, path) === null).toBe(!block));
  }
});
