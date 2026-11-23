import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { hardenNpmVersion } from "../../packages/contracts/src/harden-channel.ts";
import {
  commandName,
  NPM_REGISTRY,
  npmVersion,
  releaseManifest,
  releaseReadme,
  tarballName,
  tarballProblems,
} from "./npm-release.mjs";

const channel = { packageName: "codeharden", repository: "harperaa/codeharden" };
const release = { hardenVersion: "2026.0105.0518", channel };
const repoPackage = JSON.parse(
  readFileSync(new URL("../../apps/cli/package.json", import.meta.url), "utf8"),
);

function unpacked(manifest, files = []) {
  const dir = mkdtempSync(join(tmpdir(), "codeharden-npm-test-"));
  const all = ["README.md", "LICENSE", "dist/cli.js", "dist/runner.js", "dist/web/index.html"];
  for (const file of [...all, "dist/THIRD-PARTY-NOTICES.txt", ...files]) {
    mkdirSync(dirname(join(dir, file)), { recursive: true });
    writeFileSync(join(dir, file), "");
  }
  writeFileSync(join(dir, "package.json"), JSON.stringify(manifest));
  return dir;
}

describe("the npm release", () => {
  it("strips the leading zeros of a CodeHarden version, as the app's own mapping does", () => {
    for (const version of [
      "2026.0105.0518",
      "2026.1122.2006",
      "2026.0101.0000",
      "2027.1231.2359",
    ]) {
      expect(npmVersion(version)).toBe(hardenNpmVersion(version));
    }
    expect(npmVersion("2026.0105.0518")).toBe("2026.105.518");
    expect(() => npmVersion("0.7.7")).toThrow(/not a CodeHarden version/);
    expect(() => npmVersion("2026.105.518")).toThrow(/not a CodeHarden version/);
  });

  it("names the command and the tarball after the package", () => {
    expect(commandName("codeharden")).toBe("codeharden");
    expect(commandName("@acme/harden")).toBe("harden");
    expect(tarballName("codeharden", "2026.105.518")).toBe("codeharden-2026.105.518.tgz");
    expect(tarballName("@acme/harden", "2026.105.518")).toBe("acme-harden-2026.105.518.tgz");
  });

  it("writes the release manifest from the repository's package.json", () => {
    // The repository keeps upstream's name: the rename happens only here.
    expect(repoPackage.name).toBe("codeden");
    const manifest = releaseManifest(repoPackage, release);
    expect(manifest).toMatchObject({
      name: "codeharden",
      version: "2026.105.518",
      bin: { codeharden: "./dist/cli.js" },
      repository: { type: "git", url: "git+https://github.com/harperaa/codeharden.git" },
      bugs: { url: "https://github.com/harperaa/codeharden/issues" },
      license: repoPackage.license,
      type: "module",
      files: repoPackage.files,
      engines: repoPackage.engines,
      dependencies: repoPackage.dependencies,
    });
    expect(manifest.devDependencies).toBeUndefined();
    expect(manifest.scripts).toBeUndefined();
    expect(JSON.stringify(manifest)).not.toContain("workspace:");
    expect(JSON.stringify(manifest)).not.toContain("leonvanzyl");
    // The repository's own file is untouched.
    expect(repoPackage.bin).toEqual({ codeden: "./dist/cli.js" });
  });

  it("makes the README's relative links absolute, into the channel's repository", () => {
    const readme = "[a](docs/x.md) ![s](./docs/shot.png) [b](https://example.com) [c](#top)";
    expect(releaseReadme(readme, "harperaa/codeharden")).toBe(
      "[a](https://github.com/harperaa/codeharden/blob/harden/docs/x.md) " +
        "![s](https://raw.githubusercontent.com/harperaa/codeharden/harden/docs/shot.png) " +
        "[b](https://example.com) [c](#top)",
    );
  });

  it("accepts a tarball packed from the release manifest", () => {
    expect(tarballProblems(unpacked(releaseManifest(repoPackage, release)), release)).toEqual([]);
  });

  it("refuses a tarball that is still upstream's package, or the wrong version", () => {
    const upstream = tarballProblems(unpacked(repoPackage), release);
    expect(upstream).toContain("name is codeden, not codeharden");
    expect(upstream.join("\n")).toMatch(/version is .*, not 2026\.105\.518/);
    expect(upstream.join("\n")).toMatch(/bin is .*not the codeharden command/);
    expect(upstream).toContain("repository does not point at harperaa/codeharden");
    expect(upstream).toContain("workspace-only fields were not removed");
    const older = releaseManifest(repoPackage, { ...release, hardenVersion: "2026.0104.0000" });
    expect(tarballProblems(unpacked(older), release)).toEqual([
      "version is 2026.104.0, not 2026.105.518",
    ]);
  });

  it("refuses a tarball with sources in it or files missing", () => {
    const manifest = releaseManifest(repoPackage, release);
    expect(tarballProblems(unpacked(manifest, ["src/cli.ts"]), release)).toEqual([
      "src must not be in the package",
    ]);
    const dir = mkdtempSync(join(tmpdir(), "codeharden-npm-test-"));
    writeFileSync(join(dir, "package.json"), JSON.stringify(manifest));
    expect(tarballProblems(dir, release)).toContain("dist/cli.js is missing");
  });

  it("publishes to the public registry unless told otherwise", () => {
    expect(NPM_REGISTRY).toBe("https://registry.npmjs.org");
  });
});
