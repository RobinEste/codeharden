import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CreateSecureFoundationRequest,
  type Project,
  type ProviderInfo,
  SECURE_FOUNDATION_SETUP_AUTONOMY,
  SECURE_FOUNDATION_WORK_KEY,
  type StartSessionRequestInit,
} from "@codeden/contracts";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ServiceError } from "../src/services/errors";
import { type Exec, runTool } from "../src/services/exec";
import {
  isOwnFolder,
  removeCreated,
  type SecureFoundationDeps,
  SecureFoundationService,
} from "../src/services/secure-foundation/secure-foundation-service";
import { removeTree } from "./support/remove-tree";
import { makeTemplateFixture, type TemplateFixture } from "./support/secure-foundation-fixture";

/**
 * Creating a project from the template, against a local fixture repository and real git, with
 * the project list and the session start scripted. No network, no provider.
 */
const EMAIL = "person@site.test";
const capabilities = { projectCommands: true } as ProviderInfo["capabilities"];
const provider = (id: string, extra: Partial<ProviderInfo["capabilities"]> = {}): ProviderInfo => ({
  id,
  displayName: id.toUpperCase(),
  capabilities: { ...capabilities, ...extra },
  models: [],
});
const check = (id: string, loggedIn: boolean | null, installed = true) =>
  ({ id, installed, loggedIn }) as never;

let fixture: TemplateFixture;
let dir: string;
let projectsDir: string;
let created: Array<{ path: string; name?: string }>;
let archived: string[];
let started: StartSessionRequestInit[];
let failAt: "project" | "session" | null;

beforeAll(() => {
  fixture = makeTemplateFixture();
});
afterAll(() => removeTree(fixture.root));
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "sf-test-"));
  projectsDir = join(dir, "projects");
  created = [];
  archived = [];
  started = [];
  failAt = null;
});
afterEach(() => removeTree(dir));

function service(over: Partial<SecureFoundationDeps> = {}) {
  return new SecureFoundationService({
    exec: runTool,
    template: fixture.source,
    projectsDir,
    tmpDir: dir,
    providers: () => [provider("alpha"), provider("beta", { projectCommands: false })],
    preferredProvider: () => null,
    setupStatus: async () => ({ checks: [check("alpha", true), check("beta", true)] }),
    projects: {
      async create(req) {
        if (failAt === "project") throw new Error("database is closed");
        if (req.source.type !== "local") throw new Error("expected a local folder");
        created.push({ path: req.source.path, name: req.name });
        return { project: { id: "p1", path: req.source.path, name: req.name } as Project } as never;
      },
      get: () => ({ id: "p1", path: join(projectsDir, "my-site") }) as Project,
      archive: (id) => void archived.push(id),
    },
    async startSession(req) {
      if (failAt === "session") throw new Error("no runner");
      started.push(req);
      return { status: "started", sessionId: "s1" };
    },
    ...over,
  });
}

const request = (over: Record<string, unknown> = {}) =>
  CreateSecureFoundationRequest.parse({
    name: "My Site",
    adminEmail: EMAIL,
    provider: "alpha",
    commit: fixture.head(),
    ...over,
  });

const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" }).trim();

const failure = async (run: Promise<unknown>): Promise<ServiceError> => {
  const error = await run.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(ServiceError);
  return error as ServiceError;
};

describe("resolving the template", () => {
  it("reports the branch's commit, its date and the content modules it has", async () => {
    const template = await service().template();
    expect(template.commit).toBe(fixture.head());
    expect(template.repository).toBe("fixture/template");
    expect(Number.isNaN(Date.parse(template.committedAt))).toBe(false);
    expect(template.modules).toEqual([
      { name: "blog", title: "Blog", description: "A blog" },
      { name: "pricing", title: "Pricing", description: "A pricing page" },
    ]);
    // Nothing of the fetch is left in the temp folder.
    expect(readdirSync(dir)).toEqual([]);
  });

  it("is refused when the build has no template", async () => {
    const off = service({ template: null });
    expect((await off.options()).enabled).toBe(false);
    expect((await off.options()).providers).toEqual([]);
    expect((await failure(off.template())).code).toBe("secure_foundation_off");
    expect((await failure(off.create(request()))).code).toBe("secure_foundation_off");
  });
});

