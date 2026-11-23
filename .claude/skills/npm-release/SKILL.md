---
name: npm-release
description: Publish a CodeHarden release to npm by hand (the `codeharden` package). Use when asked to release, publish or pack CodeHarden for npm, to rehearse a release, or to check what is published.
---

# Publish CodeHarden to npm

The steps for a person are in `docs/codeharden-npm-release.md`; read it first. Everything goes through `scripts/harden/npm-release.mjs` (`pack`, `login`, `publish`, `status`). Never call `npm publish` directly, and never edit `apps/cli/package.json` to rename the package: the script writes the release manifest into a staging folder.

## Rules

- **Publishing is the user's decision, every time.** Run `publish --confirm <version>` only when the user asked for this publish in this conversation and named or confirmed the version. An earlier go-ahead, a note or a memory doesn't count. A published version can never be replaced.
- `pack`, `status` and `publish --dry-run` publish nothing and are safe to run. Say that a dry run still contacts the real registry.
- Don't enable or dispatch the Release workflow (`.github/workflows/release.yml`); it stays disabled.
- Never ask for, print or store an npm token, password or one-time code. If the user gives a one-time code, pass it with `--otp` and don't repeat it.

## Steps

1. `node scripts/harden/npm-release.mjs status`: the version in `VERSION`, its npm form and tag, who is signed in, what is published. Stop if this version is already published.
2. Make sure the checkout is the release: `git fetch origin --tags`, then `git checkout v<VERSION>` with a clean tree. If the user wants changes that aren't in a release yet, they need a new CodeHarden release first (the "Upstream sync merge" workflow with **release** checked); that is theirs to start.
3. `node scripts/harden/npm-release.mjs pack`. Report the tarball path and that the checks passed, or the problems it lists. To rehearse on a branch, add `--allow-untagged` (and `--allow-dirty`); `publish` refuses a rehearsal tarball.
4. `node scripts/harden/npm-release.mjs publish --dry-run`, and show the user the package name, version, size and file count npm prints.
5. **Signing in.** If `status` shows nobody signed in, the user runs `node scripts/harden/npm-release.mjs login` in their own terminal. If they ask you to run it, run it in the background and give them the URL npm prints (`https://www.npmjs.com/login?next=/login/cli/...`) exactly as printed; the command finishes once they approve in the browser.
6. **Publishing.** By default, give the user the command and let them run it: `node scripts/harden/npm-release.mjs publish --confirm <npm version>`. If they tell you to run it, run it in the background and pass on the authentication URL npm prints (`https://www.npmjs.com/auth/cli/...`) exactly as printed, then wait for the command to finish.
7. Afterwards: `npm view codeharden version`, and `npx codeharden@<npm version> --version` in an empty scratch folder. Report both outputs, then `git checkout harden`.

## If something is wrong after publishing

Don't unpublish. Tell the user; the fix is a newer release, and `npm deprecate codeharden@<version> "<reason>"` for the bad one, which is also theirs to decide.
