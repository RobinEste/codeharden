import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { devPreviewBaseKey } from "@codeden/contracts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { syncBaseCheckout } from "../src/services/dev-preview/base-checkout";
import { runTool } from "../src/services/exec";
import { createPreviewEnv, type PreviewEnv, SETTINGS } from "./support/dev-preview-env";

/**
 * The PM thread's preview against real git repositories in a temp folder: an "origin", the
 * project's clone of it, and the checkout the app makes. Processes are scripted.
 */
const GIT_ENV = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => !/^GIT_/i.test(key)),
);
// The suite must behave the same when it is run from a git hook.
for (const key of Object.keys(process.env)) if (/^GIT_/i.test(key)) delete process.env[key];

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    env: {
      ...GIT_ENV,
      GIT_AUTHOR_NAME: "T",
      GIT_AUTHOR_EMAIL: "t@example.com",
      GIT_COMMITTER_NAME: "T",
      GIT_COMMITTER_EMAIL: "t@example.com",
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_CONFIG_SYSTEM: "/dev/null",
    },
  }).trim();
}

let root: string;
let origin: string;
let repo: string;
let env: PreviewEnv;

function commit(cwd: string, file: string, content: string, message: string): string {
  writeFileSync(join(cwd, file), content);
  git(cwd, "add", "-A");
  git(cwd, "commit", "-q", "-m", message);
  return git(cwd, "rev-parse", "HEAD");
}

/** A new commit lands on the base branch at the remote, as a merged pull request would. */
function pushToOrigin(file: string, content: string): string {
  const work = join(root, `work-${Math.random().toString(36).slice(2)}`);
  git(root, "clone", "-q", "-b", "trunk", origin, work);
  const sha = commit(work, file, content, `change ${file}`);
  git(work, "push", "-q", "origin", "trunk");
  return sha;
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "dev-preview-base-"));
  origin = join(root, "origin.git");
  repo = join(root, "project");
  mkdirSync(repo);
  git(root, "init", "-q", "--bare", "-b", "trunk", origin);
  git(repo, "init", "-q", "-b", "trunk");
  commit(repo, "index.html", "one\n", "init");
  git(repo, "remote", "add", "origin", origin);
  git(repo, "push", "-q", "-u", "origin", "trunk");
  env = createPreviewEnv({ exec: runTool });
  // The base branch is the project's own setting: not main, not harden.
  env.projects.set("app", { ...env.addProject("app", { defaultBranch: "trunk" }), path: repo });
});
afterEach(async () => {
  await env.close();
  rmSync(root, { recursive: true, force: true });
});

const key = devPreviewBaseKey("app");
const checkout = () => env.procs[0]?.spec.cwd ?? "";
const state = () => env.service.baseState("app", false);
/** The dev command came up, so the time that passes below isn't a start that takes too long. */
const up = async (port = 43100) => {
  env.listening.add(port);
  await env.service.tick();
};
const tickAfter = async (ms: number) => {
  env.clock.now += ms;
  await env.service.tick();
  await env.service.idle();
};

