import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GUARD, cleanupGitEnv, git, guard, runHook } from "./helpers.mjs";

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
