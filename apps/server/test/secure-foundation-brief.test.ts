import { execFileSync } from "node:child_process";
import { secureFoundationCreates } from "@codeden/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type SetupBriefInput, setupBrief } from "../src/services/secure-foundation/brief";
import { removeTree } from "./support/remove-tree";
import { makeTemplateFixture, type TemplateFixture } from "./support/secure-foundation-fixture";

/**
 * The setup session's brief: its two forms, and that the commands it spells out are ones the
 * install's scripts take (run against the fixture's scripts, which refuse any other flag).
 */
const input = (over: Partial<SetupBriefInput> = {}): SetupBriefInput => ({
  name: "My Site",
  adminEmail: "person@site.test",
  doppler: false,
  modules: [],
  skippedModules: ["blog", "pricing"],
  repository: "fixture/template",
  commit: "0123456789abcdef0123456789abcdef01234567",
  runsCommandFiles: true,
  convexTeam: null,
  creates: secureFoundationCreates({ name: "My Site", secrets: "env_local" }),
  ...over,
});

/** Split a command line on spaces outside double quotes, dropping the quotes. */
const words = (line: string) =>
  (line.match(/(?:[^\s"]+|"[^"]*")+/g) ?? []).map((w) => w.replaceAll('"', ""));

/** The `node scripts/…` commands the brief gives in full. */
const commands = (brief: string) =>
  [...brief.matchAll(/`(node scripts\/[^`]+)`/g)]
    .map((m) => m[1] as string)
    .filter((c) => !c.includes("…") && !c.includes("<"));

let fixture: TemplateFixture;
beforeAll(() => {
  fixture = makeTemplateFixture();
});
afterAll(() => removeTree(fixture.root));

const run = (command: string) => {
  const [, ...args] = words(command);
  return JSON.parse(
    execFileSync(process.execPath, args, { cwd: fixture.source.url, encoding: "utf8" }),
  ) as { command?: string; args?: Record<string, string>; installed?: string[] };
};

describe("the setup brief", () => {
  it("runs /install where the provider runs command files, and reads the file where it doesn't", () => {
    const runs = setupBrief(input());
    const reads = setupBrief(input({ runsCommandFiles: false }));
    expect(runs).toContain("Run this project's `/install` command");
    expect(runs).not.toContain("follow it step by step");
    expect(reads).toContain("Read `.claude/commands/install.md` and follow it step by step.");
    expect(reads).not.toContain("Run this project's `/install` command");
  });

  it("passes the form's answers as the flags the install's scripts take", () => {
    const outputs = commands(setupBrief(input())).map(run);
    expect(outputs).toEqual([
      {
        success: true,
        command: "init",
        args: { "site-name": "My Site", "admin-email": "person@site.test" },
      },
      { success: true, command: "convex-setup", args: { "project-name": "My Site" } },
      { success: true, command: "configure", args: { "admin-email": "person@site.test" } },
    ]);
  });

  it("adds the modules and the Doppler steps when chosen, and never the CI token step", () => {
    const brief = setupBrief(
      input({
        doppler: true,
        modules: ["blog", "pricing"],
        skippedModules: [],
        creates: secureFoundationCreates({ name: "My Site", secrets: "doppler" }),
      }),
    );
    const ran = commands(brief).map(run);
    expect(ran.map((r) => r.command ?? "modules")).toEqual([
      "modules",
      "doppler-bootstrap",
      "init",
      "convex-setup",
      "configure",
      "doppler-sync-env-local",
    ]);
    expect(ran[0]?.installed).toEqual(["blog", "pricing"]);
    expect(ran[1]?.args).toEqual({ "project-name": "My Site" });
    expect(brief).toContain("Skip `doppler-create-ci-token`");
    expect(brief).toContain("`npm run convex:doppler` and `npm run dev:doppler`");
    expect(brief).toContain('Doppler: a Doppler project named "my-site"');
  });

  it("passes the Convex team chosen in the form", () => {
    const brief = setupBrief(input({ convexTeam: "acme-labs" }));
    const convex = commands(brief)
      .map(run)
      .find((r) => r.command === "convex-setup");
    expect(convex?.args).toEqual({ "project-name": "My Site", team: "acme-labs" });
    expect(brief).toContain("the person chose the team `acme-labs`");
  });

  it("holds the session to the project folder, to the confirmed list and to its secrets", () => {
    const brief = setupBrief(input());
    expect(brief).toContain("Work only inside this project folder.");
    expect(brief).toContain("Never print, quote or summarise a secret");
    expect(brief).toContain("stop and ask the person first");
    expect(brief).toContain("Don't create a GitHub repository, add a git remote, push or deploy.");
    expect(brief).toContain("don't assume port 3000");
    expect(brief).toContain("the URL only works while those processes run");
    expect(brief).not.toContain("Doppler:");
    // No key flag is ever spelled with a value.
    expect(brief).not.toMatch(/--clerk-(?:pk|sk)=/);
  });
});