describe("creating the project", () => {
  it("writes a fresh repository: one commit, no remote, none of the template's history", async () => {
    const commit = fixture.head();
    const result = await service().create(request());
    const dest = join(projectsDir, "my-site");
    expect(result).toMatchObject({ sessionId: "s1", commit });
    expect(created).toEqual([{ path: dest, name: "My Site" }]);
    expect(git(dest, "rev-list", "--count", "HEAD")).toBe("1");
    expect(git(dest, "remote")).toBe("");
    expect(git(dest, "rev-parse", "HEAD")).not.toBe(commit);
    expect(git(dest, "log", "--format=%s")).toContain(commit.slice(0, 7));
    expect(git(dest, "status", "--porcelain")).toBe("");
    expect(git(dest, "branch", "--show-current")).toBe("main");
    // The files are the confirmed commit's.
    expect(existsSync(join(dest, ".claude/commands/install.md"))).toBe(true);
    expect(existsSync(join(dest, "CHANGES.md"))).toBe(false);
    expect(readdirSync(dir)).toEqual(["projects"]);
  });

  it("starts the setup session in the project folder, unattended, on the chosen provider", async () => {
    await service().create(request());
    expect(started).toHaveLength(1);
    expect(started[0]).toMatchObject({
      projectId: "p1",
      provider: "alpha",
      autonomy: SECURE_FOUNDATION_SETUP_AUTONOMY,
      workspace: { mode: "repo_root" },
      workKey: SECURE_FOUNDATION_WORK_KEY,
      title: "Secure Foundation setup",
      purpose: "Secure Foundation setup",
    });
    // The email goes to the install (the brief) and nowhere else in the request.
    const { input, ...rest } = started[0] as StartSessionRequestInit;
    expect(input?.text).toContain(EMAIL);
    expect(JSON.stringify(rest)).not.toContain(EMAIL);
    expect(JSON.stringify(created)).not.toContain(EMAIL);
  });

  it("refuses when the branch moved after the person confirmed, and leaves nothing", async () => {
    const confirmed = fixture.head();
    const now = fixture.advance();
    const error = await failure(service().create(request({ commit: confirmed })));
    expect(error.status).toBe(409);
    expect(error.code).toBe("template_moved");
    expect(error.message).toContain(now.slice(0, 7));
    expect(existsSync(join(projectsDir, "my-site"))).toBe(false);
    expect(created).toEqual([]);
    // Confirming the new commit works.
    await service().create(request({ commit: now }));
    expect(existsSync(join(projectsDir, "my-site", "CHANGES.md"))).toBe(true);
  });

  it("refuses a folder that already holds something, and doesn't touch it", async () => {
    const dest = join(projectsDir, "my-site");
    mkdirSync(dest, { recursive: true });
    writeFileSync(join(dest, "keep.txt"), "mine\n");
    const error = await failure(service().create(request()));
    expect(error.code).toBe("destination_exists");
    expect(readdirSync(dest)).toEqual(["keep.txt"]);
    expect(started).toEqual([]);
  });

  it("refuses a file of that name too", async () => {
    mkdirSync(projectsDir, { recursive: true });
    writeFileSync(join(projectsDir, "my-site"), "a file\n");
    expect((await failure(service().create(request()))).code).toBe("destination_exists");
  });

  it("refuses a link of that name and leaves what it points at alone", async () => {
    const elsewhere = join(dir, "elsewhere");
    mkdirSync(elsewhere);
    mkdirSync(projectsDir, { recursive: true });
    symlinkSync(elsewhere, join(projectsDir, "my-site"), "dir");
    expect((await failure(service().create(request()))).code).toBe("destination_exists");
    expect(readdirSync(elsewhere)).toEqual([]);
    expect(started).toEqual([]);
  });

  it("never cleans up through a link put where the new folder was", () => {
    const elsewhere = join(dir, "elsewhere");
    mkdirSync(elsewhere);
    writeFileSync(join(elsewhere, "keep.txt"), "mine\n");
    mkdirSync(projectsDir, { recursive: true });
    const link = join(projectsDir, "swapped");
    symlinkSync(elsewhere, link, "dir");
    expect(isOwnFolder(link)).toBe(false);
    removeCreated(link, true);
    removeCreated(link, false);
    expect(readdirSync(elsewhere)).toEqual(["keep.txt"]);
    expect(existsSync(link)).toBe(true);
    // A folder of its own is removed, or emptied when it was there before.
    const own = join(projectsDir, "own");
    mkdirSync(join(own, "sub"), { recursive: true });
    expect(isOwnFolder(own)).toBe(true);
    removeCreated(own, true);
    expect(readdirSync(own)).toEqual([]);
    removeCreated(own, false);
    expect(existsSync(own)).toBe(false);
  });

  it("removes the folder when adding the project fails, and says which step", async () => {
    failAt = "project";
    const error = await failure(service().create(request()));
    expect(error.code).toBe("project_failed");
    expect(error.message).toContain("adding the project");
    expect(existsSync(join(projectsDir, "my-site"))).toBe(false);
    expect(archived).toEqual([]);
  });

  it("archives the project and removes the folder when the session can't start", async () => {
    failAt = "session";
    const error = await failure(service().create(request()));
    expect(error.code).toBe("session_failed");
    expect(archived).toEqual(["p1"]);
    expect(existsSync(join(projectsDir, "my-site"))).toBe(false);
  });

  it("empties, but keeps, an empty folder that was already there", async () => {
    const dest = join(projectsDir, "my-site");
    mkdirSync(dest, { recursive: true });
    failAt = "session";
    await failure(service().create(request()));
    expect(readdirSync(dest)).toEqual([]);
  });

  it("names the fetch when the template can't be reached", async () => {
    const gone = { ...fixture.source, url: join(dir, "nowhere") };
    const error = await failure(service({ template: gone }).create(request()));
    expect(error.code).toBe("fetch_failed");
    expect(existsSync(join(projectsDir, "my-site"))).toBe(false);
  });

  it("refuses a provider that isn't signed in", async () => {
    const signedOut = service({
      setupStatus: async () => ({ checks: [check("alpha", false), check("beta", true)] }),
    });
    expect((await signedOut.options()).providers.map((p) => p.id)).toEqual(["beta"]);
    expect((await failure(signedOut.create(request()))).code).toBe("provider_unavailable");
    expect(existsSync(projectsDir)).toBe(false);
  });

  it("refuses a module the template doesn't have", async () => {
    const error = await failure(
      service().create(request({ shell: "pick", modules: ["blog", "nope"] })),
    );
    expect(error.code).toBe("unknown_module");
    expect(existsSync(join(projectsDir, "my-site"))).toBe(false);
  });

  it("gives the setup session the confirmed repository, owner and scope, and no other", async () => {
    const deploy = { owner: "acme-org", repository: "my-site", vercelScope: "acme-team" };
    await service().create(request({ deploy }));
    const text = started[0]?.input?.text ?? "";
    expect(text).toContain("GitHub repository: acme-org/my-site, private");
    expect(text).toContain('--repo-name="my-site" --owner="acme-org"');
    expect(text).toContain('--scope="acme-team"');
    // Without the option the session is told not to create or deploy anything.
    started = [];
    await service({ projectsDir: join(dir, "other") }).create(request());
    expect(started[0]?.input?.text).toContain("Don't create a GitHub repository");
    expect(started[0]?.input?.text).not.toContain("deploy-to-dev");
  });

  it.each([
    ["an owner that is a path", { owner: "../x", repository: "a", vercelScope: "t" }],
    ["a repository name with a space", { owner: "a", repository: "a b", vercelScope: "t" }],
    ["shell text as the repository", { owner: "a", repository: 'x";id;"', vercelScope: "t" }],
    [
      "a public repository",
      { owner: "a", repository: "a", vercelScope: "t", visibility: "public" },
    ],
    ["a scope with an option in it", { owner: "a", repository: "a", vercelScope: "--prod" }],
  ])("the request schema refuses %s", (_label, deploy) => {
    const parsed = CreateSecureFoundationRequest.safeParse({
      name: "x",
      adminEmail: EMAIL,
      provider: "alpha",
      commit: "a".repeat(40),
      deploy,
    });
    expect(parsed.success).toBe(false);
  });

  it("keeps the template's history and remote in clone mode", async () => {
    await service({ repositoryMode: "clone" }).create(request());
    const dest = join(projectsDir, "my-site");
    expect(git(dest, "rev-parse", "HEAD")).toBe(fixture.head());
    expect(git(dest, "remote")).toBe("origin");
  });
});

