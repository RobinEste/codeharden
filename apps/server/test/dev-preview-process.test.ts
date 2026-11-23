import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { RunningRegistry } from "../src/services/dev-preview/leftovers";
import { isListening } from "../src/services/dev-preview/ports";
import { type PreviewProcess, previewEnv, spawnPreview } from "../src/services/dev-preview/process";
import { processTable } from "../src/services/dev-preview/process-table";
import { waitUntil } from "./support/harness";

/**
 * The real thing, with tiny fake dev commands: node scripts that listen on a port of their own
 * choosing, ignore signals or leave a child behind. Real processes and real waits, so this
 * suite runs with `pnpm test:slow` only (`vitest.config.ts`); the decisions themselves are
 * tested without any process in `dev-preview-leftovers.test.ts`.
 */
const posix = process.platform !== "win32";
const node = JSON.stringify(process.execPath);

let dir: string;
let started: PreviewProcess[];
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "dev-preview-proc-"));
  started = [];
});
afterEach(async () => {
  for (const proc of started) await proc.stop(0);
  rmSync(dir, { recursive: true, force: true });
});

function script(name: string, source: string): string {
  const file = join(dir, name);
  writeFileSync(file, source);
  return `${node} ${JSON.stringify(file)}`;
}

function run(command: string, extra: Record<string, string> = {}) {
  let output = "";
  const proc = spawnPreview({
    command,
    cwd: dir,
    // A plain shell, given in the command's own environment: the person's would read their
    // profile on every start.
    env: previewEnv({ SHELL: "/bin/sh", ...extra }),
    onOutput: (text) => {
      output += text;
    },
  });
  started.push(proc);
  return { proc, output: () => output };
}

const alive = (pid: number) => processTable().some((row) => row.pid === pid);
const gone = (pid: number) => waitUntil(() => !alive(pid));

/** A dev server that picks a free port itself and says which, so no port is guessed here. */
const LISTEN = `
  const http = require("node:http");
  const server = http.createServer((_, res) => res.end("ok"));
  server.listen(0, process.env.HOST, () => {
    console.log("ready on port=" + server.address().port + " in " + process.cwd());
  });
`;
async function portOf(output: () => string): Promise<number> {
  const port = await waitUntil(() => output().match(/port=(\d+)/)?.[1]);
  return Number(port);
}

describe.skipIf(!posix)("a preview's process", () => {
  it("runs the command in the folder with the environment it is given, on loopback", async () => {
    const { output } = run(script("listen.cjs", LISTEN), { HOST: "127.0.0.1" });
    const port = await portOf(output);
    await waitUntil(() => isListening(port));
    // macOS reports the temp folder through /private.
    expect(output()).toContain(dir.replace(/^\/private/, ""));
  });

  it("is stopped with everything it started", async () => {
    // The shell starts node, which starts a second node that does the listening.
    const child = join(dir, "child.cjs");
    writeFileSync(child, LISTEN);
    const parent = script(
      "parent.cjs",
      `const c = require("node:child_process").spawn(process.execPath, [${JSON.stringify(child)}], { stdio: "inherit" });
       console.log("child=" + c.pid);
       setInterval(() => {}, 1000);`,
    );
    const { proc, output } = run(parent, { HOST: "127.0.0.1" });
    const port = await portOf(output);
    const childPid = Number(output().match(/child=(\d+)/)?.[1]);
    await waitUntil(() => isListening(port));
    await proc.stop(10_000);
    await gone(childPid);
    await waitUntil(async () => !(await isListening(port)));
    expect(await proc.exited).toMatchObject({ signal: "SIGTERM" });
  });

  it("is forced to end when it ignores the request to stop", async () => {
    const stubborn = script(
      "stubborn.cjs",
      `process.on("SIGTERM", () => console.log("no"));
       console.log("up");
       setInterval(() => {}, 1000);`,
    );
    // \`exec\` so the signal reaches node itself, not a shell in front of it.
    const { proc, output } = run(`exec ${stubborn}`);
    await waitUntil(() => output().includes("up"));
    await proc.stop(1_000);
    expect(await proc.exited).toMatchObject({ signal: "SIGKILL" });
    expect(output()).toContain("no");
  });

  it("reports a command that exits, with its code", async () => {
    const { proc, output } = run(script("exit.cjs", `console.log("bye"); process.exit(3);`));
    expect(await proc.exited).toEqual({ code: 3, signal: null });
    await waitUntil(() => output().includes("bye"));
  });

  it("ends what a leader left in its group after the leader itself exited", async () => {
    const child = join(dir, "child.cjs");
    writeFileSync(child, LISTEN);
    const leader = script(
      "leader.cjs",
      `const c = require("node:child_process").spawn(process.execPath, [${JSON.stringify(child)}], { stdio: "inherit" });
       console.log("child=" + c.pid);
       setTimeout(() => process.exit(0), 300);`,
    );
    const { proc, output } = run(`exec ${leader}`, { HOST: "127.0.0.1" });
    await proc.exited;
    const port = await portOf(output);
    const childPid = Number(output().match(/child=(\d+)/)?.[1]);
    expect(alive(childPid)).toBe(true);
    proc.killNow();
    await gone(childPid);
    expect(await isListening(port)).toBe(false);
  });
});

describe.skipIf(!posix)("what a crash leaves behind", () => {
  it("is ended on the next start, and a record that names someone else is left alone", async () => {
    const file = join(dir, "running.json");
    const { proc, output } = run(script("listen.cjs", LISTEN), { HOST: "127.0.0.1" });
    const port = await portOf(output);
    const other = run(script("idle.cjs", `console.log("idle"); setInterval(() => {}, 1000);`));
    await waitUntil(() => other.output().includes("idle"));
    // The app "crashes": its file still names the preview's process, and a second record
    // names the id of a process with another start time.
    const before = new RunningRegistry(file);
    before.add("session:s1", proc, dir);
    before.add("session:old", { pid: other.proc.pid, started: "Mon Jan  1 00:00:00 2001" }, dir);

    expect(new RunningRegistry(file).cleanUp()).toEqual(["session:s1"]);
    await gone(proc.pid);
    await waitUntil(async () => !(await isListening(port)));
    expect(alive(other.proc.pid)).toBe(true);
    expect(new RunningRegistry(file).cleanUp()).toEqual([]);
  });
});
