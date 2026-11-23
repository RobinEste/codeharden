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
  deploy: null,
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

  describe("with the deploy option", () => {
    const deploy = {
      owner: "acme-org",
      repository: "my-site",
      visibility: "private" as const,
      vercelScope: "acme-team",
    };
    const brief = (over: Partial<SetupBriefInput> = {}) =>
      setupBrief(
        input({
          deploy,
          creates: secureFoundationCreates({ name: "My Site", secrets: "env_local", deploy }),
          ...over,
        }),
      );

    it("gives the session exactly the confirmed owner, repository and scope", () => {
      const text = brief();
      const ran = commands(text).map(run);
      expect(ran.find((r) => r.command === "github-setup")?.args).toEqual({
        "repo-name": "my-site",
        owner: "acme-org",
      });
      expect(ran.map((r) => r.command)).toEqual([
        "init",
        "convex-setup",
        "configure",
        "github-setup",
        "vercel-env-dev",
        "vercel-deploy",
      ]);
      expect(text).toContain('npx vercel project add "my-site" --scope="acme-team"');
      expect(text).toContain("GitHub: a private repository acme-org/my-site");
      expect(text).toContain("Run this project's `/deploy-to-dev` command");
      expect(text).toContain("## Part 4: start the app");
    });

    it("refuses an existing repository or project, a public one and production", () => {
      const text = brief();
      expect(text).toContain('`gh repo view "acme-org/my-site"` has to fail');
      expect(text).toContain("don't pick one yourself and don't push into it");
      expect(text).toContain("don't deploy into it");
      expect(text).toContain("If it answers `repo_exists` or `owner_mismatch`, stop");
      expect(text).toContain("Never run `/deploy-to-prod`");
      expect(text).toContain("never make the repository public");
      expect(text).toContain("If it answers `production_already_promoted`, stop.");
      expect(text).toContain("a public repository, a production deploy");
      expect(text).not.toContain("Don't create a GitHub repository");
    });

    it("stores the Doppler token in the repository only now that there is one", () => {
      const ran = commands(brief({ doppler: true }))
        .map(run)
        .map((r) => r.command);
      expect(ran.indexOf("doppler-create-ci-token")).toBeGreaterThan(ran.indexOf("github-setup"));
      expect(commands(setupBrief(input({ doppler: true }))).join()).not.toContain("ci-token");
    });

    it("reads the deploy file where the provider doesn't run command files", () => {
      expect(brief({ runsCommandFiles: false })).toContain(
        "Read `.claude/commands/deploy-to-dev.md` and follow it step by step.",
      );
    });
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
