# CodeDen: agent guide

CodeDen is a local-first harness for coding agents. **`docs/DESIGN.md` is the locked design and the source of truth.** Read the relevant sections before changing behaviour; anything in its "Locked decisions" table needs a design discussion first.

## Layout

```
apps/
  server/     Hono server: security, SQLite event log + projections (Drizzle), UI WebSocket, RunnerClient
  runner/     Runner process: provider sessions, event journal, lock file, WebSocket protocol server
  web/        React 19 + Vite SPA (Tailwind v4, shadcn/ui, TanStack Router + Query, Zustand)
  cli/        The published `codeden` package: CLI entry, bundles server + runner + web with tsdown
  desktop/    The desktop app (Electron): main process, preload bridge, server host, electron-builder packaging
packages/
  contracts/  zod schemas for everything that crosses a boundary (events, entities, protocols, settings)
  providers/  ProviderAdapter / ProviderSession interfaces, the Fake provider, the Claude Code, Codex and OpenCode adapters, a generic ACP client and the Cursor and Gemini CLI adapters on it
docs/DESIGN.md
changes/      Changelog fragments: one file per user-facing change, assembled into CHANGELOG.md at release
scripts/release/  bump-version.mjs (the Release workflow's version bump) and changes.mjs (fragments)
scripts/harden/   CodeHarden's own: release.sh, publish.sh (npm-release.mjs), setup-fork.sh, fork-config.sh (which upstream, branches and package), the build-time version and channel defines
```

Key entry points:
- Contracts: `packages/contracts/src/` (agent events `agent-events.ts`, items `items.ts`, runner protocol `runner/`, UI WebSocket `ws.ts`, persisted events `events.ts`, work/conflicts `work.ts`, factory `factory.ts`).
- Server: `apps/server/src/server.ts` (`startServer({ port, dataDir, token })`), dev entry `src/dev.ts`.
- Runner: `apps/runner/src/runner.ts` (`startRunner`), process entry `src/main.ts`.
- Web shell: `apps/web/src/components/shell/`.
- CLI: `apps/cli/src/cli.ts`.
- Desktop: `apps/desktop/src/main/main.ts` (entry), `desktop-app.ts` (wiring), `src/server/host.ts` (server child), `src/preload/preload.ts` (`window.codedenDesktop`); the UI side is `apps/web/src/lib/platform-desktop.ts`. User guide: `docs/desktop.md`.

## Commands

Node 24+ and pnpm 10 (`corepack enable`).

