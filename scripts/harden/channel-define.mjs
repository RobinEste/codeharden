// The build-time injection of CodeHarden's update channel: the npm package self-update installs,
// the GitHub repository whose releases the desktop app and the release links use, and the
// branch the docs and changelog links point at. The tsdown configs (CLI, desktop) and the web
// app's Vite config spread `hardenChannelDefine()` into their `define`, the desktop packaging
// reads `readHardenChannel()` for its publish target, and
// `packages/contracts/src/harden-channel.ts` is the one module that reads the constants (and
// holds the same defaults for the workspace, tests and `pnpm dev`).
//
// Build variables (nothing reads them at runtime). A fork keeps the first and the third as
// repository variables (scripts/harden/setup-fork.sh); scripts/harden/publish.sh passes all
// three to the build:
//   PACKAGE_NAME        the npm package, default `codeharden`
//   RELEASE_REPOSITORY  the GitHub `owner/repo`; default: the `origin` remote of this checkout
//                       when it is a GitHub repository, else `harperaa/codeharden`
//   HARDEN_BRANCH       the fork's working branch, default `harden`
//
// CodeHarden's package name is the default only for CodeHarden. In a checkout whose `origin` is
// another repository an ordinary build warns and goes on (development, CI, tests); packing a
// release (`strict`) refuses, so a fork can't publish, or update its users, as `codeharden`.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export const DEFAULT_PACKAGE_NAME = "codeharden";
export const DEFAULT_RELEASE_REPOSITORY = "harperaa/codeharden";
export const DEFAULT_HARDEN_BRANCH = "harden";

const PACKAGE = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/;
const REPOSITORY = /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?\/[A-Za-z0-9._-]+$/;
const BRANCH = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/;
const BAD_BRANCH = /\.\.|\/\/|\/$|\.$|\.lock$|\/\./;
const GITHUB_REMOTE =
  /^(?:https?:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/|git:\/\/github\.com\/)([^/]+\/[^/]+?)(?:\.git)?\/?$/;

/** The `owner/repo` of a github.com remote URL, or null for anything else. */
export function repositoryOfRemote(url) {
  const repository = GITHUB_REMOTE.exec(String(url ?? "").trim())?.[1];
  return repository && REPOSITORY.test(repository) && !/\/\.{1,2}$/.test(repository)
    ? repository
    : null;
}

let cachedOrigin;
/** The `owner/repo` of this checkout's `origin` remote, or null (no git, no origin, not GitHub). */
export function originRepository() {
  if (cachedOrigin !== undefined) return cachedOrigin;
  // Git's own variables (set while a hook runs) must not point this at another repository.
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([k]) => !k.startsWith("GIT_")),
  );
  const result = spawnSync("git", ["remote", "get-url", "origin"], {
    cwd: fileURLToPath(new URL("../..", import.meta.url)),
    encoding: "utf8",
    env,
  });
  cachedOrigin = result.status === 0 ? repositoryOfRemote(result.stdout) : null;
  return cachedOrigin;
}

const same = (a, b) => a.toLowerCase() === b.toLowerCase();
let warned = false;

/**
 * The channel for this build; throws when a variable is set to something malformed.
 * `origin` is the checkout's `owner/repo` (tests pass it); `strict` is for packing a release:
 * it throws instead of building another repository's release with CodeHarden's names.
 */
export function readHardenChannel(env = process.env, options = {}) {
  const origin = options.origin === undefined ? originRepository() : options.origin;
  const strict = Boolean(options.strict);
  const foreign = origin ? !same(origin, DEFAULT_RELEASE_REPOSITORY) : strict;
  const where = origin
    ? `this checkout's origin is ${origin}`
    : "this checkout has no GitHub origin";

  let packageName = env.PACKAGE_NAME?.trim();
  if (!packageName) {
    if (foreign && strict) {
      throw new Error(
        `PACKAGE_NAME is not set, and ${where}, not ${DEFAULT_RELEASE_REPOSITORY}: refusing to pack a release as "${DEFAULT_PACKAGE_NAME}". Set PACKAGE_NAME to this fork's own npm package (scripts/harden/setup-fork.sh creates the repository variable).`,
      );
    }
    if (foreign && !warned && !options.quiet) {
      warned = true;
      console.warn(
        `[codeharden] PACKAGE_NAME is not set and ${where}: this build uses CodeHarden's package name "${DEFAULT_PACKAGE_NAME}" for self-update. Fine for development; set PACKAGE_NAME for a build you hand to users.`,
      );
    }
    packageName = DEFAULT_PACKAGE_NAME;
  }
  // GitHub names are case-insensitive: CodeHarden's own is always written one way.
  const ownOrigin = origin && !foreign ? DEFAULT_RELEASE_REPOSITORY : origin;
  let repository = env.RELEASE_REPOSITORY?.trim() || ownOrigin;
  if (!repository) {
    if (strict && !same(packageName, DEFAULT_PACKAGE_NAME)) {
      throw new Error(
        `RELEASE_REPOSITORY is not set and ${where}: refusing to pack "${packageName}" with links to ${DEFAULT_RELEASE_REPOSITORY}. Set RELEASE_REPOSITORY to this fork's owner/repo.`,
      );
    }
    repository = DEFAULT_RELEASE_REPOSITORY;
  }
  const branch = env.HARDEN_BRANCH?.trim() || DEFAULT_HARDEN_BRANCH;
  if (!PACKAGE.test(packageName)) {
    throw new Error(`PACKAGE_NAME must be an npm package name, found "${packageName}"`);
  }
  if (!REPOSITORY.test(repository)) {
    throw new Error(`RELEASE_REPOSITORY must be a GitHub owner/repo, found "${repository}"`);
  }
  if (!BRANCH.test(branch) || BAD_BRANCH.test(branch)) {
    throw new Error(`HARDEN_BRANCH must be a branch name, found "${branch}"`);
  }
  const [owner, repo] = repository.split("/");
  return { packageName, repository, owner, repo, branch };
}

/** The `define` entries for a bundler. */
export function hardenChannelDefine(env = process.env, options = {}) {
  const { packageName, repository, branch } = readHardenChannel(env, options);
  return {
    __CODEHARDEN_PACKAGE__: JSON.stringify(packageName),
    __CODEHARDEN_REPOSITORY__: JSON.stringify(repository),
    __CODEHARDEN_BRANCH__: JSON.stringify(branch),
  };
}
