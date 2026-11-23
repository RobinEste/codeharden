export const DEFAULT_PACKAGE_NAME: string;
export const DEFAULT_RELEASE_REPOSITORY: string;

/** The update channel for this build, from `PACKAGE_NAME` and `RELEASE_REPOSITORY` or the defaults. */
export function readHardenChannel(env?: Record<string, string | undefined>): {
  packageName: string;
  repository: string;
  owner: string;
  repo: string;
};

/** The bundler `define` entries that inject it. */
export function hardenChannelDefine(env?: Record<string, string | undefined>): {
  __CODEHARDEN_PACKAGE__: string;
  __CODEHARDEN_REPOSITORY__: string;
};
