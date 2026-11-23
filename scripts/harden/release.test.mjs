// release.sh and publish.sh in a scratch git repository: nothing here touches this checkout,
// a remote or npm.
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const RELEASE = fileURLToPath(new URL("./release.sh", import.meta.url));
const PUBLISH = fileURLToPath(new URL("./publish.sh", import.meta.url));
const NOW = "2026.1123.0905 2026-11-23 09:05";
const ENV = {
  PATH: process.env.PATH,
  HOME: tmpdir(),
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_AUTHOR_NAME: "Test",
  GIT_AUTHOR_EMAIL: "test@example.invalid",
  GIT_COMMITTER_NAME: "Test",
  GIT_COMMITTER_EMAIL: "test@example.invalid",
};

function sh(cwd, command, args, env = {}) {
  const result = spawnSync(command, args, { cwd, encoding: "utf8", env: { ...ENV, ...env } });
  return { code: result.status, out: result.stdout.trim(), err: result.stderr.trim() };
}

/** A repository with an upstream branch (`up`) and a fork branch that made one release. */
function scratch() {
  const dir = mkdtempSync(join(tmpdir(), "codeharden-release-test-"));
  const git = (...args) => {
    const result = sh(dir, "git", args);
    if (result.code !== 0) throw new Error(`git ${args.join(" ")}: ${result.err}`);
    return result.out;
  };
  const commit = (file, subject) => {
    writeFileSync(join(dir, file), `${subject}\n`);
    git("add", file);
    git("commit", "--quiet", "-m", subject);
  };
  git("init", "--quiet", "--initial-branch=harden");
  commit("upstream-1.txt", "feat: upstream one");
  git("branch", "up");
  mkdirSync(join(dir, "state"));
  writeFileSync(join(dir, "VERSION"), "2026.1122.2006\n");
  writeFileSync(join(dir, "state", "upstream-base"), `${git("rev-parse", "HEAD")}\n`);
  writeFileSync(
    join(dir, "CODEHARDEN-CHANGELOG.md"),
    "# CodeHarden releases\n\n## 2026.1122.2006 — 2026-11-22 20:06\n\n### codeharden\n- docs: introduce CodeHarden\n",
  );
  git("add", ".");
  git("commit", "--quiet", "-m", "release: 2026.1122.2006 (upstream 00000000)");
  git("tag", "-a", "v2026.1122.2006", "-m", "CodeHarden 2026.1122.2006");
  const release = (args = [], env = {}) =>
    sh(dir, "bash", [RELEASE, "--upstream-ref", "up", ...args], { RELEASE_NOW: NOW, ...env });
  const read = (file) => readFileSync(join(dir, file), "utf8");
  return { dir, git, commit, release, read };
}

/** Our own change, then an upstream change merged in. */
function withChanges(repo) {
  repo.commit("own.txt", "feat: our own change");
  repo.git("checkout", "--quiet", "up");
  repo.commit("upstream-2.txt", "fix: upstream two");
  repo.git("checkout", "--quiet", "harden");
  repo.git("merge", "--quiet", "--no-ff", "up", "-m", "Merge upstream");
  return repo.git("rev-parse", "up");
}

