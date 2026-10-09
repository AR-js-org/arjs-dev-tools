import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Shared by the hook suites: the hooks run as Claude Code runs them, a Node
 * process fed the hook's JSON input on stdin, and the git repositories they
 * are driven against are isolated from whoever runs the tests.
 */

export const GUARD = fileURLToPath(
  new URL("../guard-protected-branches.mjs", import.meta.url),
);

export const FORMAT = fileURLToPath(
  new URL("../format-on-edit.mjs", import.meta.url),
);

// An empty global git configuration, in a directory of its own so it exists
// only while the suites run. Suites remove it with cleanupGitEnv().
const configDir = mkdtempSync(join(tmpdir(), "hooks-gitconfig-"));
const emptyConfig = join(configDir, "gitconfig");
writeFileSync(emptyConfig, "");

// Git in the fixtures, and in the hooks run against them, must see nothing of
// whoever runs the tests. Every inherited GIT_* variable is dropped: config
// injected through GIT_CONFIG_COUNT/KEY/VALUE or GIT_CONFIG_PARAMETERS would
// otherwise sign or hook the fixture commits (a signing prompt stalls setup
// until it times out), and GIT_DIR/GIT_INDEX_FILE, set when the tests run
// inside a git hook, would point git at this repository instead of a fixture.
// The suites then see an empty global configuration and no system one.
// Identity comes through the environment, so no command line carries it.
export const GIT_ENV = {
  ...Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !/^GIT_/i.test(key)),
  ),
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_CONFIG_GLOBAL: emptyConfig,
  GIT_AUTHOR_NAME: "fixture",
  GIT_AUTHOR_EMAIL: "fixture@example.invalid",
  GIT_COMMITTER_NAME: "fixture",
  GIT_COMMITTER_EMAIL: "fixture@example.invalid",
};

/** Remove the empty global git configuration. Call it from `afterAll`. */
export function cleanupGitEnv() {
  rmSync(configDir, { recursive: true, force: true });
}

export function git(cwd, ...args) {
  const r = spawnSync("git", args, { cwd, env: GIT_ENV, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
  return r.stdout.trim();
}

export function runHook(hook, input) {
  return runHookRaw(hook, JSON.stringify(input));
}

/**
 * Run a hook fed `stdin` as written, valid JSON or not. `nodeArgs` go before
 * the script, and `env` adds to the isolated git environment.
 */
export function runHookRaw(hook, stdin, { nodeArgs = [], env = {} } = {}) {
  const r = spawnSync(process.execPath, [...nodeArgs, hook], {
    input: stdin,
    env: { ...GIT_ENV, ...env },
    encoding: "utf8",
  });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

/** Exit status of the guard for `command` run from `cwd`: 2 means blocked. */
export function guard(command, cwd, toolName = "Bash") {
  return runHook(GUARD, {
    tool_name: toolName,
    tool_input: { command },
    cwd,
  }).status;
}

// Stand-ins for the repository's own prettier and eslint. The hook runs their
// bin script with node and the edited file as the last argument, so these are
// CommonJS scripts (the temp directories have no "type": "module").
const STUB_PRETTIER = `const fs = require("fs");
const file = process.argv.at(-1);
const text = fs.readFileSync(file, "utf8");
if (text.includes("SYNTAX ERROR")) {
  process.stderr.write("SyntaxError: Unexpected token\\n");
  process.exit(2);
}
fs.writeFileSync(file, text.replace("#   ", "# "));
`;
const STUB_ESLINT = "process.exit(0);\n";

/**
 * A throwaway git repository with stand-in prettier and eslint installed under
 * node_modules, and `origin` as its remote (none when `origin` is null). The
 * caller removes the returned directory.
 */
export function arjsProject({
  prettier = true,
  eslint = true,
  origin = "https://github.com/AR-js-org/fixture.git",
} = {}) {
  const dir = mkdtempSync(join(tmpdir(), "format-"));
  git(dir, "init");
  if (origin !== null) git(dir, "remote", "add", "origin", origin);
  for (const [name, enabled, script] of [
    ["prettier", prettier, STUB_PRETTIER],
    ["eslint", eslint, STUB_ESLINT],
  ]) {
    if (!enabled) continue;
    const pkg = join(dir, "node_modules", name);
    mkdirSync(pkg, { recursive: true });
    writeFileSync(
      join(pkg, "package.json"),
      JSON.stringify({ name, bin: "cli.js" }),
    );
    writeFileSync(join(pkg, "cli.js"), script);
  }
  return dir;
}
