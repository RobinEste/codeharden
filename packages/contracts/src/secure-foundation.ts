import { z } from "zod";
import { AutonomyLevel, Id, ProviderId, Timestamp } from "./common";
import { Project } from "./entities/project";
import type { Session } from "./entities/session";

/**
 * "Secure Foundation": the add-project option that creates a new project from the fork's
 * template repository (`HARDEN_TEMPLATE_REPOSITORY`) and starts a setup session that runs the
 * template's own install with the answers of one up-front form. Routes: `/api/secure-foundation`.
 *
 * The four defaults a fork owner may want to flip are the constants below, one each.
 */

/** Where the installed app keeps its secrets: a local `.env.local`, or Doppler. */
export const SecureFoundationSecrets = z.enum(["env_local", "doppler"]);
export type SecureFoundationSecrets = z.infer<typeof SecureFoundationSecrets>;

/** Default 1 of 4: the secrets mode the form starts with. */
export const SECURE_FOUNDATION_DEFAULT_SECRETS: SecureFoundationSecrets = "doppler";

/**
 * Default 2 of 4: the permission level of the setup session. `full` runs commands inside the
 * new project without asking; protected areas and "always ask" rules still apply at every level.
 */
export const SECURE_FOUNDATION_SETUP_AUTONOMY: AutonomyLevel = "full";

/**
 * What the new project's repository is: `fresh` is the template's files as one new initial
 * commit with no remote and no template history; `clone` keeps the template's history and its
 * `origin` remote.
 */
export const SecureFoundationRepositoryMode = z.enum(["fresh", "clone"]);
export type SecureFoundationRepositoryMode = z.infer<typeof SecureFoundationRepositoryMode>;

/** Default 3 of 4: the new project is a fresh local repository. */
export const SECURE_FOUNDATION_REPOSITORY_MODE: SecureFoundationRepositoryMode = "fresh";

// Default 4 of 4, the template version, is the build variable `TEMPLATE_BRANCH`
// (`HARDEN_TEMPLATE_BRANCH`, default `main`): the branch's latest commit at the time of the click.

/** How much of the app is installed: no content modules, all of them, or a chosen set. */
export const SecureFoundationShell = z.enum(["minimal", "all", "pick"]);
export type SecureFoundationShell = z.infer<typeof SecureFoundationShell>;

/** The app shell the form starts with. */
export const SECURE_FOUNDATION_DEFAULT_SHELL: SecureFoundationShell = "minimal";

/**
 * The project's name: also the site name, and the folder name is made from it
 * (`secureFoundationFolder`). Starts with a letter or digit; letters, digits, spaces, dots,
 * dashes and underscores after that, so no path can be written in it.
 */
export const SecureFoundationName = z
  .string()
  .trim()
  .min(1)
  .max(60)
  .regex(
    /^[A-Za-z0-9][A-Za-z0-9 ._-]*$/,
    "Use letters, digits, spaces, dots, dashes and underscores, starting with a letter or digit",
  );

/**
 * The folder a project name is created in, inside the projects folder: lower case, every other
 * run of characters one dash, 40 characters at most. Only `[a-z0-9-]`, never empty for a valid
 * `SecureFoundationName`. The template derives its Convex and Doppler project names the same way.
 */
export function secureFoundationFolder(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/, "");
}

/** Addresses the template's install refuses as placeholders. */
const PLACEHOLDER_EMAILS = [
  "example@example.com",
  "admin@example.com",
  "user@example.com",
  "test@example.com",
];

/**
 * The site admin's email, as the template's install accepts it: something@domain.tld, and not
 * one of its known placeholders. Personal data: it goes to the install and nowhere else.
 */
export const SecureFoundationEmail = z
  .string()
  .trim()
  .max(254)
  .regex(/^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/, "Enter an email address")
  .refine((v) => !PLACEHOLDER_EMAILS.includes(v.toLowerCase()), "Enter a real email address");

/** A content module's name, as the template's `templates/modules/<name>` folder. */
export const SecureFoundationModuleName = z.string().regex(/^[a-z0-9][a-z0-9-]{0,39}$/);

/** A content module the template offers at the resolved commit. */
export const SecureFoundationModule = z.object({
  name: SecureFoundationModuleName,
  title: z.string().max(80),
  description: z.string().max(300),
});
export type SecureFoundationModule = z.infer<typeof SecureFoundationModule>;

/** A full commit id. */
export const SecureFoundationCommit = z.string().regex(/^[0-9a-f]{40}$/);

