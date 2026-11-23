/**
 * CodeHarden's update channel: the npm package the self-update installs and the GitHub
 * repository whose releases the desktop app and every "releases" / "what's new" link use.
 * This is the one module that names them. The update check, the installer, the launcher, the
 * desktop packaging and the links all read from here, so an update can only ever fetch
 * CodeHarden, never upstream CodeDen.
 *
 * The values are fixed when a bundle is built (`scripts/harden/channel-define.mjs`, from the
 * `PACKAGE_NAME` and `RELEASE_REPOSITORY` build variables) and default to CodeHarden's own.
 * There is no runtime override: a running install can't be pointed at another package or
 * repository by an environment variable or a setting.
 *
 * No imports, on purpose: the CLI launcher loads this module before the rest of the bundle.
 */

/** Replaced at build time with the npm package name (`scripts/harden/channel-define.mjs`). */
declare const __CODEHARDEN_PACKAGE__: string | undefined;
/** Replaced at build time with the GitHub `owner/repo` (`scripts/harden/channel-define.mjs`). */
declare const __CODEHARDEN_REPOSITORY__: string | undefined;

/** npm package names: `name` or `@scope/name`, lower case. */
export const HARDEN_PACKAGE_PATTERN = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/;
/** GitHub `owner/repo`. */
export const HARDEN_REPOSITORY_PATTERN =
  /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?\/[A-Za-z0-9._-]+$/;

/** The npm package self-update checks and installs. */
export const HARDEN_PACKAGE_NAME: string =
  (typeof __CODEHARDEN_PACKAGE__ === "string" && HARDEN_PACKAGE_PATTERN.test(__CODEHARDEN_PACKAGE__)
    ? __CODEHARDEN_PACKAGE__
    : undefined) ?? "codeharden";

/** The GitHub repository (`owner/repo`) that publishes CodeHarden's releases and holds its docs. */
export const HARDEN_REPOSITORY: string =
  (typeof __CODEHARDEN_REPOSITORY__ === "string" &&
  HARDEN_REPOSITORY_PATTERN.test(__CODEHARDEN_REPOSITORY__)
    ? __CODEHARDEN_REPOSITORY__
    : undefined) ?? "harperaa/codeharden";

/** The branch CodeHarden is developed and released from (docs and changelog links). */
export const HARDEN_BRANCH = "harden";

/** The command the package installs: its name without the scope (`codeharden`). */
export const HARDEN_COMMAND: string = HARDEN_PACKAGE_NAME.slice(
  HARDEN_PACKAGE_NAME.lastIndexOf("/") + 1,
);

/** What to type to run the latest version once: `npx codeharden`. */
export const HARDEN_NPX_COMMAND = `npx ${HARDEN_PACKAGE_NAME}`;

/** The manual way to update a global install: `npm i -g codeharden@latest`. */
export const HARDEN_INSTALL_COMMAND = `npm i -g ${HARDEN_PACKAGE_NAME}@latest`;

/** The update command: `codeharden update`. */
export const HARDEN_UPDATE_COMMAND = `${HARDEN_COMMAND} update`;

/** The package's folder under `node_modules`, as path segments (two for a scoped name). */
export const HARDEN_PACKAGE_SEGMENTS: readonly string[] = HARDEN_PACKAGE_NAME.split("/");

/** An npm version made from a CodeHarden version: four digits, then two fields of one to four. */
const HARDEN_NPM_VERSION = /^(\d{4})\.(\d{1,4})\.(\d{1,4})$/;

/**
 * The npm form of a CodeHarden version: leading zeros stripped per field, as semver requires
 * (`2026.0105.0518` becomes `2026.105.518`). Anything else is returned unchanged.
 */
export function hardenNpmVersion(hardenVersion: string): string {
  const match = HARDEN_NPM_VERSION.exec(hardenVersion.trim().replace(/^v/, ""));
  if (!match) return hardenVersion;
  return `${match[1]}.${Number(match[2])}.${Number(match[3])}`;
}

/**
 * The CodeHarden version behind an npm version: the last two fields padded back to four digits
 * (`2026.105.518` becomes `2026.0105.0518`). A version of another shape (upstream semver, a
 * prerelease) is returned unchanged.
 */
export function hardenVersionOf(npmVersion: string): string {
  const match = HARDEN_NPM_VERSION.exec(npmVersion.trim().replace(/^v/, ""));
  if (!match) return npmVersion;
  const [, year, monthDay, time] = match as unknown as [string, string, string, string];
  return `${year}.${monthDay.padStart(4, "0")}.${time.padStart(4, "0")}`;
}

/** The git tag and GitHub release of a version: `v2026.0105.0518` for npm's `2026.105.518`. */
export function hardenReleaseTag(version: string): string {
  return `v${hardenVersionOf(version).replace(/^v/, "")}`;
}

const GITHUB = "https://github.com";

/** The repository's page on GitHub. */
export function hardenRepositoryUrl(): string {
  return `${GITHUB}/${HARDEN_REPOSITORY}`;
}

/** The release page of a version (npm or CodeHarden form). */
export function hardenReleaseUrl(version: string): string {
  return `${hardenRepositoryUrl()}/releases/tag/${encodeURIComponent(hardenReleaseTag(version))}`;
}

/** The GitHub API's JSON for a version's release (`{ body, html_url }`). */
export function hardenReleaseApiUrl(version: string): string {
  return `https://api.github.com/repos/${HARDEN_REPOSITORY}/releases/tags/${encodeURIComponent(hardenReleaseTag(version))}`;
}

/** The latest release, where the desktop installers are downloaded from. */
export function hardenLatestReleaseUrl(): string {
  return `${hardenRepositoryUrl()}/releases/latest`;
}

/** The raw CodeHarden changelog, whose sections are headed by CodeHarden versions. */
export function hardenChangelogUrl(): string {
  return `https://raw.githubusercontent.com/${HARDEN_REPOSITORY}/${HARDEN_BRANCH}/CODEHARDEN-CHANGELOG.md`;
}

/** A file in `docs/` as GitHub shows it (`desktop.md`); without a file, the folder with a trailing slash. */
export function hardenDocsUrl(file = ""): string {
  return `${hardenRepositoryUrl()}/blob/${HARDEN_BRANCH}/docs/${file}`;
}
