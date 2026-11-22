// Screenshots of the project Permissions notice against a real server + runner (Fake provider,
// isolated empty home). Run from the repository root: node .audit/shots.mjs
import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const require = createRequire(join(root, "apps/web/package.json"));
const { chromium } = require("@playwright/test");

const base = join(root, ".audit/run");
rmSync(base, { recursive: true, force: true });
const out = join(root, ".audit/evidence");
mkdirSync(out, { recursive: true });
for (const d of ["home", "user-home", "xdg"]) mkdirSync(join(base, d), { recursive: true });

const repo = join(base, "demo-repo");
const git = (...a) => execFileSync("git", a, { cwd: repo, stdio: "ignore" });
execFileSync("git", ["init", "-q", "-b", "main", repo], { stdio: "ignore" });
git("config", "user.email", "e2e@codeden.test");
git("config", "user.name", "CodeDen E2E");
writeFileSync(join(repo, "README.md"), "# Demo repo\n");
git("add", ".");
git("commit", "-q", "-m", "Initial commit");

const nodeBin = resolve(process.execPath, "..");
const child = spawn(
  process.execPath,
  ["--import", "tsx", "apps/web/e2e/support/start-server.ts", "--home", join(base, "home"),
    "--user-home", join(base, "user-home"), "--port", "0", "--exit-with-stdin", "--no-path-refresh"],
  {
    cwd: root,
    stdio: ["pipe", "pipe", "pipe"],
    env: {
      PATH: `${nodeBin}:/usr/bin:/bin:/usr/sbin:/sbin`,
      HOME: join(base, "user-home"),
      CODEDEN_HOME: join(base, "home"),
      CODEDEN_UPDATE_CHECK: "0",
      XDG_DATA_HOME: join(base, "xdg/data"),
      XDG_CONFIG_HOME: join(base, "xdg/config"),
      XDG_STATE_HOME: join(base, "xdg/state"),
      XDG_CACHE_HOME: join(base, "xdg/cache"),
    },
  },
);
let logText = "";
const ready = await new Promise((done, fail) => {
  const timer = setTimeout(() => fail(new Error(`no start:\n${logText}`)), 90_000);
  const on = (c) => {
    logText += c.toString();
    const line = logText.split(/\r?\n/).find((l) => l.startsWith("CODEDEN_E2E_READY "));
    if (line) {
      clearTimeout(timer);
      done(JSON.parse(line.slice("CODEDEN_E2E_READY ".length)));
    }
  };
  child.stdout.on("data", on);
  child.stderr.on("data", on);
});