describe("names and paths", () => {
  it.each([
    "../escape",
    "..",
    ".hidden",
    "a/b",
    "a\\b",
    "-rf",
    "x\u0000y",
    "",
    "   ",
    "a".repeat(61),
    "$(id)",
    "name;rm",
  ])("the request schema refuses the name %j", (name) => {
    expect(
      CreateSecureFoundationRequest.safeParse({
        name,
        adminEmail: EMAIL,
        provider: "alpha",
        commit: "a".repeat(40),
      }).success,
    ).toBe(false);
  });

  it("always creates a direct child of the projects folder", async () => {
    await service().create(request({ name: "Shop 2.0 _beta_" }));
    expect(readdirSync(projectsDir)).toEqual(["shop-2-0-beta"]);
  });

  it("refuses a commit that isn't a full commit id, and a request that names a URL", () => {
    const base = { name: "x", adminEmail: EMAIL, provider: "alpha" };
    expect(CreateSecureFoundationRequest.safeParse({ ...base, commit: "main" }).success).toBe(
      false,
    );
    const parsed = CreateSecureFoundationRequest.parse({
      ...base,
      commit: "a".repeat(40),
      url: "https://example.org/other.git",
    });
    expect(parsed).not.toHaveProperty("url");
  });
});

describe("providers", () => {
  it("lists signed-in providers, the configured one first, then those that run command files", async () => {
    const list = (preferred: string | null) =>
      service({
        providers: () => [
          provider("plain", { projectCommands: false }),
          provider("runs"),
          provider("free", { projectCommands: false, credentialFree: true }),
          provider("out"),
          provider("unknown"),
        ],
        preferredProvider: () => preferred,
        setupStatus: async () => ({
          checks: [check("plain", null), check("runs", true), check("out", false)],
        }),
      }).providers();
    expect((await list(null)).map((p) => p.id)).toEqual(["runs", "plain", "free"]);
    expect((await list("free")).map((p) => p.id)).toEqual(["free", "runs", "plain"]);
    expect((await list(null))[0]).toMatchObject({ runsCommandFiles: true });
  });
});

