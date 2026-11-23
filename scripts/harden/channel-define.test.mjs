import { afterEach, describe, expect, it, vi } from "vitest";
import {
  HARDEN_BRANCH,
  HARDEN_PACKAGE_NAME,
  HARDEN_REPOSITORY,
} from "../../packages/contracts/src/harden-channel.ts";
import {
  DEFAULT_HARDEN_BRANCH,
  DEFAULT_PACKAGE_NAME,
  DEFAULT_RELEASE_REPOSITORY,
  hardenChannelDefine,
  readHardenChannel,
  repositoryOfRemote,
} from "./channel-define.mjs";

const OWN = { origin: "harperaa/codeharden" };
const FORK = { origin: "example/example-harden" };

afterEach(() => {
  vi.restoreAllMocks();
});

describe("the build-time update channel", () => {
  it("defaults to CodeHarden's package, repository and branch, as the contracts module does", () => {
    for (const options of [OWN, { origin: null }, { origin: "HarperAA/CodeHarden" }]) {
      expect(readHardenChannel({}, options)).toMatchObject({
        packageName: "codeharden",
        owner: "harperaa",
        repo: "codeharden",
        branch: "harden",
      });
    }
    expect(readHardenChannel({}, OWN).repository).toBe("harperaa/codeharden");
    expect(DEFAULT_PACKAGE_NAME).toBe(HARDEN_PACKAGE_NAME);
    expect(DEFAULT_RELEASE_REPOSITORY).toBe(HARDEN_REPOSITORY);
    expect(DEFAULT_HARDEN_BRANCH).toBe(HARDEN_BRANCH);
  });

  it("takes PACKAGE_NAME, RELEASE_REPOSITORY and HARDEN_BRANCH from the build environment", () => {
    const env = {
      PACKAGE_NAME: "@acme/harden",
      RELEASE_REPOSITORY: "acme/harden-fork",
      HARDEN_BRANCH: "work",
    };
    expect(readHardenChannel(env, OWN)).toMatchObject({ owner: "acme", repo: "harden-fork" });
    expect(hardenChannelDefine(env, OWN)).toEqual({
      __CODEHARDEN_PACKAGE__: '"@acme/harden"',
      __CODEHARDEN_REPOSITORY__: '"acme/harden-fork"',
      __CODEHARDEN_BRANCH__: '"work"',
    });
  });

  it("takes the release repository from the origin remote, so a fork needs no variable for it", () => {
    const define = hardenChannelDefine({ PACKAGE_NAME: "example-harden" }, FORK);
    expect(define).toEqual({
      __CODEHARDEN_PACKAGE__: '"example-harden"',
      __CODEHARDEN_REPOSITORY__: '"example/example-harden"',
      __CODEHARDEN_BRANCH__: '"harden"',
    });
    expect(JSON.stringify(define)).not.toContain("codeharden");
    // The environment still wins over the remote.
    expect(
      readHardenChannel({ PACKAGE_NAME: "x", RELEASE_REPOSITORY: "other/place" }, FORK).repository,
    ).toBe("other/place");
  });

  it("reads owner/repo from GitHub remote URLs only", () => {
    for (const url of [
      "https://github.com/example/example-harden",
      "https://github.com/example/example-harden.git\n",
      "git@github.com:example/example-harden.git",
      "ssh://git@github.com/example/example-harden.git",
    ]) {
      expect(repositoryOfRemote(url)).toBe("example/example-harden");
    }
    for (const url of [
      "",
      "/tmp/somewhere.git",
      "https://example.com/a/b",
      "https://github.com/a/b/c",
    ]) {
      expect(repositoryOfRemote(url)).toBeNull();
    }
  });

  it("treats empty variables as unset", () => {
    expect(
      hardenChannelDefine({ PACKAGE_NAME: "", RELEASE_REPOSITORY: " ", HARDEN_BRANCH: "" }, OWN),
    ).toEqual({
      __CODEHARDEN_PACKAGE__: '"codeharden"',
      __CODEHARDEN_REPOSITORY__: '"harperaa/codeharden"',
      __CODEHARDEN_BRANCH__: '"harden"',
    });
  });

  it("refuses a malformed package name, repository or branch instead of building with it", () => {
    expect(() => readHardenChannel({ PACKAGE_NAME: "Code Harden" }, OWN)).toThrow(/PACKAGE_NAME/);
    expect(() => readHardenChannel({ PACKAGE_NAME: "../codeden" }, OWN)).toThrow(/PACKAGE_NAME/);
    expect(() =>
      readHardenChannel({ RELEASE_REPOSITORY: "https://github.com/harperaa/codeharden" }, OWN),
    ).toThrow(/RELEASE_REPOSITORY/);
    for (const branch of ["a b", "../x", "x..y", "-x", "x/", "x.lock"]) {
      expect(() => readHardenChannel({ HARDEN_BRANCH: branch }, OWN)).toThrow(/HARDEN_BRANCH/);
    }
  });

  it("only warns when an ordinary build in another repository has no PACKAGE_NAME", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const channel = readHardenChannel({}, FORK);
    expect(channel).toMatchObject({ packageName: "codeharden", repository: FORK.origin });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain("PACKAGE_NAME");
    // Once per process, and never in CodeHarden itself or without a GitHub origin.
    readHardenChannel({}, FORK);
    readHardenChannel({}, OWN);
    readHardenChannel({}, { origin: null });
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("refuses to pack a release as codeharden outside CodeHarden's own repository", () => {
    expect(readHardenChannel({}, { ...OWN, strict: true }).packageName).toBe("codeharden");
    expect(() => readHardenChannel({}, { ...FORK, strict: true })).toThrow(
      /PACKAGE_NAME is not set.*example\/example-harden/,
    );
    expect(() => readHardenChannel({}, { origin: null, strict: true })).toThrow(/PACKAGE_NAME/);
    expect(() =>
      readHardenChannel({ PACKAGE_NAME: "example-harden" }, { origin: null, strict: true }),
    ).toThrow(/RELEASE_REPOSITORY/);
    expect(
      readHardenChannel({ PACKAGE_NAME: "example-harden" }, { ...FORK, strict: true }),
    ).toMatchObject({ packageName: "example-harden", repository: "example/example-harden" });
  });
});
