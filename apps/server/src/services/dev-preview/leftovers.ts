import { spawnSync } from "node:child_process";
import { z } from "zod";
import { readJsonFile, writeJsonFile } from "../../json-file";
import { descendantsOf, isAlive, killGroupNow } from "./process";

/**
 * What the app started and hasn't seen end, written to `<home>/dev-preview/running.json`, so
 * that a start after a crash can end what the crash left running. A normal quit stops every
 * preview and leaves the file empty.
 *
 * A process id can belong to something else by the next start, so a record is acted on only
 * when the process (or its group) is provably the one recorded: the same start time, or a
 * group whose id no live process could have been given since.
 */
const RunningRecord = z.object({
  key: z.string(),
  pid: z.int().positive(),
  /** The process's start time as the system reports it; null when it couldn't be read. */
  identity: z.string().nullable(),
  cwd: z.string(),
});
export type RunningRecord = z.infer<typeof RunningRecord>;

/** What the cleanup asks the system; replaced in tests. */
export interface ProcessProbe {
  /** A value that differs for two processes that were given the same id; null when gone. */
  identity(pid: number): string | null;
  /** The id of the process's group; null when gone (and on Windows). */
  groupOf(pid: number): number | null;
  /** Does the group with this id have any process left? */
  groupAlive(pid: number): boolean;
  kill(pid: number): void;
}

const isWindows = process.platform === "win32";

function ps(pid: number, column: string): string | null {
  const result = spawnSync("ps", ["-o", `${column}=`, "-p", String(pid)], { encoding: "utf8" });
  const text = result.status === 0 ? result.stdout.trim() : "";
  return text || null;
}

export const systemProbe: ProcessProbe = {
  identity(pid) {
    if (!isWindows) return ps(pid, "lstart");
    const result = spawnSync(
      "powershell.exe",
      ["-NoProfile", "-Command", `(Get-Process -Id ${pid}).StartTime.ToFileTimeUtc()`],
      { encoding: "utf8", windowsHide: true },
    );
    const text = result.status === 0 ? result.stdout.trim() : "";
    return text || null;
  },
  groupOf(pid) {
    if (isWindows) return null;
    const group = Number(ps(pid, "pgid"));
    return Number.isInteger(group) && group > 0 ? group : null;
  },
  groupAlive: (pid) => !isWindows && isAlive(-pid),
  kill: (pid) => killGroupNow(pid, descendantsOf(pid)),
};

/** Is what this record names still the process the app started? */
export function isLeftover(record: RunningRecord, probe: ProcessProbe): boolean {
  const now = probe.identity(record.pid);
  // The leader is still the recorded process.
  if (now !== null && record.identity !== null && now === record.identity) return true;
  // The leader is gone, or its id went to another process. Its group can still hold what it
  // started. A group keeps its id for as long as it has a member, and a process can only lead
  // a group with its own id, so a live group with this id is the recorded one unless the
  // process that now has the id leads it.
  if (!probe.groupAlive(record.pid)) return false;
  return now === null || probe.groupOf(record.pid) !== record.pid;
}

export class RunningRegistry {
  private records: RunningRecord[] = [];

  constructor(
    private readonly file: string,
    private readonly probe: ProcessProbe = systemProbe,
  ) {}

  /** Note a process the app just started. */
  add(key: string, pid: number, cwd: string): void {
    if (!pid) return;
    this.records = this.records.filter((r) => r.pid !== pid);
    this.records.push({ key, pid, identity: this.probe.identity(pid), cwd });
    this.write();
  }

  /** The process ended, or the app ended it. */
  remove(pid: number): void {
    const before = this.records.length;
    this.records = this.records.filter((r) => r.pid !== pid);
    if (this.records.length !== before) this.write();
  }

  /**
   * End what an earlier run of the app left behind, and start with an empty list. Returns the
   * keys of the previews whose processes were ended.
   */
  cleanUp(): string[] {
    const parsed = z.array(RunningRecord).safeParse(readJsonFile(this.file));
    const ended: string[] = [];
    for (const record of parsed.success ? parsed.data : []) {
      if (!isLeftover(record, this.probe)) continue;
      this.probe.kill(record.pid);
      ended.push(record.key);
    }
    this.records = [];
    this.write();
    return ended;
  }

  private write(): void {
    try {
      writeJsonFile(this.file, this.records, 0o600);
    } catch {
      // Without the file a crash leaves its processes behind; the previews still work.
    }
  }
}
