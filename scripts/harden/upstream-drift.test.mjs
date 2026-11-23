// Keeps the fork's changes through upstream merges ("Keeping the fork's changes through
// upstream merges" in AGENTS.md). Two checks over the tracked source, read as text:
//
//   1. No product code uses one of upstream CodeDen's identity values as a value (its npm
//      package, repository, home folder, projects folder, port, app id, link scheme, keychain
//      service, app name), except the uses in ALLOWED below, each with its reason.
//   2. Every place the fork redirected to its own channel (CALL_SITES below) still reads it.
//
// Upstream's values are fixed text here and are never compared with this fork's own names, so
// the test reads the same in CodeHarden and in a fork configured with its own variables.
//
// This file is under scripts/harden/, which the sync workflow never lets an upstream merge
// change without a review.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));

/** What ships or builds the product. Tests, docs and the fork's own scripts are not scanned. */
const IN_SCOPE = [
  /^(?:apps|packages)\/[^/]+\/src\//,
  /^(?:apps|packages)\/[^/]+\/scripts\//,
  /^(?:apps|packages)\/[^/]+\/[^/]+\.(?:ts|mts|mjs|js|json|html)$/,
  /^apps\/web\/public\/[^/]+\.webmanifest$/,
  /^apps\/cli\/docker\//,
  /^apps\/desktop\/build\/[^/]+\.plist$/,
  /^apps\/server\/templates\//,
  /^package\.json$/,
];
const OUT_OF_SCOPE = [
  /(?:^|\/)(?:test|e2e|__tests__)\//,
  /\.(?:test|spec)\.[a-z]+$/,
  /(?:^|\/)(?:vitest|playwright)\.config\.[a-z]+$/,
  /(?:^|\/)tsconfig[^/]*\.json$/,
  /\.(?:png|jpe?g|gif|ico|icns|svg|woff2?|wasm)$/,
];

function inScope(file) {
  return IN_SCOPE.some((p) => p.test(file)) && !OUT_OF_SCOPE.some((p) => p.test(file));
}

/**
 * Upstream's identity values, as they appear when code uses them as a value. `back` says what
 * came back, `use` what the fork reads instead: a constant of
 * `packages/contracts/src/harden-channel.ts`, or in a build script a field of
 * `readHardenChannel()` (`scripts/harden/channel-define.mjs`).
 */
