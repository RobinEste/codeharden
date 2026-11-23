import { lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import {
  type CreateProjectRequest,
  type CreateProjectResponse,
  type CreateSecureFoundationRequest,
  type CreateSecureFoundationResponse,
  type Project,
  type ProviderInfo,
  SECURE_FOUNDATION_DEFAULT_SECRETS,
  SECURE_FOUNDATION_DEFAULT_SHELL,
  SECURE_FOUNDATION_REPOSITORY_MODE,
  SECURE_FOUNDATION_SETUP_AUTONOMY,
  SECURE_FOUNDATION_TEMPLATE_MOVED,
  SECURE_FOUNDATION_WORK_KEY,
  SecureFoundationEmail,
  type SecureFoundationFinish,
  type SecureFoundationModule,
  type SecureFoundationOptions,
  type SecureFoundationPrefill,
  type SecureFoundationProvider,
  type SecureFoundationRepositoryMode,
  type SecureFoundationTemplate,
  type SetupStatus,
  type StartSessionRequestInit,
  type StartSessionResponse,
  secureFoundationCreates,
  secureFoundationFolder,
} from "@codeden/contracts";
import { badRequest, conflict, errorMessage, ServiceError } from "../errors";
import type { Exec } from "../exec";
import { setupBrief } from "./brief";
import { ConnectionsService } from "./connections/connections-service";
import { claimLink, isOwnFolder, removeCreated } from "./folders";
import {
  fetchTemplate,
  readModules,
  type TemplateSource,
  writeClone,
  writeFreshRepository,
} from "./template";

export interface SecureFoundationDeps {
  exec: Exec;
  /** The build's template; null switches the feature off. */
  template: TemplateSource | null;
  /** Where new projects are created (`~/codeharden-projects`). */
  projectsDir: string;
  /** Where the template is fetched before it is written out (the OS temp folder). */
  tmpDir: string;
  providers: () => ProviderInfo[];
  /** The provider new agent sessions use when settings name one that is loaded. */
  preferredProvider: () => string | null;
  setupStatus: () => Promise<Pick<SetupStatus, "checks">>;
  projects: {
    create(req: CreateProjectRequest): Promise<CreateProjectResponse>;
    get(id: string): Project;
    archive(id: string): void;
  };
  startSession: (req: StartSessionRequestInit) => Promise<StartSessionResponse>;
  /** `fresh` unless a fork flips `SECURE_FOUNDATION_REPOSITORY_MODE`. */
  repositoryMode?: SecureFoundationRepositoryMode;
  /** Sign-in state and logins of the services' CLIs (the Connections step). */
  connections?: ConnectionsService;
}

type Step = "fetch" | "files" | "project" | "session";
const STEP_LABEL: Record<Step, string> = {
  fetch: "fetching the template",
  files: "writing the new repository",
  project: "adding the project",
  session: "starting the setup session",
};

/**
 * "Secure Foundation": create a project from the build's template and start its setup session
 * (`packages/contracts/src/secure-foundation.ts`, `docs/secure-foundation.md`).
 */
export class SecureFoundationService {
  /** The Connections step: sign-in state and logins of the services' own CLIs. */
  readonly connections: ConnectionsService;

  constructor(private readonly deps: SecureFoundationDeps) {
    this.connections = deps.connections ?? new ConnectionsService();
  }

  private get mode(): SecureFoundationRepositoryMode {
    return this.deps.repositoryMode ?? SECURE_FOUNDATION_REPOSITORY_MODE;
  }

  /** Signed-in providers, the one a new session would use first. */
  async providers(): Promise<SecureFoundationProvider[]> {
    const { checks } = await this.deps.setupStatus();
    const ready = this.deps.providers().filter((p) => {
      if (p.capabilities.credentialFree) return true;
      const check = checks.find((c) => c.id === p.id);
      return Boolean(check?.installed) && check?.loggedIn !== false;
    });
    const preferred = this.deps.preferredProvider();
    const rank = (p: ProviderInfo) =>
      p.id === preferred ? 0 : p.capabilities.projectCommands ? 1 : 2;
    return [...ready]
      .sort((a, b) => rank(a) - rank(b))
      .map((p) => ({
        id: p.id,
        displayName: p.displayName,
        runsCommandFiles: p.capabilities.projectCommands === true,
      }));
  }

  async options(): Promise<SecureFoundationOptions> {
    const { template } = this.deps;
    return {
      enabled: template !== null,
      template: template ? { repository: template.repository, branch: template.branch } : null,
      projectsDir: resolve(this.deps.projectsDir),
      pathSeparator: sep,
      providers: template ? await this.providers() : [],
      defaults: {
        secrets: SECURE_FOUNDATION_DEFAULT_SECRETS,
        shell: SECURE_FOUNDATION_DEFAULT_SHELL,
      },
      repositoryMode: this.mode,
      autonomy: SECURE_FOUNDATION_SETUP_AUTONOMY,
    };
  }

  /**
   * Suggestions for the form, from the sources the template's install uses, first one wins.
   * CodeHarden holds no account email of its own, so today that is `git config user.email`.
   * Nothing here is stored or logged; a source that is missing or fails gives null.
   */
  async prefill(): Promise<SecureFoundationPrefill> {
    for (const source of this.emailSources()) {
      let value: string | null = null;
      try {
        value = await source();
      } catch {
        value = null;
      }
      const email = SecureFoundationEmail.safeParse(value ?? "");
      if (email.success) return { adminEmail: email.data };
    }
    return { adminEmail: null };
  }

  /** In order: add a source in front when the product learns the person's email another way. */
  private emailSources(): Array<() => Promise<string | null>> {
    return [
      async () => {
        const result = await this.deps.exec("git", ["config", "--global", "user.email"], {
          timeoutMs: 5_000,
          cwd: this.deps.tmpDir,
        });
        return result.code === 0 ? result.stdout.trim() : null;
      },
    ];
  }

  private requireTemplate(): TemplateSource {
    if (!this.deps.template) {
      throw new ServiceError(
        404,
        "secure_foundation_off",
        "Secure Foundation is not part of this build",
      );
    }
    return this.deps.template;
  }

  private workDir(): string {
    return mkdtempSync(join(this.deps.tmpDir, "secure-foundation-"));
  }

  /** The commit the template's branch points at now, with its content modules. */
  async template(): Promise<SecureFoundationTemplate> {
    const source = this.requireTemplate();
    const work = this.workDir();
    try {
      const fetched = await this.step("fetch", () => fetchTemplate(this.deps.exec, source, work));
      return {
        repository: source.repository,
        branch: source.branch,
        commit: fetched.commit,
        committedAt: fetched.committedAt,
        modules: await readModules(this.deps.exec, fetched),
      };
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  }

  /**
   * Create the project: fetch the template, check it is still the confirmed commit, write the
   * new repository into a new folder of the projects folder, add the project and start its
   * setup session. A failure names its step and removes what this call created.
   */
  async create(req: CreateSecureFoundationRequest): Promise<CreateSecureFoundationResponse> {
    const source = this.requireTemplate();
    const provider = (await this.providers()).find((p) => p.id === req.provider);
    if (!provider) {
      throw badRequest(
        "That provider isn't signed in on this computer any more. Pick another one.",
        "provider_unavailable",
      );
    }
    const dest = this.destination(req.name);
    const existed = this.assertFree(dest);
    const work = this.workDir();
    let wrote = false;
    let projectId: string | null = null;
    try {
      const fetched = await this.step("fetch", () => fetchTemplate(this.deps.exec, source, work));
      if (fetched.commit !== req.commit) throw moved(source, fetched.commit);
      const available = await readModules(this.deps.exec, fetched);
      const modules = chosenModules(req, available);
      wrote = true;
      mkdirSync(dest, { recursive: true });
      if (!isOwnFolder(dest)) {
        throw conflict(
          `${dest} is not a folder of its own. Choose another name.`,
          "destination_exists",
        );
      }
      await this.step("files", async () => {
        if (this.mode === "fresh") {
          const message = `Initial commit from the Secure Foundation template (${source.repository} at ${fetched.commit.slice(0, 7)})`;
          return writeFreshRepository(this.deps.exec, fetched, dest, message);
        }
        if ((await writeClone(this.deps.exec, source, dest)) !== req.commit) {
          throw moved(source, "another commit");
        }
      });
      const { project } = await this.step("project", () =>
        this.deps.projects.create({ source: { type: "local", path: dest }, name: req.name }),
      );
      projectId = project.id;
      const sessionId = await this.step("session", async () => {
        const started = await this.deps.startSession({
          projectId: project.id,
          provider: provider.id,
          autonomy: SECURE_FOUNDATION_SETUP_AUTONOMY,
          // In the project folder itself: the app, its `.env.local` and its processes live there.
          workspace: { mode: "repo_root" },
          title: "Secure Foundation setup",
          purpose: "Secure Foundation setup",
          workKey: SECURE_FOUNDATION_WORK_KEY,
          input: {
            text: setupBrief({
              name: req.name,
              adminEmail: req.adminEmail,
              doppler: req.secrets === "doppler",
              modules,
              skippedModules: available.map((m) => m.name).filter((n) => !modules.includes(n)),
              repository: source.repository,
              commit: fetched.commit,
              runsCommandFiles: provider.runsCommandFiles,
              convexTeam: req.convexTeam ?? null,
              creates: secureFoundationCreates(req),
            }),
          },
        });
        if (started.status !== "started") throw new Error(`the session was ${started.status}`);
        return started.sessionId;
      });
      return { project, sessionId, commit: fetched.commit };
    } catch (error) {
      if (projectId) {
        try {
          this.deps.projects.archive(projectId);
        } catch {
          // The folder still goes: nothing of this request stays behind.
        }
      }
      if (wrote) removeCreated(dest, existed);
      throw error;
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  }

  /** The Clerk claim link of a finished install, from the project's `docs/INSTALL.md`. */
  finish(projectId: string): SecureFoundationFinish {
    const project = this.deps.projects.get(projectId);
    let text = "";
    try {
      text = readFileSync(join(project.path, "docs", "INSTALL.md"), "utf8").slice(0, 200_000);
    } catch {
      return { clerkClaimUrl: null };
    }
    return { clerkClaimUrl: claimLink(text) };
  }

  /** The new project's folder: a direct child of the projects folder, whatever the name. */
  private destination(name: string): string {
    const folder = secureFoundationFolder(name);
    const root = resolve(this.deps.projectsDir);
    const dest = resolve(root, folder);
    if (!/^[a-z0-9][a-z0-9-]*$/.test(folder) || dirname(dest) !== root) {
      throw badRequest("That name can't be used as a folder name", "invalid_name");
    }
    mkdirSync(root, { recursive: true });
    return dest;
  }

  /** Refuse anything already at `dest` but an empty folder; true when that folder exists. */
  private assertFree(dest: string): boolean {
    let stat: ReturnType<typeof lstatSync>;
    try {
      stat = lstatSync(dest);
    } catch {
      return false;
    }
    if (!stat.isDirectory() || readdirSync(dest).length > 0) {
      throw conflict(`${dest} already exists. Choose another name.`, "destination_exists");
    }
    return true;
  }

  private async step<T>(step: Step, run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (error) {
      if (error instanceof ServiceError) throw error;
      throw new ServiceError(
        502,
        `${step}_failed`,
        `Secure Foundation stopped while ${STEP_LABEL[step]}: ${errorMessage(error)}. Nothing was left behind.`,
      );
    }
  }
}

function moved(source: TemplateSource, now: string): ServiceError {
  return new ServiceError(
    409,
    SECURE_FOUNDATION_TEMPLATE_MOVED,
    `${source.repository} changed since you confirmed (${source.branch} is now at ${now.slice(0, 7)}). Check the new commit and confirm again.`,
  );
}

/** The modules a request installs, checked against what the fetched commit really has. */
export function chosenModules(
  req: Pick<CreateSecureFoundationRequest, "shell" | "modules">,
  available: SecureFoundationModule[],
): string[] {
  const names = available.map((m) => m.name);
  if (req.shell === "minimal") return [];
  if (req.shell === "all") return names;
  const unknown = req.modules.filter((m) => !names.includes(m));
  if (unknown.length > 0) {
    throw badRequest(`The template has no module ${unknown.join(", ")}`, "unknown_module");
  }
  return names.filter((n) => req.modules.includes(n));
}

export { isOwnFolder, removeCreated } from "./folders";
