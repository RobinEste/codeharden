#!/usr/bin/env node
// This repository's dev command for a dev preview (docs/dev-preview.md): the server and the
// web app of the checkout this script is in, on the two ports it is given, with a home of
// their own inside the checkout. `pnpm dev` can't be used for this: its ports are fixed
// (4318 and 5173), so two worktrees could never run it side by side.
//
//   WEB_PORT   the web app (Vite), the page to open. PORT is read when WEB_PORT is not set.
//   API_PORT   the server behind it.
//
// Project settings > Dev preview:
//   Dev command      node scripts/harden/dev-preview/run.mjs
//   Prepare command  pnpm install --frozen-lockfile
//   Port variables   WEB_PORT, API_PORT
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const port = (name, fallback) => {
  const value = Number(process.env[name] ?? (fallback ? process.env[fallback] : undefined));
  if (!Number.isInteger(value) || value < 1024 || value > 65535) {
    console.error(`dev-preview: set ${name} to a free port (1024-65535).`);
    process.exit(2);
  }
  return value;
};
const webPort = port("WEB_PORT", "PORT");
const apiPort = port("API_PORT");
if (webPort === apiPort) {
  console.error("dev-preview: WEB_PORT and API_PORT must differ.");
  process.exit(2);
}
// The same folder `pnpm dev` uses in this checkout: ignored by git, and never another
// checkout's or an installed app's.
const home = join(root, ".codeden-dev");
const env = {
  ...process.env,
  CODEDEN_HOME: home,
  CODEDEN_PORT: String(apiPort),
  CODEDEN_SERVER_URL: `http://127.0.0.1:${apiPort}`,
  DEV_PREVIEW_WEB_PORT: String(webPort),
};

const children = [
  spawn(
    process.execPath,
    [
      "--watch",
      "--watch-preserve-output",
      "--import",
      "tsx",
      join(root, "scripts/harden/dev-preview/server.ts"),
    ],
    { cwd: join(root, "apps/server"), env, stdio: "inherit" },
  ),
  spawn(
    process.execPath,
    [
      join(root, "apps/web/node_modules/vite/bin/vite.js"),
      "--port",
      String(webPort),
      "--strictPort",
      "--host",
      "127.0.0.1",
    ],
    { cwd: join(root, "apps/web"), env, stdio: "inherit" },
  ),
];

/** The dev server starts a runner that outlives it on purpose; a preview takes it down too. */
function stopRunner() {
  try {
    const lock = JSON.parse(readFileSync(join(home, "runner", "runner.json"), "utf8"));
    if (Number.isInteger(lock.pid) && lock.pid > 1) process.kill(lock.pid, "SIGTERM");
  } catch {
    // No runner was started, or it is gone already.
  }
}

let ending = false;
function end(code) {
  if (ending) return;
  ending = true;
  for (const child of children) child.kill("SIGTERM");
  stopRunner();
  const left = () => children.filter((c) => c.exitCode === null && c.signalCode === null);
  const done = () => left().length === 0 && process.exit(code);
  for (const child of children) child.once("exit", done);
  done();
  setTimeout(() => {
    for (const child of left()) child.kill("SIGKILL");
    process.exit(code);
  }, 4_000).unref();
}

for (const child of children) {
  child.once("exit", (code) => end(code ?? 1));
  child.once("error", (error) => {
    console.error(`dev-preview: ${error.message}`);
    end(1);
  });
}
process.on("SIGINT", () => end(0));
process.on("SIGTERM", () => end(0));
console.log(
  `dev-preview: web http://localhost:${webPort}  api http://127.0.0.1:${apiPort}  home ${home}`,
);