const RULES = [
  {
    id: "npm-package",
    pattern:
      /npmjs\.org\/codeden\b|\/package\/codeden\b|\bnpm (?:i|install|view|exec|update)\b[^"'`\n]*\bcodeden\b|\bnpx (?:-y |--yes )?codeden\b|\bcodeden@(?!localhost\b)|node_modules["',\s/\\]+codeden\b/,
    back: "upstream's npm package `codeden` (a registry URL, an install or npx command, or its folder in node_modules)",
    use: "HARDEN_PACKAGE_NAME, HARDEN_INSTALL_COMMAND, HARDEN_NPX_COMMAND or HARDEN_PACKAGE_SEGMENTS",
  },
  {
    id: "repository",
    pattern: /leonvanzyl/i,
    back: "upstream's GitHub repository `leonvanzyl/codeden`",
    use: "HARDEN_REPOSITORY or a URL helper (hardenRepositoryUrl, hardenReleaseUrl, hardenLatestReleaseUrl, hardenChangelogUrl, hardenDocsUrl); in a build script `readHardenChannel().repository`",
  },
  {
    id: "home-folder",
    pattern: /(?<![\w-])\.codeden(?![\w-])/,
    back: "upstream's home folder name `.codeden`",
    use: "HARDEN_HOME_DIRNAME (HARDEN_HOME_DISPLAY in text shown to people)",
  },
  {
    id: "projects-folder",
    pattern: /codeden-projects/,
    back: "upstream's projects folder name `codeden-projects`",
    use: "HARDEN_PROJECTS_DIRNAME",
  },
  {
    id: "default-port",
    pattern: /(?<![\w.])4317(?![\w.])/,
    back: "upstream's default port 4317",
    use: "HARDEN_DEFAULT_PORT (the CLI's and the desktop app's `DEFAULT_PORT` read it)",
  },
  {
    id: "app-id",
    pattern: /dev\.codeden\b/,
    back: "upstream's app id `dev.codeden.app`",
    use: "HARDEN_APP_ID; in the packaging config `readHardenChannel().appId`",
  },
  {
    id: "link-scheme",
    pattern: /\bcodeden:\/\/|["'`]codeden:["'`]/,
    back: "upstream's link scheme `codeden://`",
    use: "HARDEN_DEEP_LINK_SCHEME (contracts' `DEEP_LINK_SCHEME` reads it)",
  },
  {
    id: "bare-name",
    pattern: /(["'`])codeden\1/,
    back: "the bare text `codeden` as a value (upstream's package name, command, link scheme and keychain service are all this word)",
    use: "HARDEN_PACKAGE_NAME, HARDEN_COMMAND, HARDEN_DEEP_LINK_SCHEME, HARDEN_KEYCHAIN_SERVICE or HARDEN_APP_SLUG, whichever this value is",
  },
  {
    id: "app-name",
    pattern:
      /(["'`])CodeDen\1|\bCodeDen[-_](?:Setup|\$\{)|\bCodeDen\.(?:app|exe|AppImage)\b|(?:productName|shortcutName|executableName|artifactName|applicationName|setName|setAppUserModelId|setTitle|\btitle)\b\W{0,6}CodeDen\b/,
    back: "upstream's product name `CodeDen` where it names the app (its name, a title, an installer or executable name)",
    use: "HARDEN_PRODUCT_NAME; in the packaging config `readHardenChannel().productName`",
  },
];

const ANY = /^/;
const MOCK = /^apps\/web\/src\/lib\/api\/(?:mock\/|network-api\.ts$)/;
const WHY = {
  project:
    "the `.codeden/` folder inside a project's repository (its settings, vision, notes and automations): a file format shared with upstream, not this install's home",
  sender:
    "the sender id of messages the app itself sends (contracts' `MessageSender`), kept in transcripts",
  resolver: "the id of the app as the one who closed an inbox item (a contracts enum value)",
  mcp: "the `codeden` MCP server name agents see (their tools are `mcp__codeden__*`); renaming it would change every agent's tool names",
  mock: "sample data of the in-memory mock client (development only; builds always use the real server)",
  brand:
    "brand text the fork left as CodeDen: a label people read, not the app's identity on the machine",
  page: "the web page's own title stays CodeDen; the desktop window puts the version line in its place (`harden-display.ts`)",
  upstreamPack:
    "upstream's own manifest and publish step, kept as they are; the fork's release writes the name, links and README in a staging copy (`scripts/harden/npm-release.mjs`)",
  sandbox:
    "the package and command name inside the sandbox image, which is built on this machine from this build's own bundle; nothing is fetched from npm under that name",
  hello: "how the app introduces itself to an agent CLI or a web server (a client name)",
  commits: "the author name of checkpoint commits and of git inside the sandbox image",
};

/**
 * The uses of upstream's values that stay: `[files, text, reason]`. An entry exempts only the
 * text its pattern matches, in the files it names; anything else on the same line or in the
 * same file is still checked. Add an entry only with a reason a reviewer can judge ("the test
 * failed" is not one). An entry that no longer matches anything fails the test.
 */
// biome-ignore format: one entry per line, read as a table
const ALLOWED = [
  // --- the upstream home's name, kept on purpose
  ["packages/contracts/src/harden-channel.ts", /UPSTREAM_HOME_DIRNAME = "\.codeden"/, "the upstream home's name, kept to tell people about the old home (`hardenHomeNotice`); nothing is read from or written to it"],
  // --- `.codeden/` inside a repository
  [ANY, /(?<![~\w]\/)\.codeden\/(?:project\.json|VISION\.md|notes\.md)/, WHY.project],
  [/^apps\/(?:server\/src\/services\/factory\/prompts\.ts|web\/src\/lib\/api\/mock\/)/, /(?<![~\w]\/)\.codeden\/(?:automations\/|`)/, WHY.project],
  ["apps/server/src/services/automations/sources.ts", /join\("\.codeden", "automations"\)/, WHY.project],
  ["apps/server/src/services/projects/project-config.ts", /join\(projectPath, "\.codeden", "project\.json"\)/, WHY.project],
  ["apps/server/src/services/factory/policy.ts", /"\*\*\/\.codeden\/\*\*"|\(\?:\.\*\\\/\)\?\\\.codeden\\\//, WHY.project],
  ["packages/providers/src/policy/project-config.ts", /base === "\.codeden"|lastIndexOf\("\.codeden"\)|\/\\\.codeden\[\\\\\/\]\+/, WHY.project],
  ["apps/web/src/lib/api/mock/fixtures/workbench.ts", /d\("\.codeden",/, WHY.project],
  // --- ids in the protocol and in stored data
  [/^apps\/server\/src\/services\//, /\bfrom(?::| ===| !==) "codeden"/, WHY.sender],
  ["apps/server/src/services/container.ts", /whenBusy: "queue" \}, "codeden"\)/, WHY.sender],
  ["apps/server/src/services/sessions/session-service.ts", /\}, "codeden"\);/, WHY.sender],
  ["apps/server/src/services/orchestration/orchestration-service.ts", /^\s*"codeden",$/, WHY.sender],
  ["packages/contracts/src/input.ts", /^\s*"codeden",$/, WHY.sender],
  ["apps/server/src/events/reducer/signin.ts", /by: "codeden"/, WHY.resolver],
  ["apps/server/src/services/inbox-settle.ts", /const by = "codeden" as const/, WHY.resolver],
  ["packages/contracts/src/entities/inbox.ts", /z\.enum\(\["codeden", "factory"\]\)/, WHY.resolver],
  [/^(?:apps\/server\/src\/routes\/api\.ts|packages\/contracts\/src\/ws\.ts)$/, /name: (?:"codeden"|z\.literal\("codeden"\)),/, "the protocol name in the health answer; a running server is found through its own home's lock file, so this name doesn't tell installs apart"],
  // --- the MCP server name
  ["apps/server/src/mcp/prompt.ts", /MCP_SERVER_NAME = "codeden"/, WHY.mcp],
  ["apps/server/src/mcp/endpoint.ts", /realm="codeden"|\{ name: "codeden", version: CODEDEN_VERSION \}/, WHY.mcp],
  ["apps/server/src/services/agent-config/agent-config-service.ts", /(?:provider|name): "codeden"/, WHY.mcp],
  ["packages/contracts/src/agent-config.ts", /z\.enum\(\["claude", "codex", "codeden"\]\)/, WHY.mcp],
  ["packages/providers/src/fake/session.ts", /server: "codeden"/, WHY.mcp],
  ["apps/web/src/lib/mcp-status.ts", /CODEDEN_MCP_SERVER = "codeden"|provider === "codeden"/, WHY.mcp],
  [/^apps\/web\/src\/components\/agents\/mcp-server(?:s|-dialog)\.tsx$/, /provider [!=]== "codeden"/, WHY.mcp],
  [/^apps\/web\/src\/lib\/api\/mock\/fixtures\/(?:config|sessions|transcripts-[ab])\.ts$/, /(?:provider|name): "codeden"|^\s*"codeden",$|mcp\("[\w-]+", "codeden",/, WHY.mcp],
  // --- the mock client's sample data
  ["apps/web/src/lib/api/mock/index.ts", /runTurn\(id, brief, "codeden"\)/, WHY.mock],
  [MOCK, /~\/\.codeden\/(?:wt|backups|orchestrator|models|deps)\b/, WHY.mock],
  [MOCK, /\\\\\.codeden\\\\wt\\\\/, WHY.mock],
  ["apps/web/src/lib/api/network-api.ts", /(?:url: "http:\/\/[\w.]+:|^\s*port: )4317\b/, WHY.mock],
  // --- client names and commit authors
  [/^packages\/providers\/src\/(?:acp|codex)\/process\.ts$/, /clientInfo: \{ name: "codeden", title: "CodeDen",/, WHY.hello],
  ["apps/server/src/services/automations/import-link.ts", /"user-agent": "codeden"/, WHY.hello],
  ["apps/server/src/services/remote-image.ts", /"user-agent": "CodeDen"/, WHY.hello],
  ["packages/providers/src/opencode/session.ts", /INSTRUCTIONS_KEY = "codeden"/, "the key of the app's entry in an OpenCode session's instructions"],
  ["apps/runner/src/git/checkpoints.ts", /GIT_(?:AUTHOR|COMMITTER)_NAME: "CodeDen"/, WHY.commits],
  ["apps/cli/docker/Dockerfile", /user\.name "CodeDen"/, WHY.commits],
  ["packages/contracts/src/network.ts", /^\s*"codeden",$/, "an entry in the list of passwords too easy to guess"],
  // --- the sandbox image
  ["apps/server/src/execution/docker/args.ts", /^\s*"codeden",$/, WHY.sandbox],
  ["apps/server/src/execution/docker/image.ts", /\{ name: "codeden", version, private: true,/, WHY.sandbox],
  // --- upstream's manifest and publish step
  ["apps/cli/package.json", /"name": "codeden"|"codeden": "\.\/dist\/cli\.js"|github\.com\/leonvanzyl\/codeden(?:\.git|\/issues)"/, WHY.upstreamPack],
  ["apps/cli/scripts/copy-readme.mjs", /(?:REPO|RAW) = "https:\/\/(?:github\.com|raw\.githubusercontent\.com)\/leonvanzyl\/codeden(?:\/main)?"/, WHY.upstreamPack],
  // --- brand text
  ["apps/desktop/src/main/harden-display.ts", /PAGE_NAME = "CodeDen"/, WHY.page],
  ["apps/web/index.html", /<title>CodeDen<\/title>|apple-mobile-web-app-title" content="CodeDen"/, WHY.page],
  ["apps/web/public/manifest.webmanifest", /"(?:short_)?name": "CodeDen"/, WHY.page],
  ["apps/web/src/lib/attention/title.ts", /APP_TITLE = "CodeDen"/, WHY.page],
  ["apps/web/src/lib/platform.ts", /document\.title : "CodeDen"/, WHY.page],
  [/^apps\/server\/src\/(?:routes\/static|security)\.ts$/, /<title>CodeDen<\/title>/, WHY.page],
  ["apps/web/src/components/shell/live-effects.tsx", /\?\? "CodeDen",/, WHY.brand],
  ["apps/web/src/components/thread/sender-message.tsx", /codeden: (?:\{ label: )?"CodeDen"/, WHY.brand],
  ["apps/web/src/components/agents/mcp-servers.tsx", /codeden: "CodeDen"/, WHY.brand],
  ["apps/web/src/components/automations/meta.ts", /database: "CodeDen"/, WHY.brand],
  [/^apps\/server\/src\/services\/sessions\/(?:handoff-brief|transcript-items)\.ts$/, /codeden: "CodeDen"/, WHY.brand],
  ["apps/server/src/services/agent-config/agent-config-service.ts", /file: "CodeDen"/, WHY.brand],
].map(([file, pattern, reason]) => ({
  file,
  pattern: new RegExp(pattern.source, `${pattern.flags}g`),
  reason,
}));

/** Lines of `text` with comments blanked, so prose about upstream is never a hit. */
function codeLines(file, text) {
  const script = /\.[cm]?[jt]sx?$/.test(file);
  const hash = /\.(?:sh|ya?ml)$|Dockerfile$/.test(file);
  let inBlock = false;
  return text.split("\n").map((raw) => {
    let line = raw;
    if (hash) return /^\s*#/.test(line) ? "" : line;
    if (!script) return line;
    if (inBlock) {
      const end = line.indexOf("*/");
      if (end < 0) return "";
      inBlock = false;
      line = line.slice(end + 2);
    }
    // A comment starts a line or follows a space: `"**/*"` and `https://` are not comments.
    line = line.replace(/(^|\s)\/\*.*?\*\//g, "$1");
    const start = /(^|\s)\/\*/.exec(line);
    if (start) {
      inBlock = true;
      line = line.slice(0, start.index);
    }
    return line.replace(/(^|\s)\/\/.*$/, "");
  });
}

const appliesTo = (entry, file) =>
  typeof entry.file === "string" ? entry.file === file : entry.file.test(file);

/** Upstream identity values used in `text`, after the allowed uses are taken out. */
function scan(file, text, used = new Set()) {
  const entries = ALLOWED.filter((entry) => appliesTo(entry, file));
  const hits = [];
  codeLines(file, text).forEach((code, index) => {
    if (!/codeden|leonvanzyl|4317/i.test(code)) return;
    let rest = code;
    for (const entry of entries) {
      rest = rest.replace(entry.pattern, (match) => {
        used.add(entry);
        return "\u0000".repeat(match.length);
      });
    }
    for (const rule of RULES) {
      if (rule.pattern.test(rest)) hits.push({ file, line: index + 1, rule, text: code.trim() });
    }
  });
  return hits;
}

function hitReport(hits) {
  const list = hits.map(
    (hit) =>
      `${hit.file}:${hit.line}\n    ${hit.text.slice(0, 160)}\n    Came back: ${hit.rule.back}.\n    Use instead: ${hit.rule.use}.`,
  );
  return `\n\nUpstream's identity is used in product code (${hits.length}). With these, part of this product behaves like upstream CodeDen again. Change each to the fork's value; add it to ALLOWED in scripts/harden/upstream-drift.test.mjs only if it is not the install's identity, with the reason.\n\n${list.join("\n\n")}\n`;
}

/**
 * Where the fork redirected upstream's code to its own channel, derived from the fork's diff
 * against upstream: `[file, what the fork changed there, ...what the file must still contain]`.
 * A name is looked for as a word in the file's code (comments don't count); a pattern as written.
 */
// biome-ignore format: one entry per line, read as a table
const CALL_SITES = [
  // --- the channel itself
  ["packages/contracts/src/harden-channel.ts", "the one module that names the package, repository and identity", "HARDEN_PACKAGE_NAME", "HARDEN_REPOSITORY", "HARDEN_PRODUCT_NAME", "HARDEN_APP_ID", "HARDEN_HOME_DIRNAME", "HARDEN_PROJECTS_DIRNAME", "HARDEN_KEYCHAIN_SERVICE", "HARDEN_DEEP_LINK_SCHEME", "HARDEN_DEFAULT_PORT", "__CODEHARDEN_PACKAGE__", "__CODEHARDEN_SLUG__", "__CODEHARDEN_PORT__"],
  ["packages/contracts/src/harden-version.ts", "the version line every display uses", "formatHardenVersion", "HARDEN_VERSION", "UPSTREAM_VERSION", "__CODEHARDEN_VERSION__"],
  ["packages/contracts/src/index.ts", "exports the channel and the version module", /export \* from "\.\/harden-channel"/, /export \* from "\.\/harden-version"/],
  ["packages/contracts/package.json", "lets the CLI launcher load the channel alone", /"\.\/harden-channel": "\.\/src\/harden-channel\.ts"/],
  ["packages/contracts/src/desktop.ts", "the link scheme the desktop app registers", /DEEP_LINK_SCHEME = HARDEN_DEEP_LINK_SCHEME/],
  ["packages/contracts/src/ws.ts", "the two versions in the health answer and the snapshot", "hardenVersion", "upstreamVersion"],
  // --- every bundle gets both build-time defines
  ["apps/cli/tsdown.config.ts", "injects the version and the channel into the CLI bundle", /\.\.\.hardenVersionDefine\(\)/, /\.\.\.hardenChannelDefine\(\)/],
  ["apps/desktop/tsdown.config.ts", "injects the version and the channel into the desktop bundles", /\.\.\.hardenVersionDefine\(\)/, /\.\.\.hardenChannelDefine\(\)/],
  ["apps/web/vite.config.ts", "injects the version and the channel into the web app", /\.\.\.hardenVersionDefine\(\)/, /\.\.\.hardenChannelDefine\(\)/],
  // --- home, port, projects folder, keychain
  ["apps/server/src/paths.ts", "the default home folder", /join\(homedir\(\), HARDEN_HOME_DIRNAME\)/],
  ["apps/server/src/services/container.ts", "the default folder for clones", /join\(userHome, HARDEN_PROJECTS_DIRNAME\)/],
  ["apps/server/src/services/secrets.ts", "the keychain service secrets are kept under", /service = HARDEN_KEYCHAIN_SERVICE/],
  ["apps/server/src/security.ts", "the command the locked page tells people to run", "HARDEN_NPX_COMMAND"],
  ["apps/server/src/routes/api.ts", "the versions the server reports", "HARDEN_VERSION", "UPSTREAM_VERSION"],
  ["apps/cli/src/args.ts", "the CLI's default port, home and command in the help", /DEFAULT_PORT = HARDEN_DEFAULT_PORT/, "HARDEN_HOME_DISPLAY", "HARDEN_COMMAND", "formatHardenVersion"],
  ["apps/cli/src/network-command.ts", "the network command's port comes from the CLI's default", /import \{ DEFAULT_PORT \} from "\.\/args"/],
  ["apps/cli/src/launcher.ts", "the launcher's home, the installed package it may start and the commands it prints", /join\(homedir\(\), HARDEN_HOME_DIRNAME\)/, /pkg\.name !== HARDEN_PACKAGE_NAME/, "HARDEN_PACKAGE_SEGMENTS", "HARDEN_NPX_COMMAND", "HARDEN_UPDATE_COMMAND", "HARDEN_COMMAND"],
  ["apps/cli/src/harden-home.ts", "the notice about the old home", "HARDEN_HOME_DIRNAME", "UPSTREAM_HOME_DIRNAME", "hardenHomeNotice"],
  ["apps/cli/src/cli.ts", "the bare package version is printed for the updater's probe only", /CODEDEN_NO_SWITCH === "1"/],
  ["apps/cli/src/main.ts", "the version line of `--version`", "formatHardenVersion"],
  ["apps/cli/src/commands.ts", "the version line and command name in CLI output", "formatHardenVersion", "HARDEN_COMMAND"],
  ["apps/cli/src/doctor.ts", "the version line and update command in `doctor`", "formatHardenVersion", "HARDEN_UPDATE_COMMAND"],
  ["apps/cli/src/update-command.ts", "the update command it prints", "HARDEN_UPDATE_COMMAND"],
  // --- self-update: only the channel's package, only the fork's releases
  ["apps/server/src/services/updates/app-dir.ts", "the package self-update installs and may run", /PACKAGE_NAME = HARDEN_PACKAGE_NAME/, /pkg\.name !== PACKAGE_NAME/],
  ["apps/server/src/services/updates/registry.ts", "the registry lookup and the release notes links", /registryPackagePath\(PACKAGE_NAME\)/, "hardenReleaseUrl", "hardenReleaseApiUrl", "hardenChangelogUrl", "hardenVersionOf"],
  ["apps/server/src/services/updates/installer.ts", "what npm is asked to install", /`\$\{PACKAGE_NAME\}@\$\{version\}`/],
  ["apps/server/src/services/updates/desktop.ts", "where desktop installers are downloaded from", /DESKTOP_RELEASES_URL = hardenLatestReleaseUrl\(\)/],
  ["apps/server/src/services/updates/service.ts", "the manual install command", "HARDEN_INSTALL_COMMAND"],
  // --- desktop app and its packaging
  ["apps/desktop/electron-builder.config.mjs", "the installer's app id, names, link scheme and update feed", /readHardenChannel\(\)/, /^ {2}appId,$/m, /^ {2}productName,$/m, /schemes: \[slug\]/, /owner: channel\.owner, repo: channel\.repo/, /executableName: productName/, /executableName: slug/, /shortcutName: productName/],
  ["apps/desktop/scripts/package.mjs", "the staged app's name and version", /readHardenChannel\(\)/, /name: channel\.slug/, /productName: channel\.productName/, /npmVersion\(readHardenVersion\(\)\)/],
  ["apps/desktop/scripts/check-mac-signature.sh", "finds the app by its own name", "app_in", "CFBundleExecutable"],
  ["apps/desktop/src/main/args.ts", "the desktop app's default port and home", /DEFAULT_PORT = HARDEN_DEFAULT_PORT/, /join\(home, HARDEN_HOME_DIRNAME\)/],
  ["apps/desktop/src/main/main.ts", "the app's name, About panel and Windows app id", /app\.setName\(HARDEN_PRODUCT_NAME\)/, /setAppUserModelId\(HARDEN_APP_ID\)/, "hardenAboutPanel"],
  ["apps/desktop/src/main/harden-display.ts", "the window title and About panel", "hardenWindowTitle", "hardenAboutPanel", "HARDEN_PRODUCT_NAME"],
  ["apps/desktop/src/main/window.ts", "the window title", "hardenWindowTitle"],
  ["apps/desktop/src/main/desktop-app.ts", "the app's name, version line and docs links", "HARDEN_PRODUCT_NAME", "formatHardenVersion", "hardenDocsUrl", "hardenVersionOf"],
  ["apps/desktop/src/main/menu.ts", "the app's name in the menu", "HARDEN_PRODUCT_NAME"],
  ["apps/desktop/src/main/tray.ts", "the app's name in the tray", "HARDEN_PRODUCT_NAME"],
  ["apps/desktop/src/main/tray-view.ts", "the app's name and version in the tray menu", "HARDEN_PRODUCT_NAME", "hardenVersionOf"],
  ["apps/desktop/src/server/serve.ts", "the name and version line of the server the app hosts", "HARDEN_PRODUCT_NAME", "formatHardenVersion"],
  // --- web UI
  ["apps/web/src/components/shell/unauthorized.tsx", "the command the locked page tells people to run", "HARDEN_NPX_COMMAND"],
  ["apps/web/src/lib/api/updates-api.ts", "release links", "hardenReleaseUrl"],
  ["apps/web/src/lib/factory-guide.ts", "docs links", "hardenDocsUrl"],
  ["apps/web/src/routes/settings.tsx", "the version line in Settings", "formatHardenVersion"],
];

/** A needed name or pattern as a reader would look for it in the file. */
const say = (need) =>
  typeof need === "string"
    ? need
    : `\`${need.source
        .replace(/^\^ \{2\}/, "")
        .replace(/\$$/, "")
        .replace(/\\(.)/g, "$1")}\``;

/** What a call site lost, in words, or null when it is as the fork left it. */
function callSiteProblem([file, what, ...needs], text) {
  if (text === null) {
    return `${file} is gone.\n    The fork changed it for: ${what}. Upstream moved, renamed or removed the file (or a conflict resolution dropped it). Find where that logic lives now, re-apply the fork's change there (it must end up reading ${needs.map(say).join(", ")}), and point this entry of CALL_SITES at the new file.`;
  }
  const code = codeLines(file, text).join("\n");
  const missing = needs.filter((need) =>
    typeof need === "string"
      ? !new RegExp(`(?<![\\w$])${need}(?![\\w$])`).test(code)
      : !need.test(code),
  );
  if (missing.length === 0) return null;
  return `${file} no longer has ${missing.map(say).join(", ")}.\n    The fork changed it for: ${what}. A merge took upstream's side here, or upstream rewrote this code: look at the file's history (git log -p -- ${file}), put the fork's change back, and check what the code uses in its place (often upstream's fixed value).`;
}

function trackedFiles() {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")),
  );
  const result = spawnSync("git", ["ls-files", "-z"], { cwd: ROOT, encoding: "utf8", env });
  if (result.status !== 0) throw new Error(`git ls-files failed: ${result.stderr}`);
  return result.stdout.split("\0").filter(Boolean);
}

const read = (file) =>
  existsSync(`${ROOT}/${file}`) ? readFileSync(`${ROOT}/${file}`, "utf8") : null;
const D = "$";
const TICK = "`";
const rulesHit = (file, text) => [...new Set(scan(file, text).map((hit) => hit.rule.id))];

describe("upstream's identity does not come back into product code", () => {
  it("no product file uses an upstream identity value outside the allowed list", () => {
    const used = new Set();
    const files = trackedFiles().filter(inScope);
    expect(
      files.length,
      "the scan found almost no files: the source folders moved",
    ).toBeGreaterThan(500);
    const hits = files.flatMap((file) => scan(file, read(file) ?? "", used));
    expect(hits.length, hitReport(hits)).toBe(0);

    const stale = ALLOWED.filter((entry) => !used.has(entry)).map(
      (entry) => `${String(entry.file)}: ${entry.pattern.source}\n    (${entry.reason})`,
    );
    expect(
      stale.length,
      `\n\nThese ALLOWED entries match nothing any more: upstream changed or removed the text. Remove each entry, or correct it if the same text only moved or changed shape.\n\n${stale.join("\n\n")}\n`,
    ).toBe(0);
  });

  it("scans what ships and builds the product, not tests or docs", () => {
    for (const file of [
      "apps/server/src/services/updates/new-check.ts",
      "apps/desktop/electron-builder.config.mjs",
      "apps/desktop/scripts/package.mjs",
      "apps/web/vite.config.ts",
      "apps/cli/package.json",
      "packages/contracts/src/harden-channel.ts",
      "apps/web/index.html",
    ]) {
      expect(inScope(file), file).toBe(true);
    }
    for (const file of [
      "apps/server/test/updates.test.ts",
      "apps/web/e2e/update.spec.ts",
      "docs/DESIGN.md",
      "CHANGELOG.md",
      "README.md",
      "scripts/harden/release.sh",
      "apps/web/vitest.config.ts",
    ]) {
      expect(inScope(file), file).toBe(false);
    }
  });

  // What an upstream merge could bring back, run through the same scanner.
  // biome-ignore format: one case per line
  it.each([
    ["the home folder in the server's paths", "apps/server/src/paths.ts", '  return join(homedir(), ".codeden");', "home-folder"],
    ["the fixed package name in the update code", "apps/server/src/services/updates/app-dir.ts", 'export const PACKAGE_NAME = "codeden";', "bare-name"],
    ["a new file that asks the registry for upstream's package", "apps/server/src/services/updates/new-check.ts", 'const res = await fetch("https://registry.npmjs.org/codeden/latest");', "npm-package"],
    ["an install command for upstream's package", "apps/server/src/services/updates/service.ts", "const manual = `npm i -g codeden@latest`;", "npm-package"],
    ["a new default port", "apps/cli/src/network-command.ts", "const DEFAULT_PORT = 4317;", "default-port"],
    ["a port fallback in a new file", "apps/desktop/src/main/new-port.ts", "const port = Number(env.PORT ?? 4317);", "default-port"],
    ["the app id in the electron-builder config", "apps/desktop/electron-builder.config.mjs", '  appId: "dev.codeden.app",', "app-id"],
    ["the product name in the electron-builder config", "apps/desktop/electron-builder.config.mjs", '  productName: "CodeDen",', "app-name"],
    ["an installer named after upstream", "apps/desktop/electron-builder.config.mjs", `    artifactName: "CodeDen-Setup-${D}{version}.${D}{ext}",`, "app-name"],
    ["the update feed of upstream's repository", "apps/desktop/electron-builder.config.mjs", '  publish: [{ provider: "github", owner: "leonvanzyl", repo: "codeden" }],', "repository"],
    ["the app's name in the desktop entry", "apps/desktop/src/main/main.ts", 'app.setName("CodeDen");', "app-name"],
    ["upstream's releases page", "apps/server/src/services/updates/desktop.ts", 'export const DESKTOP_RELEASES_URL = "https://github.com/leonvanzyl/codeden/releases/latest";', "repository"],
    ["the projects folder", "apps/server/src/services/container.ts", '    projectsDir: opts.projectsDir ?? join(userHome, "codeden-projects"),', "projects-folder"],
    ["the keychain service", "apps/server/src/services/secrets.ts", '    private readonly service = "codeden",', "bare-name"],
    ["the link scheme", "packages/contracts/src/desktop.ts", 'export const DEEP_LINK_SCHEME = "codeden";', "bare-name"],
    ["a link built by hand", "apps/web/src/lib/new-links.ts", `const link = ${TICK}codeden://session/${D}{id}${TICK};`, "link-scheme"],
    ["the home folder in a file that also names the project folder", "apps/server/src/services/automations/sources.ts", 'const dir = join(homedir(), ".codeden", "automations");', "home-folder"],
    ["an upstream value next to an allowed one", "apps/server/src/services/sessions/handoff.ts", '  send({ from: "codeden", service: "codeden" });', "bare-name"],
  ])("fails on %s", (_name, file, line, rule) => {
    expect(inScope(file), `${file} must be scanned`).toBe(true);
    expect(rulesHit(file, `import { x } from "y";\n${line}\n`)).toContain(rule);
  });

  it("leaves comments, allowed text and the fork's own values alone", () => {
    // biome-ignore format: one case per line
    const quiet = [
      [
        "apps/server/src/paths.ts",
        "/** The home, `~/.codeden` upstream. */\n// codeden://x, port 4317\n  return join(homedir(), HARDEN_HOME_DIRNAME);",
      ],
      ["apps/server/src/services/sessions/handoff.ts", '  send({ from: "codeden" });'],
      [
        "apps/runner/src/workspace/project-config.ts",
        'export const PROJECT_CONFIG_PATH = ".codeden/project.json";',
      ],
      [
        "apps/desktop/src/main/main.ts",
        'app.setName(HARDEN_PRODUCT_NAME);\nimport { x } from "@codeden/contracts";\nconst home = env.CODEDEN_HOME;',
      ],
      [
        "apps/server/src/new.ts",
        'const branch = "codeden/fix-1"; const port = 4417; const tmp = "codeden-x"; const n = 14317;',
      ],
    ];
    for (const [file, text] of quiet) expect(scan(file, text), file).toEqual([]);
  });
});

describe("the fork's call sites are still there", () => {
  it("every file the fork redirected still reads the fork's channel", () => {
    const problems = CALL_SITES.map((site) => callSiteProblem(site, read(site[0]))).filter(Boolean);
    expect(
      problems.length,
      `\n\nThe fork's change is missing in ${problems.length} place(s). Until it is back, that part of the product uses upstream's value.\n\n${problems.join("\n\n")}\n`,
    ).toBe(0);
  });

  it("fails when a call site loses the fork's symbol or the file is gone", () => {
    const paths = CALL_SITES.find(([file]) => file === "apps/server/src/paths.ts");
    const reverted = (read(paths[0]) ?? "").replace(
      "join(homedir(), HARDEN_HOME_DIRNAME)",
      'join(homedir(), ".codeden")',
    );
    expect(callSiteProblem(paths, reverted)).toMatch(
      /paths\.ts no longer has .*HARDEN_HOME_DIRNAME/,
    );
    expect(rulesHit(paths[0], reverted)).toEqual(["home-folder"]);
    // A mention in a comment is not a use.
    expect(
      callSiteProblem(
        ["apps/x/src/a.ts", "x", "HARDEN_COMMAND"],
        "// HARDEN_COMMAND\nconst a = 1;",
      ),
    ).toMatch(/no longer has HARDEN_COMMAND/);
    expect(callSiteProblem(paths, null)).toMatch(
      /paths\.ts is gone[\s\S]*Find where that logic lives now/,
    );
    const config = CALL_SITES.find(([file]) => file === "apps/desktop/electron-builder.config.mjs");
    const upstreamConfig = (read(config[0]) ?? "").replace(
      /^ {2}appId,$/m,
      '  appId: "dev.codeden.app",',
    );
    expect(callSiteProblem(config, upstreamConfig)).toMatch(
      /electron-builder\.config\.mjs no longer has/,
    );
  });
});
