// release.sh and publish.sh in a scratch git repository: nothing here touches this checkout,
// a remote, GitHub or npm. `gh` is a stub (test-support/cooldown.mjs).
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { at, fork, github, pathWithoutGh, REPO } from "./test-support/cooldown.mjs";

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
  const gh = github();
  const release = (args = [], env = {}) =>
    sh(dir, "bash", [RELEASE, "--upstream-ref", "up", ...args], {
      RELEASE_NOW: NOW,
      ...gh.env,
      GITHUB_REPOSITORY: REPO,
      ...env,
    });
  const read = (file) => readFileSync(join(dir, file), "utf8");
  return { dir, git, commit, release, read, gh };
}

/**
 * Our own change, then an upstream change merged in by sync pull request #7, which had been
 * approved for two days when it was merged.
 */
function withChanges(repo) {
  repo.commit("own.txt", "feat: our own change");
  repo.git("checkout", "--quiet", "up");
  repo.commit("upstream-2.txt", "fix: upstream two");
  repo.git("checkout", "--quiet", "harden");
  repo.git("merge", "--quiet", "--no-ff", "up", "-m", "Merge upstream");
  const upstream = repo.git("rev-parse", "up");
  const mergeCommit = repo.git("rev-parse", "HEAD");
  const pr = repo.gh.pull(7, {
    head: upstream,
    ref: "sync/2026-11-21",
    labels: ["sync-approved"],
    merged: at(23, "13:00"),
    mergeCommit,
  });
  repo.gh.labelEvents(7, [[at(21, "12:00"), "labeled", "sync-approved"]]);
  repo.gh.pushes("sync/2026-11-21", [[at(21, "11:00"), upstream, "branch_creation"]]);
  repo.gh.pullsOfCommit(mergeCommit, [pr]);
  return upstream;
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
    expect(result.out).toContain(
      `Sync cooldown: upstream ${short} came in through pull request #7 (sync/2026-11-21), merged 2026-11-23 13:00 UTC, 49 hours after sync-approved was applied (2026-11-21 12:00 UTC).`,
    );
  });

  it("lists only our own commits when upstream didn't move, and says so when nothing changed", () => {
    const repo = scratch();
    repo.commit("own.txt", "fix: only ours");
    // A release of our own commits asks GitHub nothing: no gh on PATH, no repository named.
    const own = repo.release([], { PATH: pathWithoutGh(), GITHUB_REPOSITORY: "" });
    expect(own.err).toBe("");
    expect(own.code).toBe(0);
    expect(own.out).not.toContain("Sync cooldown");
    expect(repo.gh.calls()).toEqual([]);
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

const SYNC = "sync/2026-11-23";

/**
 * A fork whose sync pull request #7 was merged on the 23rd at 13:00. By default it had been
 * approved for 49 hours by then; `approved` moves the label, `labels` and `events` replace it.
 */
function merged({ branch = "harden", approved = at(21, "12:00"), events, pushes } = {}) {
  const repo = fork(branch);
  const gh = github();
  const upstream = repo.upstreamCommit();
  const head = repo.syncBranch(SYNC);
  const mergeCommit = repo.merge(SYNC, 7);
  const pr = gh.pull(7, { head, ref: SYNC, merged: at(23, "13:00"), mergeCommit, base: branch });
  gh.labelEvents(7, events ?? [[approved, "labeled", "sync-approved"]]);
  gh.pushes(SYNC, pushes?.(head) ?? [[at(21, "11:00"), head, "branch_creation"]]);
  gh.pullsOfCommit(mergeCommit, [pr]);
  const release = (args = [], env = {}) =>
    repo.run("release.sh", ["--upstream-ref", "up", ...args], {
      RELEASE_NOW: NOW,
      ...gh.env,
      GITHUB_REPOSITORY: REPO,
      HARDEN_BRANCH: branch,
      ...env,
    });
  const read = (file) => readFileSync(join(repo.dir, file), "utf8");
  /** Nothing was written, committed or tagged. */
  const untouched = () => {
    expect(repo.git("rev-parse", "HEAD")).toBe(mergeCommit);
    expect(read("VERSION")).toBe("2026.1122.2006\n");
    expect(repo.git("tag", "-l")).toBe("v2026.1122.2006");
    expect(repo.git("status", "--porcelain")).toBe("");
  };
  return { repo, gh, upstream, head, mergeCommit, pr, release, read, untouched };
}

describe("release.sh and the cooldown", () => {
  it("refuses a release whose sync was merged before its 48 hours were over, and says how the owner waives it", () => {
    const { release, upstream, untouched } = merged({ approved: at(23, "10:00") });
    const result = release();
    expect(result.code).toBe(1);
    expect(result.out).toBe("");
    expect(result.err).toContain(
      "release: refused. This release would ship upstream changes that had not waited out the 48-hour cooldown when they were merged:",
    );
    expect(result.err).toContain(
      `upstream ${upstream.slice(0, 8)} came in through pull request #7 (${SYNC}), merged 2026-11-23 13:00 UTC: it was merged 3 hours after sync-approved was applied (2026-11-23 10:00 UTC); it would have been allowed from 2026-11-25 10:00 UTC.`,
    );
    expect(result.err).toContain(`To waive: upstream commit ${upstream}, pull request 7.`);
    expect(result.err).toContain(
      'Only the repository owner can let it through: Actions > "Waive sync cooldown" > Run workflow on harden',
    );
    expect(result.err).toContain("release: nothing was changed");
    untouched();
  });

  it("gives the same verdict on a dry run, after showing what the release would be", () => {
    const { release, untouched } = merged({ approved: at(23, "10:00") });
    const result = release(["--dry-run"]);
    expect(result.code).toBe(1);
    expect(result.out).toContain("Dry run: nothing is written");
    expect(result.out).toContain("- fix: upstream two");
    expect(result.out).toContain("A real run would stop here:");
    expect(result.out).toContain("it would have been allowed from 2026-11-25 10:00 UTC");
    untouched();
  });

  it("releases a sync that had waited, and says so on a dry run too", () => {
    const { release, read, upstream } = merged();
    const line = `Sync cooldown: upstream ${upstream.slice(0, 8)} came in through pull request #7 (${SYNC}), merged 2026-11-23 13:00 UTC, 49 hours after sync-approved was applied (2026-11-21 12:00 UTC).`;
    const dry = release(["--dry-run"]);
    expect(dry.code).toBe(0);
    expect(dry.out).toContain(line);
    const result = release();
    expect(result.err).toBe("");
    expect(result.code).toBe(0);
    expect(result.out).toContain(line);
    expect(read("state/upstream-base")).toBe(`${upstream}\n`);
    expect(read("CODEHARDEN-CHANGELOG.md")).not.toContain("waived");
  });

  it("releases a sync the owner waived, and keeps the waiver in the changelog entry", () => {
    const { release, read, gh, upstream } = merged({ approved: at(23, "10:00") });
    const id = gh.waiverRun({
      upstream,
      pullRequest: 7,
      started: at(23, "12:00"),
      approvedBy: "the-owner",
    });
    const result = release();
    expect(result.err).toBe("");
    expect(result.code).toBe(0);
    expect(result.out).toContain(
      `Sync cooldown waived by the owner: upstream ${upstream.slice(0, 8)} came in through pull request #7 (${SYNC}), merged 2026-11-23 13:00 UTC; the-owner approved the waiver run that started 2026-11-23 12:00 UTC (https://github.example/runs/${id}).`,
    );
    expect(read("CODEHARDEN-CHANGELOG.md")).toContain(
      `## 2026.1123.0905 — 2026-11-23 09:05\n\nSync cooldown waived by the owner for upstream ${upstream.slice(0, 8)} (approved by the-owner, 2026-11-23 12:00 UTC).\n\n### upstream (leonvanzyl/codeden)\n- fix: upstream two\n\n### codeharden\n`,
    );
  });

  it("accepts a waiver given after the merge, and none for another commit or one nobody approved", () => {
    const early = { events: [] };
    const after = merged(early);
    after.gh.waiverRun({ upstream: after.upstream, started: at(23, "20:00") });
    expect(after.release().code).toBe(0);

    const other = merged(early);
    other.gh.waiverRun({ upstream: "e".repeat(40), pullRequest: 7, started: at(23, "20:00") });
    expect(other.release().code).toBe(1);

    const unapproved = merged(early);
    unapproved.gh.waiverRun({
      upstream: unapproved.upstream,
      pullRequest: 7,
      started: at(23, "20:00"),
      approvedBy: null,
    });
    expect(unapproved.release().code).toBe(1);
    unapproved.untouched();
  });

  it("refuses a sync that was never approved, was on hold, or was pushed after its approval", () => {
    const never = merged({ events: [] }).release();
    expect(never.code).toBe(1);
    expect(never.err).toContain(
      "it did not have the label sync-approved when it was merged, so there is no time from which it would have been allowed",
    );

    // Approved only after it was merged: the label's time is what counts, not that it is there.
    const late = merged({ approved: at(23, "13:30") }).release();
    expect(late.code).toBe(1);
    expect(late.err).toContain("it did not have the label sync-approved when it was merged");

    const held = merged({
      events: [
        [at(21, "12:00"), "labeled", "sync-approved"],
        [at(22), "labeled", "sync-hold"],
      ],
    }).release();
    expect(held.code).toBe(1);
    expect(held.err).toContain(
      "it had the label sync-hold when it was merged; without the hold it would have been allowed from 2026-11-23 12:00 UTC",
    );

    const pushed = merged({
      pushes: (head) => [
        [at(23, "12:30"), head],
        [at(21, "11:00"), "a".repeat(40), "branch_creation"],
      ],
    }).release();
    expect(pushed.code).toBe(1);
    expect(pushed.err).toContain(
      "its head branch was pushed 2026-11-23 12:30 UTC, after sync-approved was applied (2026-11-21 12:00 UTC), so the approval did not cover what was merged",
    );
  });

  it("ignores what happened to the pull request after it was merged", () => {
    // The branch was deleted and the label taken off afterwards: at the merge all was in order.
    const { release } = merged({
      events: [
        [at(21, "12:00"), "labeled", "sync-approved"],
        [at(23, "14:00"), "unlabeled", "sync-approved"],
        [at(23, "14:01"), "labeled", "sync-hold"],
      ],
      pushes: (head) => [
        [at(23, "13:01"), "0".repeat(40), "branch_deletion"],
        [at(21, "11:00"), head, "branch_creation"],
      ],
    });
    expect(release().code).toBe(0);
  });

  it("refuses upstream commits that came in without a pull request, until the owner waives the commit", () => {
    const repo = fork();
    const gh = github();
    const upstream = repo.upstreamCommit();
    repo.git("merge", "--quiet", "--no-ff", "up", "-m", "Merge upstream by hand");
    const landing = repo.git("rev-parse", "HEAD");
    // A merge made here and not pushed: GitHub doesn't know the commit at all.
    gh.notPushed(landing);
    const release = () =>
      repo.run("release.sh", ["--upstream-ref", "up"], {
        RELEASE_NOW: NOW,
        ...gh.env,
        GITHUB_REPOSITORY: REPO,
      });
    const refused = release();
    expect(refused.code).toBe(1);
    expect(refused.err).toContain(
      `upstream ${upstream.slice(0, 8)} came in through the commit ${landing.slice(0, 8)} ("Merge upstream by hand"), which is not the merge of a pull request into harden: nothing was approved`,
    );
    expect(refused.err).toContain(`To waive: upstream commit ${upstream}, no pull request.`);
    // A waiver that names a pull request is not for this one; one that names none is.
    gh.waiverRun({ upstream, pullRequest: 7, started: at(23, "20:00") });
    expect(release().code).toBe(1);
    gh.waiverRun({ upstream, started: at(23, "21:00") });
    const waived = release();
    expect(waived.code).toBe(0);
    expect(waived.out).toContain("Sync cooldown waived by the owner");
  });

  it("accounts for every upstream commit: one that arrived by a fast-forward is not covered by a later sync", () => {
    // Upstream took this fork's history in, and the branch was fast-forwarded onto it: no
    // merge, no pull request. A later sync, properly approved and cooled, comes on top.
    const repo = fork();
    const gh = github();
    repo.git("checkout", "--quiet", "up");
    repo.git("merge", "--quiet", "--no-ff", "harden", "-m", "Merge the fork's history");
    const forwarded = repo.git("rev-parse", "HEAD");
    repo.git("checkout", "--quiet", "harden");
    repo.git("merge", "--quiet", "--ff-only", "up");
    const later = repo.upstreamCommit();
    const mergeCommit = repo.merge("up", 7);
    const pr = gh.pull(7, { head: later, ref: SYNC, merged: at(23, "13:00"), mergeCommit });
    gh.labelEvents(7, [[at(21, "12:00"), "labeled", "sync-approved"]]);
    gh.pushes(SYNC, [[at(21, "11:00"), later, "branch_creation"]]);
    gh.pullsOfCommit(mergeCommit, [pr]);
    const release = () =>
      repo.run("release.sh", ["--upstream-ref", "up"], {
        RELEASE_NOW: NOW,
        ...gh.env,
        GITHUB_REPOSITORY: REPO,
      });
    const refused = release();
    expect(refused.code).toBe(1);
    expect(refused.err).toContain(
      `upstream ${forwarded.slice(0, 8)} is on harden's own line: it arrived by a fast-forward or a direct push, not through a pull request: nothing was approved`,
    );
    expect(refused.err).toContain(`To waive: upstream commit ${forwarded}, no pull request.`);
    // The sync on top was in order, and is not what is refused.
    expect(refused.err).not.toContain("pull request #7");
    gh.waiverRun({ upstream: forwarded, started: at(23, "20:00") });
    const released = release();
    expect(released.err).toBe("");
    expect(released.code).toBe(0);
    expect(released.out).toContain(
      `Sync cooldown waived by the owner: upstream ${forwarded.slice(0, 8)} is on harden's own line`,
    );
    expect(released.out).toContain(
      `Sync cooldown: upstream ${later.slice(0, 8)} came in through pull request #7`,
    );
  });

  it("refuses a branch that is itself an upstream commit", () => {
    const repo = fork();
    const gh = github();
    repo.git("checkout", "--quiet", "up");
    repo.git("merge", "--quiet", "--no-ff", "harden", "-m", "Merge the fork's history");
    repo.git("checkout", "--quiet", "harden");
    repo.git("merge", "--quiet", "--ff-only", "up");
    const result = repo.run("release.sh", ["--upstream-ref", "up"], {
      RELEASE_NOW: NOW,
      ...gh.env,
      GITHUB_REPOSITORY: REPO,
    });
    expect(result.code).toBe(1);
    expect(result.err).toContain(
      "it arrived by a fast-forward or a direct push, not through a pull request",
    );
    expect(gh.calls().some((call) => call.includes("/commits/"))).toBe(false);
  });

  it("names the pull request that really landed the commits, also when it was not the sync's own", () => {
    // The sync branch was merged into a working branch, and that branch's pull request landed it.
    const repo = fork();
    const gh = github();
    const upstream = repo.upstreamCommit();
    repo.syncBranch(SYNC);
    repo.git("checkout", "--quiet", "-b", "codeden/second-review", "harden");
    repo.git("merge", "--quiet", "--no-ff", SYNC, "-m", `Merge branch '${SYNC}' into harden`);
    const head = repo.commit("review.txt", "fix: review findings");
    repo.git("checkout", "--quiet", "harden");
    const mergeCommit = repo.merge("codeden/second-review", 28);
    const pr = gh.pull(28, {
      head,
      ref: "codeden/second-review",
      merged: at(23, "17:15"),
      mergeCommit,
    });
    gh.pushes("codeden/second-review", [[at(23, "17:00"), head]]);
    gh.pullsOfCommit(mergeCommit, [pr]);
    const result = repo.run("release.sh", ["--upstream-ref", "up"], {
      RELEASE_NOW: NOW,
      ...gh.env,
      GITHUB_REPOSITORY: REPO,
    });
    expect(result.code).toBe(1);
    expect(result.err).toContain(
      `upstream ${upstream.slice(0, 8)} came in through pull request #28 (codeden/second-review), merged 2026-11-23 17:15 UTC: it did not have the label sync-approved when it was merged`,
    );
    expect(result.err).toContain(`To waive: upstream commit ${upstream}, pull request 28.`);
  });

  it("finds the pull request in the list of merged ones when GitHub has not tied it to the commit yet", () => {
    const { release, gh, mergeCommit, pr } = merged();
    gh.pullsOfCommit(mergeCommit, []);
    expect(release().code).toBe(1);
    gh.closedPulls([{ ...pr, number: 3, merge_commit_sha: "f".repeat(40) }, pr]);
    expect(release().code).toBe(0);
  });

  it("judges each sync of a release by itself", () => {
    const { repo, gh, release, upstream } = merged();
    const second = repo.upstreamCommit("upstream-3.txt", "feat: upstream three");
    const head = repo.syncBranch("sync/2026-11-24");
    const mergeCommit = repo.merge("sync/2026-11-24", 9);
    const pr = gh.pull(9, { head, ref: "sync/2026-11-24", merged: at(24, "13:00"), mergeCommit });
    gh.labelEvents(9, [[at(24, "09:00"), "labeled", "sync-approved"]]);
    gh.pushes("sync/2026-11-24", [[at(24, "08:00"), head, "branch_creation"]]);
    gh.pullsOfCommit(mergeCommit, [pr]);
    const refused = release();
    expect(refused.code).toBe(1);
    expect(refused.err).toContain(`upstream ${second.slice(0, 8)} came in through pull request #9`);
    expect(refused.err).not.toContain("pull request #7");
    gh.waiverRun({ upstream: second, pullRequest: 9, started: at(24, "12:00") });
    const released = release();
    expect(released.code).toBe(0);
    expect(released.out).toContain(
      `Sync cooldown: upstream ${upstream.slice(0, 8)} came in through pull request #7`,
    );
    expect(released.out).toContain(
      `Sync cooldown waived by the owner: upstream ${second.slice(0, 8)} came in through pull request #9`,
    );
  });

  it("refuses when GitHub can't be asked, and a dry run still explains", () => {
    const noGh = merged();
    const missing = noGh.release([], { PATH: pathWithoutGh() });
    expect(missing.code).toBe(1);
    expect(missing.err).toContain(
      "release: refused. GitHub could not be asked whether the upstream changes in this release waited out their cooldown, and a release with new upstream commits is not cut without that answer.",
    );
    expect(missing.err).toContain("the GitHub CLI (gh) is not on PATH");
    expect(missing.err).toContain("release: nothing was changed");
    noGh.untouched();

    const dry = noGh.release(["--dry-run"], { PATH: pathWithoutGh() });
    expect(dry.code).toBe(1);
    expect(dry.out).toContain("New entry in CODEHARDEN-CHANGELOG.md:");
    expect(dry.out).toContain("A real run would stop here:");
    expect(dry.out).toContain("the GitHub CLI (gh) is not on PATH");
  });

  it("refuses when a call to GitHub fails, whichever it is, or when there is no repository to ask", () => {
    for (const pattern of ["commits/", "pulls/7", "timeline", "activity"]) {
      const down = merged();
      down.gh.fail(pattern, "GET repos/[^ ]+/pulls$");
      const result = down.release();
      expect(result.code).toBe(1);
      expect(result.err).toContain("GitHub could not be asked");
      expect(result.err).toContain("GitHub did not answer");
      down.untouched();
    }

    const nowhere = merged();
    const unnamed = nowhere.release([], { GITHUB_REPOSITORY: "" });
    expect(unnamed.code).toBe(1);
    expect(unnamed.err).toContain("there is no repository to ask");
    nowhere.untouched();
  });

  it("works in a fork whose working branch has another name", () => {
    const fine = merged({ branch: "trunk" });
    const released = fine.release();
    expect(released.err).toBe("");
    expect(released.code).toBe(0);
    const early = merged({ branch: "trunk", approved: at(23, "10:00") });
    const refused = early.release();
    expect(refused.code).toBe(1);
    expect(refused.err).toContain("Run workflow on trunk");
    // A pull request into another branch is not the one that landed it on this one.
    early.gh.pullsOfCommit(early.mergeCommit, [{ ...early.pr, base: { ref: "harden" } }]);
    expect(early.release().err).toContain("which is not the merge of a pull request into trunk");
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
