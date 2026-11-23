import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";

/**
 * Fake `npx` (for the pinned Convex package) and `doppler` on a PATH of their own, for the
 * Connections step. They sign in to nothing: a `mode` file says how they behave, and they take
 * exactly the arguments the product's fixed commands pass, exiting 64 on anything else.
 * POSIX only (a script with a `#!` line).
 */

export type FakeMode = "signed_out" | "signed_in" | "login_ok" | "login_hang" | "login_fail";

const SCRIPT = `#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const dir = __dirname;
const name = path.basename(process.argv[1]);
const args = process.argv.slice(2).join(" ");
const mode = fs.readFileSync(path.join(dir, "mode"), "utf8").trim();
fs.writeFileSync(path.join(dir, name + ".env.json"), JSON.stringify({ env: Object.keys(process.env), cwd: process.cwd(), args }));
const KNOWN = {
  npx: { status: "--yes convex@1.43.0 login status", login: "--yes convex@1.43.0 login --login-flow poll --no-open --device-name codeharden-setup" },
  doppler: { status: "me --json", login: "login --yes --no-copy" },
}[name];
const signedIn = () => fs.existsSync(path.join(dir, name + ".signed-in")) || mode === "signed_in";
if (args === KNOWN.status) {
  if (!signedIn()) { console.log(name === "npx" ? "Status: Not logged in" : "Doppler Error: you must provide a token"); process.exit(1); }
  if (name === "npx") console.log("Account: default\\nStatus: Logged in\\nTeams: 2 teams accessible\\n - Acme Labs (acme-labs)\\n - Side Project (side-project)\\n - Broken (not a slug)");
  else console.log(JSON.stringify({ workplace: { name: "Acme" } }));
  process.exit(0);
}
if (args !== KNOWN.login) { console.error("unexpected arguments: " + args); process.exit(64); }
if (mode === "login_fail") { console.error("something went wrong"); process.exit(1); }
fs.writeFileSync(path.join(dir, name + ".pid"), String(process.pid));
if (name === "npx") console.log("Visit https://auth.convex.dev/activate?user_code=WXYZ-1234 to finish logging in.\\nYou should see the following code which expires in 5 minutes: WXYZ-1234");
else console.log("Complete authorization at https://dashboard.doppler.com/workplace/auth/cli\\nYour auth code is:\\n\\u001b[32mfake_code_1234\\u001b[0m\\nWaiting...");
setInterval(() => {
  if (mode === "login_ok" && fs.existsSync(path.join(dir, "approve"))) {
    fs.writeFileSync(path.join(dir, name + ".signed-in"), "");
    process.exit(0);
  }
}, 20);
`;

export interface FakeClis {
  dir: string;
  /** The environment to hand the service: the fakes first on PATH, plus things that must not leak. */
  env: NodeJS.ProcessEnv;
  setMode(mode: FakeMode): void;
  /** The person finishing the sign-in in their browser. */
  approve(): void;
  /** What a fake last saw: its argument line, working directory and environment variable names. */
  seen(name: "npx" | "doppler"): { env: string[]; cwd: string; args: string } | null;
  /** The process id of a fake's running login, or null. */
  pid(name: "npx" | "doppler"): number | null;
}

export function makeFakeClis(only: Array<"npx" | "doppler"> = ["npx", "doppler"]): FakeClis {
  const dir = mkdtempSync(join(tmpdir(), "fake-clis-"));
  for (const name of only) {
    writeFileSync(join(dir, name), SCRIPT);
    chmodSync(join(dir, name), 0o755);
  }
  writeFileSync(join(dir, "mode"), "signed_out");
  const read = (file: string) =>
    existsSync(join(dir, file)) ? readFileSync(join(dir, file), "utf8") : null;
  return {
    dir,
    env: {
      PATH: [dir, dirname(process.execPath), "/usr/bin", "/bin"].join(delimiter),
      HOME: dir,
      SECRET_FROM_THE_SERVER: "must-not-reach-a-cli",
      CODEDEN_HOME: "/nowhere",
    },
    setMode: (mode) => writeFileSync(join(dir, "mode"), mode),
    approve: () => writeFileSync(join(dir, "approve"), ""),
    seen(name) {
      const text = read(`${name}.env.json`);
      return text ? (JSON.parse(text) as { env: string[]; cwd: string; args: string }) : null;
    },
    pid(name) {
      const text = read(`${name}.pid`);
      return text ? Number(text) : null;
    },
  };
}

/** True while a process exists. */
export function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
