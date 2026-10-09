import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cleanupGitEnv, git } from "./helpers.mjs";
import { isArjsRepo } from "../scope.mjs";

/** `isArjsRepo` against throwaway git repositories. */

describe("isArjsRepo", () => {
  let base;

  /** A repository under `base` with the given remotes, name -> url. */
  function repo(name, remotes = {}) {
    const dir = join(base, name);
    git(base, "init", "-b", "main", dir);
    for (const [remote, url] of Object.entries(remotes)) {
      git(dir, "remote", "add", remote, url);
    }
    return dir;
  }

  beforeAll(() => {
    base = mkdtempSync(join(tmpdir(), "scope-"));
  });

  afterAll(() => {
    rmSync(base, { recursive: true, force: true });
    cleanupGitEnv();
  });

  it("is true for an HTTPS remote", () => {
    const dir = repo("https", { origin: "https://github.com/AR-js-org/AR.js.git" });
    expect(isArjsRepo(dir)).toBe(true);
  });

  it("is true for an SSH remote", () => {
    const dir = repo("ssh", { origin: "git@github.com:AR-js-org/AR.js.git" });
    expect(isArjsRepo(dir)).toBe(true);
  });

  it("is true whatever the case of the owner", () => {
    const dir = repo("case", { origin: "https://github.com/ar-js-org/AR.js.git" });
    expect(isArjsRepo(dir)).toBe(true);
  });

  it("is false for a repository with no remote", () => {
    expect(isArjsRepo(repo("none"))).toBe(false);
  });

  it("is false when the owner only starts with AR-js-org", () => {
    const dir = repo("mirror", { origin: "https://github.com/AR-js-org-mirror/x.git" });
    expect(isArjsRepo(dir)).toBe(false);
  });

  it("is false when only a pushurl names AR-js-org", () => {
    const dir = repo("pushurl", { origin: "https://github.com/someone/x.git" });
    git(dir, "config", "remote.origin.pushurl", "https://github.com/AR-js-org/x.git");
    expect(isArjsRepo(dir)).toBe(false);
  });

  it("is false outside a repository", () => {
    const dir = mkdtempSync(join(base, "plain-"));
    expect(isArjsRepo(dir)).toBe(false);
  });
});
