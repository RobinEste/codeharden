/**
 * End-to-end check of role sessions moving provider, on a real server and a real runner
 * process (the repository's own `startServer`, as `pnpm dev` runs it), with an empty home so
 * that the Fake provider is the only one that can run a turn.
 *
 * REPO: the checkout to run. BASE: scratch folder (home, project). OUT: log file. UI: optional
 * origin of a Vite dev server to allow.
 */
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const REPO = process.env.REPO as string;
const BASE = process.env.BASE as string;
const OUT = process.env.OUT as string;
const UI = process.env.UI;
const PORT = Number(process.env.PORT ?? 0);

const { startServer } = (await import(`${REPO}/apps/server/src/server.ts`)) as {
  // biome-ignore lint/suspicious/noExplicitAny: a script against two versions of the server
  startServer: (options: Record<string, unknown>) => Promise<any>;
};

writeFileSync(OUT, "");
const log = (line = "") => {
  appendFileSync(OUT, `${line}\n`);
  console.log(line);
};

const home = join(BASE, "home");
const projectDir = join(BASE, "demo");
mkdirSync(home, { recursive: true });
mkdirSync(projectDir, { recursive: true });
const git = (...args: string[]) =>
  execFileSync("/usr/bin/git", args, {
    cwd: projectDir,
    env: {
      PATH: "/usr/bin:/bin",
      HOME: process.env.HOME,
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_CONFIG_SYSTEM: "/dev/null",
      GIT_AUTHOR_NAME: "demo",
      GIT_AUTHOR_EMAIL: "demo@example.invalid",
      GIT_COMMITTER_NAME: "demo",
      GIT_COMMITTER_EMAIL: "demo@example.invalid",
    },
  });
git("init", "-q", "-b", "main");
writeFileSync(join(projectDir, "README.md"), "# demo\n");
git("add", ".");
git("commit", "-q", "-m", "init");

// With a UI attached, the token is the one Vite's proxy reads from the (scratch) home.
const token = UI
  ? await (async () => {
      const paths = await import(`${REPO}/apps/server/src/paths.ts`);
      const tokens = await import(`${REPO}/apps/server/src/token.ts`);
      return tokens.ensureInstallToken(paths.ensureHome(home).token) as string;
    })()
  : randomBytes(32).toString("hex");
const hold = async (name: string, info: Record<string, unknown>) => {
  if (process.env.HOLD !== name) return;
  const { existsSync } = await import("node:fs");
  writeFileSync(join(BASE, "ui.json"), JSON.stringify(info));
  writeFileSync(join(BASE, "hold"), "");
  while (existsSync(join(BASE, "hold"))) await new Promise((done) => setTimeout(done, 300));
};
const server = await startServer({
  port: PORT,
  dataDir: home,
  token,
  enableFakeProvider: true,
  secrets: "memory",
  waitForRunner: true,
  allowedOrigins: UI ? [UI] : [],
  log: () => {},
});
const services = server.services;

