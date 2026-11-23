import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HELP } from "../src/args";
import { networkCommand, passwordCommand } from "../src/network-command";

/** What the network commands tell people to type names this product's command, not upstream's. */
let home: string;
let out: string[];

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "harden-cli-net-"));
  out = [];
  vi.spyOn(console, "log").mockImplementation((...a) => void out.push(a.join(" ")));
  vi.spyOn(console, "error").mockImplementation((...a) => void out.push(a.join(" ")));
});
afterEach(() => {
  vi.restoreAllMocks();
  rmSync(home, { recursive: true, force: true });
});

const said = () => out.join("\n");
/** Upstream's command as a word of its own: not inside `codeharden`, a path or a package name. */
const UPSTREAM_COMMAND = /(?<![\w./@-])codeden (?=[a-z-])/;

describe("the network commands name the channel's command (server stopped)", () => {
  it("says which command sets the password", async () => {
    expect(await networkCommand(home, "on")).toBe(1);
    expect(said()).toContain("Run: codeharden password");
    expect(said()).not.toMatch(UPSTREAM_COMMAND);
  });

  it("prints its usage with the command", async () => {
    expect(await networkCommand(home, "sideways")).toBe(2);
    expect(said()).toContain("Usage: codeharden network [on [--loopback-only] | off]");
    expect(said()).toContain("codeharden network origin add <https-url>");
    expect(said()).not.toMatch(UPSTREAM_COMMAND);
  });

  it("says how to add a trusted origin, in the list and after a loopback-only start", async () => {
    expect(await networkCommand(home, "origin", { args: ["list"] })).toBe(0);
    expect(said()).toContain("Add one with: codeharden network origin add https://<host>");
    expect(await passwordCommand(home, { generate: true })).toBe(0);
    expect(await networkCommand(home, "on", { loopbackOnly: true })).toBe(0);
    expect(said()).toContain("(codeharden network origin add)");
    expect(said()).not.toMatch(UPSTREAM_COMMAND);
  });
});

describe("the help's columns with the channel's command", () => {
  const lines = HELP.split("\n");
  const at = (start: string) => lines.findIndex((line) => line.startsWith(start));

  it("names every command after the channel", () => {
    expect(HELP).not.toMatch(UPSTREAM_COMMAND);
    expect(at("  codeharden network origin add|remove|list <https-url>")).toBeGreaterThan(-1);
    expect(at("  codeharden password ")).toBeGreaterThan(-1);
  });

  it("keeps the descriptions in one column, continuation lines included", () => {
    const column = (lines[at("  codeharden doctor ")] as string).indexOf("Check the installation");
    expect(column).toBe(28);
    for (const [command, description] of [
      ["  codeharden update ", "Install the latest version"],
      ["  codeharden stop ", "Stop the server"],
      ["  codeharden password ", "Set the network access password"],
      ["  codeharden network on|off ", "Let phones on your network"],
      ["  codeharden runner-link ", "Connect stdin/stdout"],
    ] as const) {
      expect((lines[at(command)] as string).indexOf(description), command).toBe(column);
    }
    // The long `network origin` line has its description on the next line, in that column.
    const origin = at("  codeharden network origin ");
    expect(lines[origin + 1]).toBe(
      `${" ".repeat(column)}HTTPS addresses of a proxy on this computer that CodeDen trusts`,
    );
    // So have the two other continuation lines.
    expect(lines[at("  codeharden network on|off ") + 1]).toMatch(
      new RegExp(`^ {${column}}\\(on --loopback-only`),
    );
    expect(lines[at("  codeharden runner-link ") + 1]).toMatch(
      new RegExp(`^ {${column}}inside a sandbox`),
    );
  });
});