const api = async (method, path, body) => {
  const res = await fetch(`${ready.url}/api${path}`, {
    method,
    headers: { authorization: `Bearer ${ready.token}`, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${JSON.stringify(json)}`);
  return json;
};
const until = async (probe, ms = 60_000) => {
  const end = Date.now() + ms;
  for (;;) {
    const v = await probe();
    if (v) return v;
    if (Date.now() > end) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 100));
  }
};
const statusOf = async (id) => (await api("GET", `/sessions/${id}`)).session.status;
const start = async (title, text, extra = {}) => {
  const r = await api("POST", "/sessions", {
    projectId, provider: "fake", purpose: title, title, input: { text }, ...extra,
  });
  if (r.status !== "started") throw new Error(`not started: ${r.status}`);
  return r.sessionId;
};

let projectId;
let browser;
const lines = [];
const note = (l) => {
  lines.push(l);
  console.log(l);
};
try {
  const providers = (await api("GET", "/snapshot")).runner?.providers ?? [];
  note(`providers the runner loaded: ${providers.map((p) => p.id).join(", ")}`);
  projectId = (await api("POST", "/projects", { source: { type: "local", path: repo } })).project.id;
  await api("PATCH", `/projects/${projectId}`, { autonomy: "supervised" });

  // A: created on Supervised, waiting on an approval when the project changes.
  const a = await start("Refactor the parser", "Refactor the parser [approval]");
  await until(async () => (await statusOf(a)) === "waiting");
  // K: a session whose level was picked when it was started.
  const k = await start("Update the docs", "Update the docs", { autonomy: "auto" });
  await until(async () => (await statusOf(k)) === "idle");

  browser = await chromium.launch({ channel: "chrome" });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.goto(ready.launchUrl);
  await page.waitForLoadState("networkidle");
  const settings = async (file, expectNotice) => {
    await page.goto(`${ready.url}/projects/${projectId}?tab=settings`);
    await page.getByText("What new sessions start with", { exact: false }).waitFor();
    const notice = page.getByTestId("sessions-keeping-level");
    if (expectNotice) await notice.waitFor();
    else await page.waitForTimeout(1500);
    const text = (await notice.count()) ? (await notice.innerText()).replace(/\s+/g, " ") : "(no notice)";
    await page.screenshot({ path: join(out, file) });
    note(`${file}: notice = ${text}`);
    return text;
  };

  // 1. Project on Supervised; A is on Supervised, K on Auto.
  await settings("01-settings-supervised-one-on-another-level.png", true);

  // 2. Change the project to Full in the Settings tab while A is still waiting.
  await page.getByRole("radio", { name: "Full" }).or(page.getByRole("button", { name: "Full" })).first().click();
  await until(async () => (await api("GET", `/projects/${projectId}`)).autonomy === "full");
  note(`project level after the click: ${(await api("GET", `/projects/${projectId}`)).autonomy}; A is ${await statusOf(a)}`);
  await page.getByText("2 open sessions are on another level", { exact: false }).waitFor();
  await settings("02-settings-changed-to-full-while-session-waits.png", true);

  // 3. A still waits on its approval at Supervised.
  await page.goto(`${ready.url}/sessions/${a}`);
  await page.getByText("Scripted approval", { exact: false }).first().waitFor();
  await page.waitForTimeout(800);
  await page.screenshot({ path: join(out, "03-running-session-still-supervised-still-asks.png") });
  note(`03: session A level=${(await api("GET", `/sessions/${a}`)).session.autonomy} status=${await statusOf(a)}`);

  // 4. A new session takes the project's level and runs the same command without asking.
  const b = await start("Add the changelog entry", "Add the changelog entry [approval]");
  await until(async () => (await statusOf(b)) === "idle");
  await page.goto(`${ready.url}/sessions/${b}`);
  await page.getByText("echo hello", { exact: false }).first().waitFor();
  await page.waitForTimeout(800);
  await page.screenshot({ path: join(out, "04-new-session-full-runs-without-asking.png") });
  note(`04: session B level=${(await api("GET", `/sessions/${b}`)).session.autonomy} status=${await statusOf(b)}`);

  // 5. Settings still names A and K, not B.
  await settings("05-settings-new-session-not-listed.png", true);

  // 6. Change A's own level to Full (what its Permissions picker sends); the notice drops it.
  await api("PATCH", `/sessions/${a}`, { autonomy: "full" });
  await page.getByText("1 open session is on another level", { exact: false }).waitFor();
  await settings("06-settings-after-session-level-changed.png", true);

  // 7. K too: nothing left to name.
  await api("PATCH", `/sessions/${k}`, { autonomy: "full" });
  await settings("07-settings-no-notice-when-all-match.png", false);
  writeFileSync(join(out, "screenshots.txt"), `${lines.join("\n")}\n`);
} finally {
  await browser?.close();
  if (ready) {
    await fetch(`${ready.url}/api/shutdown`, {
      method: "POST",
      headers: { authorization: `Bearer ${ready.token}`, "content-type": "application/json" },
      body: JSON.stringify({ stopRunner: true }),
    }).catch(() => undefined);
  }
  child.stdin.end();
  await new Promise((r) => setTimeout(r, 3000));
  child.kill();
}
