import { join } from "node:path";
import {
  DEV_PREVIEW_RESERVED_PORTS,
  type DevPreviewLimits,
  type DevPreviewLimitsView,
  type DevPreviewLog,
  type DevPreviewProject,
  type DevPreviewSettings,
  type DevPreviewState,
  devPreviewBaseKey,
  devPreviewPortCount,
  devPreviewSessionKey,
  HARDEN_DEFAULT_PORT,
  type Project,
  type Session,
} from "@codeden/contracts";
import { conflict, notFound } from "../errors";
import type { Exec } from "../exec";
import { BasePreviews } from "./base-previews";
import { previewBaseBranch, sessionUnavailable, suggestDevCommand } from "./eligibility";
import { type ProcessProbe, RunningRegistry } from "./leftovers";
import { PreparedStore } from "./lockfile";
import { isListening, PortAllocator, portIsFree } from "./ports";
import { Preview, type PreviewDeps, type PreviewTarget } from "./preview";
import { type SpawnPreview, spawnPreview } from "./process";
import { makeRoom } from "./room";
import type { DevPreviewStore } from "./store";

export interface DevPreviewDeps {
  /** The app's home: the base checkouts and the service's own files live under it. */
  home: string;
  store: DevPreviewStore;
  /** Throws when the project doesn't exist. */
  project: (id: string) => Project;
  session: (id: string) => Session | undefined;
  /** The session's files are in a sandbox, not on this computer. */
  sandboxed: (sessionId: string) => boolean;
  exec: Exec;
  log?: (message: string) => void;
  // Replaced in tests:
  spawn?: SpawnPreview;
  isListening?: (port: number) => Promise<boolean>;
  portIsFree?: (port: number) => Promise<boolean>;
  probe?: ProcessProbe;
  now?: () => number;
  exists?: (path: string) => boolean;
  tickMs?: number;
  baseCheckEveryMs?: number;
  stopGraceMs?: number;
  startTimeoutMs?: number;
}

/**
 * Dev previews (`docs/dev-preview.md`): a project's confirmed dev command, run in a session's
 * worktree or in a checkout of the base branch, with its link shown once something listens.
 *
 * Only a person starts one, through the routes; there is no agent tool. Nothing runs for a
 * project until a person confirmed its command on this computer (`setProject`), and the
 * command comes from the store alone: no method here takes one from a request to run it, and
 * nothing is read from the repository.
 */
export class DevPreviewService {
  private readonly previews = new Map<string, Preview>();
  private readonly allocator: PortAllocator;
  private readonly registry: RunningRegistry;
  private readonly prepared: PreparedStore;
  private readonly previewDeps: PreviewDeps;
  private readonly bases: BasePreviews;
  private readonly now: () => number;
  private serverPort: number | null = null;
  private timer: NodeJS.Timeout | null = null;
  private ticking = false;
  /** Starts run one at a time, so two can't take the same slot or the same port. */
  private queue: Promise<unknown> = Promise.resolve();
  private readonly onExit = () => {
    for (const preview of this.previews.values()) preview.killNow();
  };

  constructor(private readonly deps: DevPreviewDeps) {
    const dir = join(deps.home, "dev-preview");
    this.now = deps.now ?? Date.now;
    this.allocator = new PortAllocator(deps.portIsFree ?? portIsFree);
    this.registry = new RunningRegistry(join(dir, "running.json"), deps.probe);
    this.prepared = new PreparedStore(join(dir, "prepared.json"));
    this.previewDeps = {
      spawn: deps.spawn ?? spawnPreview,
      isListening: deps.isListening ?? isListening,
      now: this.now,
      registry: this.registry,
      prepared: this.prepared,
      stopGraceMs: deps.stopGraceMs ?? 5_000,
      startTimeoutMs: deps.startTimeoutMs ?? 5 * 60_000,
    };
    this.bases = new BasePreviews({
      dir: join(dir, "base"),
      store: deps.store,
      exec: deps.exec,
      project: (id) => this.findProject(id),
      preview: (target) => this.previewFor(target),
      existing: (key) => this.previews.get(key),
      begin: (preview, settings, byPerson) => this.begin(preview, settings, byPerson),
      prepared: this.prepared,
      now: this.now,
      checkEveryMs: deps.baseCheckEveryMs ?? 90_000,
      log: deps.log,
    });
  }