interface Res {
  status: number;
  // biome-ignore lint/suspicious/noExplicitAny: JSON
  body: any;
  ms: number;
}
const api = async (method: string, path: string, body?: unknown): Promise<Res> => {
  const started = performance.now();
  const res = await fetch(`${server.url}/api${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  const ms = Math.round(performance.now() - started);
  let parsed: unknown = text;
  try {
    parsed = JSON.parse(text);
  } catch {}
  return { status: res.status, body: parsed, ms };
};
const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));
const until = async <T>(
  what: string,
  check: () => Promise<T | undefined | false>,
  waitMs = 90_000,
): Promise<T> => {
  const deadline = Date.now() + waitMs;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await sleep(100);
  }
};

const short = (id: string | null | undefined) => (id ? id.slice(0, 8) : "null");
const names = new Map<string, string>();
/** Paths and ids never reach the log: the scratch folder shows as <base>. */
const ROOT = import.meta.dirname.replace(/\/\.scratch\/e2e$/, "");
const clean = (text: string) =>
  text.split(BASE).join("<base>").split(REPO).join("<repo>").split(ROOT).join("<worktree>");
/** The status digest CodeDen puts in front of a role's turn is left out. */
const own = (text: string) => text.replace(/<codeden_status[\s\S]*?<\/codeden_status>\s*/g, "");
const oneLine = (text: string, max = 110) => {
  const flat = clean(own(text)).replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
};

// biome-ignore lint/suspicious/noExplicitAny: JSON
type Any = any;
/** Every orchestrator and PM session, retired ones included (read from the database). */
const everyRoleSession = (): Any[] => {
  const ids: string[] = [...services.orchestration.roles.roleSessionIds()];
  return ids
    .map((id) => services.sessionRepo.get(id))
    .sort((a: Any, b: Any) => a.createdAt.localeCompare(b.createdAt));
};

const state = async (title: string) => {
  log(`## ${title}`);
  const settings = (await api("GET", "/settings")).body;
  const roles = (await api("GET", "/orchestration/roles")).body;
  log(
    `settings.providers: ${JSON.stringify({
      orchestrator: settings.providers.orchestrator.provider,
      pm: settings.providers.pm.provider,
      agent: settings.providers.agent.provider,
    })}`,
  );
  log(
    `roleSessions: orchestrator=${short(roles.orchestrator)} pms=${JSON.stringify(Object.values(roles.pms).map((id) => short(id as string)))}`,
  );
  for (const s of everyRoleSession()) {
    const queue = (await api("GET", `/sessions/${s.id}/queue`)).body.messages as Any[];
    log(
      `  session ${short(s.id)} role=${s.role} provider=${s.provider} status=${s.status} ${s.archivedAt ? "archived" : "live"} queued=${queue.length}`,
    );
    for (const m of queue) log(`      queued from=${m.from}: ${oneLine(m.input.text, 90)}`);
  }
  log();
};

/** The user messages a session's turns started with, and each turn's final reply. */
const transcript = async (sessionId: string) => {
  const detail = (await api("GET", `/sessions/${sessionId}`)).body;
  const thread = detail.session.rootThreadId;
  if (!thread) return log("  (no turns)");
  const items = (await api("GET", `/sessions/${sessionId}/threads/${thread}/items?limit=500`)).body
    .items as Any[];
  for (const record of items) {
    const item = record.item;
    if (item.kind === "user_message") {
      log(
        `  turn ${record.turnId} from=${item.input.from ?? "user"}: ${oneLine(String(item.input.text), 120)}`,
      );
    }
  }
};

const pmSession = async (projectId: string) =>
  (await api("GET", `/orchestration/projects/${projectId}/pm`)).body.session as Any | null;
const liveStatus = (id: string) => services.sessionRepo.get(id).status as string;
const callTool = (name: string, args: unknown, sessionId: string) =>
  services.tools.call(name, args, {
    role: "orchestrator",
    sessionId,
    projectId: null,
    caller: "mcp",
    signal: new AbortController().signal,
  }) as Promise<{ isError: boolean; text: string }>;

const checks: [string, boolean][] = [];
const check = (what: string, ok: boolean) => {
  checks.push([what, ok]);
  log(`${ok ? "PASS" : "FAIL"}: ${what}`);
};

try {
  const head = execFileSync("/usr/bin/git", ["rev-parse", "--short=8", "HEAD"], { cwd: REPO })
    .toString()
    .trim();
  log(`# Role sessions moving provider, end to end (checkout ${head})`);
  log(
    "A real server and runner process (the repository's startServer, as `pnpm dev` runs it), a fresh empty home, one local git project (demo).",
  );
  const setup = await until("the provider checks", async () => {
    const res = await api("GET", "/setup/status");
    return res.status === 200 && res.body.checks?.length ? res.body : undefined;
  });
  log(
    `setup checks: ${(setup.checks as Any[]).map((c) => `${c.id}=${c.state}`).join(" ")}`,
  );
  log(
    "No provider CLI is installed or signed in for this server, so the Fake provider (scripted) is the only one that can run a turn.",
  );
  log(
    "The user's messages and the settings changes go through the HTTP API. The orchestrator's message_pm and ask_pm calls are made through the server's tool registry, where its MCP endpoint hands them: the Fake provider can't call MCP tools itself.",
  );
  log();

  const project = (await api("POST", "/projects", { source: { type: "local", path: projectDir } }))
    .body.project;
  const projectId: string = project.id;
  names.set(projectId, "demo");

  // ------------------------------------------------------------------ A: the queue moves
  log("# A. Queued messages move to the new session, and the settings save returns at once");
  log();
  let res = await api("PATCH", "/settings", { providers: { orchestrator: { provider: "fake" } } });
  res = await api("POST", "/orchestration/orchestrator/messages", {
    input: { text: "hello", attachments: [] },
  });
  const orchestratorId: string = res.body.sessionId;
  await until("the orchestrator's first turn", async () => liveStatus(orchestratorId) === "idle");

  // The PM starts on Auto = Claude Code, which is not installed here. While it is starting,
  // the user's message, a message_pm task and an ask_pm question arrive and wait in its queue.
  const user = api("POST", `/orchestration/projects/${projectId}/pm/messages`, {
    input: { text: "User: please check the README of demo", attachments: [] },
  });
  // The orchestrator's calls are made the moment the PM session exists, while it is starting.
  while (!services.orchestration.roles.find("pm", projectId)) {
    await new Promise((done) => setImmediate(done));
  }
  const task = callTool(
    "message_pm",
    { projectId, text: "Task from the orchestrator: list the open work in demo" },
    orchestratorId,
  );
  const taskResult = await task;
  const askStarted = performance.now();
  const ask = callTool(
    "ask_pm",
    { projectId, question: "Is anything running in demo right now?", timeoutSec: 300 },
    orchestratorId,
  );
  await user;
  log(`message_pm returned: ${oneLine(taskResult.text.replace(/session [0-9a-f-]{36}/, (m) => `session ${short(m.slice(8))}`))}`);
  const oldPm = (await pmSession(projectId)) as Any;
  await until("the PM's failed start", async () => liveStatus(oldPm.id) === "failed");
  await state(
    "A1. The PM started on Claude Code (Auto), which can't run here: its start failed, and three messages wait in its queue; the ask_pm call is waiting for its answer",
  );
  const before = (await api("GET", `/sessions/${oldPm.id}/queue`)).body.messages as Any[];

  const save = await api("PATCH", "/settings", { providers: { pm: { provider: "fake" } } });
  log(
    `PATCH /api/settings {"providers":{"pm":{"provider":"fake"}}} -> ${save.status} in ${save.ms} ms`,
  );
  const atResponse = everyRoleSession().filter((s) => s.role === "pm");
  log(
    `the PM sessions at the moment the response arrived: ${atResponse.map((s) => `${short(s.id)} ${s.provider} ${s.status} ${s.archivedAt ? "archived" : "live"}`).join("; ")}`,
  );
  log();
  const moved = await until(
    "the new PM session",
    async () => {
      const s = await pmSession(projectId);
      return s && s.id !== oldPm.id ? s : undefined;
    },
    15_000,
  ).catch(() => undefined);
  let newPm = moved as Any;
  if (!moved) {
    await state(
      "A2. Project managers set to Fake: the Claude Code session is retired; no new PM session was started within 15 s, and the three messages are in no queue",
    );
    check("three messages were waiting in the old PM session", before.length === 3);
    check("the new PM session ran them in the same order, each with its sender", false);
    const early = await Promise.race([ask, sleep(200).then(() => undefined)]);
    log(
      `ask_pm: ${early ? oneLine(early.text, 200) : "still waiting for an answer (its limit is 300 s); nothing holds its question any more"}`,
    );
    check("the ask_pm call got its answer from the new session instead of timing out", false);
    log();
    // Part B needs a PM on Fake: the next message starts one.
    const next = await api("POST", `/orchestration/projects/${projectId}/pm/messages`, {
      input: { text: "hello", attachments: [] },
    });
    newPm = { id: next.body.sessionId };
    await until("the PM's first turn", async () => liveStatus(newPm.id) === "idle");
  } else {
    await state(
      "A2. Project managers set to Fake: the Claude Code session is retired, and a new PM session on Fake was started at once with the three messages (no new message was sent)",
    );
    const askResult = await ask;
    const askMs = Math.round(performance.now() - askStarted);
    await until("the new PM to finish", async () => {
      const queue = (await api("GET", `/sessions/${newPm.id}/queue`)).body.messages as Any[];
      return queue.length === 0 && liveStatus(newPm.id) === "idle";
    });
    await state("A3. The new PM ran the three messages, one turn each, in the order they were sent");
    log(`turns of the new PM session ${short(newPm.id)}:`);
    await transcript(newPm.id);
    log();
    log(`ask_pm returned after ${askMs} ms (its limit was 300 s): isError=${askResult.isError}`);
    log(`  ${oneLine(askResult.text, 260)}`);
    log();

    const turns = (
      (await api("GET", `/sessions/${newPm.id}/threads/${(await api("GET", `/sessions/${newPm.id}`)).body.session.rootThreadId}/items?limit=500`))
        .body.items as Any[]
    )
      .filter((r) => r.item.kind === "user_message")
      .map((r) => ({ from: r.item.input.from ?? "user", text: String(r.item.input.text) }));
    check("three messages were waiting in the old PM session", before.length === 3);
    check(
      "the queue held the user's message, the message_pm task and the ask_pm question, in that order",
      before.map((m) => m.from).join() === "user,orchestrator,orchestrator" &&
        before[1]?.input.text.includes("list the open work") &&
        before[2]?.input.text.includes("Is anything running in demo"),
    );
    check(
      "the new PM session ran them in the same order, each with its sender",
      turns.length === before.length &&
        before.every(
          (m, i) => turns[i]?.from === m.from && own(turns[i].text).trim() === m.input.text.trim(),
        ),
    );
    check(
      "the ask_pm call got its answer from the new session instead of timing out",
      !askResult.isError && askResult.text.includes("answered") && askMs < 120_000,
    );
    check("the settings save answered in under a second", save.status === 200 && save.ms < 1000);
    log();
  }
  log();

  if (process.env.HOLD) await api("POST", "/setup/complete");
  await hold("A", { projectId, pm: newPm.id, oldPm: oldPm.id, orchestrator: orchestratorId });

  // ------------------------------------------------------------------ B: concurrent use
  log("# B. Two uses of the PM at the same moment, just after its setting changed");
  log();
  // The PM is waiting on an approval when its setting changes, so the session is left alone.
  await api("POST", `/orchestration/projects/${projectId}/pm/messages`, {
    input: { text: "Run the scripted command [approval]", attachments: [] },
  });
  const approval = await until("the PM's approval request", async () => {
    const inbox = (await api("GET", "/inbox")).body;
    const items: Any[] = Array.isArray(inbox) ? inbox : (inbox.items ?? []);
    return items.find(
      (i) => i.sessionId === newPm.id && i.kind === "approval" && i.status === "open",
    );
  });
  const save2 = await api("PATCH", "/settings", { providers: { pm: { provider: "gemini" } } });
  log(
    `PATCH /api/settings {"providers":{"pm":{"provider":"gemini"}}} -> ${save2.status} in ${save2.ms} ms (the PM is waiting on an approval)`,
  );
  await sleep(500);
  await state(
    "B1. Project managers set to Gemini CLI while the PM (Fake) waits on an approval: the session is left as it is",
  );
  const requestId = approval.requestId ?? approval.request?.id ?? approval.data?.requestId;
  const responded = await api("POST", `/sessions/${newPm.id}/respond`, {
    requestId,
    response: { kind: "approval", decision: "allow_once" },
  });
  if (responded.status >= 300) throw new Error(`respond: ${JSON.stringify(responded.body)}`);
  await until("the PM's turn to end", async () => liveStatus(newPm.id) === "idle");

  // The turn has ended and nothing has retired the session yet. Two messages arrive together.
  const [first, second] = await Promise.all([
    api("POST", `/orchestration/projects/${projectId}/pm/messages`, {
      input: { text: "Concurrent message one", attachments: [] },
    }),
    api("POST", `/orchestration/projects/${projectId}/pm/messages`, {
      input: { text: "Concurrent message two", attachments: [] },
    }),
  ]);
  const show = (r: Res) =>
    r.status === 200
      ? `200 ${JSON.stringify({ sessionId: short(r.body.sessionId), status: r.body.status })}`
      : `${r.status} ${oneLine(JSON.stringify(r.body), 160)}`;
  log(`message one -> ${show(first)}`);
  log(`message two -> ${show(second)}`);
  log();
  await sleep(1500);
  await state(
    "B2. Two PM messages sent at the same moment after that turn ended (Gemini CLI is not installed here, so a session on it fails to start and its messages wait)",
  );
  const livePms = everyRoleSession().filter((s) => s.role === "pm" && !s.archivedAt);
  const geminiQueue = livePms[0]
    ? ((await api("GET", `/sessions/${livePms[0].id}/queue`)).body.messages as Any[])
    : [];
  check("both messages were accepted (no 409)", first.status === 200 && second.status === 200);
  check(
    "both went to the same session",
    first.status === 200 && second.status === 200 && first.body.sessionId === second.body.sessionId,
  );
  check(
    "exactly one live PM session, on the chosen provider",
    livePms.length === 1 && livePms[0].provider === "gemini",
  );
  check("both messages wait in that session's queue", geminiQueue.length === 2);
  log();

  // Back to Fake: the two waiting messages move again and run.
  const save3 = await api("PATCH", "/settings", { providers: { pm: { provider: "fake" } } });
  log(
    `PATCH /api/settings {"providers":{"pm":{"provider":"fake"}}} -> ${save3.status} in ${save3.ms} ms`,
  );
  const lastPm = await until("the PM back on Fake", async () => {
    const s = await pmSession(projectId);
    if (!s || s.provider !== "fake" || s.id === newPm.id) return undefined;
    const queue = (await api("GET", `/sessions/${s.id}/queue`)).body.messages as Any[];
    return queue.length === 0 && liveStatus(s.id) === "idle" ? s : undefined;
  }).catch(() => undefined);
  await state(
    "B3. Project managers set back to Fake: the Gemini CLI session is retired, and its two waiting messages ran in a new PM session on Fake",
  );
  if (lastPm) {
    log(`turns of the PM session ${short(lastPm.id)}:`);
    await transcript(lastPm.id);
    log();
  }
  const finalPms = everyRoleSession().filter((s) => s.role === "pm" && !s.archivedAt);
  check(
    "the two messages ran in the new Fake session, and one PM session is live",
    !!lastPm && finalPms.length === 1,
  );
  check(
    "every settings save answered in under a second",
    [save, save2, save3].every((r) => r.status === 200 && r.ms < 1000),
  );
  log();
  log(
    `# Result: ${checks.filter(([, ok]) => ok).length} of ${checks.length} checks passed`,
  );

} catch (error) {
  log(`ERROR: ${clean(String((error as Error)?.stack ?? error))}`);
  process.exitCode = 1;
} finally {
  await server.close({ stopRunner: true }).catch(() => undefined);
  process.exit(process.exitCode ?? 0);
}
