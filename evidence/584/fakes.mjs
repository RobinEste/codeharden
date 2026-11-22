// Fake `claude` / `codex` executables for the audit of PR #584: small shell scripts that print a
// version and a login state, and append every call to a log. No real CLI is ever run.
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/**
 * Write a fake CLI. `version` is what `--version` prints (null: prints text with no version);
 * `auth`: "ok" (signed in), "old-claude" (no `auth status`: hangs like a prompt would),
 * "old-codex" (fails on a current config), "hang-version" (`--version` never answers).
 */
export function fake(file, { tool, version, auth = "ok", log, withPid = false }) {
  mkdirSync(dirname(file), { recursive: true });
  const versionLine =
    version === null
      ? "echo 'hello from a tool that prints no version'"
      : tool === "claude"
        ? `echo '${version} (Claude Code)'`
        : `echo 'codex-cli ${version}'`;
  const authBlock = {
    ok:
      tool === "claude"
        ? `echo '{"loggedIn": true, "authMethod": "claude.ai", "apiProvider": "firstParty", "email": "fake@example.test"}'; exit 0`
        : `echo 'Logged in using ChatGPT'; exit 0`,
    "old-claude": "exec sleep 40",
    "old-codex":
      "echo \"Error loading configuration: missing field 'command' in 'mcp_servers.notion'\" >&2; exit 1",
  }[auth === "hang-version" ? "ok" : auth];
  const authArgs = tool === "claude" ? "auth status" : "login status";
  writeFileSync(
    file,
    `#!/bin/sh
# Fake ${tool} ${version ?? "(no version)"} for the PR #584 audit. Contacts nothing.
echo "${withPid ? "$PPID " : ""}${file} $*" >> '${log}'
if [ "$1" = "--version" ]; then
  ${auth === "hang-version" ? "exec sleep 40" : `${versionLine}; exit 0`}
fi
if [ "$1 $2" = "${authArgs}" ]; then
  ${authBlock}
fi
# Anything else (a session or a model list): not a real CLI, end at once.
echo "fake ${tool}: nothing behind this stand-in" >&2
exit 1
`,
  );
  chmodSync(file, 0o755);
  return file;
}
