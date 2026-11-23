import { spawn, spawnSync } from "node:child_process";
import { agentEnv, defaultShell, defaultShellArgs, shellSyntax } from "@codeden/providers";

/**
 * Running a project's confirmed command for a preview.
 *
 * The command is the text a person typed and confirmed in the project's settings, handed whole
 * to their own shell (`<shell> -c <command>`), as if they had typed it into a terminal in that
 * folder. Nothing is ever added to that text here: ports reach the process in its environment.
 * The process gets what a session's terminal would: the worktree as its working directory and
 * the person's environment without the app's own variables (`agentEnv`).
 */

const isWindows = process.platform === "win32";

/** Variables a git hook sets. A dev server started from one must not inherit its repository. */
const GIT_LOCAL = ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_PREFIX", "GIT_COMMON_DIR"];

/** The environment of a preview's processes. `extra` wins over what is inherited. */
export function previewEnv(
  extra: Record<string, string>,
  base: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const env = agentEnv({}, base);
  for (const name of GIT_LOCAL) delete env[name];
  return { ...env, ...extra };
}

/** The program and arguments that run `command` in the person's shell. */
export function shellInvocation(
  command: string,
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): { file: string; args: string[] } {
  const shell = defaultShell(env, platform);
  const syntax = shellSyntax(shell);
  if (syntax === "powershell") {
    return { file: shell, args: ["-NoLogo", "-NonInteractive", "-Command", command] };
  }
  if (syntax === "cmd") return { file: shell, args: ["/d", "/s", "/c", command] };
  return { file: shell, args: [...defaultShellArgs(shell, platform), "-c", command] };
}

export interface PreviewExit {
  code: number | null;
  signal: string | null;
  /** The shell itself couldn't be started. */
  error?: string;
}

export interface PreviewProcess {
  /** Also the id of its process group (not on Windows). */
  readonly pid: number;
  /** Resolves once, when the command's own process has ended. */
  readonly exited: Promise<PreviewExit>;
  /** End it and everything it started: ask first, then force after `graceMs`. */
  stop(graceMs?: number): Promise<void>;
  /** Force it to end now, without waiting. For the moment the app itself exits. */
  killNow(): void;
}

export interface SpawnSpec {
  command: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
  onOutput: (text: string) => void;
}

export type SpawnPreview = (spec: SpawnSpec) => PreviewProcess;

/** Is a process (or, with a negative id, any process of a group) still there? */
export function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

function signal(pid: number, sig: NodeJS.Signals): void {
  try {
    process.kill(pid, sig);
  } catch {
    // Already gone.
  }
}

/** Every process started, directly or not, by `root` (not on Windows). */
export function descendantsOf(root: number): number[] {
  if (isWindows) return [];
  const ps = spawnSync("ps", ["-A", "-o", "pid=,ppid="], { encoding: "utf8" });
  if (ps.status !== 0) return [];
  const children = new Map<number, number[]>();
  for (const line of ps.stdout.split("\n")) {
    const [pid, ppid] = line.trim().split(/\s+/).map(Number);
    if (!pid || !ppid) continue;
    children.set(ppid, [...(children.get(ppid) ?? []), pid]);
  }
  const found: number[] = [];
  const queue = [root];
  while (queue.length > 0) {
    for (const child of children.get(queue.shift() as number) ?? []) {
      if (child === process.pid || found.includes(child)) continue;
      found.push(child);
      queue.push(child);
    }
  }
  return found;
}

/** Force a process group and the given stragglers to end. */
export function killGroupNow(pid: number, others: readonly number[] = []): void {
  if (isWindows) {
    spawn("taskkill", ["/pid", String(pid), "/t", "/f"], { windowsHide: true, stdio: "ignore" });
    return;
  }
  signal(-pid, "SIGKILL");
  signal(pid, "SIGKILL");
  for (const other of others) signal(other, "SIGKILL");
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * End a process group and what it started, including processes that left the group (a dev
 * server's own detached helpers): SIGTERM first, SIGKILL for what is left after `graceMs`.
 */
export async function stopGroup(pid: number, graceMs: number): Promise<void> {
  if (isWindows) {
    killGroupNow(pid);
    return;
  }
  const others = descendantsOf(pid);
  const left = () => isAlive(-pid) || isAlive(pid) || others.some(isAlive);
  signal(-pid, "SIGTERM");
  for (const other of others) signal(other, "SIGTERM");
  const deadline = Date.now() + graceMs;
  while (left() && Date.now() < deadline) await sleep(Math.min(50, Math.max(5, graceMs / 10)));
  if (left()) killGroupNow(pid, others);
}

/** Start `spec.command` in the person's shell, in its own process group, with no stdin. */
export const spawnPreview: SpawnPreview = (spec) => {
  const { file, args } = shellInvocation(spec.command);
  const child = spawn(file, args, {
    cwd: spec.cwd,
    env: spec.env,
    stdio: ["ignore", "pipe", "pipe"],
    detached: !isWindows,
    windowsHide: true,
  });
  child.stdout?.setEncoding("utf8").on("data", spec.onOutput);
  child.stderr?.setEncoding("utf8").on("data", spec.onOutput);
  const pid = child.pid ?? 0;
  let ended = false;
  const exited = new Promise<PreviewExit>((resolve) => {
    child.once("error", (error) => {
      ended = true;
      resolve({ code: null, signal: null, error: error.message });
    });
    child.once("exit", (code, sig) => {
      ended = true;
      resolve({ code, signal: sig });
    });
  });
  return {
    pid,
    exited,
    async stop(graceMs = 5_000) {
      if (!pid) return;
      await stopGroup(pid, graceMs);
      // The group can be gone a moment before node reports the exit.
      if (!ended) await Promise.race([exited, sleep(1_000)]);
    },
    killNow() {
      if (pid) killGroupNow(pid, descendantsOf(pid));
    },
  };
};
