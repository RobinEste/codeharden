import { existsSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { secureFoundationRoutes } from "../src/routes/secure-foundation";
import { errorResponse } from "../src/routes/validate";
import type { AppServices } from "../src/services/container";
import { ServiceError } from "../src/services/errors";
import { ConnectionsService } from "../src/services/secure-foundation/connections/connections-service";
import { minimalEnv } from "../src/services/secure-foundation/connections/process";
import { type FakeClis, isAlive, makeFakeClis } from "./support/fake-clis";
import { waitUntil } from "./support/harness";
import { removeTree } from "./support/remove-tree";

/**
 * The Connections step against fake CLIs on a PATH of their own: nothing here signs in to a
 * real service. The fakes take only the product's fixed arguments.
 */
const posix = process.platform !== "win32";
let fakes: FakeClis;
let connections: ConnectionsService;

const service = (over: { loginTimeoutMs?: number; fakes?: FakeClis } = {}) =>
  new ConnectionsService({
    env: () => (over.fakes ?? fakes).env,
    loginTimeoutMs: over.loginTimeoutMs,
  });

beforeEach(() => {
  fakes = makeFakeClis();
  connections = service();
});
afterEach(async () => {
  connections.dispose();
  await removeTree(fakes.dir);
});

const settled = (id: string, s = connections) =>
  waitUntil(() => {
    const login = s.login(id);
    return login.status === "starting" || login.status === "waiting" ? undefined : login;
  });
const waiting = (id: string, s = connections) =>
  waitUntil(() => (s.login(id).status === "waiting" ? s.login(id) : undefined));

describe.runIf(posix)("sign-in state, asked of each CLI", () => {
  it("reads signed out, then signed in with the Convex teams", async () => {
    expect(await connections.states(["convex", "doppler"])).toMatchObject([
      { service: "convex", cli: "ready", signedIn: false, teams: [] },
      { service: "doppler", cli: "ready", signedIn: false, teams: [] },
    ]);
    fakes.setMode("signed_in");
    const [convex, doppler] = await connections.states(["convex", "doppler"]);
    expect(convex).toMatchObject({ signedIn: true, message: "Signed in to Convex." });
    // A line that isn't `- Name (slug)` with a valid slug is not a team.
    expect(convex?.teams).toEqual([
      { name: "Acme Labs", slug: "acme-labs" },
      { name: "Side Project", slug: "side-project" },
    ]);
    expect(doppler).toMatchObject({ signedIn: true, teams: [] });
  });

  it("says a CLI is missing, with the install command for the person to run", async () => {
    const onlyNpx = makeFakeClis(["npx"]);
    const s = service({ fakes: onlyNpx });
    const [doppler] = await s.states(["doppler"]);
    expect(doppler).toMatchObject({ cli: "missing", signedIn: null });
    expect(doppler?.install).toBeTruthy();
    // Starting its login is refused: nothing is installed for the person, nothing hangs.
    expect(() => s.startLogin("doppler")).toThrow(ServiceError);
    s.dispose();
    await removeTree(onlyNpx.dir);
  });

  it("runs the CLI with a minimal environment, in a scratch folder that isn't a project", async () => {
    await connections.states(["convex"]);
    const seen = fakes.seen("npx");
    expect(seen?.args).toBe("--yes convex@1.43.0 login status");
    expect(seen?.env).toContain("PATH");
    expect(seen?.env).toContain("HOME");
    expect(seen?.env).not.toContain("SECRET_FROM_THE_SERVER");
    expect(seen?.env).not.toContain("CODEDEN_HOME");
    expect(seen?.cwd.startsWith(realpathSync(tmpdir()))).toBe(true);
    expect(existsSync(`${seen?.cwd}/.git`)).toBe(false);
    expect(Object.keys(minimalEnv({ A_TOKEN: "x", PATH: "/bin" }))).toEqual([
      "PATH",
      "NO_COLOR",
      "FORCE_COLOR",
    ]);
  });
});

describe.runIf(posix)("a login started from the form", () => {
  it("shows the link and the code, and is done when the person finishes in the browser", async () => {
    fakes.setMode("login_ok");
    const started = connections.startLogin("convex");
    expect(started).toMatchObject({ service: "convex", status: "starting", url: null });
    const shown = await waiting(started.id);
    expect(shown.url).toBe("https://auth.convex.dev/activate?user_code=WXYZ-1234");
    expect(shown.code).toBe("WXYZ-1234");
    // A second click joins the login that is running.
    expect(connections.startLogin("convex").id).toBe(started.id);
    fakes.approve();
    const done = await settled(started.id);
    expect(done).toMatchObject({ status: "done", url: null, code: null });
    expect(fakes.seen("npx")?.args).toContain("login --login-flow poll --no-open");
    expect((await connections.states(["convex"]))[0]?.signedIn).toBe(true);
  });

  it("reads Doppler's link and code through its colour codes", async () => {
    fakes.setMode("login_ok");
    const shown = await waiting(connections.startLogin("doppler").id);
    expect(shown.url).toBe("https://dashboard.doppler.com/workplace/auth/cli");
    expect(shown.code).toBe("fake_code_1234");
    expect(fakes.seen("doppler")?.args).toBe("login --yes --no-copy");
  });

  it("times out, and leaves no process behind", async () => {
    fakes.setMode("login_hang");
    const s = service({ loginTimeoutMs: 400 });
    const login = s.startLogin("convex");
    const ended = await settled(login.id, s);
    expect(ended).toMatchObject({ status: "timed_out", url: null, code: null });
    const pid = fakes.pid("npx");
    if (pid) await waitUntil(() => (isAlive(pid) ? undefined : true));
    s.dispose();
  });

  it("can be cancelled, and leaves no process behind", async () => {
    fakes.setMode("login_hang");
    const login = connections.startLogin("doppler");
    await waiting(login.id);
    const pid = fakes.pid("doppler") as number;
    expect(isAlive(pid)).toBe(true);
    expect(connections.cancel(login.id)).toMatchObject({ status: "cancelled", url: null });
    await waitUntil(() => (isAlive(pid) ? undefined : true));
    // Cancelling again changes nothing; a new login can start.
    expect(connections.cancel(login.id).status).toBe("cancelled");
    expect(connections.startLogin("doppler").id).not.toBe(login.id);
  });

  it("reports a login that fails, with what to do by hand", async () => {
    fakes.setMode("login_fail");
    const ended = await settled(connections.startLogin("convex").id);
    expect(ended.status).toBe("failed");
    expect(ended.message).toContain("npx convex login");
  });

  it("stops every login when the server closes", async () => {
    fakes.setMode("login_hang");
    await waiting(connections.startLogin("convex").id);
    const pid = fakes.pid("npx") as number;
    connections.dispose();
    await waitUntil(() => (isAlive(pid) ? undefined : true));
  });

  it("never accepts a link on another host as the sign-in page", () => {
    const read = (text: string) =>
      (
        connections as unknown as { commands: Record<string, { readLogin(o: string): unknown }> }
      ).commands.convex?.readLogin(text);
    expect(read("Visit https://convex.dev.evil.test/x to finish")).toMatchObject({ url: null });
    expect(read("Visit http://auth.convex.dev/x to finish")).toMatchObject({ url: null });
    expect(read("Visit https://auth.convex.dev/x. Bye")).toMatchObject({
      url: "https://auth.convex.dev/x",
    });
  });
});

describe("the Connections routes are for this computer only", () => {
  const calls: string[] = [];
  const stub = {
    connections: {
      states: async (services: string[]) => {
        calls.push(`states:${services.join(",")}`);
        return [];
      },
      startLogin: (s: string) => {
        calls.push(`login:${s}`);
        return { id: "l1", service: s, status: "starting", url: null, code: null, message: "" };
      },
      login: (id: string) => ({
        id,
        service: "convex",
        status: "waiting",
        url: null,
        code: null,
        message: "",
      }),
      cancel: (id: string) => ({
        id,
        service: "convex",
        status: "cancelled",
        url: null,
        code: null,
        message: "",
      }),
    },
  };
  const app = new Hono()
    .onError((e, c) => errorResponse(e, c))
    .route("/", secureFoundationRoutes({ secureFoundation: stub } as unknown as AppServices));
  const from = (remoteAddress: string) => ({ incoming: { socket: { remoteAddress } } });
  const ROUTES: Array<[string, string]> = [
    ["GET", "/connections?services=convex,doppler"],
    ["POST", "/connections/convex/login"],
    ["GET", "/connections/logins/l1"],
    ["DELETE", "/connections/logins/l1"],
  ];

  it.each(ROUTES)("%s %s is refused to another device and starts nothing", async (method, path) => {
    const before = calls.length;
    const res = await app.request(path, { method }, from("192.168.1.20"));
    expect(res.status).toBe(403);
    expect(calls.length).toBe(before);
  });

  it.each(ROUTES)("%s %s works on this computer", async (method, path) => {
    const res = await app.request(path, { method }, from("127.0.0.1"));
    expect(res.status).toBeLessThan(300);
  });

  it("refuses a service it doesn't know, and a list with one", async () => {
    const local = from("127.0.0.1");
    expect((await app.request("/connections/github/login", { method: "POST" }, local)).status).toBe(
      403,
    );
    expect((await app.request("/connections?services=convex,ssh", {}, local)).status).toBe(400);
    expect((await app.request("/connections", {}, local)).status).toBe(400);
  });
});
