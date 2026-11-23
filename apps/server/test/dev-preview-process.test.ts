import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  isLeftover,
  type ProcessProbe,
  RunningRegistry,
  systemProbe,
} from "../src/services/dev-preview/leftovers";
import { isListening, PortAllocator, portIsFree } from "../src/services/dev-preview/ports";
import {
  isAlive,
  type PreviewProcess,
  previewEnv,
  shellInvocation,
  spawnPreview,
} from "../src/services/dev-preview/process";

/**
 * The real thing, with tiny fake dev commands: node scripts that listen on the port they are
 * given, print a URL, ignore signals or leave a child behind. No dev server, no network
 * beyond loopback.
 */
const posix = process.platform !== "win32";
const node = JSON.stringify(process.execPath);

let dir: string;
let started: PreviewProcess[];
const ownShell = process.env.SHELL;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "dev-preview-proc-"));
  started = [];
  // A plain shell: the person's own would read their profile on every start.
  process.env.SHELL = "/bin/sh";
});
afterEach(async () => {
  for (const proc of started) await proc.stop(0);
  rmSync(dir, { recursive: true, force: true });
  if (ownShell === undefined) delete process.env.SHELL;
  else process.env.SHELL = ownShell;
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
    env: previewEnv(extra),
    onOutput: (text) => {
      output += text;
    },
  });
  started.push(proc);
  return { proc, output: () => output };
}

async function waitUntil(check: () => boolean | Promise<boolean>, what: string): Promise<void> {
  const deadline = Date.now() + 30_000;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 20));
  }
}

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as { port: number };
  await new Promise((resolve) => server.close(resolve));
  return port;
}

const LISTEN = `
  const http = require("node:http");
  const port = Number(process.env.PORT);
  http.createServer((_, res) => res.end("ok")).listen(port, process.env.HOST, () => {
    console.log("ready on http://localhost:" + port + " in " + process.cwd());
  });
`;

describe.skipIf(!posix)("a preview's process", () => {
  it("runs the command in the folder, with its ports in the environment, on loopback", async () => {
    const port = await freePort();
    const { output } = run(script("listen.cjs", LISTEN), { PORT: String(port), HOST: "127.0.0.1" });
    await waitUntil(() => isListening(port), "the fake dev server to listen");
    expect(await portIsFree(port)).toBe(false);
    await waitUntil(() => output().includes("ready on"), "its output");
    expect(output()).toContain(`http://localhost:${port}`);
    // macOS reports the temp folder through /private.
    expect(output()).toContain(dir.replace(/^\/private/, ""));
  });

  it("is stopped with everything it started, and its port is free again", async () => {
    const port = await freePort();
    // The shell starts node, which starts a second node that does the listening.
    const child = join(dir, "child.cjs");
    writeFileSync(child, LISTEN);
    const parent = script(
      "parent.cjs",
      `require("node:child_process").spawn(process.execPath, [${JSON.stringify(child)}], { stdio: "inherit" });
       setInterval(() => {}, 1000);`,
    );
    const { proc } = run(parent, { PORT: String(port), HOST: "127.0.0.1" });
    await waitUntil(() => isListening(port), "the child to listen");
    await proc.stop(2_000);
    expect(await isListening(port)).toBe(false);
    expect(isAlive(-proc.pid)).toBe(false);
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
    await waitUntil(() => output().includes("up"), "the process to start");
    await proc.stop(100);
    expect(isAlive(proc.pid)).toBe(false);
    expect(await proc.exited).toMatchObject({ signal: "SIGKILL" });
  });

  it("reports a command that exits, with its code", async () => {
    const { proc, output } = run(`${script("exit.cjs", `console.log("bye"); process.exit(3);`)}`);
    expect(await proc.exited).toEqual({ code: 3, signal: null });
    await waitUntil(() => output().includes("bye"), "its output");
  });

  it("a command that never listens leaves its port free", async () => {
    const port = await freePort();
    const { output } = run(
      script("idle.cjs", `console.log("idle"); setInterval(() => {}, 1000);`),
      {
        PORT: String(port),
      },
    );
    await waitUntil(() => output().includes("idle"), "the process to start");
    expect(await isListening(port)).toBe(false);
    expect(await portIsFree(port)).toBe(true);
  });

  it("hands the command to the person's shell whole, never as extra arguments", () => {
    const hostile = `echo hi; echo "$(id)" && rm -rf "$HOME"`;
    const { file, args } = shellInvocation(hostile, { SHELL: "/bin/zsh" }, "darwin");
    expect(file).toBe("/bin/zsh");
    expect(args).toEqual(["-l", "-c", hostile]);
    expect(shellInvocation("x", { SHELL: "/bin/bash" }, "linux").args).toEqual(["-c", "x"]);
    expect(shellInvocation("x", {}, "win32")).toEqual({
      file: "powershell.exe",
      args: ["-NoLogo", "-NonInteractive", "-Command", "x"],
    });
  });
});

