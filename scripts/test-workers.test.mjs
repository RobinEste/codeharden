import { describe, expect, it } from "vitest";
import { busyWorkerCount, capWorkersWhenBusy, setsWorkers } from "./test-workers.mjs";

/** One process: its environment, the idle shares its measurements report, and what it logged. */
function fakeProcess({ idle = [0.2], env = {}, argv = ["node", "vitest", "run"], cpuCount = 16 }) {
  const state = { env: { ...env }, store: {}, measured: 0, logged: [] };
  const call = (mode = "test") =>
    capWorkersWhenBusy({
      mode,
      env: state.env,
      argv,
      cpuCount,
      store: state.store,
      measureIdle: async () => idle[Math.min(state.measured++, idle.length - 1)],
      log: (line) => state.logged.push(line),
    });
  return { state, call };
}

describe("busyWorkerCount", () => {
  it("is a quarter of the CPUs, at least 2", () => {
    expect([8, 11, 12, 16, 32, 64].map(busyWorkerCount)).toEqual([2, 2, 3, 4, 8, 16]);
  });

  it("never exceeds what Vitest starts on its own, and is at least 1, for every CPU count", () => {
    expect([1, 2, 3, 4].map(busyWorkerCount)).toEqual([1, 1, 2, 2]);
    for (let cpus = 1; cpus <= 512; cpus++) {
      const workers = busyWorkerCount(cpus);
      expect(Number.isInteger(workers)).toBe(true);
      expect(workers).toBeGreaterThanOrEqual(1);
      expect(workers).toBeLessThanOrEqual(Math.max(cpus - 1, 1));
    }
  });

  it("is 1 for a CPU count that is not a positive number", () => {
    expect([0, -4, Number.NaN, Number.POSITIVE_INFINITY, undefined].map(busyWorkerCount)).toEqual([
      1, 1, 1, 1, 1,
    ]);
    expect(busyWorkerCount(16.9)).toBe(4);
  });
});

describe("setsWorkers", () => {
  it("finds the worker options in every spelling Vitest accepts", () => {
    for (const flag of [
      "--maxWorkers=4",
      "--maxWorkers",
      "--max-workers=50%",
      "--max-workers",
      "--fileParallelism=false",
      "--file-parallelism",
      "--no-file-parallelism",
      "--no-fileParallelism",
    ]) {
      expect(setsWorkers(["node", "vitest", "run", flag]), flag).toBe(true);
    }
  });

  it("ignores everything else", () => {
    expect(setsWorkers(["node", "vitest", "run", "--project", "scripts", "-t", "maxWorkers"])).toBe(
      false,
    );
    expect(setsWorkers(["--maxWorkersX=1", "--pool=forks", "maxWorkers=2"])).toBe(false);
  });
});

describe("capWorkersWhenBusy", () => {
  it("limits the workers on a busy machine and says so", async () => {
    const { state, call } = fakeProcess({ idle: [0.2] });
    await call();
    expect(state.env.VITEST_MAX_WORKERS).toBe("4");
    expect(state.logged).toEqual(["The machine is busy (20% idle): 4 test workers."]);
  });

  it("leaves an idle machine alone, at half idle and above", async () => {
    for (const idle of [0.5, 0.75, 1]) {
      const { state, call } = fakeProcess({ idle: [idle] });
      await call();
      expect(state.env.VITEST_MAX_WORKERS).toBeUndefined();
      expect(state.logged).toEqual([]);
    }
    const { state, call } = fakeProcess({ idle: [0.49] });
    await call();
    expect(state.env.VITEST_MAX_WORKERS).toBe("4");
  });

  // Vitest evaluates the config function again for inline projects while it resolves the others.
  it("keeps the first decision when the machine gets busy afterwards", async () => {
    const { state, call } = fakeProcess({ idle: [0.9, 0.2, 0.2] });
    await call();
    await Promise.all([call(), call(), call()]);
    expect(state.measured).toBe(1);
    expect(state.env.VITEST_MAX_WORKERS).toBeUndefined();
    expect(state.logged).toEqual([]);
  });

  it("measures once for calls that overlap, and logs once", async () => {
    const { state, call } = fakeProcess({ idle: [0.2, 0.9] });
    await Promise.all([call(), call(), call()]);
    await call();
    expect(state.measured).toBe(1);
    expect(state.env.VITEST_MAX_WORKERS).toBe("4");
    expect(state.logged).toHaveLength(1);
  });

  it("leaves a VITEST_MAX_WORKERS that is already set, without measuring", async () => {
    for (const value of ["1", "9", "50%"]) {
      const { state, call } = fakeProcess({ env: { VITEST_MAX_WORKERS: value } });
      await call();
      expect(state.env.VITEST_MAX_WORKERS).toBe(value);
      expect(state.measured).toBe(0);
    }
  });

  it("treats an empty VITEST_MAX_WORKERS as unset, as Vitest does", async () => {
    const { state, call } = fakeProcess({ env: { VITEST_MAX_WORKERS: "" } });
    await call();
    expect(state.env.VITEST_MAX_WORKERS).toBe("4");
  });

  it("leaves a run whose command line sets the workers", async () => {
    for (const flag of ["--maxWorkers=6", "--max-workers=6", "--no-file-parallelism"]) {
      const { state, call } = fakeProcess({ argv: ["node", "vitest", "run", flag] });
      await call();
      expect(state.env.VITEST_MAX_WORKERS, flag).toBeUndefined();
      expect(state.measured).toBe(0);
    }
  });

  it("leaves the slow suites one file at a time", async () => {
    const { state, call } = fakeProcess({ idle: [0] });
    await call("slow");
    expect(state.env.VITEST_MAX_WORKERS).toBeUndefined();
    expect(state.measured).toBe(0);
  });

  it("sets a valid count on a busy machine with any number of CPUs", async () => {
    for (const [cpuCount, workers] of [
      [1, "1"],
      [2, "1"],
      [3, "2"],
      [4, "2"],
      [10, "2"],
      [32, "8"],
    ]) {
      const { state, call } = fakeProcess({ idle: [0], cpuCount });
      await call();
      expect(state.env.VITEST_MAX_WORKERS, `${cpuCount} CPUs`).toBe(workers);
    }
  });
});
