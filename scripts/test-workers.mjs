/**
 * The worker limit `pnpm test` runs with on a busy machine. The root `vitest.config.ts` calls
 * `capWorkersWhenBusy` from its config function.
 *
 * On a machine other builds already keep busy (factory builders and reviewers running
 * `pnpm test` side by side), the fast suites run a quarter of the CPUs' worth of workers instead
 * of one per CPU. With a worker per CPU on top of that load, the process-heavy suites starved
 * each other past their timeouts, and Vitest's own workers could not start within its fixed 60 s.
 */
import { availableParallelism, cpus } from "node:os";

/** The share of the machine's CPU time that was idle over the next `ms` (0 to 1). */
export async function idleShare(ms) {
  const sample = () =>
    cpus().reduce(
      (sum, { times: t }) => ({
        idle: sum.idle + t.idle,
        all: sum.all + t.user + t.nice + t.sys + t.idle + t.irq,
      }),
      { idle: 0, all: 0 },
    );
  const before = sample();
  await new Promise((resolve) => setTimeout(resolve, ms));
  const after = sample();
  const all = after.all - before.all;
  return all > 0 ? (after.idle - before.idle) / all : 1;
}

/**
 * Workers on a busy machine with `cpuCount` CPUs: a quarter of them, at least 2, and never more
 * than Vitest starts on its own (one fewer than the CPUs, at least 1), so the limit can only
 * lower the count: 1 on one or two CPUs, 2 up to eleven, then a quarter.
 */
export function busyWorkerCount(cpuCount) {
  const count = Number.isFinite(cpuCount) && cpuCount >= 1 ? Math.floor(cpuCount) : 1;
  return Math.min(Math.max(count - 1, 1), Math.max(2, Math.floor(count / 4)));
}

/**
 * Whether the command line sets the workers itself: `--maxWorkers` or `--fileParallelism`, in
 * either spelling (`--max-workers`, `--no-file-parallelism`), with the value attached or next.
 */
export function setsWorkers(argv) {
  return argv.some((arg) =>
    /^--(?:no-)?(?:maxWorkers|max-workers|fileParallelism|file-parallelism)(?:=|$)/.test(arg),
  );
}

async function decide({
  mode,
  env = process.env,
  argv = process.argv,
  cpuCount = availableParallelism(),
  measureIdle = () => idleShare(300),
  log = console.log,
}) {
  // The slow suites run one file at a time (`fileParallelism: false`), and Vitest lets
  // `VITEST_MAX_WORKERS` override that.
  if (mode === "slow") return;
  if (env.VITEST_MAX_WORKERS) return;
  if (setsWorkers(argv)) return;
  const idle = await measureIdle();
  if (idle >= 0.5) return;
  const workers = busyWorkerCount(cpuCount);
  env.VITEST_MAX_WORKERS = String(workers);
  log(`The machine is busy (${Math.round(idle * 100)}% idle): ${workers} test workers.`);
}

const DECIDED = Symbol.for("codeden.test-workers.decided");

/**
 * Limits the workers of every project when the machine is busy, by setting `VITEST_MAX_WORKERS`
 * (which Vitest reads for each project as it resolves it). `VITEST_MAX_WORKERS`, `--maxWorkers`
 * and `--fileParallelism` still win, and the slow suites (`mode` "slow") are left alone.
 *
 * Decided once per process. Vitest evaluates the root config function again, as a fresh module,
 * for every inline project that has no `extends`, while it resolves the other projects. A second
 * measurement there could find the machine busy after the first found it idle, and set the
 * variable when some projects already had their workers: Vitest then stops before any test with
 * "Projects … have different 'maxWorkers' but same 'sequence.groupOrder'". So the first call's
 * decision is kept on `globalThis` (`store`) and every later call returns it.
 *
 * The options other than `mode` are for tests.
 */
export function capWorkersWhenBusy(options = {}) {
  const store = options.store ?? globalThis;
  store[DECIDED] ??= decide(options);
  return store[DECIDED];
}
