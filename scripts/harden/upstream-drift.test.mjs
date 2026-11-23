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
  {
    id: "sandbox-names",
    pattern:
      /\bcodeden-runner:|\blabel=codeden\.|(["'`])codeden\.(?:install|session|project|runner|version|build)\1|`codeden-\$\{/,
    back: "upstream's name for something in Docker: the sandbox image `codeden-runner:<version>`, a `codeden.*` label, or a container or volume named `codeden-<id>`",
    use: "HARDEN_APP_SLUG, through `imageName`, `LABEL` (`apps/server/src/execution/docker/args.ts`) and `containerNameFor` (`docker/backend.ts`)",
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
  upstreamPack:
    "upstream's own manifest and publish step, kept as they are; the fork's release writes the name, links and README in a staging copy (`scripts/harden/npm-release.mjs`)",
  sandbox:
    "the package and command name inside the sandbox image (`codeden`, in `/opt/codeden`): nothing outside a container sees it, and the image is built on this machine from this build's own bundle, never fetched from npm under that name. What Docker itself is asked for by name (the image, labels, containers, volumes) is the fork's: rule `sandbox-names`",
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

/**
 * A script's text without its comments (line breaks kept). Strings and template strings are
 * followed, so a comment opener inside one never hides the code after it, and a comment must
 * start a line or follow a space, so a glob ending in slash-star is not one. When in doubt the
 * text is kept: a comment read as code can only cause a failure, never hide a value.
 */
function withoutComments(text) {
  let out = "";
  let state = "code";
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];
    if (state === "line" || state === "block") {
      if (ch === "\n") out += ch;
      if (state === "line" ? ch === "\n" : ch === "*" && next === "/") {
        if (state === "block") i++;
        state = "code";
      }
    } else if (state !== "code") {
      out += ch;
      if (ch === "\\" && next !== undefined) out += text[++i];
      else if (ch === state || (ch === "\n" && state !== "`")) state = "code";
    } else if (
      ch === "/" &&
      (next === "/" || next === "*") &&
      (i === 0 || /\s/.test(text[i - 1]))
    ) {
      state = next === "/" ? "line" : "block";
      i++;
    } else {
      if (ch === '"' || ch === "'" || ch === "`") state = ch;
      out += ch;
    }
  }
  return out;
}

/** Lines of `text` with comments blanked, so prose about upstream is never a hit. */
function codeLines(file, text) {
  if (/\.[cm]?[jt]sx?$/.test(file)) return withoutComments(text).split("\n");
  const hash = /\.(?:sh|ya?ml)$|Dockerfile$/.test(file);
  return text.split("\n").map((line) => (hash && /^\s*#/.test(line) ? "" : line));
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
 * A name is looked for as a word in the file's code (comments don't count), a pattern as
 * written, and a function is asked.
 */
// biome-ignore format: one entry per line, read as a table
const CALL_SITES = [
  // --- the channel itself
  ["packages/contracts/src/harden-channel.ts", "the one module that names the package, repository and identity", "HARDEN_PACKAGE_NAME", "HARDEN_REPOSITORY", "HARDEN_PRODUCT_NAME", "HARDEN_APP_ID", "HARDEN_HOME_DIRNAME", "HARDEN_PROJECTS_DIRNAME", "HARDEN_KEYCHAIN_SERVICE", "HARDEN_DEEP_LINK_SCHEME", "HARDEN_DEFAULT_PORT", "__CODEHARDEN_PACKAGE__", "__CODEHARDEN_SLUG__", "__CODEHARDEN_PORT__"],
  ["packages/contracts/src/harden-version.ts", "the version line every display uses", "formatHardenVersion", "HARDEN_VERSION", "UPSTREAM_VERSION", "__CODEHARDEN_VERSION__"],
  ["packages/contracts/src/index.ts", "exports the channel, the version and the brand modules", /export \* from "\.\/harden-channel"/, /export \* from "\.\/harden-version"/, /export \* from "\.\/harden-brand"/, /export \* from "\.\/harden-mark"/],
  ["packages/contracts/src/harden-brand.ts", "the wordmark's two parts and the paths of the product's own web icons", "hardenWordmark", "hardenWordmarkHtml", "HARDEN_WEB_ICONS", "HARDEN_PUBLIC_ICON_PATHS", "HARDEN_FAVICON_PATH"],
  ["packages/contracts/src/harden-mark.ts", "the mark's shapes and the brand's colours, written by scripts/harden/brand/make.mjs", "HARDEN_MARK", "HARDEN_BRAND_RED", "HARDEN_BRAND_RED_ON_DARK", "HARDEN_BRAND_WHITE"],
  ["packages/contracts/package.json", "lets the CLI launcher load the channel alone", /"\.\/harden-channel": "\.\/src\/harden-channel\.ts"/],
  ["packages/contracts/src/desktop.ts", "the link scheme the desktop app registers", /DEEP_LINK_SCHEME = HARDEN_DEEP_LINK_SCHEME/],
  ["packages/contracts/src/ws.ts", "the two versions in the health answer and the snapshot", "hardenVersion", "upstreamVersion"],
  // --- every bundle gets both build-time defines
  ["apps/cli/tsdown.config.ts", "injects the version and the channel into the CLI bundle", bothDefinesInEveryBundle],
  ["apps/desktop/tsdown.config.ts", "injects the version and the channel into the desktop bundles", bothDefinesInEveryBundle],
  ["apps/web/vite.config.ts", "injects the version and the channel into the web app", bothDefinesInEveryBundle, /hardenWebIdentity\(\)/],
  // --- home, port, projects folder, keychain
  ["apps/server/src/paths.ts", "the default home folder", /join\(homedir\(\), HARDEN_HOME_DIRNAME\)/],
  ["apps/server/src/services/container.ts", "the default folder for clones", /join\(userHome, HARDEN_PROJECTS_DIRNAME\)/],
  ["apps/server/src/services/secrets.ts", "the keychain service secrets are kept under", /service = HARDEN_KEYCHAIN_SERVICE/],
  ["apps/server/src/security.ts", "the command the locked page tells people to run, that page's title and wordmark, and the product's icons a browser may fetch without a cookie", "HARDEN_NPX_COMMAND", /<title>\$\{HARDEN_PRODUCT_NAME\}<\/title>/, /<h1>\$\{hardenWordmarkHtml\("dark"\)\} is locked<\/h1>/, /\.\.\.HARDEN_PUBLIC_ICON_PATHS,/],
  ["apps/server/src/routes/api.ts", "the versions the server reports", "HARDEN_VERSION", "UPSTREAM_VERSION"],
  ["apps/cli/src/args.ts", "the CLI's default port, home and command in the help", /DEFAULT_PORT = HARDEN_DEFAULT_PORT/, "HARDEN_HOME_DISPLAY", "HARDEN_COMMAND", "formatHardenVersion"],
  ["apps/cli/src/network-command.ts", "the network command's port comes from the CLI's default", /import \{ DEFAULT_PORT \} from "\.\/args"/],
  ["apps/cli/src/launcher.ts", "the launcher's home, the installed package it may start and the commands it prints", /join\(homedir\(\), HARDEN_HOME_DIRNAME\)/, /pkg\.name !== HARDEN_PACKAGE_NAME/, "HARDEN_PACKAGE_SEGMENTS", "HARDEN_NPX_COMMAND", "HARDEN_UPDATE_COMMAND", "HARDEN_COMMAND", /export \{ HARDEN_PRODUCT_NAME \} from/],
  ["apps/cli/src/harden-home.ts", "the notice about the old home", "HARDEN_HOME_DIRNAME", "UPSTREAM_HOME_DIRNAME", "hardenHomeNotice"],
  ["apps/cli/src/cli.ts", "the bare package version is printed for the updater's probe only, and the warning about an installed version that didn't load names the product", /CODEDEN_NO_SWITCH === "1"/, /`\$\{HARDEN_PRODUCT_NAME\} \$\{decision\.version\} failed to load/],
  ["apps/cli/src/main.ts", "the version line of `--version`", "formatHardenVersion"],
  ["apps/cli/src/commands.ts", "the version line and command name in CLI output", "formatHardenVersion", "HARDEN_COMMAND"],
  ["apps/cli/src/doctor.ts", "the version line and update command in `doctor`", "formatHardenVersion", "HARDEN_UPDATE_COMMAND"],
  ["apps/cli/src/update-command.ts", "the update command it prints, and the product's name in every message of the update command", "HARDEN_UPDATE_COMMAND", productNameOnlyByConstant],
  ["apps/cli/src/restart.ts", "the product's name in the messages of the restart into an updated version", productNameOnlyByConstant],
  // --- the sandbox in Docker: one Docker is shared by every product on the machine
  ["apps/server/src/execution/docker/args.ts", "the sandbox image's name and the labels on images, containers and volumes", /`\$\{HARDEN_APP_SLUG\}-runner:\$\{version\}`/, /install: `\$\{HARDEN_APP_SLUG\}\.install`/, /build: `\$\{HARDEN_APP_SLUG\}\.build`/],
  ["apps/server/src/execution/docker/backend.ts", "the names of sandbox containers (and through them their volumes)", /`\$\{HARDEN_APP_SLUG\}-\$\{recordId\}`/],
  // --- self-update: only the channel's package, only the fork's releases
  ["apps/server/src/services/updates/app-dir.ts", "the package self-update installs and may run", /PACKAGE_NAME = HARDEN_PACKAGE_NAME/, /pkg\.name !== PACKAGE_NAME/],
  ["apps/server/src/services/updates/registry.ts", "the registry lookup and the release notes links", /registryPackagePath\(PACKAGE_NAME\)/, "hardenReleaseUrl", "hardenReleaseApiUrl", "hardenChangelogUrl", "hardenVersionOf"],
  ["apps/server/src/services/updates/installer.ts", "what npm is asked to install", /`\$\{PACKAGE_NAME\}@\$\{version\}`/],
  ["apps/server/src/services/updates/desktop.ts", "where desktop installers are downloaded from, and the product's name in the restart hint", /DESKTOP_RELEASES_URL = hardenLatestReleaseUrl\(\)/, productNameOnlyByConstant],
  ["apps/server/src/services/updates/service.ts", "the manual install command, the product's name in the update messages, and what a source build compares the registry's version with", "HARDEN_INSTALL_COMMAND", productNameOnlyByConstant, /isNewerVersion\(this\.latest, hardenUpdateBaseline\(this\.host\.source, current, this\.latest\)\)/],
  ["apps/server/src/services/updates/harden-baseline.ts", "a source build compares the registry's version with the CodeHarden version it was made from, not with upstream's package version", "hardenUpdateBaseline", "HARDEN_VERSION", "hardenNpmVersion", /source !== "source"/],
  // --- desktop app and its packaging
  ["apps/desktop/electron-builder.config.mjs", "the installer's app id, names, link scheme, update feed and app icon (the product's own, not upstream's build/icon.png)", /readHardenChannel\(\)/, /^ {2}appId,$/m, /^ {2}productName,$/m, /schemes: \[slug\]/, /owner: channel\.owner, repo: channel\.repo/, /executableName: productName/, /executableName: slug/, /shortcutName: productName/, /icon: "build\/harden\/icon\.icns"/, /icon: "build\/harden\/icon\.ico"/, /icon: "build\/harden\/icons"/],
  ["apps/desktop/scripts/package.mjs", "the staged app's name and version", /readHardenChannel\(\)/, /name: channel\.slug/, /productName: channel\.productName/, /npmVersion\(readHardenVersion\(\)\)/],
  ["apps/desktop/scripts/check-mac-signature.sh", "finds the app by its own name", "app_in", "CFBundleExecutable"],
  ["apps/desktop/src/main/args.ts", "the desktop app's default port and home", /DEFAULT_PORT = HARDEN_DEFAULT_PORT/, /join\(home, HARDEN_HOME_DIRNAME\)/],
  ["apps/desktop/src/main/main.ts", "the app's name, About panel and Windows app id", /app\.setName\(HARDEN_PRODUCT_NAME\)/, /setAppUserModelId\(HARDEN_APP_ID\)/, "hardenAboutPanel"],
  ["apps/desktop/src/main/harden-display.ts", "the window title (the page name it replaces is the product name) and About panel", "hardenWindowTitle", "hardenAboutPanel", /PAGE_NAME = HARDEN_PRODUCT_NAME/],
  ["apps/desktop/src/main/window.ts", "the window title", "hardenWindowTitle"],
  ["apps/desktop/src/main/desktop-app.ts", "the app's name, version line and docs links, and its own tray, menu-bar and window icons", "HARDEN_PRODUCT_NAME", "formatHardenVersion", "hardenDocsUrl", "hardenVersionOf", /"harden\/trayTemplate\.png" : "harden\/tray\.png"/, bothWindowIconsAreTheForks],
  ["apps/desktop/src/main/menu.ts", "the app's name in the menu", "HARDEN_PRODUCT_NAME"],
  ["apps/desktop/src/main/tray.ts", "the app's name in the tray", "HARDEN_PRODUCT_NAME"],
  ["apps/desktop/src/main/tray-view.ts", "the app's name and version in the tray menu", "HARDEN_PRODUCT_NAME", "hardenVersionOf"],
  ["apps/desktop/src/server/serve.ts", "the name and version line of the server the app hosts", "HARDEN_PRODUCT_NAME", "formatHardenVersion"],
  // --- web UI
  ["scripts/harden/web-identity.mjs", "the build step that names the page and the web manifest after the product and points them at its icons", /readHardenChannel\(env, options\)/, "productName", "titledHtml", "namedManifest", "brandedHtml", "brandedManifest", "HARDEN_ICONS"],
  ["apps/web/index.html", "the places the build puts the product name in (the page title, the home-screen title) and the icon links it points at the product's icons", /<title>[^<]+<\/title>/, /name="apple-mobile-web-app-title" content="/, /rel="manifest" href="\/manifest\.webmanifest"/, /<link rel="icon"[^>]* href="/, /<link rel="apple-touch-icon" href="/],
  ["apps/web/public/manifest.webmanifest", "the installed web app's name and icons, which the build replaces with the product's; a build does not fail when this file is gone", /"name": "/, /"short_name": "/, /"icons": \[/],
  ["apps/web/src/lib/attention/title.ts", "the tab title, bare, counted and waiting", /APP_TITLE = HARDEN_PRODUCT_NAME/, /Waiting on you · \$\{APP_TITLE\}/],
  ["apps/web/src/lib/platform.ts", "the tab title the badge falls back to, and the icon of browser notifications", /document\.title : HARDEN_PRODUCT_NAME/, /icon: HARDEN_FAVICON_PATH/],
  ["apps/server/src/routes/static.ts", "the title of the page served when the web UI is not built", /<title>\$\{HARDEN_PRODUCT_NAME\}<\/title>/, /hardenWordmarkHtml\("light"\)/],
  ["apps/web/src/components/shell/unauthorized.tsx", "the command the locked page tells people to run, and the wordmark in its heading", "HARDEN_NPX_COMMAND", /<Wordmark \/>/],
  // --- the logo and the wordmark
  ["apps/web/src/components/shell/logo.tsx", "the logo: the product's mark (a shield), not upstream's", "HARDEN_MARK", "HARDEN_BRAND_RED", "HARDEN_BRAND_WHITE"],
  ["apps/web/src/components/shell/wordmark.tsx", "the product name as the brand, in two colours", "hardenWordmark", /text-brand-text/],
  ["apps/web/src/index.css", "the brand's colour tokens (written by scripts/harden/brand/make.mjs)", /@import "\.\/harden-brand\.css";/],
  ["apps/web/src/harden-brand.css", "the brand's colour tokens for both themes", /--color-brand-text: var\(--brand-text\)/, /--brand: #[0-9a-f]{6};/, /\.dark \{\n {2}--brand-text: #[0-9a-f]{6};/],
  ["apps/web/src/components/shell/sidebar/sidebar.tsx", "the wordmark beside the logo in the sidebar", /<Wordmark className=/],
  ["apps/web/src/components/shell/sign-in.tsx", "the wordmark in the sign-in heading", /Sign in to <Wordmark \/>/],
  ["apps/web/src/routes/setup.tsx", "the wordmark in the first-run heading", /Welcome to <Wordmark \/>/],
  ["apps/web/src/lib/api/updates-api.ts", "release links, and the product's name in the mock client's update message", "hardenReleaseUrl", productNameOnlyByConstant],
  ["apps/web/src/components/shell/update-banner.tsx", "the product's name in the update banner, in each of its states", productNameOnlyByConstant, /\{HARDEN_PRODUCT_NAME\} \{view\.version\} is available\./, /\{HARDEN_PRODUCT_NAME\} updated to \{view\.version\}\./],
  ["apps/web/src/components/shell/whats-new-dialog.tsx", "the product's name in the title of \"What's new\"", productNameOnlyByConstant, /What's new in \{HARDEN_PRODUCT_NAME\} \{version\}/],
  ["apps/web/src/components/settings/update-mode.tsx", "the product's name in the help of the Updates setting", productNameOnlyByConstant],
  ["apps/web/src/lib/factory-guide.ts", "docs links", "hardenDocsUrl"],
  ["apps/web/src/routes/settings.tsx", "the version line in Settings, its name as the wordmark", "formatHardenVersion", /<WordmarkLine text=\{versionLine\} \/>/],
  // --- Secure Foundation: the add-project option, slotted into upstream's files
  ["apps/web/src/components/setup/add-project-dialog.tsx", "the Secure Foundation option in the add-project dialog", /<SecureFoundationSlot \/>/],
  ["apps/web/src/routes/project.tsx", "the Secure Foundation setup status on the project page", /<SecureFoundationStatus projectId=\{projectId\} \/>/],
  ["apps/web/src/lib/api/http-client.ts", "the web client's Secure Foundation calls", /secureFoundation: httpSecureFoundationApi\(http\)/],
  ["apps/server/src/routes/api.ts", "the Secure Foundation routes", /\.route\("\/secure-foundation", secureFoundationRoutes\(s\)\)/],
  ["apps/server/src/services/container.ts", "the Secure Foundation service", /secureFoundation: createSecureFoundation\(/],
  ["apps/server/src/services/secure-foundation/index.ts", "the template comes from the fork's configuration, never from a request", "HARDEN_TEMPLATE_REPOSITORY", "HARDEN_TEMPLATE_BRANCH", "hardenTemplateUrl"],
  ["packages/contracts/src/harden-channel.ts", "the Secure Foundation template in the fork's configuration", "HARDEN_TEMPLATE_REPOSITORY", "HARDEN_TEMPLATE_BRANCH", "__CODEHARDEN_TEMPLATE_REPOSITORY__", "__CODEHARDEN_TEMPLATE_BRANCH__"],
  ["packages/contracts/src/provider.ts", "the capability the setup brief reads instead of a provider id", "projectCommands"],
  ["packages/providers/src/claude/adapter.ts", "the provider that runs project command files says so", /projectCommands: true/],
];

/** True when every `define` block of a bundler config spreads the version and the channel. */
function bothDefinesInEveryBundle(code) {
  const count = (pattern) => code.match(pattern)?.length ?? 0;
  const blocks = count(/\bdefine: \{/g);
  return (
    blocks > 0 &&
    count(/\.\.\.hardenVersionDefine\(\)/g) === blocks &&
    count(/\.\.\.hardenChannelDefine\(\)/g) === blocks
  );
}
bothDefinesInEveryBundle.say =
  "`...hardenVersionDefine()` and `...hardenChannelDefine()` in every `define` block (one per bundle)";

/**
 * True when the file names the product through `HARDEN_PRODUCT_NAME` and nowhere as the fixed
 * text `CodeDen`. For the files whose every mention of the product is the thing being updated
 * (the update banner, "What's new", the update command): a new message upstream adds there
 * with its own name fails too.
 */
function productNameOnlyByConstant(code) {
  return /(?<![\w$])HARDEN_PRODUCT_NAME(?![\w$])/.test(code) && !/\bCodeDen\b/.test(code);
}
productNameOnlyByConstant.say =
  "the product's name read from `HARDEN_PRODUCT_NAME` in every message (and no fixed `CodeDen` in the file's code)";

/** True when the window's and the notifications' icon are both the product's own. */
function bothWindowIconsAreTheForks(code) {
  return (
    code.match(/icon: this\.asset\("harden\/icon\.png"\)/g)?.length === 2 &&
    !/this\.asset\("icon\.png"\)/.test(code)
  );
}
bothWindowIconsAreTheForks.say =
  '`icon: this.asset("harden/icon.png")` for the window and for notifications (and no `this.asset("icon.png")`, upstream\'s icon)';

/** A needed name or pattern as a reader would look for it in the file. */
const say = (need) =>
  typeof need === "string"
    ? need
    : typeof need === "function"
      ? need.say
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
      : typeof need === "function"
        ? !need(code)
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
    ["the page title in the web app's index.html", "apps/web/index.html", "    <title>CodeDen</title>", "app-name"],
    ["the home-screen title in index.html", "apps/web/index.html", '    <meta name="apple-mobile-web-app-title" content="CodeDen" />', "app-name"],
    ["the installed web app's name in the manifest", "apps/web/public/manifest.webmanifest", '  "short_name": "CodeDen",', "app-name"],
    ["the tab title constant", "apps/web/src/lib/attention/title.ts", 'export const APP_TITLE = "CodeDen";', "app-name"],
    ["the title of a page the server writes", "apps/server/src/security.ts", "const PAGE = `<!doctype html><title>CodeDen</title>`;", "app-name"],
    ["the sandbox image's name", "apps/server/src/execution/docker/args.ts", `  return ${TICK}codeden-runner:${D}{version}${TICK};`, "sandbox-names"],
    ["a sandbox label", "apps/server/src/execution/docker/args.ts", '  install: "codeden.install",', "sandbox-names"],
    ["a label filter written by hand", "apps/server/src/execution/new-sweep.ts", 'const filter = ["--filter", "label=codeden.install"];', "sandbox-names"],
    ["the sandbox container's name", "apps/server/src/execution/docker/backend.ts", `  return ${TICK}codeden-${D}{recordId}${TICK};`, "sandbox-names"],
    ["the link scheme", "packages/contracts/src/desktop.ts", 'export const DEEP_LINK_SCHEME = "codeden";', "bare-name"],
    ["a link built by hand", "apps/web/src/lib/new-links.ts", `const link = ${TICK}codeden://session/${D}{id}${TICK};`, "link-scheme"],
    ["the home folder in a file that also names the project folder", "apps/server/src/services/automations/sources.ts", 'const dir = join(homedir(), ".codeden", "automations");', "home-folder"],
    ["a value after a string that looks like a comment start", "apps/server/src/new.ts", 'const hint = "Use /* to start a comment";\nconst port = 4317;', "default-port"],
    ["a value after a URL and before a real comment", "apps/server/src/new.ts", 'const url = "https://registry.npmjs.org/codeden"; // the package', "npm-package"],
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
    // One bundle of three losing its defines is a loss.
    const bundles = CALL_SITES.find(([file]) => file === "apps/desktop/tsdown.config.ts");
    const oneLost = (read(bundles[0]) ?? "").replace(
      "{ ...hardenVersionDefine(), ...hardenChannelDefine() }",
      "{}",
    );
    expect(callSiteProblem(bundles, oneLost)).toMatch(/in every `define` block/);
    const config = CALL_SITES.find(([file]) => file === "apps/desktop/electron-builder.config.mjs");
    const upstreamConfig = (read(config[0]) ?? "").replace(
      /^ {2}appId,$/m,
      '  appId: "dev.codeden.app",',
    );
    expect(callSiteProblem(config, upstreamConfig)).toMatch(
      /electron-builder\.config\.mjs no longer has/,
    );
  });

  it("fails when the logo or an icon goes back to upstream's", () => {
    const site = (file) => CALL_SITES.find(([path]) => path === file);
    const text = (file) => read(file) ?? "";
    // Upstream's logo component: its own path, drawn in the theme's accent.
    const logo = site("apps/web/src/components/shell/logo.tsx");
    expect(callSiteProblem(logo, text(logo[0]))).toBeNull();
    expect(
      callSiteProblem(
        logo,
        'const MARK_PATH = "M15.04 5.78L10.7 5.78Z";\nexport function Logo() {\n  return <path d={MARK_PATH} className="fill-primary" />;\n}\n',
      ),
    ).toMatch(/logo\.tsx no longer has HARDEN_MARK/);
    // The name beside it as plain text again.
    const sidebar = site("apps/web/src/components/shell/sidebar/sidebar.tsx");
    const plain = text(sidebar[0]).replace(/<Wordmark className=[^>]*\/>/, "<span>CodeDen</span>");
    expect(callSiteProblem(sidebar, plain)).toMatch(/sidebar\.tsx no longer has/);
    // The packaged app without its own icon falls back to upstream's build/icon.png.
    const config = site("apps/desktop/electron-builder.config.mjs");
    const noIcon = text(config[0]).replace('    icon: "build/harden/icon.icns",\n', "");
    expect(callSiteProblem(config, noIcon)).toMatch(/no longer has .*icon\.icns/);
    // One of the two window icons, and the tray, back on upstream's files.
    const app = site("apps/desktop/src/main/desktop-app.ts");
    const oneBack = text(app[0]).replace('this.asset("harden/icon.png")', 'this.asset("icon.png")');
    expect(callSiteProblem(app, oneBack)).toMatch(/for the window and for notifications/);
    const tray = text(app[0]).replace(
      '"harden/trayTemplate.png" : "harden/tray.png"',
      '"trayTemplate.png" : "tray.png"',
    );
    expect(callSiteProblem(app, tray)).toMatch(/desktop-app\.ts no longer has/);
    // The build step that swaps the page's and the manifest's icons.
    const identity = site("scripts/harden/web-identity.mjs");
    const noSwap = text(identity[0]).replaceAll("brandedHtml", "sameHtml");
    expect(callSiteProblem(identity, noSwap)).toMatch(/no longer has .*brandedHtml/);
  });

  it("fails when an update message names the product as the fixed CodeDen again", () => {
    const site = (file) => CALL_SITES.find(([path]) => path === file);
    const text = (file) => read(file) ?? "";
    // The banner as upstream writes it: "CodeDen 1.2.3 is available."
    const banner = site("apps/web/src/components/shell/update-banner.tsx");
    expect(callSiteProblem(banner, text(banner[0]))).toBeNull();
    const upstream = text(banner[0]).replace(
      "{HARDEN_PRODUCT_NAME} {view.version} is available.",
      "CodeDen {view.version} is available.",
    );
    expect(upstream).not.toBe(text(banner[0]));
    expect(callSiteProblem(banner, upstream)).toMatch(
      /update-banner\.tsx no longer has the product's name read from `HARDEN_PRODUCT_NAME`/,
    );
    // A new state upstream adds with its own name, the fork's lines untouched.
    const added = `${text(banner[0])}\nconst later = <span>CodeDen is up to date.</span>;\n`;
    expect(callSiteProblem(banner, added)).toMatch(/update-banner\.tsx no longer has/);
    // A mention in a comment or in an identifier is not a message.
    expect(
      productNameOnlyByConstant(
        "// CodeDen upstream\nconst a: CodeDenClient = HARDEN_PRODUCT_NAME;",
      ),
    ).toBe(false);
    expect(productNameOnlyByConstant("const a: CodeDenClient = HARDEN_PRODUCT_NAME;")).toBe(true);
    // The update command's messages and the server's.
    const command = site("apps/cli/src/update-command.ts");
    const fixed = text(command[0]).replace(/`Installing \S+ /, "`Installing CodeDen ");
    expect(fixed).not.toBe(text(command[0]));
    expect(callSiteProblem(command, fixed)).toMatch(/update-command\.ts no longer has/);
    // A source build comparing with upstream's package version again.
    const service = site("apps/server/src/services/updates/service.ts");
    const compared = text(service[0]).replace(
      "hardenUpdateBaseline(this.host.source, current, this.latest)",
      "current",
    );
    expect(compared).not.toBe(text(service[0]));
    expect(callSiteProblem(service, compared)).toMatch(/service\.ts no longer has/);
  });

  it("fails when the Secure Foundation option's slot disappears from the dialog", () => {
    const slot = CALL_SITES.find(([, what]) => what.startsWith("the Secure Foundation option"));
    const dialog = read(slot[0]) ?? "";
    expect(callSiteProblem(slot, dialog)).toBeNull();
    // Upstream's dialog as a merge would bring it back: the two choices and no slot.
    const upstream = dialog.replace("      <SecureFoundationSlot />\n", "");
    expect(upstream).not.toBe(dialog);
    expect(callSiteProblem(slot, upstream)).toMatch(
      /add-project-dialog\.tsx no longer has `<SecureFoundationSlot \/>`/,
    );
    // The import alone is not the option.
    expect(callSiteProblem(slot, upstream)).not.toBeNull();
    expect(callSiteProblem(slot, null)).toMatch(/add-project-dialog\.tsx is gone/);
    const status = CALL_SITES.find(([, what]) =>
      what.startsWith("the Secure Foundation setup status"),
    );
    const page = read(status[0]) ?? "";
    expect(callSiteProblem(status, page)).toBeNull();
    expect(
      callSiteProblem(status, page.replace(/ *<SecureFoundationStatus [^>]*\/>\n/, "")),
    ).toMatch(/project\.tsx no longer has/);
  });
});