describe("the checkout itself", () => {
  const path = () => join(root, "checkout");
  const sync = () => syncBaseCheckout(runTool, { repo, path: path(), branch: "trunk" });

  it("is created at the remote's tip and fast-forwarded when the branch moves", async () => {
    const first = await sync();
    expect(first).toMatchObject({ ok: true, moved: true });
    expect(readFileSync(join(path(), "index.html"), "utf8")).toBe("one\n");
    expect(await sync()).toMatchObject({ ok: true, moved: false });
    const sha = pushToOrigin("index.html", "two\n");
    expect(await sync()).toMatchObject({ ok: true, moved: true, commit: sha });
    expect(readFileSync(join(path(), "index.html"), "utf8")).toBe("two\n");
    // The person's own folder and branch are never moved.
    expect(readFileSync(join(repo, "index.html"), "utf8")).toBe("one\n");
    expect(git(repo, "status", "--porcelain")).toBe("");
  });

  it("stops, and changes nothing, when someone committed in it", async () => {
    await sync();
    const mine = commit(path(), "note.txt", "mine\n", "a commit made in the checkout");
    pushToOrigin("index.html", "two\n");
    const result = await sync();
    expect(result).toMatchObject({ ok: false });
    expect(result.ok ? "" : result.message).toMatch(/can't be fast-forwarded to trunk/);
    expect(git(path(), "rev-parse", "HEAD")).toBe(mine);
    expect(readFileSync(join(path(), "note.txt"), "utf8")).toBe("mine\n");
    expect(readFileSync(join(path(), "index.html"), "utf8")).toBe("one\n");
  });

  it("stops, and keeps local edits, when they are in the way", async () => {
    await sync();
    const head = git(path(), "rev-parse", "HEAD");
    writeFileSync(join(path(), "index.html"), "edited by hand\n");
    pushToOrigin("index.html", "two\n");
    const result = await sync();
    expect(result.ok ? "" : result.message).toMatch(/couldn't be fast-forwarded/);
    expect(readFileSync(join(path(), "index.html"), "utf8")).toBe("edited by hand\n");
    expect(git(path(), "rev-parse", "HEAD")).toBe(head);
  });

  it("stops when the branch was rewritten at the remote", async () => {
    await sync();
    const head = git(path(), "rev-parse", "HEAD");
    const other = join(root, "rewrite");
    git(root, "clone", "-q", "-b", "trunk", origin, other);
    git(other, "commit", "-q", "--amend", "-m", "rewritten");
    git(other, "push", "-q", "--force", "origin", "trunk");
    expect(await sync()).toMatchObject({ ok: false });
    expect(git(path(), "rev-parse", "HEAD")).toBe(head);
  });

  it("leaves a folder that isn't its own alone", async () => {
    mkdirSync(path());
    writeFileSync(join(path(), "keep.txt"), "someone's\n");
    const result = await sync();
    expect(result.ok ? "" : result.message).toMatch(/isn't this project's preview checkout/);
    expect(readFileSync(join(path(), "keep.txt"), "utf8")).toBe("someone's\n");
  });

  it("refuses a branch name that could be read as an option", async () => {
    const result = await syncBaseCheckout(runTool, {
      repo,
      path: path(),
      branch: "--upload-pack=x",
    });
    expect(result).toMatchObject({ ok: false });
    expect(existsSync(path())).toBe(false);
  });

  it("follows the local branch of a project with no remote", async () => {
    git(repo, "remote", "remove", "origin");
    await sync();
    const sha = commit(repo, "index.html", "local two\n", "local");
    expect(await sync()).toMatchObject({ ok: true, moved: true, commit: sha });
  });
});

describe("the PM thread's preview", () => {
  const on = { ...SETTINGS, pmEnabled: true };

  it("starts by default once a command is confirmed, from its own checkout of the base branch", async () => {
    env.service.start();
    await env.service.idle();
    expect(env.procs).toHaveLength(0);
    await env.service.setProject("app", on);
    await env.service.idle();
    expect(env.procs.map((p) => p.spec.command)).toEqual(["run-dev"]);
    expect(checkout()).toContain(join(env.home, "dev-preview", "base"));
    expect(checkout()).not.toBe(repo);
    expect(readFileSync(join(checkout(), "index.html"), "utf8")).toBe("one\n");
    env.listening.add(43100);
    await env.service.tick();
    expect(state()).toMatchObject({
      key,
      status: "running",
      url: "http://localhost:43100",
      base: { branch: "trunk", blocked: false },
    });
  });

  it("follows the base branch without restarting the dev command", async () => {
    await env.service.setProject("app", on);
    await env.service.idle();
    await up();
    pushToOrigin("index.html", "two\n");
    // Not before its turn: at most one look every 90 seconds.
    await tickAfter(30_000);
    expect(readFileSync(join(checkout(), "index.html"), "utf8")).toBe("one\n");
    await tickAfter(61_000);
    expect(readFileSync(join(checkout(), "index.html"), "utf8")).toBe("two\n");
    expect(env.procs).toHaveLength(1);
    expect(env.running()).toHaveLength(1);
  });

  it("Update now looks at once", async () => {
    await env.service.setProject("app", on);
    await env.service.idle();
    const sha = pushToOrigin("index.html", "two\n");
    const updated = await env.service.updateBase("app");
    expect(updated.base).toMatchObject({ commit: sha.slice(0, 10) });
    expect(env.procs).toHaveLength(1);
  });

  it("runs the prepare command again and restarts when the lockfile changed, and only then", async () => {
    await env.service.setProject("app", { ...on, prepareCommand: "install-deps" });
    await env.service.idle();
    expect(env.procs.map((p) => p.spec.command)).toEqual(["install-deps"]);
    env.procs[0]?.exit(0);
    await new Promise((r) => setImmediate(r));
    expect(env.procs.map((p) => p.spec.command)).toEqual(["install-deps", "run-dev"]);
    await up();

    pushToOrigin("index.html", "two\n");
    await tickAfter(91_000);
    expect(env.procs).toHaveLength(2);

    pushToOrigin("pnpm-lock.yaml", "lockfileVersion: 9\n");
    await tickAfter(91_000);
    expect(env.procs.map((p) => p.spec.command).slice(2)).toEqual(["install-deps"]);
    expect(env.procs[1]?.stopped).toBe(true);
    env.procs[2]?.exit(0);
    await new Promise((r) => setImmediate(r));
    expect(env.procs.at(-1)?.spec.command).toBe("run-dev");
    expect(env.running()).toHaveLength(1);
  });

  it("stops with a clear message when its checkout can't be fast-forwarded, and resets nothing", async () => {
    await env.service.setProject("app", on);
    await env.service.idle();
    await up();
    const mine = commit(checkout(), "note.txt", "mine\n", "committed in the checkout");
    pushToOrigin("index.html", "two\n");
    await tickAfter(91_000);
    expect(env.running()).toHaveLength(0);
    expect(state()).toMatchObject({ status: "stopped", base: { blocked: true } });
    expect(state().message).toMatch(/can't be fast-forwarded to trunk/);
    expect(git(checkout(), "rev-parse", "HEAD")).toBe(mine);
    // It stays stopped while nothing changes…
    await tickAfter(91_000);
    expect(env.procs).toHaveLength(1);
    // …and comes back once the person sorted the checkout out.
    git(checkout(), "checkout", "-q", "--detach", "origin/trunk");
    await tickAfter(91_000);
    expect(env.running()).toHaveLength(1);
    expect(state()).toMatchObject({ status: "starting", base: { blocked: false } });
  });

  it("a person's choice to switch it off is remembered across restarts", async () => {
    await env.service.setProject("app", on);
    await env.service.idle();
    expect((await env.service.setPm("app", false)).status).toBe("off");
    expect(env.running()).toHaveLength(0);
    await tickAfter(91_000);
    const next = env.restart();
    next.start();
    await next.idle();
    expect(env.procs).toHaveLength(1);
    expect(next.project("app", false).config).toMatchObject({
      pmEnabled: false,
      command: "run-dev",
    });
    // Switched on again, it starts.
    await next.setPm("app", true);
    expect(env.running()).toHaveLength(1);
    await next.stop();
  });

  it("starts again by itself after a restart of the app, when it is on", async () => {
    await env.service.setProject("app", on);
    await env.service.idle();
    await env.service.stop();
    const next = env.restart();
    next.start();
    await next.idle();
    expect(env.running()).toHaveLength(1);
    await next.stop();
  });

  it("doesn't restart a preview that stopped until the branch moves or a person asks", async () => {
    await env.service.setProject("app", on);
    await env.service.idle();
    env.procs[0]?.exit(1);
    await new Promise((r) => setImmediate(r));
    env.procs[1]?.exit(1);
    await new Promise((r) => setImmediate(r));
    expect(state().status).toBe("failed");
    await tickAfter(91_000);
    await tickAfter(91_000);
    expect(env.procs).toHaveLength(2);
    pushToOrigin("index.html", "fixed\n");
    await tickAfter(91_000);
    expect(env.procs).toHaveLength(3);
  });

  it("the app's own start never stops a session's preview to make room", async () => {
    env.store.setLimits({ perProject: 1, total: 6, portFrom: 43100, portTo: 43199 });
    await env.service.setProject("app", SETTINGS);
    env.addSession("s1", "app");
    await env.service.startSession("s1");
    await up();
    env.store.setPmEnabled("app", true);
    await tickAfter(91_000);
    expect(env.running().map((p) => p.spec.cwd)).toEqual([env.sessions.get("s1")?.worktreePath]);
    expect(state()).toMatchObject({ status: "stopped", message: expect.stringContaining("limit") });
  });

  it("removing the project's preview takes the checkout away, unless it has changes", async () => {
    await env.service.setProject("app", on);
    await env.service.idle();
    const path = checkout();
    await env.service.removeProject("app");
    expect(existsSync(path)).toBe(false);

    await env.service.setProject("app", on);
    await env.service.idle();
    writeFileSync(join(path, "untracked.txt"), "keep me\n");
    await env.service.removeProject("app");
    expect(readFileSync(join(path, "untracked.txt"), "utf8")).toBe("keep me\n");
  });
});
