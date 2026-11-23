import {
  isSecureFoundationQuiet,
  SECURE_FOUNDATION_PROJECT_MODE,
  SECURE_FOUNDATION_WORK_KEY,
} from "@codeden/contracts";
import { and, eq } from "drizzle-orm";
import type { Db } from "../../db/client";
import { sessions } from "../../db/schema";
import type { ProjectService } from "../projects/project-service";

/**
 * Whether a project's manager is not to be woken: true for a quiet Secure Foundation project
 * (`isSecureFoundationQuiet`: one Secure Foundation set up that is still in Manual mode), false
 * for every other project, for the orchestrator (`projectId` null) and for a project that is
 * gone. A new project gets pull requests, issues and reviews from GitHub within minutes of its
 * repository existing; none of them starts a project manager until the person turns automatic
 * work on by changing the project's autonomy mode. The updates are kept and reach the manager
 * with its next turn.
 */
export function holdsPmWakes(
  deps: { db: Db; projects: Pick<ProjectService, "get"> },
  projectId: string | null,
): boolean {
  if (!projectId) return false;
  let project: ReturnType<ProjectService["get"]>;
  try {
    project = deps.projects.get(projectId);
  } catch {
    return false;
  }
  // Most projects: no query.
  if (project.autonomyMode !== SECURE_FOUNDATION_PROJECT_MODE) return false;
  const setup = deps.db
    .select({ workKey: sessions.workKey })
    .from(sessions)
    .where(and(eq(sessions.projectId, projectId), eq(sessions.workKey, SECURE_FOUNDATION_WORK_KEY)))
    .limit(1)
    .get();
  return isSecureFoundationQuiet(project, setup ? [setup] : []);
}
