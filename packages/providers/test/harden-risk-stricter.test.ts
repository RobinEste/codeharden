import { describe, expect, it } from "vitest";
import { classifyCommand, type RiskContext } from "../src/policy/risk";

const posix: RiskContext = {
  cwd: "/work/repo",
  platform: "linux",
  home: "/home/me",
  tempRoots: ["/tmp"],
};
const win: RiskContext = {
  cwd: "C:\\work\\repo",
  platform: "win32",
  home: "C:\\Users\\me",
  extraRoots: ["D:\\shared"],
  tempRoots: ["C:\\Users\\me\\AppData\\Local\\Temp"],
};

const action = (command: string, ctx: RiskContext = posix) => {
  const r = classifyCommand(command, ctx);
  return r.risky ? r.action : null;
};

describe("classifyCommand: stricter handling the fork keeps", () => {
  it("asks when a variable the path rules know is assigned on the command line and then used", () => {
    for (const cmd of [
      "false && HOME=.; rm -rf $HOME/Documents",
      "if false; then HOME=.; fi; echo x > $HOME/.bashrc",
      "HOME=. | :; rm -rf $HOME/x",
      "false && TMPDIR=.; rm -rf $TMPDIR/../x",
      // biome-ignore lint/suspicious/noTemplateCurlyInString: a shell variable, not a template
      "HOME=/work/repo; rm -rf ${HOME}/Documents",
    ]) {
      expect(action(cmd), cmd).toBe("outside_worktree");
    }
    expect(action("$HOME = '.'; Remove-Item -Recurse $HOME\\Documents", win)).toBe(
      "outside_worktree",
    );
  });

  it("keeps asking where the command can't be judged once for each value", () => {
    // A worktree inside the home folder: `$HOME/repo/x` is in it only if `HOME` is the real one.
    const under: RiskContext = { ...posix, cwd: "/home/me/repo" };
    for (const cmd of [
      "HOME=/etc; rm -rf $HOME/repo/x | cat",
      "false && HOME=/etc; rm -rf $HOME/repo/x | cat",
      "HOME=$1; rm -rf $HOME/repo/x",
      "HOME=/etc; x=a; x=b; rm -rf $HOME/repo/$x",
      "for HOME in /etc; do rm -rf $HOME/repo/x; done",
      "export HOME=/etc; echo x > $HOME/repo/x",
    ]) {
      expect(action(cmd, under), cmd).toBe("outside_worktree");
    }
    // Untouched: the real home, a variable of the command's own, and `HOME` set for one command.
    expect(action("rm -rf $HOME/repo/x", under)).toBeNull();
    expect(action("d=build; rm -rf $d/x", under)).toBeNull();
    expect(action("d=/etc; rm -rf $d/x", under)).toBe("outside_worktree");
    expect(action("HOME=/tmp/h npm test", under)).toBeNull();
  });

  it("reads a cp or mv option cluster one letter at a time", () => {
    for (const cmd of ["cp -Stilde payload ~/.bashrc", "mv -Stilde payload /etc/x"]) {
      expect(action(cmd), cmd).toBe("outside_worktree");
    }
    // The spellings that do name a target folder keep working, in or out of the worktree.
    expect(action("cp -t dist a b")).toBeNull();
    expect(action("cp -vtdist a b")).toBeNull();
    expect(action("cp -t /etc a b")).toBe("outside_worktree");
    expect(action("mv -vt/etc a b")).toBe("outside_worktree");
  });

  it("judges a script handed to sh both with and without $'…' quoting", () => {
    for (const cmd of [
      `sh -c "echo \\$'\\\\' ; rm -rf ~/x ; echo ''"`,
      `dash -c "echo \\$'\\\\' ; rm -rf ~/x ; echo ''"`,
    ]) {
      expect(action(cmd), cmd).toBe("outside_worktree");
    }
  });

  it("does not take cmd's `cd /d` for a folder change off Windows", () => {
    expect(action("cd /d sub; rm -rf ../x")).toBe("outside_worktree");
    expect(action("cd /D sub; echo x > ../x")).toBe("outside_worktree");
    // On Windows it is cmd's own switch, as before.
    expect(action("cd /d sub && del x.txt", win)).toBeNull();
    expect(action("cd /d sub; rm -rf ../x", { ...win, shell: "posix" })).toBe("outside_worktree");
    expect(action("cd sub; rm -rf x")).toBeNull();
  });
});
