// Which copy the look-up picks, case by case, with fake executables in a scratch folder.
// Run from a checkout root:  node --import tsx <this file> <scratch dir> <providers src dir>
import { mkdirSync, rmSync, symlinkSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { fake } from "./fakes.mjs";

const scratch = path.resolve(process.argv[2] ?? "");
const src = path.resolve(process.argv[3] ?? "");
const load = (file: string) => import(pathToFileURL(path.join(src, file)).href);
const { findExecutable, quickLocate, clearExecutableCache } = await load("util/locate.ts");
const { detectClaude, CLAUDE_MIN_VERSION } = await load("claude/detect.ts");
const { detectCodex, CODEX_MIN_VERSION } = await load("codex/detect.ts");

rmSync(scratch, { recursive: true, force: true });
mkdirSync(scratch, { recursive: true });
const log = path.join(scratch, "calls.log");
const show = (file: string | undefined) => (file ? path.relative(scratch, file) : "(none)");
let n = 0;

interface Case {
  title: string;
  tool?: "claude" | "codex";
  /** Builds the files; returns PATH folders and known-location files. */
  build: (dir: string) => { pathDirs: string[]; known: string[]; timeoutMs?: number };
}

const c = (dir: string, folder: string, version: string | null, auth = "ok", tool = "claude") =>
  fake(path.join(dir, folder, tool), { tool, version, auth, log });

const cases: Case[] = [
  {
    title: "old copy first on PATH, supported copy in a known location",
    build: (d) => ({ pathDirs: [path.dirname(c(d, "path1", "2.0.8", "old-claude"))], known: [c(d, "known1", "2.1.327")] }),
  },
  {
    title: "old, then two supported copies on PATH (2.1.300 before 2.1.327)",
    build: (d) => ({
      pathDirs: [c(d, "path1", "2.0.8", "old-claude"), c(d, "path2", "2.1.300"), c(d, "path3", "2.1.327")].map((f) => path.dirname(f)),
      known: [],
    }),
  },
  {
    title: "supported copy first on PATH, old copy in a known location",
    build: (d) => ({ pathDirs: [path.dirname(c(d, "path1", "2.1.327"))], known: [c(d, "known1", "2.0.8", "old-claude")] }),
  },
  {
    title: "only old copies (2.0.8 on PATH, 2.1.100 in a known location)",
    build: (d) => ({ pathDirs: [path.dirname(c(d, "path1", "2.0.8", "old-claude"))], known: [c(d, "known1", "2.1.100", "old-claude")] }),
  },
  {
    title: "the same PATH folder listed twice, supported copy in a known location",
    build: (d) => {
      const old = path.dirname(c(d, "path1", "2.0.8", "old-claude"));
      return { pathDirs: [old, old], known: [c(d, "known1", "2.1.327")] };
    },
  },
  {
    title: "PATH entry is a symlink to the supported copy in the known location",
    build: (d) => {
      const current = c(d, "known1", "2.1.327");
      mkdirSync(path.join(d, "path1"), { recursive: true });
      symlinkSync(current, path.join(d, "path1", "claude"));
      return { pathDirs: [path.join(d, "path1")], known: [current] };
    },
  },
  {
    title: "PATH entry is a symlink to an old copy, supported copy in a known location",
    build: (d) => {
      const old = c(d, "elsewhere", "2.0.8", "old-claude");
      mkdirSync(path.join(d, "path1"), { recursive: true });
      symlinkSync(old, path.join(d, "path1", "claude"));
      return { pathDirs: [path.join(d, "path1")], known: [c(d, "known1", "2.1.327")] };
    },
  },
  {
    title: "PATH entry is a symlink to a missing file, supported copy in a known location",
    build: (d) => {
      mkdirSync(path.join(d, "path1"), { recursive: true });
      symlinkSync(path.join(d, "gone", "claude"), path.join(d, "path1", "claude"));
      return { pathDirs: [path.join(d, "path1")], known: [c(d, "known1", "2.1.327")] };
    },
  },
  {
    title: "first copy prints no version for --version, then an old copy, then a supported one",
    build: (d) => ({
      pathDirs: [c(d, "path1", null), c(d, "path2", "2.0.8", "old-claude")].map((f) => path.dirname(f)),
      known: [c(d, "known1", "2.1.327")],
    }),
  },
  {
    title: "a copy that prints no version, and an old copy; nothing supported",
    build: (d) => ({ pathDirs: [c(d, "path1", null), c(d, "path2", "2.0.8", "old-claude")].map((f) => path.dirname(f)), known: [] }),
  },
  {
    title: "only a copy that prints no version",
    build: (d) => ({ pathDirs: [path.dirname(c(d, "path1", null))], known: [] }),
  },
  {
    title: "old copy never answers --version (2s limit here), supported copy in a known location",
    build: (d) => ({ pathDirs: [path.dirname(c(d, "path1", "2.0.8", "hang-version"))], known: [c(d, "known1", "2.1.327")], timeoutMs: 2000 }),
  },
  {
    title: "old copy on PATH, the supported copy never answers --version (2s limit here)",
    build: (d) => ({ pathDirs: [path.dirname(c(d, "path1", "2.0.8", "old-claude"))], known: [c(d, "known1", "2.1.327", "hang-version")], timeoutMs: 2000 }),
  },
  {
    title: "codex: old copy first on PATH, supported copy in a known location",
    tool: "codex",
    build: (d) => ({
      pathDirs: [path.dirname(c(d, "path1", "0.42.0", "old-codex", "codex"))],
      known: [c(d, "known1", "0.170.0", "ok", "codex")],
    }),
  },
  {
    title: "codex: only an old copy",
    tool: "codex",
    build: (d) => ({ pathDirs: [path.dirname(c(d, "path1", "0.42.0", "old-codex", "codex"))], known: [] }),
  },
  { title: "no copy at all", build: () => ({ pathDirs: [], known: [] }) },
];

for (const item of cases) {
  n += 1;
  clearExecutableCache();
  const tool = item.tool ?? "claude";
  const dir = path.join(scratch, `case${String(n).padStart(2, "0")}`);
  mkdirSync(dir, { recursive: true });
  const built = item.build(dir);
  const min = tool === "claude" ? CLAUDE_MIN_VERSION : CODEX_MIN_VERSION;
  const locate = {
    pathEnv: built.pathDirs.join(":"),
    knownLocations: built.known,
    timeoutMs: built.timeoutMs ?? 15_000,
  };
  const quickBefore = quickLocate(tool, locate);
  const plain = await findExecutable(tool, locate);
  clearExecutableCache();
  const found = await findExecutable(tool, { ...locate, minVersion: min });
  const quickAfter = quickLocate(tool, locate);
  const status = await (tool === "claude" ? detectClaude : detectCodex)({
    locate,
    timeoutMs: built.timeoutMs ?? 15_000,
  });
  console.log(`\n## ${n}. ${item.title}`);
  console.log(`PATH: ${built.pathDirs.map(show).join(" : ") || "(empty)"}   known locations: ${built.known.map(show).join(", ") || "(none)"}   minimum: ${min}`);
  console.log(`without a minimum (how upstream main looks up): ${show(plain.command?.path)} ${plain.version ?? ""}`);
  console.log(`with the minimum: ${show(found.command?.path)} ${found.version ?? ""}`);
  console.log(`  not running: ${found.broken.map((b: { path: string; reason: string }) => `${show(b.path)} (${b.reason})`).join("; ") || "(none)"}`);
  console.log(`quickLocate before any look-up: ${show(quickBefore?.path)}   after it: ${show(quickAfter?.path)}`);
  console.log(
    `detect: installed=${status.installed} version=${status.version} supported=${status.supported} loggedIn=${status.loggedIn} path=${show(status.executablePath ?? undefined)}`,
  );
  for (const issue of status.issues) {
    console.log(`  issue ${issue.code}: ${issue.message.split(scratch + path.sep).join("")}${issue.fix ? `  [fix: ${issue.fix.command}]` : ""}`);
  }
}

// Every call the fakes received, to show which copies were asked for their login state.
const { readFileSync } = await import("node:fs");
console.log("\n## Calls made to the fake executables (file, arguments), in order");
console.log(readFileSync(log, "utf8").split(scratch + path.sep).join("").trimEnd());
