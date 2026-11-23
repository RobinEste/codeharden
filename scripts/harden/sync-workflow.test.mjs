// The sync workflow's protected-paths rule, run as written: the function is cut out of the
// workflow file and run with bash in a scratch repository laid out like the merge job's.
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

const workflow = readFileSync(
  new URL("../../.github/workflows/upstream-sync-merge.yml", import.meta.url),
  "utf8",
);
const snippet =
  /# protected-paths:begin\n([\s\S]*?)# protected-paths:end/.exec(workflow)?.[1] ?? "";
const protectedPaths = /^ {2}PROTECTED_PATHS: (.+)$/m.exec(workflow)?.[1] ?? "";

const ENV = {
  PATH: process.env.PATH,
  HOME: tmpdir(),
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_AUTHOR_NAME: "Test",
  GIT_AUTHOR_EMAIL: "test@example.invalid",
  GIT_COMMITTER_NAME: "Test",
  GIT_COMMITTER_EMAIL: "test@example.invalid",
};

function scratch() {
  const dir = mkdtempSync(join(tmpdir(), "codeharden-sync-test-"));
  const git = (...args) => {
    const result = spawnSync("git", args, { cwd: dir, encoding: "utf8", env: ENV });
    if (result.status !== 0) throw new Error(`git ${args.join(" ")}: ${result.stderr}`);
    return result.stdout.trim();
  };
  const commit = (file, text) => {
    mkdirSync(dirname(join(dir, file)), { recursive: true });
    writeFileSync(join(dir, file), text);
    git("add", file);
    git("commit", "--quiet", "-m", `change ${file}`);
    return git("rev-parse", "HEAD");
  };
  git("init", "--quiet", "--initial-branch=up");
  commit("app.txt", "one\n");
  git("checkout", "--quiet", "-b", "harden");
  commit("scripts/harden/release.sh", "ours\n");
  git("update-ref", "refs/sync/target", "HEAD");
  /** What the workflow's function prints for a head commit. */
  const touched = (sha) => {
    const result = spawnSync(
      "bash",
      ["-c", `set -euo pipefail\n${snippet}\ntouches_protected "$1"`, "bash", sha],
      {
        cwd: dir,
        encoding: "utf8",
        env: { ...ENV, PROTECTED_PATHS: protectedPaths },
      },
    );
    if (result.status !== 0) throw new Error(result.stderr);
    return result.stdout.trim();
  };
  return { git, commit, touched };
}

describe("the sync workflow's protected paths", () => {
  it("protects this fork's release scripts, by a function the merge job calls before merging", () => {
    expect(protectedPaths.split(" ")).toContain("scripts/harden/");
    expect(snippet).toContain("touches_protected()");
    const check = workflow.indexOf('touches_protected "$head_sha"');
    expect(check).toBeGreaterThan(-1);
    expect(check).toBeLessThan(workflow.indexOf('gh pr merge "$number"'));
  });

  it("lets through a head that is upstream code only, or a clean merge of it", () => {
    const repo = scratch();
    repo.git("checkout", "--quiet", "up");
    const upstream = repo.commit("app.txt", "two\n");
    expect(repo.touched(upstream)).toBe("");
    repo.git("checkout", "--quiet", "-b", "sync/x", "up");
    repo.git("merge", "--quiet", "--no-ff", "harden", "-m", "merge harden");
    expect(repo.touched(repo.git("rev-parse", "HEAD"))).toBe("");
  });

  it("names the protected files an upstream commit adds", () => {
    const repo = scratch();
    repo.git("checkout", "--quiet", "up");
    const upstream = repo.commit("scripts/harden/extra.sh", "theirs\n");
    expect(repo.touched(upstream)).toBe("scripts/harden/extra.sh");
  });

  it("names the protected files a merge commit changes", () => {
    const repo = scratch();
    repo.git("checkout", "--quiet", "up");
    repo.commit("app.txt", "two\n");
    repo.git("checkout", "--quiet", "-b", "sync/x", "up");
    repo.git("merge", "--quiet", "--no-ff", "--no-commit", "harden");
    writeFileSync(
      join(repo.git("rev-parse", "--show-toplevel"), "scripts/harden/release.sh"),
      "changed\n",
    );
    repo.git("add", "-A");
    repo.git("commit", "--quiet", "-m", "merge harden");
    expect(repo.touched(repo.git("rev-parse", "HEAD"))).toBe("scripts/harden/release.sh");
  });
});
