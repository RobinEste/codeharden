export const DEFAULT_PACKAGE_NAME: string;
export const DEFAULT_RELEASE_REPOSITORY: string;
export const DEFAULT_HARDEN_BRANCH: string;

export interface HardenChannelOptions {
  /** The checkout's `owner/repo`; default: read from the `origin` remote. `null`: none. */
  origin?: string | null;
  /** Packing a release: throw instead of using CodeHarden's names in another repository. */
  strict?: boolean;
  /** Don't print the warning an ordinary build gives in another repository. */
  quiet?: boolean;
}

/** The `owner/repo` of a github.com remote URL, or null. */
export function repositoryOfRemote(url: string | null | undefined): string | null;

/** The `owner/repo` of this checkout's `origin` remote, or null. */
export function originRepository(): string | null;

/** The update channel for this build, from `PACKAGE_NAME`, `RELEASE_REPOSITORY` and `HARDEN_BRANCH` or the defaults. */
export function readHardenChannel(
  env?: Record<string, string | undefined>,
  options?: HardenChannelOptions,
): {
  packageName: string;
  repository: string;
  owner: string;
  repo: string;
  branch: string;
};

/** The bundler `define` entries that inject it. */
export function hardenChannelDefine(
  env?: Record<string, string | undefined>,
  options?: HardenChannelOptions,
): {
  __CODEHARDEN_PACKAGE__: string;
  __CODEHARDEN_REPOSITORY__: string;
  __CODEHARDEN_BRANCH__: string;
};
