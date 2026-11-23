# Publishing CodeHarden to npm

CodeHarden is published to npm by hand, for the releases you choose. Not every CodeHarden release has to go to npm: installs update to the newest version npm has, and skip the ones in between.

The package is `codeharden`. The repository's `apps/cli/package.json` keeps upstream's name and version; `scripts/harden/publish.sh` (through `scripts/harden/npm-release.mjs`, which does the work) writes the release manifest into a staging folder at pack time (name, command, version, repository links) and changes nothing in the repository.

| | Example |
|---|---|
| CodeHarden version (`VERSION`, the git tag, the GitHub release) | `2026.0105.0518`, tag `v2026.0105.0518` |
| npm version (leading zeros stripped, as semver requires) | `2026.105.518` |

## Before the first publish

1. An npm account with two-factor authentication on (a security key or passkey if you can).
2. Node 24+ and pnpm 10 (`corepack enable`), and a clone of this repository.

## Every publish

1. **Cut the release**, if the changes you want aren't in one yet. On a clean, up-to-date `harden`:

   ```sh
   git checkout harden && git pull --ff-only
   scripts/harden/release.sh --dry-run   # shows the version, the tag and the changelog entry
   scripts/harden/release.sh --push      # commits, tags and pushes both in one atomic push
   ```

   It writes `VERSION` (the time now in America/New_York), a new entry on top of `CODEHARDEN-CHANGELOG.md` and `state/upstream-base`, in one commit `release: <version> (upstream <sha>)` tagged `v<version>`. Without `--push` it stays local and prints the push command. It refuses if the tag exists or tracked files have changes. The "Upstream sync merge" workflow runs the same script after it merges a sync, so a release may already be there.

2. **Check the release out**, clean:

   ```sh
   git fetch origin --tags
   git checkout v2026.0105.0518
   ```

3. **Rehearse:**

   ```sh
   scripts/harden/publish.sh --dry-run
   ```

   It refuses unless the tree is clean and HEAD is the tag `v<VERSION>`. Then it installs dependencies, builds, packs `dist/npm/codeharden-<npm version>.tgz` and checks the tarball: the name, version, command and repository in its `package.json`, the files it must and must not contain, that the bundle was built from this `VERSION` for this package, and that its CLI starts and reports both versions. It prints the name, version, `bin` and file count, then what npm would publish. Nothing is published.

4. **Sign in to npm**, if `npm whoami` doesn't show your account: `npm login`. npm prints a URL (`https://www.npmjs.com/login?next=/login/cli/...`); open it in your browser and approve.

5. **Publish:**

   ```sh
   scripts/harden/publish.sh
   ```

   It repeats the build, pack and checks, asks you to type the version, then runs `npm publish --access public`. npm prints another URL (`https://www.npmjs.com/auth/cli/...`) and waits while you approve with your second factor in the browser. No one-time code goes on the command line.

6. **Check it**, in an empty folder:

   ```sh
   npm view codeharden version
   npx codeharden@2026.105.518 --version
   ```

   Then go back to your branch: `git checkout harden`.

## Good to know

- **If npm says it published but the version isn't there:** `npm view codeharden versions` showing only `0.0.0-stage` means npm staged the release instead of publishing it. Approve it on npmjs.com under account settings > **Staged Packages** (it asks for your second factor); the version appears once approved.

- **A version can't be published twice**, and npm restricts unpublishing after 72 hours. If a release is wrong, publish a newer one and mark the bad one: `npm deprecate codeharden@<version> "<reason>"`.
- **The registry is always named** (`https://registry.npmjs.org`), so an npm config pointing elsewhere can't redirect a publish. `--registry` exists for tests.
- **Nothing is published from CI.** The Release workflow stays disabled, no npm token is stored anywhere, and there is no Trusted Publishing or provenance: every publish is you, signed in, at your machine.
- **A fork's own package:** in a fork of CodeHarden the package is the fork's `PACKAGE_NAME` repository variable, the links point at the fork's own repository (the `origin` remote) and its working branch; `publish.sh` reads them with `gh`, or from the environment (`PACKAGE_NAME`, `RELEASE_REPOSITORY`, `HARDEN_BRANCH`). Outside `harperaa/codeharden` there is no default package name: packing refuses until `PACKAGE_NAME` is set. Setting a fork up: [Make your own hardened fork](../README.md#make-your-own-hardened-fork).
