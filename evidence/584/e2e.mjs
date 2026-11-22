// PR #584 end to end: a real CodeDen server and runner (isolated empty home, the real Claude
// Code and Codex adapters) looking for fake `claude` / `codex` executables. An old copy of each
// is first on PATH (a stand-in for /usr/local/bin); in the "both" case a supported copy sits in
// the known location ~/.local/bin of the stand-in home. No real CLI runs and nothing leaves
// 127.0.0.1: the server and its runner are started under a macOS sandbox profile that refuses
// every other connection and hides /usr/local and /opt/homebrew.
//
//   node e2e.mjs <checkout root> <label> <both|old-only> <output folder>
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fake } from "./fakes.mjs";

const [rootArg, label, scenario, outArg] = process.argv.slice(2);
const root = resolve(rootArg);
const out = resolve(outArg);
mkdirSync(out, { recursive: true });
const name = `${label}-${scenario}`;

// The files live in the checkout; a short link keeps the paths the product reports readable.
const real = join(import.meta.dirname, "run", name);
rmSync(real, { recursive: true, force: true });
mkdirSync(real, { recursive: true });
const base = `/tmp/cd584-${name}`;
rmSync(base, { force: true });
symlinkSync(real, base);

const userHome = join(base, "home");
const oldBin = join(base, "usr-local-bin");
const log = join(base, "calls.log");
for (const d of ["codeden-home", "home", "xdg"]) mkdirSync(join(base, d), { recursive: true });
writeFileSync(log, "");
fake(join(oldBin, "claude"), { tool: "claude", version: "2.0.8", auth: "old-claude", log, withPid: true });
fake(join(oldBin, "codex"), { tool: "codex", version: "0.42.0", auth: "old-codex", log, withPid: true });
if (scenario === "both") {
  fake(join(userHome, ".local/bin/claude"), { tool: "claude", version: "2.1.327", log, withPid: true });
  fake(join(userHome, ".local/bin/codex"), { tool: "codex", version: "0.170.0", log, withPid: true });
}

const repo = join(base, "demo-repo");
const git = (...a) => execFileSync("git", a, { cwd: repo, stdio: "ignore" });
execFileSync("git", ["init", "-q", "-b", "main", repo], { stdio: "ignore" });
git("config", "user.email", "e2e@codeden.test");
git("config", "user.name", "CodeDen E2E");
writeFileSync(join(repo, "README.md"), "# Demo repo\n");
git("add", ".");
git("commit", "-q", "-m", "Initial commit");

// Loopback only; the machine's own tool folders and agent folders are out of reach.
const mine = homedir();
const realNodeBin = resolve(process.execPath, "..");
const hidden = ["/usr/local", "/opt/homebrew"]
  .concat([".claude", ".codex", ".local", ".opencode", ".gemini", ".cursor", ".config"].map((d) => join(mine, d)))
  .map((d) => `(subpath "${d}")`)
  .join(" ");
const profile = `(version 1)
(allow default)
(deny network-outbound (remote ip "*:*"))
(allow network-outbound (remote ip "localhost:*"))
(deny file-read* file-write* process-exec ${hidden})
(deny process-exec (subpath "${realNodeBin}"))
(allow process-exec (literal "${process.execPath}"))`;

// PATH gets a folder holding only `node`: the folder Node.js lives in may hold real CLIs.
const nodeBin = join(base, "node-bin");
mkdirSync(nodeBin, { recursive: true });
symlinkSync(process.execPath, join(nodeBin, "node"));
const lines = [];
const clean = (text) => String(text).split(userHome).join("~").split(base).join("<scratch>").split(real).join("<scratch>").split(root).join("<checkout>");
const note = (l = "") => {
  lines.push(clean(l));
  console.log(clean(l));
};

