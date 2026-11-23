// Preload for the reproduction of the busy-machine worker cap in the root vitest.config.ts.
// It replaces what the config reads from `node:os` in the process that loads the config, so
// the "busy" branch runs on demand instead of depending on the machine's real load.
//
//   STUB_IDLE=0.9,0.2  the idle share each successive measurement reports (0 to 1). The config
//                      takes two `os.cpus()` samples per measurement; the last value repeats.
//   STUB_CPUS=4        what `os.availableParallelism()` and `os.cpus().length` report (optional).
//   STUB_TRACE=1       print one line per measurement to stderr.
//
// Use: NODE_OPTIONS="--import <path to this file>" STUB_IDLE=0.9,0.2 pnpm test
// Test workers are separate threads or processes and keep the real `node:os`.
import { syncBuiltinESMExports } from "node:module";
import os from "node:os";
import { isMainThread } from "node:worker_threads";

const isWorker = !isMainThread || process.env.VITEST_POOL_ID !== undefined;
if (!isWorker && process.env.STUB_IDLE !== undefined) {
  const shares = process.env.STUB_IDLE.split(",").map(Number);
  const count = process.env.STUB_CPUS ? Number(process.env.STUB_CPUS) : os.availableParallelism();
  let calls = 0;
  let idleTotal = 0;
  let busyTotal = 0;
  os.cpus = () => {
    // Samples come in pairs (before, after): the second of each pair adds one measurement's time.
    if (calls % 2 === 1) {
      const n = (calls - 1) / 2;
      const idle = shares[Math.min(n, shares.length - 1)];
      idleTotal += 1000 * idle;
      busyTotal += 1000 * (1 - idle);
      if (process.env.STUB_TRACE) {
        console.error(
          `[stub] measurement ${n + 1}: ${Math.round(idle * 100)}% idle, VITEST_MAX_WORKERS=${process.env.VITEST_MAX_WORKERS ?? "(unset)"}`,
        );
      }
    }
    calls += 1;
    return Array.from({ length: count }, () => ({
      model: "stub",
      speed: 0,
      times: { user: busyTotal, nice: 0, sys: 0, idle: idleTotal, irq: 0 },
    }));
  };
  if (process.env.STUB_CPUS) os.availableParallelism = () => count;
  syncBuiltinESMExports();
}
