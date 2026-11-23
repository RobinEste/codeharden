import { readdirSync, readFileSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { configDefaults, defineConfig } from "vitest/config";
import { capWorkersWhenBusy } from "./scripts/test-workers.mjs";

/**
 * Tests make temp folders under `os.tmpdir()` and compare paths the server and runner
 * canonicalise with `realpath`. On CI runners the temp dir is not canonical: macOS uses
 * `/var/folders/...` (a symlink to `/private/var/...`) and Windows uses an 8.3 short name
 * (`C:\Users\RUNNER~1\...`). Point every worker (and the processes they spawn) at the
 * canonical temp dir so expectations and results agree. `os.tmpdir()` reads these variables
 * on every call.
 */
const canonicalTmp = realpathSync.native(tmpdir());
for (const name of process.platform === "win32" ? ["TEMP", "TMP"] : ["TMPDIR"]) {
  process.env[name] = canonicalTmp;
}

/**
 * Variables CodeDen sets on the processes it starts (the runner's home, the desktop app's
 * installer, a restart's launch info). A shell that inherited them from a running CodeDen would
 * point the suites at its real home and the npm registry instead of their temp homes and fake
 * npm, so every worker starts without them; a test that needs one sets it itself. Switches a
 * developer sets on purpose (`CODEDEN_LIVE`, `CODEDEN_REQUIRE_CLI_DIST`) are kept.
 */
for (const name of [
  "CODEDEN_HOME",
  "CODEDEN_DEPS_INSTALLER",
  "CODEDEN_LAUNCHED_BY",
  "CODEDEN_NO_SWITCH",
]) {
  delete process.env[name];
}

/**
 * Suites that drive real processes with timing-sensitive waits: Chromium, terminals, Fake
 * turns in worktrees, dev-server discovery and detached runner processes. They compete for
 * CPU and process start-up (PowerShell, netstat, tsx) and their waits time out on a loaded
 * machine, so they only run with `pnpm test:slow`, one file at a time per package.
 */
const RUNNER_PROCESS_TESTS = [
  "test/browser-engine.test.ts",
  "test/browser-agent.test.ts",
  "test/browser-native.test.ts",
  "test/browser-dialogs.test.ts",
  "test/browser-listeners.test.ts",
  "test/sessions.test.ts",
  "test/pty.test.ts",
];
const SERVER_PROCESS_TESTS = [
  "test/runner-lifecycle.test.ts",
  "test/runner-e2e.test.ts",
  "test/runner-link-process.test.ts",
  "test/opencode-e2e.test.ts",
  "test/restart-recovery.test.ts",
  "test/browser.test.ts",
  "test/browser-native.test.ts",
];
const DESKTOP_PROCESS_TESTS = ["test/relay-chromium.test.ts"];

/**
 * Server suites that start a real runner process with the Fake provider: they call
 * `startHarness` (`apps/server/test/support/harness.ts`) or `startServer` without
 * `runner: false`. Found by reading the test files, so a new suite lands here on its own.
 */
const SERVER_ROOT = fileURLToPath(new URL("./apps/server/", import.meta.url));
const SERVER_RUNNER_TESTS = readdirSync(join(SERVER_ROOT, "test"))
  .filter((file) => file.endsWith(".test.ts"))
  .map((file) => `test/${file}`)
  .filter((file) => !SERVER_PROCESS_TESTS.includes(file))
  .filter((file) => {
    const source = readFileSync(join(SERVER_ROOT, file), "utf8");
    return (
      source.includes("startHarness(") ||
      (source.includes("startServer(") && !source.includes("runner: false"))
    );
  });
/** Runner suites that build git worktrees and checkpoints, many per test. */
const RUNNER_WORKTREE_TESTS = [
  "test/workspace.test.ts",
  "test/workspace-base.test.ts",
  "test/workspace-fork.test.ts",
  "test/workspace-remove.test.ts",
  "test/workspace-clone.test.ts",
  "test/workspace-setup-change.test.ts",
  "test/checkpoints.test.ts",
];

/**
 * The process-heavy suites above (a server, a runner through tsx and git worktrees per suite)
 * get timeouts that leave room for a busy machine: with Vitest's 5 s they timed out whenever
 * other builds kept the machine busy, and a saturated machine still takes up to a minute for
 * some of their tests. The test timeout stays above the harness's 60 s `waitUntil` and 90 s
 * runner-command floor, so a slow wait reports what it waited for; the suites set no lower
 * timeouts of their own. They share the pool with the fast suites: a worker limit of their own
 * would need a phase of their own after the fast suites, which made `pnpm test` 40-50% slower
 * (on a busy machine, `capWorkersWhenBusy` in `scripts/test-workers.mjs` limits every project
 * instead).
 */
const PROCESS_HEAVY = { testTimeout: 120_000, hookTimeout: 120_000 };

/**
 * The other runner, server and release-script suites still start git and child processes
 * (clones, fake CLIs), which take seconds on a busy machine: more room than Vitest's 5 s default.
 */
const SPAWNS_PROCESSES = { testTimeout: 40_000, hookTimeout: 60_000 };

/**
 * Suites whose clock moves hours ahead must not depend on the time of day CI runs at (#379). A
 * sample of the factory, budget and digest suites runs again with the system clock started just
 * before and just after local midnight (`CODEDEN_TEST_CLOCK`, `apps/server/test/support/
 * clock-setup.ts`). The factory test env runs its own clock from a fixed instant; the rest must
 * hold at any time of day. In-process suites only (a runner process keeps the real clock), and
 * none that pin their own clock (`vi.setSystemTime`).
 */
const CLOCK_SAMPLE = [
  "test/factory-loop.test.ts",
  "test/factory-policy.test.ts",
  "test/factory-scout.test.ts",
  "test/factory-reviewer-fallback.test.ts",
  "test/factory-stalls.test.ts",
  "test/factory-conflicts.test.ts",
  "test/factory-unattended.test.ts",
  "test/factory-run-failed-inbox.test.ts",
  "test/orchestration-digest.test.ts",
];
const AROUND_MIDNIGHT = ["23:50", "00:05"].map((at) => ({
  extends: "./apps/server/vitest.config.ts",
  test: {
    name: `@codeden/server (clock ${at})`,
    root: "apps/server",
    include: CLOCK_SAMPLE,
    env: { CODEDEN_TEST_CLOCK: at },
    ...SPAWNS_PROCESSES,
  },
}));

/** The fast suites: `pnpm test`, CI and the release run these. */
const FAST = [
  "packages/*",
  "apps/web",
  "apps/cli",
  {
    test: {
      name: "@codeden/desktop",
      root: "apps/desktop",
      include: ["test/**/*.test.ts"],
      exclude: [...configDefaults.exclude, ...DESKTOP_PROCESS_TESTS],
    },
  },
  {
    test: { name: "scripts", root: "scripts", include: ["**/*.test.mjs"], ...SPAWNS_PROCESSES },
  },
  {
    test: {
      name: "@codeden/runner",
      root: "apps/runner",
      exclude: [...configDefaults.exclude, ...RUNNER_PROCESS_TESTS, ...RUNNER_WORKTREE_TESTS],
      ...SPAWNS_PROCESSES,
    },
  },
  {
    test: {
      name: "@codeden/runner (worktrees)",
      root: "apps/runner",
      include: RUNNER_WORKTREE_TESTS,
      ...PROCESS_HEAVY,
    },
  },
  {
    extends: "./apps/server/vitest.config.ts",
    test: {
      name: "@codeden/server",
      root: "apps/server",
      exclude: [...configDefaults.exclude, ...SERVER_PROCESS_TESTS, ...SERVER_RUNNER_TESTS],
      ...SPAWNS_PROCESSES,
    },
  },
  {
    extends: "./apps/server/vitest.config.ts",
    test: {
      name: "@codeden/server (runner)",
      root: "apps/server",
      include: SERVER_RUNNER_TESTS,
      ...PROCESS_HEAVY,
    },
  },
  ...AROUND_MIDNIGHT,
];

/**
 * The real-browser and real-process suites: slow, and the main source of flaky failures, so
 * they are opt-in (`pnpm test:slow`, i.e. `vitest run --mode slow`) and not part of CI or the
 * release. Run them when working on the browser, terminals or the runner's processes.
 */
const SLOW = [
  {
    test: {
      name: "@codeden/desktop (processes)",
      root: "apps/desktop",
      include: DESKTOP_PROCESS_TESTS,
      fileParallelism: false,
    },
  },
  {
    test: {
      name: "@codeden/runner (processes)",
      root: "apps/runner",
      include: RUNNER_PROCESS_TESTS,
      fileParallelism: false,
    },
  },
  {
    extends: "./apps/server/vitest.config.ts",
    test: {
      name: "@codeden/server (processes)",
      root: "apps/server",
      include: SERVER_PROCESS_TESTS,
      fileParallelism: false,
    },
  },
];

export default defineConfig(async ({ mode }) => {
  // Fewer workers when the machine is busy, decided once: this function runs again for every
  // inline project without `extends`.
  await capWorkersWhenBusy({ mode });
  return {
    test: {
      passWithNoTests: true,
      projects: mode === "slow" ? SLOW : FAST,
    },
  };
});
