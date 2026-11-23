import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createPreviewEnv, type PreviewEnv, SETTINGS } from "./support/dev-preview-env";

/** Starts under pressure: settings that change mid-start, double clicks, time-outs, links. */
let env: PreviewEnv;
afterEach(() => env.close());

describe("a start that waits while the settings change", () => {
  // Finding free ports takes a moment; here it takes until the test says so.
  let probing: (() => void) | null;
  let proceed: () => void;
  beforeEach(() => {
    probing = null;
    env = createPreviewEnv({
      overrides: {
        portIsFree: (port) =>
          new Promise<boolean>((resolve) => {
            const answer = () => resolve(!env.taken.has(port));
            if (probing === null) {
              probing = answer;
              proceed = () => {
                probing = () => {};
                answer();
              };
            } else answer();
          }),
      },
    });
    env.addProject("app");
    env.addSession("s1", "app");
  });
  const untilProbing = async () => {
    while (probing === null) await new Promise((r) => setImmediate(r));
  };

  it("runs the new command, never the one it found when it began", async () => {
    await env.service.setProject("app", SETTINGS);
    const starting = env.service.startSession("s1").catch(() => null);
    await untilProbing();
    // The start has read "run-dev" and is looking for ports. The person saves another command.
    env.clock.now += 5;
    const changing = env.service.setProject("app", { ...SETTINGS, command: "new-dev" });
    proceed();
    await Promise.all([starting, changing]);
    expect(env.procs.map((p) => p.spec.command)).not.toContain("run-dev");
    await env.service.tick();
    expect(env.running().every((p) => p.spec.command === "new-dev")).toBe(true);
  });

  it("runs nothing when the preview was removed meanwhile", async () => {
    await env.service.setProject("app", SETTINGS);
    const starting = env.service.startSession("s1").catch((e) => e);
    await untilProbing();
    const removing = env.service.removeProject("app");
    proceed();
    const [outcome] = await Promise.all([starting, removing]);
    expect(outcome).toMatchObject({ code: "not_configured" });
    expect(env.procs).toHaveLength(0);
  });
});

describe("starts", () => {
  beforeEach(async () => {
    env = createPreviewEnv({ overrides: { prepareTimeoutMs: 10 * 60_000 } });
    env.addProject("app");
    env.addSession("s1", "app");
  });

  it("a second click while it starts doesn't start it twice", async () => {
    await env.service.setProject("app", SETTINGS);
    await Promise.all([env.service.startSession("s1"), env.service.startSession("s1")]);
    expect(env.procs).toHaveLength(1);
    expect(env.running()).toHaveLength(1);
  });

  it("anything running under settings that were replaced is stopped at the next look", async () => {
    await env.service.setProject("app", SETTINGS);
    await env.service.startSession("s1");
    // As if a start had slipped past the change: the store moves on, the process is still there.
    env.clock.now += 1000;
    env.store.confirm("app", { ...SETTINGS, command: "new-dev" }, new Date(env.clock.now), "main");
    await env.service.tick();
    expect(env.running()).toHaveLength(0);
    expect(env.service.sessionState("s1", false).message).toMatch(/settings changed/);
  });

  it("gives up on a prepare command that never finishes", async () => {
    await env.service.setProject("app", { ...SETTINGS, prepareCommand: "install-deps" });
    await env.service.startSession("s1");
    env.clock.now += 9 * 60_000;
    await env.service.tick();
    expect(env.service.sessionState("s1", false).status).toBe("preparing");
    env.clock.now += 2 * 60_000;
    await env.service.tick();
    expect(env.procs[0]?.stopped).toBe(true);
    expect(env.service.sessionState("s1", false)).toMatchObject({
      status: "failed",
      message: "The prepare command didn't finish in 10 minutes.",
    });
    expect(env.procs).toHaveLength(1);
  });

  it("never links to the app's own port, whatever the dev command prints", async () => {
    env.service.start({ port: 43050 });
    await env.service.setProject("app", { ...SETTINGS, urlFrom: "output" });
    await env.service.startSession("s1");
    // The app answers on its own ports; a repository's dev script names them.
    for (const port of [43050, 4417, 4317]) env.listening.add(port);
    env.procs[0]?.print("ready on http://localhost:43050/settings/network\n");
    env.procs[0]?.print("ready on http://localhost:4417/\nready on http://127.0.0.1:4317/\n");
    await env.service.tick();
    expect(env.service.sessionState("s1", false)).toMatchObject({ status: "starting", url: null });
    env.listening.add(5199);
    env.procs[0]?.print("ready on http://localhost:5199/\n");
    await env.service.tick();
    expect(env.service.sessionState("s1", false).url).toBe("http://localhost:5199/");
  });

  it("forgets a preview and its log once its session is archived", async () => {
    await env.service.setProject("app", SETTINGS);
    await env.service.startSession("s1");
    env.procs[0]?.print("a secret the project printed\n");
    const session = env.sessions.get("s1");
    if (session) env.sessions.set("s1", { ...session, archivedAt: "2026-11-07T11:00:00.000Z" });
    await env.service.tick();
    expect(env.service.log("session:s1").lines).toContain("a secret the project printed");
    await env.service.tick();
    expect(env.service.log("session:s1").lines).toEqual([]);
  });
});
