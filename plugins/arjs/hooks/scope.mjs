// Which repositories the hooks act in. The plugin runs in every repository
// Claude Code opens, but its rules are AR-js-org's.
import { execFileSync } from "node:child_process";

/** Run git in `cwd`: trimmed stdout, or null when git fails. */
export function git(cwd, args) {
  try {
    return execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
}

/**
 * Whether any remote of the repository at `dir` belongs to the AR-js-org
 * GitHub organisation, over HTTPS or SSH, whatever the case of the owner.
 * The configured URLs are read as written: `git remote get-url` applies
 * `insteadOf` rewrites, which could hide the owner. False when `dir` is not a
 * repository.
 */
export function isArjsRepo(dir) {
  const urls = git(dir, ["config", "--get-regexp", "^remote\..*\.url$"]);
  return urls !== null && /github\.com[:/]ar-js-org\//i.test(urls);
}