  /** End what a crash left behind, start following base branches, and begin ticking. */
  start(opts: { port?: number } = {}): void {
    this.serverPort = opts.port ?? null;
    const ended = this.registry.cleanUp();
    if (ended.length > 0) {
      this.deps.log?.(`[dev-preview] ended ${ended.length} preview(s) left from an earlier run`);
    }
    process.on("exit", this.onExit);
    this.timer = setInterval(() => void this.tick(), this.deps.tickMs ?? 1_000);
    this.timer.unref?.();
    this.bases.checkDue(true);
  }

  /** Stop every preview. Called when the app closes. */
  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    process.off("exit", this.onExit);
    await this.stopAll();
  }

  /**
   * One look at everything: stop previews whose session ended, see whether a starting one
   * listens yet, and check the base branches that are due.
   */
  async tick(): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    try {
      for (const preview of [...this.previews.values()]) {
        if (!preview.active) continue;
        const gone = this.noLongerAllowed(preview);
        if (gone) await preview.stop("stopped", gone);
        else await preview.poll();
      }
      this.bases.checkDue(false);
    } finally {
      this.ticking = false;
    }
  }

  /** Resolves when the base-branch work under way is done. For tests. */
  idle(): Promise<void> {
    return this.bases.idle();
  }

  limits(remote: boolean): DevPreviewLimitsView {
    return { limits: this.deps.store.limits(), remote };
  }

  setLimits(limits: DevPreviewLimits): DevPreviewLimitsView {
    return { limits: this.deps.store.setLimits(limits), remote: false };
  }

  project(projectId: string, remote: boolean): DevPreviewProject {
    const project = this.deps.project(projectId);
    const config = this.deps.store.config(projectId);
    return {
      projectId,
      config,
      suggestion: config || remote ? null : suggestDevCommand(project.path),
      baseBranch: previewBaseBranch(project),
      remote,
    };
  }

  /**
   * A person confirmed these commands for the project, on this computer. Everything running
   * under the old ones stops; session previews stay off until a person turns them on again.
   */
  async setProject(projectId: string, settings: DevPreviewSettings): Promise<DevPreviewProject> {
    const project = this.deps.project(projectId);
    if (project.archivedAt) throw conflict("The project is archived.", "project_archived");
    this.deps.store.confirm(projectId, settings, new Date(this.now()));
    await this.stopProject(projectId, "The dev preview's settings changed. Turn it on again.");
    if (settings.pmEnabled) void this.bases.ensure(projectId, true).catch(() => {});
    return this.project(projectId, false);
  }

  /** Forget the project's commands and stop its previews. Nothing can run for it afterwards. */
  async removeProject(projectId: string): Promise<DevPreviewProject> {
    const project = this.deps.project(projectId);
    this.deps.store.remove(projectId);
    await this.stopProject(projectId, null);
    await this.bases.forget(project);
    return this.project(projectId, false);
  }

  /** The PM thread's preview on (starts it) or off (stops it); the choice is kept. */
  async setPm(projectId: string, enabled: boolean): Promise<DevPreviewState> {
    this.deps.project(projectId);
    if (!this.deps.store.setPmEnabled(projectId, enabled)) throw this.notConfigured();
    await this.bases.ensure(projectId, true);
    return this.baseState(projectId, false);
  }

  /** Look for new commits on the base branch now, and (re)start the PM thread's preview. */
  async updateBase(projectId: string): Promise<DevPreviewState> {
    this.deps.project(projectId);
    const config = this.deps.store.config(projectId);
    if (!config) throw this.notConfigured();
    if (!config.pmEnabled) throw conflict("The PM thread's preview is off.", "preview_off");
    await this.bases.ensure(projectId, true);
    return this.baseState(projectId, false);
  }

  baseState(projectId: string, remote: boolean): DevPreviewState {
    const project = this.deps.project(projectId);
    const key = devPreviewBaseKey(projectId);
    return this.state(
      { key, kind: "base", projectId, sessionId: null },
      this.bases.unavailable(project),
      remote,
    );
  }

  sessionState(sessionId: string, remote: boolean): DevPreviewState {
    const session = this.deps.session(sessionId);
    if (!session?.projectId) throw notFound("Session not found");
    const key = devPreviewSessionKey(sessionId);
    return this.state(
      { key, kind: "session", projectId: session.projectId, sessionId },
      this.unavailable(session),
      remote,
    );
  }

  async startSession(sessionId: string): Promise<DevPreviewState> {
    const session = this.deps.session(sessionId);
    if (!session?.projectId) throw notFound("Session not found");
    const settings = this.deps.store.config(session.projectId);
    if (!settings) throw this.notConfigured();
    const reason = this.unavailable(session);
    if (reason || !session.worktreePath) throw conflict(reason ?? "No worktree", "unavailable");
    const preview = this.previewFor({
      key: devPreviewSessionKey(sessionId),
      kind: "session",
      projectId: session.projectId,
      sessionId,
      cwd: session.worktreePath,
    });
    if (!preview.active) await this.begin(preview, settings, true);
    return this.sessionState(sessionId, false);
  }

  async stopSession(sessionId: string): Promise<DevPreviewState> {
    await this.previews.get(devPreviewSessionKey(sessionId))?.stop("off");
    return this.sessionState(sessionId, false);
  }

  log(key: string): DevPreviewLog {
    return { key, lines: this.previews.get(key)?.log() ?? [] };
  }

  /** Stop every preview of every project. Returns how many were running. */
  async stopAll(): Promise<number> {
    const running = [...this.previews.values()].filter((p) => p.active);
    await Promise.all(running.map((p) => p.stop("off")));
    return running.length;
  }

  private notConfigured() {
    return conflict(
      "This project has no dev preview yet. Set its dev command in the project's settings first.",
      "not_configured",
    );
  }

  private findProject(id: string): Project | undefined {
    try {
      return this.deps.project(id);
    } catch {
      return undefined;
    }
  }

  private unavailable(session: Session | undefined): string | null {
    const project = session?.projectId ? this.findProject(session.projectId) : undefined;
    return sessionUnavailable(session, project, {
      sandboxed: session ? this.deps.sandboxed(session.id) : false,
      exists: this.deps.exists,
    });
  }

  /** Why a running preview must stop now, or null. */
  private noLongerAllowed(preview: Preview): string | null {
    const { projectId, sessionId } = preview.target;
    if (!this.deps.store.config(projectId)) return "The project's dev preview was removed.";
    if (preview.target.kind === "base") return null;
    return this.unavailable(sessionId ? this.deps.session(sessionId) : undefined);
  }

  private previewFor(target: PreviewTarget): Preview {
    const existing = this.previews.get(target.key);
    if (existing && existing.target.cwd === target.cwd) return existing;
    const preview = new Preview(target, this.previewDeps);
    this.previews.set(target.key, preview);
    return preview;
  }

  private async stopProject(projectId: string, message: string | null): Promise<void> {
    const mine = [...this.previews.values()].filter((p) => p.target.projectId === projectId);
    await Promise.all(
      mine.map((p) => (p.active && message ? p.stop("stopped", message) : p.stop("off"))),
    );
  }

  /**
   * Make room, take ports and start. A person's start may stop the oldest idle preview to
   * make room; one the app starts by itself never stops anyone's.
   */
  private begin(preview: Preview, settings: DevPreviewSettings, byPerson: boolean): Promise<void> {
    const run = this.queue.then(async () => {
      await makeRoom({
        previews: [...this.previews.values()],
        preview,
        limits: this.deps.store.limits(),
        evict: byPerson,
        session: this.deps.session,
      });
      const limits = this.deps.store.limits();
      const taken = new Set<number>([...DEV_PREVIEW_RESERVED_PORTS, HARDEN_DEFAULT_PORT]);
      if (this.serverPort) taken.add(this.serverPort);
      for (const other of this.previews.values()) {
        if (other !== preview && other.active) for (const port of other.ports) taken.add(port);
      }
      const ports = await this.allocator.next(
        devPreviewPortCount(settings),
        { from: limits.portFrom, to: limits.portTo },
        taken,
      );
      if (!ports) {
        throw conflict(
          `No free port between ${limits.portFrom} and ${limits.portTo}. Stop a preview, or widen the range in Settings.`,
          "no_ports",
        );
      }
      await preview.start(settings, ports);
    });
    this.queue = run.catch(() => {});
    return run;
  }

  private state(
    target: Omit<PreviewTarget, "cwd">,
    unavailable: string | null,
    remote: boolean,
  ): DevPreviewState {
    const preview = this.previews.get(target.key);
    const status = preview?.status ?? "off";
    return {
      ...target,
      status,
      enabled:
        target.kind === "base"
          ? this.deps.store.config(target.projectId)?.pmEnabled === true
          : status !== "off",
      url: preview?.url ?? null,
      ports: preview?.active ? preview.ports : [],
      message: preview?.message ?? null,
      logTail: status === "failed" || status === "stopped" ? (preview?.tail() ?? []) : [],
      startedAt: preview?.startedAt ? new Date(preview.startedAt).toISOString() : null,
      configured: this.deps.store.config(target.projectId) !== null,
      unavailable,
      remote,
      base: target.kind === "base" ? this.bases.info(target.projectId) : null,
    };
  }
}
