// The build-time injection of CodeHarden's update channel: the npm package self-update installs
// and the GitHub repository whose releases the desktop app and the release links use. The
// tsdown configs (CLI, desktop) and the web app's Vite config spread `hardenChannelDefine()`
// into their `define`, the desktop packaging reads `readHardenChannel()` for its publish
// target, and `packages/contracts/src/harden-channel.ts` is the one module that reads the
// constants (and holds the same defaults for the workspace, tests and `pnpm dev`).
//
// Build variables (a fork sets them as repository variables; nothing reads them at runtime):
//   PACKAGE_NAME        the npm package, default `codeharden`
//   RELEASE_REPOSITORY  the GitHub `owner/repo`, default `harperaa/codeharden`

export const DEFAULT_PACKAGE_NAME = "codeharden";
export const DEFAULT_RELEASE_REPOSITORY = "harperaa/codeharden";

const PACKAGE = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/;
const REPOSITORY = /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?\/[A-Za-z0-9._-]+$/;

/** The channel for this build; throws when a variable is set to something malformed. */
export function readHardenChannel(env = process.env) {
  const packageName = env.PACKAGE_NAME?.trim() || DEFAULT_PACKAGE_NAME;
  const repository = env.RELEASE_REPOSITORY?.trim() || DEFAULT_RELEASE_REPOSITORY;
  if (!PACKAGE.test(packageName)) {
    throw new Error(`PACKAGE_NAME must be an npm package name, found "${packageName}"`);
  }
  if (!REPOSITORY.test(repository)) {
    throw new Error(`RELEASE_REPOSITORY must be a GitHub owner/repo, found "${repository}"`);
  }
  const [owner, repo] = repository.split("/");
  return { packageName, repository, owner, repo };
}

/** The `define` entries for a bundler. */
export function hardenChannelDefine(env = process.env) {
  const { packageName, repository } = readHardenChannel(env);
  return {
    __CODEHARDEN_PACKAGE__: JSON.stringify(packageName),
    __CODEHARDEN_REPOSITORY__: JSON.stringify(repository),
  };
}
