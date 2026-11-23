import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { readJsonFile, writeJsonFile } from "../../json-file";

/** The files whose change means dependencies must be installed again. Looked up at the root. */
const LOCKFILES = [
  "pnpm-lock.yaml",
  "package-lock.json",
  "npm-shrinkwrap.json",
  "yarn.lock",
  "bun.lock",
  "bun.lockb",
  "deno.lock",
  "Cargo.lock",
  "go.sum",
  "poetry.lock",
  "uv.lock",
  "Pipfile.lock",
  "requirements.txt",
  "Gemfile.lock",
  "composer.lock",
];

/** A digest of the folder's lockfiles and the prepare command that would install from them. */
export function prepareDigest(dir: string, prepareCommand: string): string {
  const hash = createHash("sha256").update(prepareCommand).update("\0");
  for (const name of LOCKFILES) {
    try {
      const content = readFileSync(join(dir, name));
      hash.update(name).update("\0").update(content).update("\0");
    } catch {
      // Not there.
    }
  }
  return hash.digest("hex");
}

const Prepared = z.record(z.string(), z.string());

/**
 * Remembers, per folder, what the prepare command last ran for, so it runs before the first
 * start in a worktree and again when a lockfile (or the command) changed, and not otherwise.
 * Kept in the app's home, never in the worktree, where it would show up as a change.
 */
export class PreparedStore {
  private readonly seen: Record<string, string>;

  constructor(private readonly file: string) {
    const parsed = Prepared.safeParse(readJsonFile(file));
    this.seen = parsed.success ? parsed.data : {};
  }

  needs(dir: string, prepareCommand: string): boolean {
    return this.seen[dir] !== prepareDigest(dir, prepareCommand);
  }

  /** The prepare command just succeeded in `dir`. */
  record(dir: string, prepareCommand: string): void {
    this.seen[dir] = prepareDigest(dir, prepareCommand);
    this.write();
  }

  forget(dir: string): void {
    if (!(dir in this.seen)) return;
    delete this.seen[dir];
    this.write();
  }

  private write(): void {
    try {
      writeJsonFile(this.file, this.seen, 0o600);
    } catch {
      // A prepare that isn't remembered runs again next time; nothing is lost.
    }
  }
}