describe.skipIf(!posix)("what a crash leaves behind", () => {
  it("is ended on the next start, and only that", async () => {
    const port = await freePort();
    const file = join(dir, "running.json");
    const { proc } = run(script("listen.cjs", LISTEN), { PORT: String(port), HOST: "127.0.0.1" });
    await waitUntil(() => isListening(port), "the fake dev server to listen");
    // The app "crashes": its registry file still names the process.
    new RunningRegistry(file).add("session:s1", proc.pid, dir);
    expect(JSON.parse(readFileSync(file, "utf8"))).toMatchObject([
      { key: "session:s1", pid: proc.pid },
    ]);

    const next = new RunningRegistry(file);
    expect(next.cleanUp()).toEqual(["session:s1"]);
    await waitUntil(async () => !(await isListening(port)), "the leftover to end");
    await waitUntil(() => !isAlive(-proc.pid), "its group to be gone");
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual([]);
    expect(new RunningRegistry(file).cleanUp()).toEqual([]);
  });

  it("ends the group of a leader that already died", async () => {
    const port = await freePort();
    const child = join(dir, "child.cjs");
    writeFileSync(child, LISTEN);
    // The leader starts a child that stays in its group, then dies as a crash would kill it.
    const leader = script(
      "leader.cjs",
      `require("node:child_process").spawn(process.execPath, [${JSON.stringify(child)}], { stdio: "ignore" });
       setTimeout(() => process.kill(process.pid, "SIGKILL"), 300);`,
    );
    const file = join(dir, "running.json");
    const { proc } = run(`exec ${leader}`, { PORT: String(port), HOST: "127.0.0.1" });
    new RunningRegistry(file).add("base:app", proc.pid, dir);
    await proc.exited;
    await waitUntil(() => isListening(port), "the orphan to listen");
    expect(isAlive(proc.pid)).toBe(false);
    expect(new RunningRegistry(file).cleanUp()).toEqual(["base:app"]);
    await waitUntil(async () => !(await isListening(port)), "the orphan to end");
  });

  it("leaves a process alone when its id now belongs to something else", async () => {
    const file = join(dir, "running.json");
    const { proc, output } = run(
      script("idle.cjs", `console.log("idle"); setInterval(() => {}, 1000);`),
    );
    await waitUntil(() => output().includes("idle"), "the process to start");
    writeFileSync(
      file,
      JSON.stringify([
        { key: "session:old", pid: proc.pid, identity: "Mon Jan  1 00:00:00 2001", cwd: dir },
      ]),
    );
    expect(new RunningRegistry(file).cleanUp()).toEqual([]);
    expect(isAlive(proc.pid)).toBe(true);
    // The test's own process is never a leftover either.
    expect(
      isLeftover({ key: "k", pid: process.pid, identity: "not this one", cwd: dir }, systemProbe),
    ).toBe(false);
  });
});

describe("telling a leftover from a stranger", () => {
  const probe = (over: Partial<ProcessProbe>): ProcessProbe => ({
    identity: () => null,
    groupOf: () => null,
    groupAlive: () => false,
    kill: () => {},
    ...over,
  });
  const record = { key: "session:s1", pid: 700, identity: "started-at-9", cwd: "/w" };

  it("the same process: a leftover", () => {
    expect(isLeftover(record, probe({ identity: () => "started-at-9" }))).toBe(true);
  });
  it("everything gone: nothing to do", () => {
    expect(isLeftover(record, probe({}))).toBe(false);
  });
  it("the leader gone, its group still there: a leftover", () => {
    expect(isLeftover(record, probe({ groupAlive: () => true }))).toBe(true);
  });
  it("the id reused by a process that leads a group of its own: a stranger", () => {
    expect(
      isLeftover(
        record,
        probe({ identity: () => "started-at-10", groupAlive: () => true, groupOf: () => 700 }),
      ),
    ).toBe(false);
  });
  it("the id reused inside another group while the old group lives on: a leftover", () => {
    expect(
      isLeftover(
        record,
        probe({ identity: () => "started-at-10", groupAlive: () => true, groupOf: () => 42 }),
      ),
    ).toBe(true);
  });
  it("a record without a start time is never matched by a live process", () => {
    expect(
      isLeftover(
        { ...record, identity: null },
        probe({ identity: () => "x", groupOf: () => 700, groupAlive: () => true }),
      ),
    ).toBe(false);
  });
});

describe("the port allocator", () => {
  it("skips taken and busy ports and moves on from the last one given", async () => {
    const busy = new Set([5001]);
    const allocator = new PortAllocator(async (port) => !busy.has(port));
    const range = { from: 5000, to: 5005 };
    expect(await allocator.next(2, range, new Set([5000]))).toEqual([5002, 5003]);
    expect(await allocator.next(1, range, new Set())).toEqual([5004]);
    expect(await allocator.next(2, range, new Set([5002, 5003, 5004]))).toEqual([5005, 5000]);
    expect(await allocator.next(3, range, new Set([5002, 5003, 5004, 5005]))).toBeNull();
  });
});
