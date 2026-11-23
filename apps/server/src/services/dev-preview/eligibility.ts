import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Project, Session } from "@codeden/contracts";

/** Statuses in which an agent is at work: its preview is never stopped to make room. */
const BUSY: ReadonlySet<Session["status"]> = new Set(["queued", "starting", "running", "waiting"]);

export function sessionIsBusy(session: Session | undefined): boolean {
  return session !== undefined && BUSY.has(session.status);
}

/**
 * Why this session can't have a preview, or null when it can. A preview runs in the session's
 * own worktree on this computer, so a session without one has nowhere to run it.
 */
export function sessionUnavailable(
  session: Session | undefined,
  project: Project | undefined,
  opts: { sandboxed: boolean; exists?: (path: string) => boolean },
): string | null {
  if (!session) return "The session no longer exists.";
  if (session.role !== "agent") return "Only agent sessions have a preview of their own.";
  if (session.archivedAt) return "The session is archived.";
  if (session.status === "stopped") return "The session is stopped.";
  if (session.status === "failed") return "The session failed.";
  if (!project) return "The session's project no longer exists.";
  if (session.autonomy === "read_only") {
    return "Read-only sessions don't run a preview: it would install and build in their folder.";
  }
  if (!project.isGitRepo) {
    return "The project folder isn't a git repository, so sessions have no worktree of their own.";
  }
  if (!session.worktreePath) {
    return "This session works in the project folder, not in a worktree of its own.";
  }
  if (session.worktreeRemovedAt) {
    return "The session's worktree was cleaned up. Send it a message to bring it back.";
  }
  if (opts.sandboxed) {
    return "This session runs in a sandbox. Previews run only for sessions on this computer.";
  }
  if (!(opts.exists ?? existsSync)(session.worktreePath)) {
    return "The session's worktree isn't there yet.";
  }
  return null;
}

/** The branch the PM thread's preview follows: the project's own setting, never a fixed name. */
export function previewBaseBranch(project: Project): string | null {
  return project.defaultBranch ?? (project.kind === "github" ? project.github.defaultBranch : null);
}

const RUNNERS: [lockfile: string, command: string][] = [
  ["pnpm-lock.yaml", "pnpm dev"],
  ["yarn.lock", "yarn dev"],
  ["bun.lock", "bun run dev"],
  ["bun.lockb", "bun run dev"],
];

/**
 * A dev command to offer in the settings form. Only the fact that a `dev` script exists is
 * read from the repository: the suggested text is one of a few fixed commands, never a string
 * the repository wrote. It is shown to the person and goes nowhere unless they save it.
 */
export function suggestDevCommand(projectPath: string): { command: string; reason: string } | null {
  let scripts: unknown;
  try {
    const pkg = JSON.parse(readFileSync(join(projectPath, "package.json"), "utf8")) as {
      scripts?: unknown;
    };
    scripts = pkg.scripts;
  } catch {
    return null;
  }
  const dev = (scripts as Record<string, unknown> | undefined)?.dev;
  if (typeof dev !== "string" || !dev.trim()) return null;
  const runner = RUNNERS.find(([lockfile]) => existsSync(join(projectPath, lockfile)));
  return {
    command: runner?.[1] ?? "npm run dev",
    reason: "package.json has a dev script",
  };
}