| Command | What it does |
|---|---|
| `pnpm install` | Install the workspace |
| `pnpm dev` | Server on 127.0.0.1:4318 (data in `.codeden-dev/`, Fake provider on) + Vite on http://localhost:5173 |
| `pnpm build` | Build the web app, then bundle `apps/cli/dist` |
| `pnpm typecheck` | `tsc --noEmit` in every package |
| `pnpm lint` / `pnpm format` | Biome check / Biome fix + format |
| `pnpm test` | Vitest, the fast suites (what CI and the release run) |
| `pnpm test:slow` | The real-browser and real-process suites (Chromium, terminals, detached runners). Not in CI; run them when working in those areas |
| `pnpm e2e` | Not in CI. Build the web app and the CLI, then Playwright (`apps/web/e2e`) against a real server + runner with an isolated home and the Fake provider; the update spec also runs the built CLI against a local fake npm registry (first run: `pnpm --filter @codeden/web exec playwright install chromium`) |
| `pnpm desktop:dev` | Build the web UI and the desktop bundle, then run the desktop app from the checkout with home `.codeden-dev/` and the Fake provider (attaches to `pnpm dev`'s server when it runs). Pass options after `--`, e.g. `pnpm desktop:dev -- --home <dir>` |
| `pnpm desktop:build` | `pnpm build`, then the unpacked desktop app for this OS in `apps/desktop/release/` (`pnpm desktop:dist` builds the installers) |
| `pnpm e2e:desktop` | `pnpm desktop:build`, then Playwright's Electron smoke test against the unpacked app with an isolated home and the Fake provider (plus a local update feed test on Windows). Separate from `pnpm e2e` because packaging is slow |
| `VITE_CODEDEN_MOCK=1 pnpm --filter @codeden/web dev` | The UI against the in-memory mock client, no server needed (dev only; builds always use the real server) |
| `pnpm db:generate` | Generate a Drizzle migration after editing a table file `apps/server/src/db/schema-*.ts` (`schema.ts` is the barrel that re-exports them). The snapshots must stay one chain (`apps/server/test/migration-chain.test.ts` checks it): if `main` gained a migration since you generated yours, delete your migration's folder after rebasing and run `pnpm db:generate` again so yours sits on top. Don't use `--ignore-conflicts`, which writes a merge snapshot with two parents. To repair a fork that already reached `main`, change only the newer snapshots (their `prevIds`, and add the other branch's entities to `ddl`), never a shipped `migration.sql`, then check that `pnpm db:generate` reports no changes and `pnpm --filter @codeden/server exec drizzle-kit check` passes |
| `node apps/cli/dist/cli.js --home <dir>` | Run the built CLI (`doctor`, `update`, `stop`, `--port`, `--no-open`). A repository build never switches versions; self-update is tested with the fake registry in `apps/cli/test/support/` |

## Conventions

- **Contracts first.** Any new message, event, entity or setting is added to `packages/contracts` (with JSDoc and a round-trip test) before it is used. Validate at boundaries with the shared schemas.
- **Plain TypeScript**, strict, ESM. **No Effect**, no clever abstractions; mainstream patterns that other agents can follow.
- **Small modules:** keep files under ~400 lines; split by concern.
- **Honest capabilities:** UI and orchestration read `ProviderCapabilities`, never branch on a provider id.
- **Heavy UI code loads on demand.** Pages are lazy routes, and the terminal, diff viewer and code editor come from `apps/web/src/components/on-demand.tsx`; never import those libraries statically from anything the web app's entry reaches. `apps/web/test/entry-chunk.test.ts` checks it. See `apps/web/README.md`.
- **Events are append-only.** Projections are written in the same transaction as their event (`apps/server/src/events/`), so they can be rebuilt from the log.
- **Security:** server and runner bind 127.0.0.1 only; every request needs the install token; never log or persist tokens in transcripts.
- **Tests: keep them lean.** The bar is that the app installs and works; CI checks exactly that (typecheck, lint, `pnpm test`, build, the packed CLI installed and started). Add a Vitest unit test (next to the package in `test/`) when logic is easy to get wrong and costly when wrong: the risk classifier and other security checks, contracts round-trips, migrations, parsers, anything that can lose data. Don't add end-to-end, real-browser or real-process tests for a feature unless asked, and keep `pnpm test` fast and deterministic (no real timers or races; use the Fake provider, never live agent turns). Bugs users hit get an issue and a fix, with a regression test when the logic warrants one.
- **Process-heavy suites get room for a busy machine.** `startHarness` (`apps/server/test/support/harness.ts`), and `startServer` without `runner: false`, start a real runner process with the Fake provider, plus git worktrees. `vitest.config.ts` finds those server files by reading them and runs them as the `@codeden/server (runner)` project, beside the runner's worktree suites (`@codeden/runner (worktrees)`, a list in the config), with 120 s test and hook timeouts (and no lower ones in the files). The harness's `waitUntil` waits 60 s, and its server gives runner commands at least 90 s (`runnerRequestTimeoutFloorMs`), so the product's own 5-30 s deadlines don't fire first. They stay in `pnpm test` and CI, in the shared pool: a worker limit of their own would need a phase of their own after the fast suites (Vitest 5), which made the run 40-50% slower. Instead, when the machine is already busy at start (under half idle), the config runs a quarter of the CPUs' worth of workers for every project. The other runner, server and release-script suites get 40 s, the web suites 15 s. Reach for the harness only when the test is about the server and the runner together (sessions, turns, worktrees, MCP over a live runner). For server logic, prefer services over a real SQLite database with a scripted `RunnerPort` (`support/factory-env.ts`, `support/github-env.ts`) or `startServer({ runner: false })`; those stay in the fast pool. Wait on the condition with `waitUntil` and a generous deadline, never a fixed sleep or a tight timer. `node scripts/test-under-load.mjs` runs three `pnpm test` at once, as parallel factory builds do, to check for timing flakes.
- **Tests don't depend on the time of day.** The factory test env (`apps/server/test/support/factory-env.ts`) runs the process clock from a fixed instant (`TEST_START` in `support/test-clock.ts`, mid-morning local time), so a test can move it hours ahead without crossing midnight into the daily digest, counters and budget; a test about day boundaries starts near midnight on purpose (`createFactoryEnv({ startAt })`). Elsewhere, pin the clock (`vi.setSystemTime`) instead of building on the real `Date.now()` when a test moves time by hours. `CODEDEN_TEST_CLOCK=23:50` starts the server suites' system clock at that local time, and `pnpm test` runs a sample of the factory, budget and digest suites at 23:50 and 00:05 (`@codeden/server (clock …)`).
- **Agent sessions don't inherit CodeDen's internal `CODEDEN_*` variables** (its home, its installer and the like; `packages/providers/test/agent-env.test.ts` keeps it so), and the root `vitest.config.ts` drops them for every worker as well. Run the tests as they are: there's no need to look for those variables first.
- **Never mention other harnesses or products as inspiration** anywhere: code, comments, docs, commits. Describe CodeDen on its own terms.
- **Commits:** conventional commits (`feat(server): ...`, `fix(runner): ...`, `chore: ...`), one logical change per commit. `pnpm typecheck && pnpm lint && pnpm test` must pass.
- **Changelog notes are fragments.** A user-facing change adds its note as its own file, `changes/<issue>-<slug>.md` (front matter `section: added | changed | deprecated | removed | fixed | security`, then `- ` bullets in the style of `CHANGELOG.md`). Never edit `CHANGELOG.md` for unreleased work, so pull requests never conflict on it. Docs-only and internal changes need no note. Format: `changes/README.md`; `pnpm test` checks it.
- Generated files: `apps/server/drizzle/` (migrations, via drizzle-kit) and `apps/web/src/components/ui/` (shadcn). Add shadcn components with `pnpm dlx shadcn@latest add <name>` from `apps/web`.

## Local test gate (temporary)

Since 2026-11-22 CI skips `pnpm test` to keep pull requests fast: the repository variable `CI_TESTS` is `off` (CI still runs typecheck, lint, the build, the self-update check and the packed install). Until it is turned back on, the tests run on your machine and a failure blocks the push:

- `scripts/harden/local-checks.sh` runs `pnpm test` on the checked-out commit and remembers a pass for that exact tree. **Run it before you open or update a pull request**, with everything committed.
- The pre-push hook `scripts/harden/hooks/pre-push` runs the same script and refuses the push when the tests fail or can't run. A commit that already passed pushes at once. It is enabled per clone, once (worktrees share it): `git config core.hooksPath scripts/harden/hooks`.
- Not gated: tags, pushes to `harden`, `main` and (in a fork of CodeHarden) `mirror`, and branches that change documentation only. `git push --no-verify` skips the hook; don't use it to get around a failure, and say so in the pull request if you ever use it.
- Sync pull requests from upstream are opened without this gate; run `scripts/harden/local-checks.sh` on the sync branch before approving one.
- To turn the tests back on in CI: delete the repository variable (`gh variable delete CI_TESTS`), then remove this section. The plan is to do that in mid-December 2026, once the code has settled.

## Releasing

CodeHarden has its own releases; upstream's Release workflow (`.github/workflows/release.yml`) is disabled here and stays disabled. The app's own version (`apps/cli/package.json`, `apps/desktop/package.json`, `SOURCE_VERSION`) stays upstream's and is never bumped here; `scripts/release/` is upstream's and unused.

1. **A release** is one commit on `harden`, `release: <version> (upstream <sha>)`, tagged `v<version>`. The version is `YYYY.MMDD.HHMM`, the release time in America/New_York (`2026.0105.0518`). `scripts/harden/release.sh` makes it: it writes `VERSION`, a new entry on top of `CODEHARDEN-CHANGELOG.md` (`## <version> — YYYY-MM-DD HH:MM`, then `### upstream (<UPSTREAM_REPO>)` and `### <this repository's name>` with the non-merge commit subjects since the last release; here `leonvanzyl/codeden` and `codeharden`) and `state/upstream-base` (the upstream commit `harden` now contains). `--dry-run` prints what it would write; `--push` pushes the commit and the tag in one atomic push. It fails if the tag exists and never forces anything.
2. **Who runs it.** The "Upstream sync merge" workflow, after it merges a sync pull request, and a maintainer after merging our own changes (`scripts/harden/release.sh --push` on an up-to-date `harden`).
3. **npm** is published by hand, by the owner, for the releases they choose: `scripts/harden/publish.sh` on a clean checkout of the release tag. The package is the repository variable `PACKAGE_NAME` and its command is that name without the scope (here `codeharden` for both); its npm version is the CodeHarden version with leading zeros stripped per field (`2026.105.518`). The rename happens in a staging copy at pack time; `apps/cli/package.json` keeps upstream's name and version. No tokens, no Trusted Publishing, no publish from CI. An agent runs the real publish only when the owner asks for that release to be published in the conversation: it runs the publish step under a pseudo-terminal, opens the approval URL npm prints, and the owner approves in the browser (the `npm-release` skill has the steps). An agent never runs `npm login` and never handles a token or one-time code. Steps: `docs/codeharden-npm-release.md`.
4. **Desktop installers** are not published by this fork.
5. **Nothing above is a fixed name.** Which upstream is followed, on which branch, and the npm package come from the repository variables `UPSTREAM_REPO`, `UPSTREAM_BRANCH` and `PACKAGE_NAME` (optionally `HARDEN_BRANCH` and `MIRROR_BRANCH` for the working and mirror branches); the release repository is the repository itself. `scripts/harden/fork-config.sh` resolves them for the shell scripts, the "config" job for the sync workflow and `scripts/harden/channel-define.mjs` for the build; CodeHarden's values (`leonvanzyl/codeden`, `main`, `codeharden`, `harden`, `main`) are the defaults in `harperaa/codeharden` only. Anywhere else the scripts and the workflow refuse until the variables are set. `scripts/harden/setup-fork.sh` sets a fork up (README, "Make your own hardened fork").