describe("release.sh", () => {
  it("writes VERSION, the changelog entry and the upstream base, commits and tags", () => {
    const repo = scratch();
    const upstream = withChanges(repo);
    const result = repo.release();
    expect(result.err).toBe("");
    expect(result.code).toBe(0);
    expect(repo.read("VERSION")).toBe("2026.1123.0905\n");
    expect(repo.read("state/upstream-base")).toBe(`${upstream}\n`);
    expect(repo.read("CODEHARDEN-CHANGELOG.md")).toBe(
      [
        "# CodeHarden releases",
        "",
        "## 2026.1123.0905 — 2026-11-23 09:05",
        "",
        "### upstream (leonvanzyl/codeden)",
        "- fix: upstream two",
        "",
        "### codeharden",
        "- feat: our own change",
        "",
        "## 2026.1122.2006 — 2026-11-22 20:06",
        "",
        "### codeharden",
        "- docs: introduce CodeHarden",
        "",
      ].join("\n"),
    );
    const short = upstream.slice(0, 8);
    expect(repo.git("log", "-1", "--format=%s")).toBe(
      `release: 2026.1123.0905 (upstream ${short})`,
    );
    expect(
      repo.git("show", "--stat", "--format=", "HEAD").split("\n").slice(0, 3).join(" "),
    ).toMatch(/CODEHARDEN-CHANGELOG\.md.*VERSION.*state\/upstream-base/);
    expect(repo.git("cat-file", "-t", "v2026.1123.0905")).toBe("tag");
    expect(repo.git("tag", "-l", "--format=%(contents:subject)", "v2026.1123.0905")).toBe(
      `CodeHarden 2026.1123.0905 (upstream ${short})`,
    );
    expect(repo.git("rev-parse", "v2026.1123.0905^{commit}")).toBe(repo.git("rev-parse", "HEAD"));
    expect(repo.git("status", "--porcelain")).toBe("");
    expect(result.out).toContain("Not pushed.");
  });

  it("lists only our own commits when upstream didn't move, and says so when nothing changed", () => {
    const repo = scratch();
    repo.commit("own.txt", "fix: only ours");
    expect(repo.release().code).toBe(0);
    const first = repo.read("CODEHARDEN-CHANGELOG.md");
    expect(first).toContain(
      "## 2026.1123.0905 — 2026-11-23 09:05\n\n### codeharden\n- fix: only ours\n\n## ",
    );
    expect(first).not.toContain("### upstream");

    const again = repo.release([], { RELEASE_NOW: "2026.1123.0906 2026-11-23 09:06" });
    expect(again.code).toBe(0);
    expect(repo.read("CODEHARDEN-CHANGELOG.md")).toContain(
      "## 2026.1123.0906 — 2026-11-23 09:06\n\n- rebuild only (upstream base or dependency refresh)\n\n## 2026.1123.0905",
    );
  });

  it("changes nothing on a dry run", () => {
    const repo = scratch();
    withChanges(repo);
    const head = repo.git("rev-parse", "HEAD");
    const result = repo.release(["--dry-run"]);
    expect(result.code).toBe(0);
    expect(result.out).toContain("Dry run: nothing is written");
    expect(result.out).toContain("## 2026.1123.0905 — 2026-11-23 09:05");
    expect(result.out).toContain("- feat: our own change");
    expect(repo.git("rev-parse", "HEAD")).toBe(head);
    expect(repo.read("VERSION")).toBe("2026.1122.2006\n");
    expect(repo.git("tag", "-l")).toBe("v2026.1122.2006");
    expect(repo.git("status", "--porcelain")).toBe("");
  });

  it("refuses when the tag already exists, and changes nothing", () => {
    const repo = scratch();
    repo.commit("own.txt", "fix: only ours");
    expect(repo.release().code).toBe(0);
    const head = repo.git("rev-parse", "HEAD");
    repo.commit("more.txt", "fix: one more");
    const after = repo.git("rev-parse", "HEAD");
    const second = repo.release();
    expect(second.code).toBe(1);
    expect(second.err).toContain("tag v2026.1123.0905 already exists");
    expect(repo.git("rev-parse", "HEAD")).toBe(after);
    expect(repo.git("rev-parse", "v2026.1123.0905^{commit}")).toBe(head);
    expect(repo.read("VERSION")).toBe("2026.1123.0905\n");
  });

  it("refuses with changes to tracked files, a bad base or a bad clock", () => {
    const dirty = scratch();
    writeFileSync(join(dirty.dir, "upstream-1.txt"), "edited\n");
    expect(dirty.release().err).toContain("tracked files have changes");

    const badBase = scratch();
    writeFileSync(join(badBase.dir, "state", "upstream-base"), "not-a-commit\n");
    badBase.git("commit", "--quiet", "-am", "break the base");
    expect(badBase.release().err).toContain("doesn't hold a commit");

    const badClock = scratch();
    expect(badClock.release([], { RELEASE_NOW: "2026.105.518 2026-01-05 05:18" }).err).toContain(
      "is not a version",
    );
    expect(badClock.release(["--push"]).err).toContain("no remote named origin");
  });
});

describe("publish.sh", () => {
  it("refuses a tree with changes, a checkout off the release tag, and a missing tag", () => {
    const repo = scratch();
    // On the tag, but with an untracked file.
    writeFileSync(join(repo.dir, "stray.txt"), "x\n");
    const dirty = sh(repo.dir, "bash", [PUBLISH, "--dry-run"]);
    expect(dirty.code).toBe(1);
    expect(dirty.err).toContain("the working tree has changes");

    repo.commit("stray.txt", "chore: past the release");
    const off = sh(repo.dir, "bash", [PUBLISH, "--dry-run"]);
    expect(off.code).toBe(1);
    expect(off.err).toContain("HEAD is not the release v2026.1122.2006");

    writeFileSync(join(repo.dir, "VERSION"), "2026.1201.0000\n");
    repo.git("commit", "--quiet", "-am", "pretend release without a tag");
    const untagged = sh(repo.dir, "bash", [PUBLISH]);
    expect(untagged.code).toBe(1);
    expect(untagged.err).toContain("the tag v2026.1201.0000 is not in this checkout");
  });

  it("rejects options it doesn't know (there is no one-time code option)", () => {
    const repo = scratch();
    const result = sh(repo.dir, "bash", [PUBLISH, "--otp", "123456"]);
    expect(result.code).toBe(2);
    expect(result.err).toContain("unknown option --otp");
  });
});
