/**
 * Start a real CodeDen server and its runner (the real provider adapters, isolated home) for
 * the first-session check of PR #584. As `apps/web/e2e/support/start-server.ts`, plus
 * `--no-setup-check`: the server then runs no setup check when it starts, so nothing has looked
 * at the CLIs before the runner does. Copied into `apps/web` of the checkout under test.
 */
import { parseArgs } from "node:util";
import { ensureHome, ensureInstallToken, startServer } from "@codeden/server";

const { values } = parseArgs({
  options: {
    home: { type: "string" },
    "user-home": { type: "string" },
    "no-setup-check": { type: "boolean", default: false },
  },
});
const home = values.home as string;
const token = ensureInstallToken(ensureHome(home).token);
const server = await startServer({
  port: 0,
  dataDir: home,
  token,
  enableFakeProvider: true,
  builtinProviders: true,
  waitForRunner: true,
  userHome: values["user-home"],
  refreshPath: async () => undefined,
  ...(values["no-setup-check"] ? { checkSetupOnStart: false } : {}),
  log: (m) => console.log(`[codeden] ${m}`),
});
console.log(`CODEDEN_E2E_READY ${JSON.stringify({ url: server.url, token })}`);

let stopping = false;
const stop = () => {
  if (stopping) return;
  stopping = true;
  void server
    .close({ stopRunner: true })
    .catch((error: unknown) => console.error(error))
    .finally(() => process.exit(0));
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
process.stdin.on("end", stop);
process.stdin.resume();
