// The desktop installers workflow's safety rules, read from the file as written: it only runs
// when a person starts it, only one job may write, no input reaches a script except through
// the environment, and it uses the actions upstream's workflows already use.
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (name) =>
  readFileSync(new URL(`../../.github/workflows/${name}`, import.meta.url), "utf8");
const workflow = read("harden-desktop.yml");
const sync = read("upstream-sync-merge.yml");

/** The text of each top-level job, by name. */
function jobs(text) {
  const body = text.slice(text.indexOf("\njobs:\n") + "\njobs:\n".length);
  const out = {};
  let name = null;
  for (const line of body.split("\n")) {
    const start = /^ {2}([a-z][a-z0-9_-]*):\s*$/.exec(line);
    if (start) {
      name = start[1];
      out[name] = "";
    } else if (name) out[name] += `${line}\n`;
  }
  return out;
}

/** The lines of every `run:` block (and one-line `run:`), without YAML comments' help. */
function scripts(text) {
  const lines = text.split("\n");
  const found = [];
  for (let i = 0; i < lines.length; i++) {
    const m = /^(\s*)(?:- )?run:\s*(.*)$/.exec(lines[i]);
    if (!m) continue;
    if (m[2] && m[2] !== "|") {
      found.push(m[2]);
      continue;
    }
    const indent = m[1].length;
    for (i++; i < lines.length; i++) {
      const line = lines[i];
      if (line.trim() !== "" && line.search(/\S/) <= indent) {
        i--;
        break;
      }
      found.push(line);
    }
  }
  return found.join("\n");
}

