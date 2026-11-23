import { describe, expect, it } from "vitest";
import {
  HARDEN_PACKAGE_NAME,
  HARDEN_REPOSITORY,
} from "../../packages/contracts/src/harden-channel.ts";
import {
  DEFAULT_PACKAGE_NAME,
  DEFAULT_RELEASE_REPOSITORY,
  hardenChannelDefine,
  readHardenChannel,
} from "./channel-define.mjs";

describe("the build-time update channel", () => {
  it("defaults to CodeHarden's package and repository, as the contracts module does", () => {
    expect(readHardenChannel({})).toEqual({
      packageName: "codeharden",
      repository: "harperaa/codeharden",
      owner: "harperaa",
      repo: "codeharden",
    });
    expect(DEFAULT_PACKAGE_NAME).toBe(HARDEN_PACKAGE_NAME);
    expect(DEFAULT_RELEASE_REPOSITORY).toBe(HARDEN_REPOSITORY);
  });

  it("takes PACKAGE_NAME and RELEASE_REPOSITORY from the build environment", () => {
    const env = { PACKAGE_NAME: "@acme/harden", RELEASE_REPOSITORY: "acme/harden-fork" };
    expect(readHardenChannel(env)).toMatchObject({ owner: "acme", repo: "harden-fork" });
    expect(hardenChannelDefine(env)).toEqual({
      __CODEHARDEN_PACKAGE__: '"@acme/harden"',
      __CODEHARDEN_REPOSITORY__: '"acme/harden-fork"',
    });
  });

  it("treats empty variables as unset", () => {
    expect(hardenChannelDefine({ PACKAGE_NAME: "", RELEASE_REPOSITORY: " " })).toEqual({
      __CODEHARDEN_PACKAGE__: '"codeharden"',
      __CODEHARDEN_REPOSITORY__: '"harperaa/codeharden"',
    });
  });

  it("refuses a malformed package name or repository instead of building with it", () => {
    expect(() => readHardenChannel({ PACKAGE_NAME: "Code Harden" })).toThrow(/PACKAGE_NAME/);
    expect(() => readHardenChannel({ PACKAGE_NAME: "../codeden" })).toThrow(/PACKAGE_NAME/);
    expect(() =>
      readHardenChannel({ RELEASE_REPOSITORY: "https://github.com/harperaa/codeharden" }),
    ).toThrow(/RELEASE_REPOSITORY/);
  });
});
