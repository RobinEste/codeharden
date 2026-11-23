import {
  type ConvexTeam,
  ConvexTeamSlug,
  HARDEN_APP_SLUG,
  SECURE_FOUNDATION_NPX_PACKAGES,
  type SecureFoundationService,
} from "@codeden/contracts";
import type { CliResult } from "./process";

/**
 * The fixed commands of the Connections step: per service, one that asks its CLI whether this
 * computer is signed in and one that starts its login. Every word is written here: nothing
 * comes from the form, a request or the template. Flags and output formats were read from each
 * CLI's own source and documentation.
 */

export interface Command {
  program: string;
  args: readonly string[];
}

export interface StatusReading {
  signedIn: boolean | null;
  teams: ConvexTeam[];
}

export interface ServiceCommands {
  /** The name people know the service by. */
  label: string;
  status: Command;
  login: Command;
  /** How long the status command may take (npx may have to download the pinned package). */
  statusTimeoutMs: number;
  readStatus(result: CliResult): StatusReading;
  /** The sign-in link and code in what the login has printed so far. */
  readLogin(output: string): { url: string | null; code: string | null };
  /** Said when the program can't be found on the app's path. */
  missing: string;
  /** For a missing CLI: what the person runs to install it themselves. */
  install: string | null;
  /** What to do by hand when the login can't be driven from here. */
  manual: string;
}

/** The first link in `output` that is on one of the service's own hosts. */
function linkOn(output: string, domain: string): string | null {
  for (const word of output.split(/\s/)) {
    if (!word.startsWith("https://") || word.length > 2_000) continue;
    let text = word;
    while (/[.,)]$/.test(text)) text = text.slice(0, -1);
    try {
      const host = new URL(text).hostname.toLowerCase();
      if (host === domain || host.endsWith(`.${domain}`)) return text;
    } catch {
      // Not a URL after all.
    }
  }
  return null;
}

/** The word that follows `marker` in `output` (a sign-in code), or null. */
function wordAfter(output: string, marker: string): string | null {
  const at = output.indexOf(marker);
  if (at < 0) return null;
  const word = output
    .slice(at + marker.length, at + marker.length + 200)
    .trim()
    .split(/\s/, 1)[0];
  return word && /^[A-Za-z0-9_-]{4,80}$/.test(word) ? word : null;
}

const convexNpx = ["--yes", SECURE_FOUNDATION_NPX_PACKAGES.convex] as const;

/** `convex login status` lists teams as ` - Name (slug)` under "Status: Logged in". */
function convexTeams(output: string): ConvexTeam[] {
  const teams: ConvexTeam[] = [];
  for (const raw of output.split("\n").slice(0, 500)) {
    const line = raw.trim();
    if (line.length > 300 || !line.startsWith("- ") || !line.endsWith(")")) continue;
    const open = line.lastIndexOf(" (");
    if (open < 2) continue;
    const name = line.slice(2, open).trim();
    const slug = line.slice(open + 2, -1);
    if (name && ConvexTeamSlug.safeParse(slug).success) teams.push({ name, slug });
  }
  return teams;
}

const dopplerInstall =
  process.platform === "darwin"
    ? "brew install gnupg && brew install dopplerhq/cli/doppler"
    : process.platform === "win32"
      ? "winget install doppler.doppler"
      : "See https://docs.doppler.com/docs/install-cli";

export const SERVICE_COMMANDS: Record<SecureFoundationService, ServiceCommands> = {
  convex: {
    label: "Convex",
    // Exits 1 with "Status: Not logged in" when signed out.
    status: { program: "npx", args: [...convexNpx, "login", "status"] },
    // The login the template's install uses: prints a link and waits; opens no browser itself.
    login: {
      program: "npx",
      args: [
        ...convexNpx,
        "login",
        "--login-flow",
        "poll",
        "--no-open",
        "--device-name",
        `${HARDEN_APP_SLUG}-setup`,
      ],
    },
    statusTimeoutMs: 120_000,
    readStatus({ code, output }) {
      if (/Status:\s+Logged in/.test(output)) return { signedIn: true, teams: convexTeams(output) };
      if (/Status:\s+Not logged in/.test(output) || code === 1)
        return { signedIn: false, teams: [] };
      return { signedIn: null, teams: [] };
    },
    readLogin: (output) => ({
      url: linkOn(output, "convex.dev"),
      code: wordAfter(output, "minutes:"),
    }),
    missing:
      "Node.js (npx) isn't on the app's path, so Convex can't be asked. Install Node.js, or start the app from a terminal where `npx` works, then check again.",
    install: null,
    manual: "Run `npx convex login` in a terminal, then check again.",
  },
  doppler: {
    label: "Doppler",
    status: { program: "doppler", args: ["me", "--json"] },
    // `--yes` skips its "open the browser?" question (it opens the page itself); `--no-copy`
    // leaves the clipboard alone. It gives up by itself after five minutes.
    login: { program: "doppler", args: ["login", "--yes", "--no-copy"] },
    statusTimeoutMs: 20_000,
    readStatus: ({ code }) => ({ signedIn: code === null ? null : code === 0, teams: [] }),
    readLogin: (output) => ({
      url: linkOn(output, "doppler.com"),
      code: wordAfter(output, "code is:"),
    }),
    missing: "The Doppler command-line tool isn't installed, or isn't on the app's path.",
    install: dopplerInstall,
    manual: "Run `doppler login` in a terminal, then check again.",
  },
};
