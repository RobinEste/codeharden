/**
 * Audit run for the project permission level (not part of the suite): a real server and runner
 * process with the Fake provider and an isolated home. The Fake provider asks for approval when
 * a prompt holds `[approval]` unless the session's level in the runner is Full, so "asked" /
 * "ran without asking" shows the level the runner's provider session holds.
 */
import { appendFileSync, writeFileSync } from "node:fs";
import {
  RoleMessageResponse,
  RunAutomationResponse,
  StartSessionResponse,
  ThreadItemsPage,
} from "@codeden/contracts";
import { afterAll, beforeAll, expect, it } from "vitest";
import { type Harness, startHarness, waitUntil } from "./support/harness";

const OUT = process.env.AUDIT_OUT ?? "audit-583.txt";
const log = (line = "") => appendFileSync(OUT, `${line}\n`);

let h: Harness;
beforeAll(async () => {
  writeFileSync(OUT, "");
  h = await startHarness();
});
afterAll(async () => {
  await h?.close();
});

const level = async (id: string) => (await h.detail(id)).session.autonomy;
const status = async (id: string) => (await h.detail(id)).session.status;
const settled = (id: string) =>
  waitUntil(async () => {
    const s = await status(id);
    return s === "waiting" || s === "idle" || s === "stopped" ? s : undefined;
  });
const items = async (id: string) => {
  const d = await h.detail(id);
  if (!d.session.rootThreadId) return [];
  const res = await h.api(
    "GET",
    `/sessions/${id}/threads/${d.session.rootThreadId}/items?limit=500`,
  );
  return ThreadItemsPage.parse(res.body).items.map((r) => r.item);
};
/**
 * Send `[approval]` and report whether the runner's session asked. Denies what it asked. A
 * resumed session shows a new thread, so only the items after this message count.
 */
const probe = async (id: string, label: string) => {
  // A first turn that is still asking (a fork or hand-off repeats its source's text) is answered first.
  if ((await settled(id)) === "waiting") await deny(id);
  await h.api("POST", `/sessions/${id}/messages`, { input: { text: `${label} [approval]` } });
  const asked = await waitUntil(async () => {
    const all = await items(id);
    const at = all.findLastIndex(
      (i) => i.kind === "user_message" && JSON.stringify(i).includes(label),
    );
    if (at < 0) return undefined;
    const after = all.slice(at).map((i) => i.kind);
    const s = await status(id);
    if (s === "waiting" && after.includes("approval_request")) return "asked";
    if (s === "idle" && after.includes("tool_call") && !after.includes("approval_request"))
      return "ran";
    return undefined;
  });
  if (asked === "asked") await deny(id);
  return asked === "asked";
};
const deny = async (id: string) => {
  const open = (await items(id)).findLast((i) => i.kind === "approval_request");
  if (!open || open.kind !== "approval_request") throw new Error("no approval to deny");
  await h.api("POST", `/sessions/${id}/respond`, {
    requestId: open.requestId,
    response: { kind: "approval", decision: "deny" },
  });
  await waitUntil(async () => ((await status(id)) === "idle" ? true : undefined));
};
const row = async (name: string, id: string, asked: boolean | string) =>
  log(
    `${name.padEnd(58)} level=${(await level(id)).padEnd(10)} ${
      typeof asked === "string" ? asked : asked ? "ASKED for approval" : "ran WITHOUT asking"
    }`,
  );
const start = async (body: Record<string, unknown>) => {
  const res = StartSessionResponse.parse(
    (await h.api("POST", "/sessions", { projectId: h.projectId, provider: "fake", ...body })).body,
  );
  if (res.status !== "started") throw new Error(`not started: ${res.status}`);
  return res.sessionId;
};
const project = async () =>
  (await h.api("GET", `/projects/${h.projectId}`)).body as { autonomy: string; autonomyMode: string };

