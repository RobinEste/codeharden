// PR #584, the first session of a fresh runner, end to end: a real CodeDen server and runner
// (isolated empty home, the real Claude Code, Codex and OpenCode adapters) looking for fake
// executables. An old copy of each is first on PATH (a stand-in for /usr/local/bin) and a
// supported copy sits in the tool's known location under the stand-in home. The script shows
// which copy the runner starts for its start-up model lists and for the first session on each
// provider, before any setup check or detection has run. No real CLI runs and nothing leaves
// 127.0.0.1: the server and its runner are started under a macOS sandbox profile that refuses
// every other connection and hides /usr/local and /opt/homebrew.
//
//   node first-session-e2e.mjs <checkout root> <label> <no-startup-check|default-start> <output folder>
import { execFileSync, spawn } from "node:child_process";
import {
  copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fake } from "./first-session-fakes.mjs";

const [rootArg, label, mode, outArg] = process.argv.slice(2);
const root = resolve(rootArg);
const out = resolve(outArg);
mkdirSync(out, { recursive: true });
const name = `first-session-${label}-${mode}`;

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
const COPIES = [
  ["claude", "2.0.8", "2.1.327", ".local/bin/claude"],
  ["codex", "0.42.0", "0.170.0", ".local/bin/codex"],
  ["opencode", "1.19.5", "2.2.7", ".opencode/bin/opencode"],
];
for (const [tool, old, current, known] of COPIES) {
  fake(join(oldBin, tool), { tool, version: old, log });
  fake(join(userHome, known), { tool, version: current, log });
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

// The starter is copied into the checkout under test so that it loads that checkout's server.
const starter = join(root, "apps/web/.codeden-dev/first-session-start.ts");
mkdirSync(join(root, "apps/web/.codeden-dev"), { recursive: true });
copyFileSync(join(import.meta.dirname, "first-session-start.ts"), starter);

const child = spawn(
  "/usr/bin/sandbox-exec",
  ["-p", profile, process.execPath, "--import", "tsx", starter,
    "--home", join(base, "codeden-home"), "--user-home", userHome,
    ...(mode === "no-startup-check" ? ["--no-setup-check"] : [])],
  {
    cwd: join(root, "apps/web"),
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

// Which process started each fake: the server (its setup checks) or the runner (model lists,
// sessions). The runner's pid comes from its lock file in the scratch CodeDen home.
const runnerPid = () => {
  const file = join(base, "codeden-home", "runner/runner.json");
  return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")).pid : undefined;
};
let shown = 0;
let knownRunner;
const all = [];
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
  const rows = last.split("\n").filter(Boolean);
  const fresh = rows.slice(shown);
  shown = rows.length;
  const rp = (knownRunner ??= runnerPid());
  return fresh.map((l) => {
    const [pid, file, ...args] = l.split(" ");
    const who = Number(pid) === child.pid ? "server" : Number(pid) === rp ? "runner" : "other";
    const call = { who, file: clean(file), args: args.join(" ") };
    all.push(call);
    return `  [${who}] ${call.file} ${call.args}`;
  });
};
const report = async (title, quietMs) => {
  const calls = await newCalls(quietMs);
  note(title);
  note(calls.length ? calls.join("\n") : "  (no fake was started)");
};
/** "old" or "supported" for each start by the runner that is not `--version`, from `from` on. */
const runnerStarts = (tool, from) =>
  all
    .slice(from)
    .filter((c) => c.who === "runner" && c.file.endsWith(`/${tool}`) && c.args !== "--version")
    .map((c) => (c.file.startsWith("<scratch>/usr-local-bin/") ? "old" : "supported"));
const summary = {};
const sum = (tool, what, from) => {
  const starts = runnerStarts(tool, from);
  (summary[tool] ??= {})[what] = starts.length ? [...new Set(starts)].join(" and ") : "none started";
};

let projectId;
try {
  note(`# ${label}: a fresh runner's first model lists and first sessions (${mode === "no-startup-check" ? "the server's start-up setup check is switched off; any [server] line is a look-up the server process made itself, which the runner process does not share" : "the server starts as the product does, with its own start-up setup check"})`);
  note(`checkout: ${execFileSync("git", ["rev-parse", "HEAD"], { cwd: root }).toString().trim()}`);
  note(`PATH given to the server: ${oldBin}:<node>:/usr/bin:/bin:/usr/sbin:/sbin   HOME: ${userHome}`);
  note(`fake copies, old first on PATH: ${COPIES.map(([t, old]) => `${oldBin}/${t} = ${old}`).join(", ")}`);
  note(`fake copies, supported, in the known locations: ${COPIES.map(([t, , cur, known]) => `${userHome}/${known} = ${cur}`).join(", ")}`);
  const snapshot = (await api("GET", "/snapshot")).json;
  note(`providers the runner loaded: ${(snapshot.runner?.providers ?? []).map((p) => p.id).join(", ")}`);
  projectId = (await api("POST", "/projects", { source: { type: "local", path: repo } })).json.project.id;

  note("\n## 1. Server and runner just started: the runner's start-up model lists");
  note("No request was made for a setup check, a detection or a model refresh.");
  await report("fake executables started so far ([server]: the server process; [runner]: the runner process):", 6000);
  for (const [tool] of COPIES) sum(tool, "first model list", 0);
  const versionCalls = all.filter((c) => c.who === "runner" && c.args === "--version");
  note(`\`--version\` calls made by the runner so far: ${versionCalls.length}${versionCalls.length ? ` (${versionCalls.map((c) => c.file).join(", ")})` : ""}`);

  note("\n## 2. The first session on each provider, still before any setup check or detection request");
  const before = all.length;
  for (const [provider] of COPIES) {
    const r = await api("POST", "/sessions", {
      projectId, provider, purpose: `Say hello (${provider})`, title: `Say hello (${provider})`,
      input: { text: "Say hello" },
    });
    note(`POST /api/sessions provider=${provider}: HTTP ${r.status} ${JSON.stringify(r.json.status ?? r.json.error ?? r.json).slice(0, 200)}`);
    await sleep(3000);
  }
  await report("fake executables started by these sessions (the fakes end at once, so the sessions themselves fail or stay idle; what counts is which copy was started):");
  for (const [tool] of COPIES) sum(tool, "first session", before);
  const later = all.slice(before).filter((c) => c.who === "runner" && c.args === "--version");
  note(`\`--version\` calls made by the runner for these sessions: ${later.length}`);

  note("\n## Result: the copy the runner started");
  for (const [tool] of COPIES) {
    note(`${tool}: first model list -> ${summary[tool]["first model list"]}; first session -> ${summary[tool]["first session"]}`);
  }
} finally {
  await fetch(`${ready.url}/api/shutdown`, {
    method: "POST",
    headers: { authorization: `Bearer ${ready.token}`, "content-type": "application/json" },
    body: JSON.stringify({ stopRunner: true }),
  }).catch(() => undefined);
  child.stdin.end();
  await sleep(3000);
  child.kill();
  rmSync(base, { force: true });
  rmSync(starter, { force: true });
  const text = `${lines.join("\n")}\n`;
  if (/\/Users\/|\/home\/[a-z]/.test(text)) throw new Error("a home path is left in the output");
  writeFileSync(join(out, `${name}.txt`), text);
}
