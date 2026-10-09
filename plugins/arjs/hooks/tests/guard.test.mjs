import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  GUARD,
  cleanupGitEnv,
  git,
  guard,
  runHook,
  runHookRaw,
} from "./helpers.mjs";

// `node --import` takes a URL: a Windows path would read as a `d:` scheme.
const COUNT_GIT = new URL("./count-git.mjs", import.meta.url).href;

/**
 * The branch guard, run as Claude Code runs it: a Node process fed the hook's
 * JSON input on stdin, driven against throwaway git repositories.
 */

describe("guard-protected-branches", () => {
  let base;
  /** On `main`, with `origin/main` fetched. */
  let onMain;
  /** On `feature`, with `origin/main` fetched. */
  let onFeature;
  /** On `main`; the remote has `main`, but it was never fetched. */
  let unfetched;
  /** On `main`; the only remote is not an AR-js-org one. */
  let foreign;
  /** On `main`; a fork whose `upstream` remote is an AR-js-org one. */
  let fork;

  beforeAll(() => {
    base = mkdtempSync(join(tmpdir(), "guard-"));
    const remote = join(base, "remote.git");
    git(base, "init", "--bare", "-b", "main", remote);

    onMain = join(base, "on-main");
    git(base, "init", "-b", "main", onMain);
    writeFileSync(join(onMain, "a.txt"), "a\n");
    git(onMain, "add", ".");
    git(onMain, "commit", "-m", "init");
    git(onMain, "remote", "add", "origin", remote);
    git(onMain, "push", "origin", "main");
    git(onMain, "fetch", "origin");

    onFeature = join(base, "on-feature");
    git(base, "clone", remote, onFeature);
    git(onFeature, "checkout", "-b", "feature");

    unfetched = join(base, "unfetched");
    git(base, "init", "-b", "main", unfetched);
    writeFileSync(join(unfetched, "a.txt"), "a\n");
    git(unfetched, "add", ".");
    git(unfetched, "commit", "-m", "init");
    git(unfetched, "remote", "add", "origin", remote);

    // The guard acts only in AR-js-org repositories: point every fixture's
    // origin at one, once the pushes and fetches above are done.
    const arjs = "https://github.com/AR-js-org/fixture.git";
    for (const dir of [onMain, onFeature, unfetched]) {
      git(dir, "remote", "set-url", "origin", arjs);
    }

    // Unborn `main` is enough: the guard only reads the current branch.
    foreign = join(base, "foreign");
    git(base, "init", "-b", "main", foreign);
    git(foreign, "remote", "add", "origin", "https://github.com/someone/other.git");

    fork = join(base, "fork");
    git(base, "init", "-b", "main", fork);
    git(fork, "remote", "add", "origin", "https://github.com/someone/AR.js-next.git");
    git(fork, "remote", "add", "upstream", "git@github.com:ar-js-org/AR.js-next.git");
    // Dozens of git processes: slow where every spawn is scanned, as on Windows.
  }, 60000);

  afterAll(() => {
    rmSync(base, { recursive: true, force: true });
    cleanupGitEnv();
  });

  it("blocks a commit on main and allows one on a feature branch", () => {
    expect(guard("git commit -m x", onMain)).toBe(2);
    expect(guard("git commit -m x", onFeature)).toBe(0);
  });

  it("checks the repository a cd or -C points at", () => {
    expect(guard(`cd "${onMain}" && git commit -m x`, onFeature)).toBe(2);
    expect(guard(`git -C "${onMain}" commit -m x`, onFeature)).toBe(2);
    expect(guard(`git -C "${onFeature}" commit -m x`, onMain)).toBe(0);
  });

  it("blocks a push to main and allows one to another branch", () => {
    expect(guard("git push origin main", onFeature)).toBe(2);
    expect(guard("git push origin HEAD:main", onFeature)).toBe(2);
    expect(guard("git push origin feature", onFeature)).toBe(0);
    expect(guard("git push", onMain)).toBe(2);
  });

  it("blocks force refspecs and HEAD pushed from main (Qodo #8)", () => {
    expect(guard("git push origin +main", onFeature)).toBe(2);
    expect(guard("git push origin +refs/heads/main", onFeature)).toBe(2);
    expect(guard("git push origin HEAD", onMain)).toBe(2);
    expect(guard("git push origin +HEAD", onMain)).toBe(2);
    expect(guard("git push origin HEAD", onFeature)).toBe(0);
  });

  it("blocks --all and --mirror, which push main too", () => {
    expect(guard("git push --all origin", onFeature)).toBe(2);
    expect(guard("git push --mirror origin", onFeature)).toBe(2);
  });

  it("blocks a push to main even when origin/main was never fetched (Qodo #3)", () => {
    expect(guard("git push origin main", unfetched)).toBe(2);
  });

  it("follows a backslash-continued command onto the next line (Qodo #4)", () => {
    expect(guard("git \\\ncommit -m x", onMain)).toBe(2);
    expect(guard("git push \\\n  origin main", onFeature)).toBe(2);
  });

  it("only treats git as git when it is the command run (Qodo #6)", () => {
    expect(guard("echo git commit", onMain)).toBe(0);
    expect(guard('grep -r "git push origin main" docs', onFeature)).toBe(0);
  });

  it("still sees git behind env assignments and command wrappers", () => {
    expect(guard("GIT_TRACE=1 git commit -m x", onMain)).toBe(2);
    expect(guard("env GIT_TRACE=1 git commit -m x", onMain)).toBe(2);
    expect(guard("rtk git push origin main", onFeature)).toBe(2);
  });

  it("blocks a wildcard refspec whose destination can be main", () => {
    expect(
      guard("git push origin 'refs/heads/*:refs/heads/*'", onFeature),
    ).toBe(2);
    expect(
      guard("git push origin '+refs/heads/*:refs/heads/*'", onFeature),
    ).toBe(2);
    expect(
      guard("git push origin 'refs/heads/feat-*:refs/heads/feat-*'", onFeature),
    ).toBe(0);
  });

  it("does not split on separators inside quotes", () => {
    // A word after `main` keeps the closing quote off it, so a quote-blind
    // split would see a real push to main.
    expect(
      guard('git commit -m "fix; git push origin main later"', onFeature),
    ).toBe(0);
    expect(
      guard("git commit -m 'a && git push origin main later'", onFeature),
    ).toBe(0);
    expect(
      guard(
        'git commit -m "say \\"hi\\"; git push origin main later"',
        onFeature,
      ),
    ).toBe(0);
    expect(guard('git commit -m "x" && git push origin main', onFeature)).toBe(
      2,
    );
  });

  it("skips the values of push options instead of reading them as remote or refspec", () => {
    // On main, with no refspec, these push main: the option value must not
    // be taken for the remote and the remote for a refspec.
    expect(guard("git push -o ci.skip origin", onMain)).toBe(2);
    expect(guard("git push --push-option ci.skip origin", onMain)).toBe(2);
    expect(guard("git push --receive-pack x origin", onMain)).toBe(2);
    expect(guard("git push -o ci.skip origin feature", onFeature)).toBe(0);
    expect(guard("git push origin -- main", onFeature)).toBe(2);
  });

  it("treats every positional argument as a refspec when --repo names the remote", () => {
    expect(guard("git push --repo=origin main", onFeature)).toBe(2);
    expect(guard("git push --repo origin main", onFeature)).toBe(2);
    expect(guard("git push --repo=origin feature", onFeature)).toBe(0);
  });

  it("acts only in AR-js-org repositories", () => {
    expect(guard("git commit -m x", foreign)).toBe(0);
    expect(guard("git push origin main", foreign)).toBe(0);
    expect(guard("git commit -m x", fork)).toBe(2); // upstream, SSH, lower-case owner
  });

  it("checks PowerShell commands too", () => {
    expect(
      guard(`Set-Location "${onMain}"; git commit -m x`, onFeature, "PowerShell"),
    ).toBe(2);
    expect(guard(`cd ${onMain}; git commit -m x`, onFeature, "PowerShell")).toBe(2);
    expect(guard("git push `\n  origin main", onFeature, "PowerShell")).toBe(2);
    expect(guard("git push origin feature", onFeature, "PowerShell")).toBe(0);
  });

  it("reads a backslash in PowerShell double quotes as a path separator", () => {
    // The closing quote must not be swallowed, or the git command after it
    // is never seen.
    expect(
      guard(`cd "${onMain}\\"; git commit -m x`, onFeature, "PowerShell"),
    ).toBe(2);
    expect(
      guard(`Set-Location "${onMain}\\"; git commit -m x`, onFeature, "PowerShell"),
    ).toBe(2);
    expect(
      guard(
        `git -C "${onMain}\\" add -A; git -C "${onMain}\\" commit -m x`,
        onFeature,
        "PowerShell",
      ),
    ).toBe(2);
    // The backtick is the escape character there.
    expect(
      guard('git commit -m "say `"hi`"; git push origin main later"', onFeature, "PowerShell"),
    ).toBe(0);
  });

  it("follows Set-Location and Push-Location given a path parameter", () => {
    expect(
      guard(`Set-Location -Path "${onMain}"; git commit -m x`, onFeature, "PowerShell"),
    ).toBe(2);
    expect(
      guard(`Push-Location -LiteralPath '${onMain}'; git commit -m x`, onFeature, "PowerShell"),
    ).toBe(2);
    expect(
      guard(`sl -path "${onFeature}"; git commit -m x`, onMain, "PowerShell"),
    ).toBe(0);
  });

  it("matches git case-insensitively in PowerShell", () => {
    expect(guard("Git commit -m x", onMain, "PowerShell")).toBe(2);
    expect(guard("Git commit -m x", onFeature, "PowerShell")).toBe(0);
  });

  it("follows a git switch or checkout earlier in the same command", () => {
    // The release skill's dev re-sync, run right after tagging on main.
    expect(
      guard("git switch dev && git merge --ff-only origin/main && git push", onMain),
    ).toBe(0);
    expect(guard("git switch main && git commit -m x", onFeature)).toBe(2);
    expect(guard("git switch -c feat/y && git commit -m x", onMain)).toBe(0);
    expect(guard("git checkout -b feat/y && git push -u origin feat/y", onMain)).toBe(0);
    expect(guard("git checkout -b feat/y && git push -u origin HEAD", onMain)).toBe(0);
    expect(guard("git checkout main && git commit -m x", onFeature)).toBe(2);
    expect(guard(`git -C "${onMain}" switch dev && git -C "${onMain}" push`, onFeature)).toBe(0);
    // A switch in another repository says nothing about this one.
    expect(guard(`git -C "${onFeature}" switch dev && git commit -m x`, onMain)).toBe(2);
  });

  it("honours a recorded switch only across &&", () => {
    // The commit may run on the old branch: the switch failed, or ran
    // regardless of it.
    expect(guard("git switch missing; git commit -m x", onMain)).toBe(2);
    expect(guard("git switch dev || git commit -m x", onMain)).toBe(2);
    expect(guard("git switch dev\ngit commit -m x", onMain)).toBe(2);
    expect(
      guard("git switch feat/new; git add -A; git commit -m x", onMain, "PowerShell"),
    ).toBe(2);
    // A switch to main may have succeeded: it holds across any separator.
    expect(guard("git switch main; git commit -m x", onFeature)).toBe(2);
    expect(guard("git switch main || git commit -m x", onFeature)).toBe(2);
    // Across && only, the recorded branch still holds.
    expect(
      guard("git switch dev && git merge --ff-only origin/main && git push", onMain),
    ).toBe(0);
    expect(guard("git checkout -b feat/y && git push -u origin feat/y", onMain)).toBe(0);
  });

  it("does not take a checked-out path for a branch", () => {
    // a.txt exists in the repository: restoring it leaves the branch alone.
    expect(guard("git checkout a.txt && git commit -m x", onMain)).toBe(2);
    expect(guard("git checkout -- a.txt && git commit -m x", onMain)).toBe(2);
    expect(guard("git checkout feature -- a.txt && git commit -m x", onMain)).toBe(2);
  });

  it("sees git inside PowerShell and Bash conditionals", () => {
    expect(
      guard("git add -A; if ($?) { git commit -m x }", onMain, "PowerShell"),
    ).toBe(2);
    expect(
      guard("git add -A; if ($?) { git push origin main }", onMain, "PowerShell"),
    ).toBe(2);
    expect(guard("git add -A; if ($?) { git commit -m x }", onFeature, "PowerShell")).toBe(0);
    expect(guard("if true; then git commit -m x; fi", onMain)).toBe(2);
    expect(guard("if true; then git commit -m x; fi", onFeature)).toBe(0);
    expect(guard("if git commit -m x; then echo ok; fi", onMain)).toBe(2);
    expect(guard("true && { git commit -m x; }", onMain)).toBe(2);
    expect(guard("! git commit -m x", onMain)).toBe(2);
  });

  it("does not split on braces inside a revision or quotes", () => {
    expect(guard("git push origin HEAD@{0}:main", onFeature)).toBe(2);
    expect(guard("git push origin HEAD@{0}:feature", onFeature)).toBe(0);
    expect(guard('git commit -m "{ git push origin main }"', onFeature)).toBe(0);
    // Inside a block, the brace closing a revision does not close the block.
    expect(
      guard("if ($?) { git push origin HEAD@{0}:main }", onFeature, "PowerShell"),
    ).toBe(2);
    expect(guard("true && { git push origin HEAD@{0}:main; }", onFeature)).toBe(2);
    expect(guard("true && { git push origin HEAD@{0}:feature; }", onFeature)).toBe(0);
  });

  it("allows a push of tags alone, but not --follow-tags from main", () => {
    expect(guard("git push --tags", onMain)).toBe(0);
    expect(guard("git push origin --tags", onMain)).toBe(0);
    expect(guard("git push --follow-tags", onMain)).toBe(2);
    expect(guard("git push origin --tags main", onFeature)).toBe(2);
  });

  it("exits quietly on malformed input", () => {
    for (const stdin of ["\n", "not json", "null"]) {
      const r = runHookRaw(GUARD, stdin);
      expect(r.status).toBe(0);
      expect(r.stderr).toBe("");
    }
  });

  it("spawns git only when the verdict needs it", () => {
    const log = join(base, "git-spawns.log");
    /** The git invocations the guard makes for `command` from `cwd`. */
    function spawns(command, cwd, toolName = "Bash") {
      rmSync(log, { force: true });
      const r = runHookRaw(
        GUARD,
        JSON.stringify({ tool_name: toolName, tool_input: { command }, cwd }),
        { nodeArgs: ["--import", COUNT_GIT], env: { GIT_SPAWN_LOG: log } },
      );
      const calls = existsSync(log)
        ? readFileSync(log, "utf8").split("\n").filter(Boolean)
        : [];
      return { status: r.status, calls };
    }
    expect(spawns("git status", onMain).calls).toHaveLength(0);
    expect(spawns("git push origin feature", onFeature).calls).toHaveLength(0);
    // The branch only: an allowed commit needs no scope check.
    expect(spawns("git commit -m x", onFeature).calls).toEqual([
      "branch --show-current",
    ]);
    // Read once per directory, not once per segment.
    expect(spawns("git commit -m a && git commit -m b", onFeature).calls).toHaveLength(1);
    // A blocked commit: the branch, then the scope.
    const blocked = spawns("git commit -m x", onMain);
    expect(blocked.status).toBe(2);
    expect(blocked.calls).toHaveLength(2);
    // An explicit refspec to main needs no branch, only the scope.
    expect(spawns("git push origin main", onFeature).calls).toHaveLength(1);
    // The switch names the branch: nothing to ask git.
    expect(
      spawns("git switch dev && git merge --ff-only origin/main && git push", onMain).calls,
    ).toHaveLength(0);
  });

  it("names no branch flow in the message", () => {
    const r = runHook(GUARD, {
      tool_name: "Bash",
      tool_input: { command: "git commit -m x" },
      cwd: onMain,
    });
    expect(r.stderr).not.toContain("into dev");
    expect(r.stderr).toContain("AGENTS.md");
  });
});