it("a project's level reaches only sessions created afterwards", async () => {
  const tool = (role: "orchestrator" | "pm", name: string, args: unknown, sessionId: string) =>
    h.server.services.tools.call(name, args, {
      role,
      sessionId,
      projectId: role === "pm" ? h.projectId : null,
      caller: "mcp",
      signal: new AbortController().signal,
    });

  // 1. The project starts on Supervised.
  await h.api("PATCH", `/projects/${h.projectId}`, { autonomy: "supervised" });
  let p = await project();
  log(`STEP 1  project level=${p.autonomy}  autonomy mode=${p.autonomyMode}`);
  expect(p.autonomy).toBe("supervised");

  // 2. Session A starts with no level of its own and waits on an approval (it is running).
  const a = await start({ purpose: "A: running while the project changes", input: { text: "go [approval]" } });
  await waitUntil(async () => ((await status(a)) === "waiting" ? true : undefined));
  const stoppedLater = await start({ purpose: "S: stopped, resumed later", input: { text: "hello" } });
  await waitUntil(async () => ((await status(stoppedLater)) === "idle" ? true : undefined));
  log(`STEP 2  session A created, status=${await status(a)} (waiting on an approval), level=${await level(a)}`);
  expect(await level(a)).toBe("supervised");

  // 3. The orchestrator changes the project to Full while A is still waiting.
  const orch = RoleMessageResponse.parse(
    (await h.api("POST", "/orchestration/orchestrator/messages", { input: { text: "hello" } })).body,
  ).sessionId;
  const updated = await tool("orchestrator", "update_project", { projectId: h.projectId, autonomy: "full" }, orch);
  expect(updated.isError).toBeFalsy();
  const result = JSON.parse(updated.text) as { project: { autonomy: string; autonomyMode: string }; note?: string };
  p = await project();
  log(`STEP 3  update_project {autonomy:"full"} while A waits -> project level=${p.autonomy}, autonomy mode=${p.autonomyMode}`);
  log(`        update_project result note: ${JSON.stringify(result.note)}`);
  const unrelated = JSON.parse(
    (await tool("orchestrator", "update_project", { projectId: h.projectId, timezone: "UTC" }, orch)).text,
  ) as { note?: string };
  log(`        update_project {timezone} (level untouched) note: ${JSON.stringify(unrelated.note ?? null)}`);
  expect(p.autonomy).toBe("full");
  expect(p.autonomyMode).toBe("assisted");

  log();
  log("STEP 4  what each session runs with, project level now = full");
  // A: still waiting on the same approval, still supervised; its next command asks again.
  expect(await status(a)).toBe("waiting");
  await deny(a);
  const aAsked = await probe(a, "A again");
  await row("A  running when the project changed", a, aAsked);
  expect(aAsked).toBe(true);

  // A resumed after a stop: keeps its own level.
  await h.api("POST", `/sessions/${stoppedLater}/stop`);
  await waitUntil(async () => ((await status(stoppedLater)) === "stopped" ? true : undefined));
  const sAsked = await probe(stoppedLater, "S resumed");
  await row("S  stopped before, resumed after the change", stoppedLater, sAsked);
  expect(sAsked).toBe(true);

  // New session by the user: takes the project's level.
  const b = await start({ purpose: "B: new after the change", input: { text: "hello" } });
  await waitUntil(async () => ((await status(b)) === "idle" ? true : undefined));
  const bAsked = await probe(b, "B");
  await row("B  new session (user), no level picked", b, bAsked);
  expect(bAsked).toBe(false);

  // New session with a level picked in the request: the request wins.
  const c = await start({ purpose: "C: new, level picked", autonomy: "supervised", input: { text: "hello" } });
  await waitUntil(async () => ((await status(c)) === "idle" ? true : undefined));
  await row("C  new session (user), Supervised picked in the draft", c, await probe(c, "C"));

  // PM start_session: no level of its own, takes the project's.
  const pm = RoleMessageResponse.parse(
    (await h.api("POST", `/orchestration/projects/${h.projectId}/pm/messages`, { input: { text: "hello pm" } })).body,
  ).sessionId;
  const pmStart = JSON.parse(
    (await tool("pm", "start_session", { prompt: "do the work", purpose: "D: started by the PM", provider: "fake" }, pm)).text,
  ) as { status: string; sessionId: string };
  expect(pmStart.status).toBe("started");
  await waitUntil(async () => ((await status(pmStart.sessionId)) === "idle" ? true : undefined));
  await row("D  new session started by the PM (start_session)", pmStart.sessionId, await probe(pmStart.sessionId, "D"));

  // Fork and hand-off of A: the source's level, not the project's.
  const fork = ((await h.api("POST", `/sessions/${a}/fork`, {})).body as { sessionId: string }).sessionId;
  await settled(fork);
  await row("E  fork of A", fork, await probe(fork, "E"));
  const handoff = ((await h.api("POST", `/sessions/${a}/handoff`, { provider: "fake" })).body as { sessionId: string }).sessionId;
  await settled(handoff);
  await row("F  hand-off of A", handoff, await probe(handoff, "F"));

  // Review of B (a Full session): always read-only.
  const review = ((await h.api("POST", `/sessions/${b}/review`, { provider: "fake" })).body as { sessionId: string }).sessionId;
  await settled(review);
  await row("G  review of B", review, "(read-only: the Fake provider runs no command)");
  expect(await level(review)).toBe("read_only");

  // Automations: one that names no level, one that names Supervised; run by the user.
  const automation = async (name: string, extra: Record<string, unknown>) => {
    const made = await h.api("POST", "/automations", {
      projectId: h.projectId,
      name,
      trigger: { type: "manual" },
      action: { type: "start_session", prompt: "hello", provider: "fake", ...extra },
    });
    const id = (made.body as { automation: { id: string } }).automation.id;
    const run = RunAutomationResponse.parse(
      (await h.api("POST", `/automations/${id}/run`, { projectId: h.projectId })).body,
    );
    if (run.status !== "started" || !run.sessionId) throw new Error(`automation: ${run.status}`);
    await waitUntil(async () => ((await status(run.sessionId as string)) === "idle" ? true : undefined));
    return run.sessionId;
  };
  const h1 = await automation("No level", {});
  await row("H  automation run, automation names no level", h1, await probe(h1, "H"));
  const h2 = await automation("Supervised", { autonomy: "supervised" });
  await row("I  automation run, automation names Supervised", h2, await probe(h2, "I"));

  log();
  log("STEP 5  changing a session's own level (PATCH /api/sessions/:id, the Permissions picker)");
  // A while it runs: applies to the live provider session.
  await h.api("PATCH", `/sessions/${a}`, { autonomy: "full" });
  await row("A  after its own level is set to Full while it is open", a, await probe(a, "A full"));
  // S stopped, level changed, then resumed: the resume opens it at the new level.
  await h.api("POST", `/sessions/${stoppedLater}/stop`);
  await waitUntil(async () => ((await status(stoppedLater)) === "stopped" ? true : undefined));
  await h.api("PATCH", `/sessions/${stoppedLater}`, { autonomy: "full" });
  const sFull = await probe(stoppedLater, "S full");
  await row("S  stopped, own level set to Full, then resumed", stoppedLater, sFull);
  expect(sFull).toBe(false);

  log();
  log("STEP 6  the project goes back to Supervised; sessions created at Full keep Full");
  await h.api("PATCH", `/projects/${h.projectId}`, { autonomy: "supervised" });
  log(`        project level=${(await project()).autonomy}`);
  const bStill = await probe(b, "B after");
  await row("B  created when the project was Full", b, bStill);
  expect(bStill).toBe(false);
  const n = await start({ purpose: "N: new after the second change", input: { text: "hello" } });
  await waitUntil(async () => ((await status(n)) === "idle" ? true : undefined));
  const nAsked = await probe(n, "N");
  await row("N  new session after the change back", n, nAsked);
  expect(nAsked).toBe(true);
});