describe("the desktop installers workflow", () => {
  it("starts only when a person runs it, dry by default", () => {
    const on = workflow.slice(workflow.indexOf("\non:\n"), workflow.indexOf("\npermissions:"));
    expect(on).toContain("workflow_dispatch:");
    expect(on).not.toMatch(
      /^\s+(push|pull_request|pull_request_target|schedule|release|workflow_run):/m,
    );
    expect(on).toMatch(/dry-run:[\s\S]*?type: boolean[\s\S]*?default: true/);
  });

  it("grants nothing by default, and write access to the release job alone", () => {
    expect(workflow).toMatch(/^permissions: \{\}$/m);
    expect(workflow).not.toContain("id-token");
    const all = jobs(workflow);
    expect(Object.keys(all)).toEqual(["check", "build", "release"]);
    expect(all.check).toMatch(/permissions:\n\s+contents: read\n/);
    expect(all.build).toMatch(/permissions:\n\s+contents: read\n/);
    expect(all.check + all.build).not.toMatch(/: write\b/);
    expect(all.release).toMatch(/permissions:\n\s+contents: write\n\s+actions: read\n/);
  });

  it("publishes only after every build, and only when dry-run is off", () => {
    const { release, build } = jobs(workflow);
    expect(release).toContain("needs: [check, build]");
    expect(release).toMatch(/^ {4}if: \$\{\{ !inputs\.dry-run \}\}$/m);
    // The build jobs never upload to a release themselves.
    expect(build).not.toContain("gh release");
    expect(build).not.toMatch(/--publish (?!never)/);
    // Draft first, the update files after the installers, published last.
    const order = [
      "--draft",
      'others[@]}" --repo',
      'feeds[@]}" --repo',
      "--draft=false --latest",
    ].map((s) => release.indexOf(s));
    expect(order.every((at) => at > -1)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    // The release job runs no code from the repository.
    expect(release).not.toContain("actions/checkout");
    expect(release).not.toMatch(/pnpm|node /);
  });

  it("passes inputs and other expressions to scripts through the environment only", () => {
    expect(scripts(workflow)).not.toContain("${{");
    expect(workflow).toMatch(/TAG: \$\{\{ inputs\.tag \}\}/);
    expect(scripts(workflow)).toContain(
      '[[ ! "$TAG" =~ ^v([0-9]{4})\\.([0-9]{4})\\.([0-9]{4})$ ]]',
    );
  });

  it("uses only the actions, at the versions, that upstream's workflows use", () => {
    const uses = (text) => [...text.matchAll(/uses: (\S+)/g)].map((m) => m[1]);
    const known = new Set([...uses(read("release.yml")), ...uses(read("ci.yml"))]);
    for (const action of uses(workflow)) expect(known).toContain(action);
  });

  it("gives each system its own signing secrets and no other system's", () => {
    const { build, check, release } = jobs(workflow);
    const mac = [
      "CSC_LINK",
      "CSC_KEY_PASSWORD",
      "APPLE_ID",
      "APPLE_APP_SPECIFIC_PASSWORD",
      "APPLE_TEAM_ID",
    ];
    const win = ["WIN_CSC_LINK", "WIN_CSC_KEY_PASSWORD"];
    const given = [...build.matchAll(/^\s+([A-Z_]+): \$\{\{ (.*secrets\.[A-Z_]+.*) \}\}$/gm)];
    // Every secret is behind its system's condition; none is passed to all three.
    expect(given.map((m) => m[1]).sort()).toEqual([...mac, ...win].sort());
    for (const [, name, expression] of given) {
      const os = mac.includes(name) ? "macos-latest" : "windows-latest";
      expect(expression).toBe(`matrix.os == '${os}' && secrets.${name} || ''`);
    }
    // No other job, and no other place in the build job, reads a secret.
    expect(check + release).not.toContain("secrets.");
    expect(build.match(/secrets\./g)).toHaveLength(mac.length + win.length);
    // And the script drops the other systems' variables again before anything is built.
    const script = scripts(workflow);
    const drop = script.indexOf('if [ "$RUNNER_OS" != "macOS" ]; then unset');
    expect(drop).toBeGreaterThan(-1);
    expect(script).toContain('if [ "$RUNNER_OS" != "Windows" ]; then unset');
    expect(drop).toBeLessThan(script.indexOf("pnpm --filter @codeden/desktop package"));
  });

  it("stops on half-configured signing and checks a signed macOS app strictly", () => {
    const script = scripts(workflow);
    const stop = script.indexOf("macOS signing is half configured");
    expect(stop).toBeGreaterThan(-1);
    expect(script).toContain("Windows signing is half configured");
    expect(stop).toBeLessThan(script.indexOf("pnpm --filter @codeden/desktop package"));
    // The message names the missing secrets; it never prints a value.
    expect(script).not.toMatch(
      /echo[^\n]*\$\{?(CSC_LINK|CSC_KEY_PASSWORD|APPLE_ID|APPLE_APP_SPECIFIC_PASSWORD|APPLE_TEAM_ID|WIN_CSC_LINK|WIN_CSC_KEY_PASSWORD)\b/,
    );
    expect(script).toContain('echo "REQUIRE_DEVELOPER_ID=1" >> "$GITHUB_ENV"');
    const check = readFileSync(
      new URL("../../apps/desktop/scripts/check-mac-signature.sh", import.meta.url),
      "utf8",
    );
    expect(check).toMatch(/^require_id="\$\{REQUIRE_DEVELOPER_ID:-\}"$/m);
    expect(check).toContain("xcrun stapler validate");
    expect(check).toContain("the app is not signed with a Developer ID");
    expect(check).toContain("Gatekeeper does not accept the downloaded app");
  });

  it("does not check the release tag out with the job's credentials kept", () => {
    expect(jobs(workflow).build).toContain("persist-credentials: false");
  });

  it("is a protected path of the sync workflow, with what it runs to package the app", () => {
    const paths = /^ {2}PROTECTED_PATHS: (.+)$/m.exec(sync)?.[1].split(" ") ?? [];
    expect(paths).toEqual(
      expect.arrayContaining([
        "scripts/harden/",
        ".github/workflows/harden-desktop.yml",
        "apps/desktop/scripts/",
        "apps/desktop/electron-builder.config.mjs",
      ]),
    );
  });
});

/** The `run:` block of the build job's step called `name`, with its indentation removed. */
function stepScript(name) {
  const lines = workflow.split("\n");
  const start = lines.findIndex((l) => l.trim() === `- name: ${name}`);
  const run = lines.findIndex((l, i) => i > start && /^\s+run: \|$/.test(l));
  const indent = lines[run].search(/\S/);
  const body = [];
  for (const line of lines.slice(run + 1)) {
    if (line.trim() !== "" && line.search(/\S/) <= indent) break;
    body.push(line.slice(indent + 2));
  }
  return body.join("\n");
}

const MAC = [
  "CSC_LINK",
  "CSC_KEY_PASSWORD",
  "APPLE_ID",
  "APPLE_APP_SPECIFIC_PASSWORD",
  "APPLE_TEAM_ID",
];
const WIN = ["WIN_CSC_LINK", "WIN_CSC_KEY_PASSWORD"];
const set = (names) => Object.fromEntries(names.map((n) => [n, `dummy-${n}`]));

/**
 * Runs the build step as written, on `os`, with dummy secrets and packaging replaced by a stub
 * that reports which signing variables it was given.
 */
function runBuildStep(os, secrets) {
  const dir = mkdtempSync(join(tmpdir(), "codeharden-desktop-step-"));
  try {
    const stub =
      'pnpm() { echo "PACKAGED_WITH:$(env | grep -oE "^(CSC_[A-Z_]+|APPLE_[A-Z_]+|WIN_CSC_[A-Z_]+)" | sort | tr "\\n" " ")"; }; ls() { :; }';
    const empty = Object.fromEntries([...MAC, ...WIN].map((n) => [n, ""]));
    const result = spawnSync("bash", ["-c", `${stub}\n${stepScript("Build the installers")}`], {
      cwd: dir,
      encoding: "utf8",
      env: {
        PATH: process.env.PATH,
        RUNNER_OS: os,
        GITHUB_ENV: join(dir, "github-env"),
        ...empty,
        ...secrets,
      },
    });
    let exported = "";
    try {
      exported = readFileSync(join(dir, "github-env"), "utf8");
    } catch {
      // nothing exported
    }
    const packaged = /PACKAGED_WITH:(.*)/.exec(result.stdout)?.[1].trim();
    return {
      status: result.status,
      output: result.stdout + result.stderr,
      packagedWith: packaged === undefined ? null : packaged.split(" ").filter(Boolean),
      strict: exported.includes("REQUIRE_DEVELOPER_ID=1"),
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("the build step's signing guards, run as written", () => {
  it("builds unsigned on every system when no secret is set", () => {
    for (const os of ["macOS", "Windows", "Linux"]) {
      expect(runBuildStep(os, {})).toMatchObject({ status: 0, packagedWith: [], strict: false });
    }
  });

  it("signs and notarizes on macOS with all five secrets, and turns the strict check on", () => {
    const run = runBuildStep("macOS", { ...set(MAC), ...set(WIN) });
    expect(run.status).toBe(0);
    expect(run.packagedWith).toEqual([...MAC].sort());
    expect(run.strict).toBe(true);
  });

  it("stops on macOS before packaging when only some of the five are set, naming the rest", () => {
    for (const present of [["CSC_LINK", "CSC_KEY_PASSWORD"], ["APPLE_ID"], MAC.slice(0, 4)]) {
      const run = runBuildStep("macOS", set(present));
      expect(run.status).toBe(1);
      expect(run.packagedWith).toBeNull();
      expect(run.strict).toBe(false);
      expect(run.output).toContain("macOS signing is half configured");
      for (const name of MAC.filter((n) => !present.includes(n))) {
        expect(run.output).toMatch(new RegExp(`Missing secrets:[^.]*\\b${name}\\b`));
      }
      expect(run.output).not.toContain("dummy-");
    }
  });

  it("never hands the Apple certificate to Windows or Linux", () => {
    expect(runBuildStep("Windows", set(MAC))).toMatchObject({
      status: 0,
      packagedWith: [],
      strict: false,
    });
    expect(runBuildStep("Linux", { ...set(MAC), ...set(WIN) })).toMatchObject({
      status: 0,
      packagedWith: [],
      strict: false,
    });
    expect(runBuildStep("Windows", { ...set(MAC), ...set(WIN) }).packagedWith).toEqual(
      [...WIN].sort(),
    );
  });

  it("stops on Windows when only one of its two secrets is set", () => {
    const run = runBuildStep("Windows", set(["WIN_CSC_LINK"]));
    expect(run.status).toBe(1);
    expect(run.packagedWith).toBeNull();
    expect(run.output).toContain("Missing secrets: WIN_CSC_KEY_PASSWORD");
    expect(run.output).not.toContain("dummy-");
  });
});
