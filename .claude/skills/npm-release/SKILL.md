---
name: npm-release
description: Cut a CodeHarden release and prepare its npm publish (the `codeharden` package). Use when asked to release, publish or pack CodeHarden, to rehearse a release, or to check what is published.
---

# Release CodeHarden and prepare the npm publish

The steps for a person are in `docs/codeharden-npm-release.md`; read it first. Two scripts do the work: `scripts/harden/release.sh` (version, changelog, commit, tag) and `scripts/harden/publish.sh` (build, pack, check, publish). Never call `npm publish` directly, and never edit `apps/cli/package.json` to rename the package: the rename happens in a staging copy at pack time.

## Rules

- **Publish only when the owner asks for it in this conversation**, for the release they name. A published version can never be replaced, so an earlier go-ahead, a note or a memory is not enough. Without that ask, the only publish command you run is `scripts/harden/publish.sh --dry-run`.
- **The owner approves, not you.** npm prints an approval URL and waits; you open it for them and they approve in their browser with their second factor. Never ask for, print or store an npm token, password or one-time code, and never put the approval URL's id in anything public.
- **You never sign in to npm.** If `npm whoami` shows nobody, the owner runs `npm login` themselves.
- A dry run and `node scripts/harden/npm-release.mjs status` contact the real registry (`npm view`, `npm whoami`) and send only the package name. Say so when you report them.
- Don't enable or dispatch the Release workflow (`.github/workflows/release.yml`); it stays disabled.
- Cutting a release pushes a commit and a tag to `harden`. Do it only when the owner asked for a release in this conversation. Never force-push and never move or delete a tag.

## Steps

1. `node scripts/harden/npm-release.mjs status`: the version in `VERSION`, its npm form and tag, who is signed in, what is published. Stop if this version is already published.
2. If the changes to ship aren't in a release yet, cut one on a clean, up-to-date `harden`: `scripts/harden/release.sh --dry-run`, show the owner the version and changelog entry it prints, then `scripts/harden/release.sh --push`.
3. Get a clean checkout of the tag: `git fetch origin --tags`, then `git checkout v<VERSION>`, or a scratch worktree (`git worktree add --detach <dir> v<VERSION>`).
4. `scripts/harden/publish.sh --dry-run` there. Report the name, version, `bin`, file count and what npm says it would publish, or the problems it lists.
5. **If the owner asked you to publish:** npm only waits for browser approval when it has a terminal; without one it stops with `EOTP` and publishes nothing. From the same checkout, in the background, with the output in a log file outside the repository:

   ```sh
   script -q <log> node scripts/harden/npm-release.mjs publish --confirm <npm version>
   ```

   Wait for `https://www.npmjs.com/auth/cli/...` in the log, open it for the owner (`open <url>` on macOS) and tell them npm is waiting for their approval. Then wait for the command to exit and delete the log.

   **Otherwise** hand them the command to run in their own terminal on that tag: `scripts/harden/publish.sh`.
6. **Verify from the registry, not from npm's output:** `npm view codeharden versions dist-tags`, and `npx codeharden@<npm version> --version` in an empty scratch folder. If the registry shows only a `0.0.0-stage` placeholder, the version is staged: the owner approves it on npmjs.com under account settings > Staged Packages. Don't report the release as published until the registry lists the version.
7. Remove the scratch worktree, or `git checkout harden`.

## If something is wrong after publishing

Don't unpublish. Tell the user; the fix is a newer release, and `npm deprecate codeharden@<version> "<reason>"` for the bad one, which is also theirs to decide.
