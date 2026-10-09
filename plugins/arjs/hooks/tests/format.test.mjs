import { describe, it, expect, afterAll } from "vitest";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  FORMAT,
  arjsProject,
  cleanupGitEnv,
  runHook,
  runHookRaw,
} from "./helpers.mjs";

/**
 * The format-on-edit hook, run as Claude Code runs it, against throwaway
 * repositories holding stand-ins for the repository's own prettier and eslint.
 */

describe("format-on-edit", () => {
  const dirs = [];

  /** An AR-js-org project, removed after the suite. */
  function project(options) {
    const dir = arjsProject(options);
    dirs.push(dir);
    return dir;
  }

  /** A plain temp directory, removed after the suite. */
  function plainDir() {
    const dir = mkdtempSync(join(tmpdir(), "format-plain-"));
    dirs.push(dir);
    return dir;
  }

  afterAll(() => {
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
    cleanupGitEnv();
  });

  /**
   * Write `content` to `name` in `dir`, run the hook on it as the session
   * running in `cwd`.
   */
  function edit(dir, name, content, cwd = dir) {
    const file = join(dir, name);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, content);
    const out = runHook(FORMAT, {
      tool_name: "Edit",
      tool_input: { file_path: file },
      cwd,
    });
    return { ...out, after: readFileSync(file, "utf8") };
  }

  it("formats the edited file", () => {
    expect(edit(project(), "plain.md", "#   Title\n").after).toBe("# Title\n");
  }, 30000);

  it("passes the file name verbatim, never through a shell (Qodo #2)", () => {
    // Each name is mangled by one platform's shell: %OS% by cmd.exe on
    // Windows, $(...) by sh elsewhere. Formatting the right file proves the
    // name reached prettier as written.
    const dir = project();
    expect(edit(dir, "cmd-%OS%.md", "#   Title\n").after).toBe("# Title\n");
    if (process.platform !== "win32") {
      expect(edit(dir, "sh-$(echo x).md", "#   Title\n").after).toBe(
        "# Title\n",
      );
    }
  }, 30000);

  it("reports a formatter failure back to the agent (Qodo #9)", () => {
    const { stdout } = edit(project(), "broken.js", "SYNTAX ERROR\n");
    expect(stdout).toContain("additionalContext");
    expect(stdout).toMatch(/prettier: .*SyntaxError/);
  }, 30000);

  it("finds a package's CLI when its bin key differs from the package name", () => {
    // A stand-in prettier whose only bin entry has another name. Its script
    // marks the file it was given, so a change proves it was found and run.
    const dir = project({ prettier: false });
    const pkg = join(dir, "node_modules", "prettier");
    mkdirSync(pkg, { recursive: true });
    writeFileSync(
      join(pkg, "package.json"),
      JSON.stringify({ name: "prettier", bin: { "prettier-cli": "cli.js" } }),
    );
    writeFileSync(
      join(pkg, "cli.js"),
      'require("fs").writeFileSync(process.argv.at(-1), "formatted\\n");\n',
    );

    expect(edit(dir, "doc.md", "draft\n").after).toBe("formatted\n");
  }, 30000);

  it("says when prettier is not installed", () => {
    const dir = project({
      prettier: false,
      eslint: false,
      packageJson: { devDependencies: { prettier: "^3.0.0" } },
    });
    expect(edit(dir, "doc.md", "draft\n").stdout).toContain(
      "prettier is not installed",
    );
  }, 30000);

  it("says when eslint is not installed, if the repository declares it", () => {
    const dir = project({
      eslint: false,
      packageJson: { dependencies: { eslint: "^9.0.0" } },
    });
    const out = edit(dir, "a.js", "#   x\n");
    expect(out.after).toBe("# x\n"); // prettier, installed, still runs
    expect(out.stdout).toContain("eslint is not installed");
    expect(out.stdout).not.toContain("prettier");
  }, 30000);

  it("stays silent when the repository does not use prettier or eslint", () => {
    // No declaration and nothing installed: with or without a package.json.
    for (const packageJson of [null, { devDependencies: { vitest: "^5.0.0" } }]) {
      const dir = project({ prettier: false, eslint: false, packageJson });
      const out = edit(dir, "a.js", "#   Title\n");
      expect(out.after).toBe("#   Title\n");
      expect(out.stdout).toBe("");
    }
  }, 30000);

  it("runs an installed prettier the repository does not declare", () => {
    const dir = project({ packageJson: { devDependencies: {} } });
    expect(edit(dir, "plain.md", "#   Title\n").after).toBe("# Title\n");
  }, 30000);

  it("exits quietly on malformed input", () => {
    for (const stdin of ["\n", "not json", "null"]) {
      const r = runHookRaw(FORMAT, stdin);
      expect(r.status).toBe(0);
      expect(r.stderr).toBe("");
    }
  }, 30000);

  it("formats a file in another AR-js-org repository than the session's", () => {
    // The session's repository has no CLIs: formatting only works if the
    // hook uses the edited file's own repository.
    const session = project({ prettier: false, eslint: false });
    const other = project();
    expect(edit(other, "plain.md", "#   Title\n", session).after).toBe(
      "# Title\n",
    );
  }, 30000);

  it("leaves non-AR repositories alone", () => {
    const dir = project({ origin: "https://github.com/someone/x.git" });
    const out = edit(dir, "plain.md", "#   Title\n");
    expect(out.after).toBe("#   Title\n");
    expect(out.stdout).toBe("");
  }, 30000);

  it("leaves repositories without remotes alone", () => {
    const out = edit(project({ origin: null }), "plain.md", "#   Title\n");
    expect(out.after).toBe("#   Title\n");
    expect(out.stdout).toBe("");
  }, 30000);

  it("leaves files outside any repository alone", () => {
    const out = edit(plainDir(), "plain.md", "#   Title\n");
    expect(out.after).toBe("#   Title\n");
    expect(out.stdout).toBe("");
  }, 30000);

  it("skips generated and vendored paths", () => {
    const dir = project();
    expect(edit(dir, "dist/a.md", "#   Title\n").after).toBe("#   Title\n");
    expect(edit(dir, "node_modules/x/a.md", "#   Title\n").after).toBe(
      "#   Title\n",
    );
  }, 30000);
});