describe("prefill", () => {
  const withEmail =
    (stdout: string, code = 0): Exec =>
    async () => ({ code, stdout, stderr: "", notFound: false, timedOut: false, path: "git" });

  it("suggests git's own email", async () => {
    expect(await service({ exec: withEmail(`${EMAIL}\n`) }).prefill()).toEqual({
      adminEmail: EMAIL,
    });
  });

  it.each([
    ["nothing configured", withEmail("", 1)],
    ["something that isn't an email", withEmail("not an address\n")],
    ["a placeholder the install refuses", withEmail("admin@example.com\n")],
    [
      "a source that fails",
      (async () => {
        throw new Error("spawn failed");
      }) as Exec,
    ],
  ])("gives null with %s", async (_label, exec) => {
    expect(await service({ exec }).prefill()).toEqual({ adminEmail: null });
  });

  it("creates nothing and starts nothing", async () => {
    await service({ exec: withEmail(EMAIL) }).prefill();
    expect(created).toEqual([]);
    expect(started).toEqual([]);
    expect(existsSync(projectsDir)).toBe(false);
  });
});

describe("the finish state", () => {
  it("reads the Clerk claim link from the install's summary, and only a Clerk link", () => {
    const dest = join(projectsDir, "my-site");
    mkdirSync(join(dest, "docs"), { recursive: true });
    const s = service();
    expect(s.finish("p1")).toEqual({ clerkClaimUrl: null, deployedUrl: null });
    const url = "https://dashboard.clerk.com/apps/claim?token=fixture";
    writeFileSync(join(dest, "docs/INSTALL.md"), `## Claim Your Clerk App\n\nVisit: ${url}\n`);
    expect(s.finish("p1")).toEqual({ clerkClaimUrl: url, deployedUrl: null });
    writeFileSync(join(dest, "docs/INSTALL.md"), "Visit: https://clerk.com.evil.test/claim\n");
    expect(s.finish("p1")).toEqual({ clerkClaimUrl: null, deployedUrl: null });
    // The deployed site, from the deploy's own summary: a vercel.app address only.
    writeFileSync(
      join(dest, "docs/DEPLOYMENT-DEV.md"),
      "# Deployment\n\n- GitHub: https://github.com/acme-org/my-site\n- **App:** https://my-site.vercel.app/dashboard\n",
    );
    expect(s.finish("p1").deployedUrl).toBe("https://my-site.vercel.app");
    writeFileSync(join(dest, "docs/DEPLOYMENT-DEV.md"), "App: https://vercel.app.evil.test/x\n");
    expect(s.finish("p1").deployedUrl).toBeNull();
  });
});
