#!/usr/bin/env node
/**
 * The worker-limit failure with real CPU load and the real measurement (no stub).
 *
 *   node real-load.mjs [--config <file>] [--tries 12]
 *
 * Each try starts `vitest run` for two small projects and, a moment later, one spinning thread
 * per CPU, so the machine is idle when Vitest loads the root config and busy when it evaluates
 * the config again for the inline projects. The threads stop when the run ends. The delay grows
 * from 200 ms in 50 ms steps, because the moment the second evaluation happens depends on the
 * machine. Prints one line per try, then how many tries hit Vitest's maxWorkers error.
 */
import { spawn } from "node:child_process";
import { availableParallelism } from "node:os";
import { Worker } from "node:worker_threads";

const argv = process.argv.slice(2);
const option = (name, fallback) => {
  const i = argv.indexOf(name);
  return i === -1 ? fallback : argv[i + 1];
};
const config = option("--config", undefined);
const tries = Number(option("--tries", 12));
const args = ["exec", "vitest", "run", "--project", "@codeden/contracts", "--project", "scripts"];
if (config) args.push("--config", config);

function once(delay) {
  return new Promise((resolve) => {
    const child = spawn("pnpm", args, { stdio: ["ignore", "pipe", "pipe"] });
    let burners = [];
    const timer = setTimeout(() => {
      burners = Array.from(
        { length: availableParallelism() },
        () => new Worker("for (;;) {}", { eval: true }),
      );
    }, delay);
    let output = "";
    child.stdout.on("data", (chunk) => (output += chunk));
    child.stderr.on("data", (chunk) => (output += chunk));
    child.on("close", async (code) => {
      clearTimeout(timer);
      await Promise.all(burners.map((w) => w.terminate()));
      // biome-ignore lint/suspicious/noControlCharactersInRegex: strips ANSI colour codes
      const plain = output.replace(/\u001b\[[0-9;]*m/g, "");
      resolve({
        code,
        busy: plain.match(/^The machine is busy.*$/gm) ?? [],
        error: plain.match(/^Error: Projects .*$/m)?.[0],
        files: plain.match(/^\s*Test Files\s+(.*)$/m)?.[1] ?? "?",
      });
    });
  });
}

let hit = 0;
for (let i = 0; i < tries; i++) {
  const delay = 200 + i * 50;
  const r = await once(delay);
  if (r.error) hit++;
  console.log(
    `try ${i + 1} (load after ${delay} ms): exit ${r.code} | files: ${r.files} | "busy" lines: ${r.busy.length}${r.busy[0] ? ` (${r.busy[0]})` : ""}${r.error ? `\n  ${r.error}` : ""}`,
  );
  // Let the machine settle so the next try starts idle.
  await new Promise((resolve) => setTimeout(resolve, 3000));
}
console.log(`\n${hit}/${tries} tries stopped with the maxWorkers error`);
