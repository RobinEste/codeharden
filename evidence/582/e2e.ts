/**
 * End-to-end check for PR #582: a real server (as `pnpm dev` starts it: Fake provider on) and its
 * real runner process, in an isolated empty home, with an MCP client connected through the
 * runner's local MCP proxy, as a PM's agent is. Prints a JSON transcript on stdout.
 *
 * Run from apps/server:  HOME=<empty dir> tsx audit582/e2e.ts <work dir>
 * The PM and orchestrator bearer tokens are minted from the server's token store, because a role
 * session's own token never leaves its provider process.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { startServer } from "../src/server";

const work = resolve(process.argv[2] ?? "audit582-work");
const TOKEN = "d".repeat(64);
const repo = join(work, "repo");
mkdirSync(repo, { recursive: true });
const git = (...args: string[]) => execFileSync("git", ["-C", repo, ...args], { stdio: "pipe" });
git("init", "-q", "-b", "main");
git("config", "user.email", "test@example.com");
git("config", "user.name", "Test");
writeFileSync(join(repo, "README.md"), "# test\n");
git("add", ".");
git("commit", "-q", "-m", "init");

const logs: string[] = [];
const server = await startServer({
  port: 0,
  dataDir: join(work, "data"),
  token: TOKEN,
  enableFakeProvider: true,
  waitForRunner: true,
  secrets: "memory",
  checkSetupOnStart: false,
  log: (m) => logs.push(m),
});

const out: Record<string, unknown> = {};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until<T>(probe: () => Promise<T | undefined> | T | undefined, ms = 60_000) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await probe();
    if (v !== undefined) return v;
    if (Date.now() > end) throw new Error("timed out");
    await sleep(100);
  }
}
const api = async (method: string, path: string, body?: unknown) => {
  const res = await fetch(`${server.url}/api${path}`, {
    method,
    headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as any };
};
async function connect(bearer: string): Promise<Client> {
  const url = await until(() => server.runner?.mcpProxyUrl ?? undefined);
  const client = new Client({ name: "audit-582", version: "0.0.0" });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(url), {
      requestInit: { headers: { Authorization: `Bearer ${bearer}` } },
    }),
  );
  return client;
}
const param = (tools: Awaited<ReturnType<Client["listTools"]>>["tools"], tool: string, p: string) =>
  (tools.find((t) => t.name === tool)?.inputSchema.properties as Record<string, unknown>)?.[p];
const text = (r: Awaited<ReturnType<Client["callTool"]>>) => ({
  isError: r.isError ?? false,
  text: (r.content as Array<{ type: string; text: string }>)[0]?.text ?? "",
});

try {
  const project = (await api("POST", "/projects", { source: { type: "local", path: repo } })).body
    .project;
  out.runner = {
    connected: server.services.runner.isConnected(),
    loadedProviders: server.services.runner.providers().map((p) => `${p.id} (${p.displayName})`),
  };

  // A PM's MCP client, through the runner's proxy.
  const pm = await connect(
    server.services.mcpTokens.mint({ role: "pm", sessionId: "pm-session", projectId: project.id }),
  );
  let t0 = Date.now();
  const first = (await pm.listTools()).tools;
  out.pmFirstListMs = Date.now() - t0;
  out.pmStartSessionProvider = param(first, "start_session", "provider");
  t0 = Date.now();
  const second = (await pm.listTools()).tools;
  out.pmSecondListMs = Date.now() - t0;
  out.pmSecondListSameText =
    JSON.stringify(param(second, "start_session", "provider")) ===
    JSON.stringify(out.pmStartSessionProvider);

  // What detection said, without the private fields (path, account).
  const detect = await server.services.runner.request(
    { name: "provider.detect", refreshModels: false },
    60_000,
  );
  out.detected = detect.statuses.map((s) => ({
    providerId: s.providerId,
    installed: s.installed,
    version: s.version,
    loggedIn: s.loggedIn,
    supported: s.supported,
    issues: s.issues.map((i) => ({ code: i.code, fix: i.fix?.command, minVersion: i.minVersion })),
    executablePath: s.executablePath === null ? null : "<redacted>",
    account: s.account === null ? null : "<redacted>",
  }));

  const start = (args: Record<string, unknown>) =>
    pm.callTool({
      name: "start_session",
      arguments: { prompt: "Say hello", purpose: "audit 582", ...args },
    });

  // 1. An id that isn't loaded is refused.
  out.refusalUnknownId = text(await start({ provider: "antigravity", workKey: "request:a" }));

  // 2. A loaded provider that is ready starts.
  const ok = text(await start({ provider: "fake", workKey: "request:b" }));
  out.startOnReady = ok;

  // 3. A loaded provider that isn't ready: what a PM gets back, and what becomes of the session.
  // (Upstream main has no `providerChoices`: the script also runs there for the "before".)
  const factory = server.services.factory as { providerChoices?: () => Promise<any[]> };
  const choices: any[] = (await factory.providerChoices?.()) ?? [];
  out.choices = choices.map((c) => ({
    id: c.id,
    name: c.name,
    checked: c.checked,
    runnable: c.runnable,
    reason: c.reason,
    until: c.until,
    fix: c.fix,
  }));
  const notReady = choices.filter((c) => !c.runnable);
  const attempts: unknown[] = [];
  for (const c of notReady) {
    const res = text(await start({ provider: c.id, workKey: `request:nr-${c.id}` }));
    let session: unknown = null;
    try {
      const id = JSON.parse(res.text).sessionId as string | undefined;
      if (id) {
        const done = await until(async () => {
          const s = (await api("GET", `/sessions/${id}`)).body.session;
          return s.status === "failed" || s.status === "idle" || s.status === "completed"
            ? s
            : undefined;
        }, 90_000).catch(() => null);
        const s = done ?? (await api("GET", `/sessions/${id}`)).body.session;
        const repo = server.services.sessionRepo;
        const lastTurn = repo.rootTurnIds(s).at(-1);
        const turn = lastTurn ? repo.turn(id, lastTurn) : undefined;
        session = {
          provider: s.provider,
          status: s.status,
          lastTurn: turn
            ? {
                status: turn.status,
                error: turn.error
                  ? { kind: turn.error.kind, message: turn.error.message.split(", url")[0] }
                  : null,
              }
            : null,
          startError: s.startError
            ? { kind: s.startError.kind, message: String(s.startError.message) }
            : null,
        };
      }
    } catch {}
    attempts.push({ provider: c.id, listedAs: c.reason, result: res, session });
  }
  out.startOnNotReady = attempts;

  // The orchestrator's tools.
  const orch = await connect(
    server.services.mcpTokens.mint({ role: "orchestrator", sessionId: "orch", projectId: null }),
  );
  const orchTools = (await orch.listTools()).tools;
  out.createProjectDefaultProvider = param(orchTools, "create_project", "defaultProvider");
  out.updateProjectDefaultProvider = param(orchTools, "update_project", "defaultProvider");
  // An id that isn't loaded, as a project's default provider.
  out.updateProjectUnknownId = text(
    await orch.callTool({
      name: "update_project",
      arguments: { projectId: project.id, defaultProvider: "antigravity" },
    }),
  );
  // ... and what a session started without `provider` then runs on.
  const fallback = text(await start({ workKey: "request:c" }));
  out.startWithUnloadedProjectDefault = fallback;
  try {
    const id = JSON.parse(fallback.text).sessionId as string;
    out.startWithUnloadedProjectDefaultRanOn = (await api("GET", `/sessions/${id}`)).body.session
      .provider;
  } catch {}

  // Not a string enum, and other tools are untouched.
  out.pmToolCount = first.length;
  out.orchestratorToolCount = orchTools.length;
  await pm.close();
  await orch.close();
} catch (error) {
  out.error = error instanceof Error ? (error.stack ?? error.message) : String(error);
} finally {
  out.serverLog = logs.filter((l) => /describing its input|provider detection/.test(l));
  await server.close({ stopRunner: true });
}
// Nothing private leaves this script: home and work paths become placeholders.
const home = process.env.HOME ?? "";
let json = JSON.stringify(out, null, 2).split(work).join("<work>");
if (home) json = json.split(home).join("<home>");
console.log(json);
process.exit(0);