/** A provider that can run the setup session. */
export const SecureFoundationProvider = z.object({
  id: ProviderId,
  displayName: z.string(),
  /** It runs the template's `/install` command file itself (`capabilities.projectCommands`). */
  runsCommandFiles: z.boolean(),
});
export type SecureFoundationProvider = z.infer<typeof SecureFoundationProvider>;

/**
 * `GET /api/secure-foundation`: whether the option exists in this build and what the form needs
 * before anything is fetched. Nothing personal.
 */
export const SecureFoundationOptions = z.object({
  /** False when the build has no template (`HARDEN_TEMPLATE_REPOSITORY` empty). */
  enabled: z.boolean(),
  /** The template's `owner/repo` and branch; null when off. */
  template: z.object({ repository: z.string(), branch: z.string() }).nullable(),
  /** The folder new projects are created in, and this machine's path separator. */
  projectsDir: z.string(),
  pathSeparator: z.enum(["/", "\\"]),
  /** Signed-in providers that can run the setup, the one a new session would use first. */
  providers: z.array(SecureFoundationProvider),
  defaults: z.object({ secrets: SecureFoundationSecrets, shell: SecureFoundationShell }),
  repositoryMode: SecureFoundationRepositoryMode,
  autonomy: AutonomyLevel,
});
export type SecureFoundationOptions = z.infer<typeof SecureFoundationOptions>;

/**
 * `GET /api/secure-foundation/prefill`: suggestions for the form, read on the person's own
 * machine from the sources the template's install uses, shown only to them and stored nowhere.
 * A source that is missing gives null. Answered with nulls to another device.
 */
export const SecureFoundationPrefill = z.object({
  adminEmail: z.string().nullable(),
});
export type SecureFoundationPrefill = z.infer<typeof SecureFoundationPrefill>;

/**
 * `POST /api/secure-foundation/template`: the commit the template's branch points at now, with
 * its content modules. This is the commit the consent step shows and `create` installs.
 */
export const SecureFoundationTemplate = z.object({
  repository: z.string(),
  branch: z.string(),
  commit: SecureFoundationCommit,
  /** When the commit was made. */
  committedAt: Timestamp,
  modules: z.array(SecureFoundationModule),
});
export type SecureFoundationTemplate = z.infer<typeof SecureFoundationTemplate>;

/** `POST /api/secure-foundation/projects`: the confirmed form. No field names a URL or a path. */
export const CreateSecureFoundationRequest = z.object({
  name: SecureFoundationName,
  adminEmail: SecureFoundationEmail,
  secrets: SecureFoundationSecrets.default(SECURE_FOUNDATION_DEFAULT_SECRETS),
  shell: SecureFoundationShell.default(SECURE_FOUNDATION_DEFAULT_SHELL),
  /** The chosen modules when `shell` is `pick`; ignored otherwise. */
  modules: z.array(SecureFoundationModuleName).max(20).default([]),
  /** One of `SecureFoundationOptions.providers`. */
  provider: ProviderId,
  /** The commit the person saw and confirmed; another commit on the branch is refused. */
  commit: SecureFoundationCommit,
});
export type CreateSecureFoundationRequest = z.infer<typeof CreateSecureFoundationRequest>;
export type CreateSecureFoundationRequestInit = z.input<typeof CreateSecureFoundationRequest>;

/** `POST /api/secure-foundation/projects` response: the new project and its setup session. */
export const CreateSecureFoundationResponse = z.object({
  project: Project,
  sessionId: Id,
  commit: SecureFoundationCommit,
});
export type CreateSecureFoundationResponse = z.infer<typeof CreateSecureFoundationResponse>;

/**
 * Error codes of `create` beyond validation: `template_moved` (the branch points at another
 * commit than the one confirmed: resolve again and ask again), `destination_exists`,
 * `provider_unavailable`, `secure_foundation_off`, and `<step>_failed` for the step that failed
 * (`fetch`, `files`, `repository`, `project`, `session`), after cleaning up.
 */
export const SECURE_FOUNDATION_TEMPLATE_MOVED = "template_moved";

/**
 * `GET /api/secure-foundation/projects/:id/finish`: what the finished install left for the
 * person, read from the project's `docs/INSTALL.md`. The claim URL is shown to the person on
 * this computer only and stored nowhere.
 */
export const SecureFoundationFinish = z.object({
  /** Where the person claims the accountless Clerk app; null when there is none (yet). */
  clerkClaimUrl: z.string().nullable(),
});
export type SecureFoundationFinish = z.infer<typeof SecureFoundationFinish>;

// ------------------------------------------------------- what gets created

