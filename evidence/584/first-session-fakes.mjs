// Fake `claude` / `codex` / `opencode` executables for the first-session check of PR #584:
// small shell scripts that print a version and append every call to a log. No real CLI is
// ever run, and the fakes contact nothing.
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const VERSION_LINE = {
  claude: (v) => `${v} (Claude Code)`,
  codex: (v) => `codex-cli ${v}`,
  opencode: (v) => `${v}`,
};

/** Write a fake `tool` that prints `version` for `--version` and logs `<parent pid> <file> <args>`. */
export function fake(file, { tool, version, log }) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(
    file,
    `#!/bin/sh
# Fake ${tool} ${version} for the PR #584 first-session check. Contacts nothing.
echo "$PPID ${file} $*" >> '${log}'
if [ "$1" = "--version" ]; then
  echo '${VERSION_LINE[tool](version)}'; exit 0
fi
# Anything else (a session, a model list, a login state): not a real CLI, end at once.
echo "fake ${tool}: nothing behind this stand-in" >&2
exit 1
`,
  );
  chmodSync(file, 0o755);
  return file;
}
