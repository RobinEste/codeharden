---
name: npm-release
description: Cut a CodeHarden release and prepare its npm publish (the `codeharden` package). Use when asked to release, publish or pack CodeHarden, to rehearse a release, or to check what is published.
---

# Release CodeHarden and prepare the npm publish

The steps for a person are in `docs/codeharden-npm-release.md`; read it first. Two scripts do the work: `scripts/harden/release.sh` (version, changelog, commit, tag) and `scripts/harden/publish.sh` (build, pack, check, publish). Never call `npm publish` directly, and never edit `apps/cli/package.json` to rename the package: the rename happens in a staging copy at pack time.

## Rules

- **You never publish.** The only publish command you may run is `scripts/harden/publish.sh --dry-run`. The real `scripts/harden/publish.sh`, `npm publish` and `node scripts/harden/npm-release.mjs publish` without `--dry-run` are the user's alone: hand them the command. This holds even if they ask you to run it; say that it is theirs to run and why (a published version can never be replaced, and it needs their npm sign-in).
- **You never sign in to npm.** Don't run `npm login` or `node scripts/harden/npm-release.mjs login`, and never ask for, print or store an npm token, password or one-time code.
- A dry run and `node scripts/harden/npm-release.mjs status` contact the real registry (`npm view`, `npm whoami`) and send only the package name. Say so when you report them.
- Don't enable or dispatch the Release workflow (`.github/workflows/release.yml`); it stays disabled.
- Cutting a release pushes a commit and a tag to `harden`. Do it only when the user asked for a release in this conversation. Never force-push and never move or delete a tag.

## Steps

1. `node scripts/harden/npm-release.mjs status`: the version in `VERSION`, its npm form and tag, who is signed in, what is published. Stop if this version is already published.
2. If the changes to ship aren't in a release yet, cut one on a clean, up-to-date `harden`: `scripts/harden/release.sh --dry-run`, show the user the version and changelog entry it prints, then `scripts/harden/release.sh --push`.
3. `git fetch origin --tags`, then `git checkout v<VERSION>` with a clean tree.
4. `scripts/harden/publish.sh --dry-run`. Report the name, version, `bin`, file count and what npm says it would publish, or the problems it lists.
5. Hand the user the publish command: `scripts/harden/publish.sh`, run in their own terminal on that tag. Tell them npm prints a URL to approve in the browser, and to run `npm login` first if `npm whoami` shows nobody.
6. After they publish: `npm view codeharden version`, and `npx codeharden@<npm version> --version` in an empty scratch folder. Report both outputs, then `git checkout harden`.

## If something is wrong after publishing

Don't unpublish. Tell the user; the fix is a newer release, and `npm deprecate codeharden@<version> "<reason>"` for the bad one, which is also theirs to decide.