const child = spawn(
  "/usr/bin/sandbox-exec",
  ["-p", profile, process.execPath, "--import", "tsx", "apps/web/e2e/support/start-server.ts",
    "--home", join(base, "codeden-home"), "--user-home", userHome, "--port", "0",
    "--builtin", "--exit-with-stdin", "--no-path-refresh"],
  {
    cwd: root,
    stdio: ["pipe", "pipe", "pipe"],
    env: {
      PATH: `${oldBin}:${nodeBin}:/usr/bin:/bin:/usr/sbin:/sbin`,
      HOME: userHome,
      TZ: "UTC",
      CODEDEN_HOME: join(base, "codeden-home"),
      CODEDEN_UPDATE_CHECK: "0",
      XDG_DATA_HOME: join(base, "xdg/data"),
      XDG_CONFIG_HOME: join(base, "xdg/config"),
      XDG_STATE_HOME: join(base, "xdg/state"),
      XDG_CACHE_HOME: join(base, "xdg/cache"),
    },
  },
);
let serverLog = "";
const ready = await new Promise((done, fail) => {
  const timer = setTimeout(() => fail(new Error(`no start:\n${serverLog}`)), 120_000);
  const on = (c) => {
    serverLog += c.toString();
    const line = serverLog.split(/\r?\n/).find((l) => l.startsWith("CODEDEN_E2E_READY "));
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
  const json = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, json };
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Which process started each fake: the server (setup checks) or the runner (detection, model
// lists, sessions). The runner's pid comes from its lock file in the scratch CodeDen home.
const runnerPid = () => {
  for (const f of ["runner/runner.json"]) {
    const file = join(base, "codeden-home", f);
    if (existsSync(file)) return JSON.parse(readFileSync(file, "utf8")).pid;
  }
  return undefined;
};
let shown = 0;
let knownRunner;
/** Calls the fakes received since the last time this was asked, once they stop arriving. */
const newCalls = async (quietMs = 4000, maxMs = 60_000) => {
  const end = Date.now() + maxMs;
  let last = readFileSync(log, "utf8");
  let since = Date.now();
  while (Date.now() < end) {
    await sleep(500);
    const now = readFileSync(log, "utf8");
    if (now !== last) {
      last = now;
      since = Date.now();
    } else if (Date.now() - since >= quietMs) break;
  }
  const all = last.split("\n").filter(Boolean);
  const fresh = all.slice(shown);
  shown = all.length;
  const rp = (knownRunner ??= runnerPid());
  return fresh.map((l) => {
    const [pid, ...rest] = l.split(" ");
    const who = Number(pid) === child.pid ? "server" : Number(pid) === rp ? "runner" : "other";
    return `  [${who}] ${rest.join(" ")}`;
  });
};
const report = async (title, quietMs) => {
  const calls = await newCalls(quietMs);
  note(title);
  note(calls.length ? calls.join("\n") : "  (no fake was started)");
};
const startSession = async (provider) => {
  const r = await api("POST", "/sessions", {
    projectId, provider, purpose: `Say hello (${provider})`, title: `Say hello (${provider})`,
    input: { text: "Say hello" },
  });
  const id = r.json.sessionId;
  let state = "";
  if (id) {
    await sleep(6000);
    const s = (await api("GET", `/sessions/${id}`)).json.session ?? {};
    state = ` -> session status "${s.status}"${s.error ? `, error: ${JSON.stringify(s.error)}` : ""}`;
  }
  note(`POST /api/sessions provider=${provider}: HTTP ${r.status} ${JSON.stringify(r.json.status ?? r.json.error ?? r.json).slice(0, 300)}${state}`);
};
const row = (c) =>
  JSON.stringify(
    {
      id: c.id, state: c.state, message: c.message, detail: c.detail, installed: c.installed,
      version: c.version, executablePath: c.executablePath, loggedIn: c.loggedIn,
      authMethod: c.authMethod, fix: c.fix, broken: c.broken, durationMs: c.durationMs,
    },
    null,
    2,
  );

let projectId;
let browser;
try {
  note(`# ${label}, ${scenario === "both" ? "old copies first on PATH and supported copies in ~/.local/bin" : "only the old copies"}`);
  note(`checkout: ${execFileSync("git", ["rev-parse", "HEAD"], { cwd: root }).toString().trim()}`);
  note(`PATH given to the server: ${oldBin}:<node>:/usr/bin:/bin:/usr/sbin:/sbin   HOME: ${userHome}`);
  note(`fake copies: ${oldBin}/claude = 2.0.8, ${oldBin}/codex = 0.42.0${scenario === "both" ? `, ${userHome}/.local/bin/claude = 2.1.327, ${userHome}/.local/bin/codex = 0.170.0` : ""}`);
  const snapshot = (await api("GET", "/snapshot")).json;
  note(`providers the runner loaded: ${(snapshot.runner?.providers ?? []).map((p) => p.id).join(", ")}`);
  projectId = (await api("POST", "/projects", { source: { type: "local", path: repo } })).json.project.id;

  note("\n## 1. Server and runner just started; no setup check and no detection has run yet");
  await report("fake executables started so far ([server]: the server process and its own start-up checks; [runner]: the runner, here its start-up model lists):", 6000);

  note("\n## 2. A session on each provider before any detection ran in this runner");
  await startSession("codex");
  await startSession("claude");
  await report("fake executables started by these two sessions:");

  note("\n## 3. GET /api/setup/status?refresh=1 (what the setup screen shows)");
  const t0 = Date.now();
  const setup = (await api("GET", "/setup/status?refresh=1")).json;
  note(`answered in ${((Date.now() - t0) / 1000).toFixed(1)}s; ready=${setup.ready}; warnings=${JSON.stringify(setup.warnings)}`);
  for (const id of ["claude", "codex"]) note(row(setup.checks.find((c) => c.id === id)));
  note(`other rows: ${setup.checks.filter((c) => !["claude", "codex"].includes(c.id)).map((c) => `${c.id}=${c.state}`).join(", ")}`);
  writeFileSync(join(out, `${name}-setup-status.json`), `${clean(JSON.stringify({ ...setup, checks: setup.checks.filter((c) => ["claude", "codex"].includes(c.id)) }, null, 2))}\n`);
  // The setup check asks the runner to detect its providers as well; wait for that to finish.
  await report("fake executables started by the setup check (server) and the detection it triggers in the runner:", 20_000);

  note("\n## 4. A session on each provider after detection");
  await startSession("codex");
  await startSession("claude");
  await report("fake executables started by these two sessions:");

  note("\n## 5. The setup screen");
  const require = createRequire(join(root, "apps/web/package.json"));
  const { chromium } = require("@playwright/test");
  browser = await chromium.launch({
    channel: "chrome",
    args: ["--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1"],
  });
  const page = await browser.newPage({ viewport: { width: 1180, height: 1000 } });
  await page.goto(ready.launchUrl);
  await page.waitForLoadState("networkidle");
  await page.goto(`${ready.url}/setup`);
  const list = page.getByTestId("setup-checklist");
  await list.waitFor();
  await page.waitForFunction(
    () => !document.querySelector('[data-testid="setup-checklist"]')?.textContent?.includes("Checking"),
    undefined,
    { timeout: 90_000 },
  );
  await page.evaluate(() => {
    for (const d of document.querySelectorAll('[data-testid="check-details"]')) d.open = true;
  });
  await page.waitForTimeout(500);
  for (const id of ["claude", "codex"]) {
    const text = (await page.locator(`[data-check="${id}"]`).innerText()).replace(/\s+/g, " ");
    note(`row ${id}: ${text}`);
  }
  await page.screenshot({ path: join(out, `${name}-setup.png`) });
  note(`screenshot: ${name}-setup.png`);
} finally {
  await browser?.close();
  await fetch(`${ready.url}/api/shutdown`, {
    method: "POST",
    headers: { authorization: `Bearer ${ready.token}`, "content-type": "application/json" },
    body: JSON.stringify({ stopRunner: true }),
  }).catch(() => undefined);
  child.stdin.end();
  await sleep(3000);
  child.kill();
  rmSync(base, { force: true });
  const text = `${lines.join("\n")}\n`;
  if (/\/Users\/|\/home\/[a-z]/.test(text)) throw new Error("a home path is left in the output");
  writeFileSync(join(out, `${name}.txt`), text);
}