/** One thing a setup creates in the person's accounts, and where it is removed again. */
export interface SecureFoundationCreated {
  service: "Clerk" | "Convex" | "Doppler";
  /** What it is and its name, as one phrase. */
  item: string;
  /** Where the person removes it. */
  removeAt: string;
}

/**
 * Everything a setup with these answers creates outside the project folder. The consent step
 * lists it and the setup session's brief is held to it, both from this one function, so the list
 * the person confirms is the list the session may create.
 */
export function secureFoundationCreates(answers: {
  name: string;
  secrets: SecureFoundationSecrets;
}): SecureFoundationCreated[] {
  const slug = secureFoundationFolder(answers.name);
  const created: SecureFoundationCreated[] = [
    {
      service: "Clerk",
      item: "an accountless Clerk app (yours once you claim it), with a JWT template and a webhook endpoint",
      removeAt: "the Clerk dashboard, after claiming it; unclaimed apps expire by themselves",
    },
    {
      service: "Convex",
      item: `a Convex project named "${slug}" with a cloud dev deployment, in your Convex team`,
      removeAt: "the Convex dashboard, in the project's settings",
    },
  ];
  if (answers.secrets === "doppler") {
    created.push({
      service: "Doppler",
      item: `a Doppler project named "${slug}" with the configs dev and prd, holding the app's secrets`,
      removeAt: "the Doppler dashboard, in the project's settings",
    });
  }
  return created;
}

// ------------------------------------------------------------------ status

/** The `workKey` of a setup session: how the UI finds it among a project's sessions. */
export const SECURE_FOUNDATION_WORK_KEY = "secure-foundation:setup";

/** What every progress line of the setup session starts with (`report_progress`). */
export const SECURE_FOUNDATION_PROGRESS_PREFIX = "Secure Foundation: ";

/** The progress lines the setup session reports, after the prefix. */
export const SECURE_FOUNDATION_PROGRESS = {
  preflight: "checking this computer",
  installing: "installing",
  running: "running at ",
  stopped: "stopped",
  failed: "failed",
} as const;

/**
 * Where a setup stands. `cloning` is shown while the project is being created (no session
 * yet); the others are derived from the setup session (`secureFoundationStatus`).
 */
export const SecureFoundationPhase = z.enum([
  "cloning",
  "preparing",
  "installing",
  "waiting",
  "running",
  "stopped",
  "failed",
]);
export type SecureFoundationPhase = z.infer<typeof SecureFoundationPhase>;

export interface SecureFoundationStatus {
  phase: SecureFoundationPhase;
  /** The service's local URL while `running`; null otherwise. */
  url: string | null;
}

/** A URL on this computer (`http://localhost:3000`), the only kind the status links to. */
const LOCAL_URL = /^https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d{1,5})?(?:\/[^\s]*)?$/;

/** True for a setup session (`SECURE_FOUNDATION_WORK_KEY`). */
export function isSecureFoundationSetup(session: Pick<Session, "workKey">): boolean {
  return session.workKey === SECURE_FOUNDATION_WORK_KEY;
}

/**
 * A setup's status, from its session alone: the session's lifecycle and the last progress line
 * it reported. The service lives in the session's processes, so a session that ended (or was
 * archived) reads `stopped` whatever it reported last. A session between turns that reported
 * nothing reads `waiting`: it has something to say that the person should read.
 */
export function secureFoundationStatus(
  session: Pick<Session, "status" | "progress" | "archivedAt" | "startError">,
): SecureFoundationStatus {
  const text = session.progress?.text ?? "";
  const line = text.startsWith(SECURE_FOUNDATION_PROGRESS_PREFIX)
    ? text.slice(SECURE_FOUNDATION_PROGRESS_PREFIX.length).trim()
    : "";
  const marks = SECURE_FOUNDATION_PROGRESS;
  const phase = (p: SecureFoundationPhase, url: string | null = null) => ({ phase: p, url });
  if (session.status === "failed" || session.startError || line.startsWith(marks.failed)) {
    return phase("failed");
  }
  const ended = ["completed", "stopped", "interrupted"].includes(session.status);
  if (ended || session.archivedAt || line.startsWith(marks.stopped)) return phase("stopped");
  if (session.status === "waiting") return phase("waiting");
  if (line.startsWith(marks.running)) {
    const url = line.slice(marks.running.length).trim().split(/\s/, 1)[0] ?? "";
    return phase("running", LOCAL_URL.test(url) ? url : null);
  }
  if (line.startsWith(marks.installing)) return phase("installing");
  if (session.status === "idle" && !line) return phase("waiting");
  return phase("preparing");
}
