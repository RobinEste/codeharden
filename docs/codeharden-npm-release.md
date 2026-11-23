# Publishing CodeHarden to npm

CodeHarden is published to npm by hand, for the releases you choose. Not every CodeHarden release has to go to npm: installs update to the newest version npm has, and skip the ones in between.

The package is `codeharden`. The repository's `apps/cli/package.json` keeps upstream's name and version; `scripts/harden/npm-release.mjs` writes the release manifest into a staging folder at pack time (name, command, version, repository links) and changes nothing in the repository.

| | Example |
|---|---|
| CodeHarden version (`VERSION`, the git tag, the GitHub release) | `2026.0105.0518`, tag `v2026.0105.0518` |
| npm version (leading zeros stripped, as semver requires) | `2026.105.518` |

## Before the first publish

1. An npm account with two-factor authentication on (a security key or passkey if you can).
2. Node 24+ and pnpm 10 (`corepack enable`), and a clone of this repository.

## Every publish

1. **Pick the release.** A CodeHarden release is a commit on `harden` tagged `v<version>`. The "Upstream sync merge" workflow makes one after it merges a sync; to make one now, run that workflow by hand with **release** checked.

2. **Check the release out**, clean:

   ```sh
   git fetch origin --tags
   git checkout v2026.0105.0518
   ```

3. **Pack and check:**

   ```sh
   node scripts/harden/npm-release.mjs pack
   ```

   It installs dependencies, builds, packs `dist/npm/codeharden-<npm version>.tgz` and checks the tarball: the name, version, command and repository in its `package.json`, the files it must and must not contain, that the bundle was built from this `VERSION` for this package, and that its CLI starts and reports the version. It refuses a checkout that is not the release tag or has changes (`--allow-untagged` and `--allow-dirty` make a rehearsal tarball, which `publish` refuses).

4. **Sign in to npm:**

   ```sh
   node scripts/harden/npm-release.mjs login
   ```

   npm prints a URL (`https://www.npmjs.com/login?next=/login/cli/...`). Open it in your browser and approve. `node scripts/harden/npm-release.mjs status` shows who is signed in and what is already published.

5. **Look at what would be published**, without publishing:

   ```sh
   node scripts/harden/npm-release.mjs publish --dry-run
   ```

6. **Publish:**

   ```sh
   node scripts/harden/npm-release.mjs publish --confirm 2026.105.518
   ```

   `--confirm` takes the npm version, so a publish is never an accident. When npm wants your second factor it prints another URL (`https://www.npmjs.com/auth/cli/...`): open it and approve, or pass `--otp <code>` from an authenticator app.

7. **Check it**, in an empty folder:

   ```sh
   npm view codeharden version
   npx codeharden@2026.105.518 --version
   ```

   Then go back to your branch: `git checkout harden`.

## Good to know

- **A version can't be published twice**, and npm restricts unpublishing after 72 hours. If a release is wrong, publish a newer one and mark the bad one: `npm deprecate codeharden@<version> "<reason>"`.
- **The registry is always named** (`https://registry.npmjs.org`), so an npm config pointing elsewhere can't redirect a publish. `--registry` exists for tests.
- **Nothing is published from CI.** The Release workflow stays disabled, and no npm token is stored anywhere.
- **A fork's own channel:** set `PACKAGE_NAME` and `RELEASE_REPOSITORY` in the environment for both the build and this script (see `scripts/harden/channel-define.mjs`).
