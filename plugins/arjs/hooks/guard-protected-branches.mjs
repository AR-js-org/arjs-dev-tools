#!/usr/bin/env node
// PreToolUse hook (Bash and PowerShell): refuse `git commit` on `main` and
// `git push` to `main`. Work goes through a feature branch and a pull request;
// see the repository's AGENTS.md. Exit code 2 blocks the tool call and shows
// the reason to Claude.
//
// The hook ships in a plugin that runs in every repository, so it acts only in
// AR-js-org repositories (see scope.mjs) and leaves all others alone.
//
// Each git invocation is checked in the repository it actually runs in: the
// directory set by a preceding `cd` in the same command, or by `git -C`,
// falling back to the session's cwd. A push that reaches `main` is blocked
// whatever the local refs say: a missing `origin/main` only means it was never
// fetched, not that the remote has none. The first push of a new repository is
// a one-off for a human to make. A `git switch` or `git checkout` earlier in
// the same command, joined to them by `&&` only, sets the branch that later
// commits and pushes in that directory run on (a switch to `main` holds
// across any separator).
//
// Git is spawned only when the verdict needs it: the current branch for a
// commit, a push without refspecs or a `HEAD` refspec, and the scope check
// only for what would be blocked.
import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { git, isArjsRepo } from "./scope.mjs";

// Malformed input is not this hook's to report: let the tool call through.
let input;
try {
  input = JSON.parse(readFileSync(0, "utf8") || "{}") ?? {};
} catch {
  process.exit(0);
}
const command = input.tool_input?.command || "";
const PROTECTED = "main";
const POWERSHELL = input.tool_name === "PowerShell";

// PowerShell command names are case-insensitive: `Git commit` is git too.
if (!new RegExp("\\bgit\\b", POWERSHELL ? "i" : "").test(command)) {
  process.exit(0);
}

/** `git push` options whose value is the next word when not given with `=`. */
const PUSH_VALUE_OPTIONS = new Set([
  "-o",
  "--push-option",
  "--repo",
  "--receive-pack",
  "--exec",
]);

/** Commands that change the directory; PowerShell's are case-insensitive. */
const CD_COMMANDS = new Set(["cd"]);
const POWERSHELL_CD_COMMANDS = new Set([
  "cd",
  "set-location",
  "sl",
  "chdir",
  "push-location",
  "pushd",
]);

/**
 * Words that can precede the command a simple command runs: wrappers, and the
 * shell keywords left in front of it once a command is split into segments,
 * as `then` in `if true; then git commit; fi` or `if` in `if git commit; then`.
 */
const WRAPPERS = new Set(["env", "command", "exec", "nohup", "time", "rtk"]);
const KEYWORDS = new Set([
  "then",
  "do",
  "else",
  "elif",
  "!",
  "if",
  "while",
  "until",
]);

/**
 * Options of `git switch` and `git checkout` whose value is the branch they
 * create and check out.
 */
const CREATE_OPTIONS = {
  switch: new Set(["-c", "-C", "--create", "--force-create", "--orphan"]),
  checkout: new Set(["-b", "-B", "--orphan"]),
};

/**
 * Split a shell command into simple commands on && || ; | and newlines, but
 * not inside quotes: `git commit -m "a; b"` is one command. A
 * backslash-newline is a line continuation, not a boundary: the shell runs
 * `git \<newline>commit` as `git commit`. In PowerShell the continuation is a
 * backtick-newline, and a backslash is only a path separator.
 *
 * Braces that open a block split too, so the body of PowerShell's
 * `if ($?) { git commit }` or a Bash `{ git commit; }` group is a command of
 * its own. A brace opens a block only at the start of a word or after `)`; the
 * one in a revision such as `HEAD@{0}`, or in `${VAR}`, stays in its word, and
 * so does the `}` closing it, even inside a block.
 *
 * Each segment comes with the separator that ends it (`&&`, `||`, `;`, `|`,
 * newline, `{` or `}`; null for the last one), and empty segments are kept so
 * that no separator is lost.
 */
function segments(cmd) {
  const s = cmd.replace(POWERSHELL ? /`\r?\n/g : /\\\r?\n/g, " ");
  const escape = POWERSHELL ? "`" : "\\";
  const out = [];
  let cur = "";
  let quote = null;
  let blocks = 0; // open blocks
  let inWord = 0; // open braces inside a word, as in `HEAD@{0}`
  const end = (sep) => {
    out.push({ text: cur.trim(), sep });
    cur = "";
    inWord = 0;
  };
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quote) {
      cur += c;
      // Inside double quotes the escape character escapes the next one: a
      // backslash in a POSIX shell, a backtick in PowerShell (where a
      // backslash is a path separator, as in "C:\repo\").
      if (quote === '"' && c === escape && i + 1 < s.length) cur += s[++i];
      else if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'") {
      quote = c;
      cur += c;
    } else if (s.startsWith("&&", i) || s.startsWith("||", i)) {
      end(s.slice(i, i + 2));
      i += 1;
    } else if (c === ";" || c === "|" || c === "\n") {
      end(c);
    } else if (c === "{" && /(^|[\s)])$/.test(cur)) {
      end(c);
      blocks += 1;
    } else if (c === "{") {
      inWord += 1;
      cur += c;
    } else if (c === "}" && inWord > 0) {
      inWord -= 1;
      cur += c;
    } else if (c === "}" && blocks > 0) {
      end(c);
      blocks -= 1;
    } else {
      cur += c;
    }
  }
  end(null);
  return out;
}

/**
 * Whether a push destination can update the protected branch: the branch
 * itself, or a wildcard such as `refs/heads/*` whose pattern covers it.
 */
function reachesProtected(dst) {
  if (!dst.includes("*")) {
    return dst.replace(/^refs\/heads\//, "") === PROTECTED;
  }
  const escape = (part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`^${dst.split("*").map(escape).join(".*")}$`);
  return pattern.test(PROTECTED) || pattern.test(`refs/heads/${PROTECTED}`);
}

/** Split one simple command into words, honouring quotes. */
function words(seg) {
  return [...seg.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)].map(
    (m) => m[1] ?? m[2] ?? m[3],
  );
}

/**
 * Index of `git` when it is the command this simple command runs: the first
 * word, after any `VAR=value` assignments, wrappers such as `env` or `rtk`,
 * and shell keywords such as `then`. -1 when git is only an argument, as in
 * `echo git commit`, or in a condition such as PowerShell's `if ($?)`.
 */
function gitIndex(w) {
  let i = 0;
  while (
    i < w.length &&
    (/^[A-Za-z_]\w*=/.test(w[i]) || WRAPPERS.has(w[i]) || KEYWORDS.has(w[i]))
  ) {
    i += 1;
  }
  return i < w.length && /^(.*[/\\])?git(\.exe)?$/i.test(w[i]) ? i : -1;
}

/** Map Git Bash paths like /d/foo to D:/foo on Windows. */
function nativePath(p) {
  const m = process.platform === "win32" && /^\/([a-zA-Z])(\/.*)?$/.exec(p);
  return m ? `${m[1].toUpperCase()}:${m[2] || "/"}` : p;
}

/**
 * The branch `git switch` or `git checkout` with `args` leaves checked out in
 * `dir`: "" when it detaches HEAD, undefined when it is not a branch change
 * this hook can name (`git switch -`, `git checkout -- file`, a path).
 */
function switchedTo(sub, args, dir) {
  let created;
  let detach = false;
  let pathspec = false;
  const positional = [];
  for (let k = 0; k < args.length; k++) {
    const a = args[k];
    if (a === "--") {
      pathspec = true;
      break;
    }
    const [name, value] = a.startsWith("--") ? a.split(/=(.*)/s) : [a];
    if (CREATE_OPTIONS[sub].has(name)) {
      created = value ?? args[++k];
    } else if (name === "--detach" || (sub === "switch" && a === "-d")) {
      detach = true;
    } else if (!a.startsWith("-")) {
      positional.push(a);
    }
  }
  if (created) return created;
  if (detach) return "";
  if (sub === "switch") return positional[0];
  // `git checkout <branch>`: a lone name that looks like a branch and is not
  // a path in the repository, with no pathspec after it.
  const [name] = positional;
  const branchLike =
    positional.length === 1 &&
    /^\w[\w./-]*$/.test(name) &&
    !name.includes("..") &&
    name !== "HEAD" &&
    !existsSync(resolve(dir, name));
  return !pathspec && branchLike ? name : undefined;
}

/**
 * Per directory: the branch a `git switch` or `git checkout` earlier in the
 * command checked out ("" when detached). It holds only while every separator
 * since the switch is `&&`: after `;`, `||` or the like the switch may have
 * failed and the next command still run. A recorded `main` is kept across any
 * separator, since that switch may have succeeded.
 */
const switched = new Map();

/** Per directory: the branch git reports (null when it cannot tell). */
const reported = new Map();

/** The branch checked out in `dir`: as switched to, else as git reports. */
function currentBranch(dir) {
  if (switched.has(dir)) return switched.get(dir);
  if (!reported.has(dir)) {
    reported.set(dir, git(dir, ["branch", "--show-current"]));
  }
  return reported.get(dir);
}

/** Forget the recorded switches that a separator other than `&&` voids. */
function crossSeparator(sep) {
  if (sep === null || sep === "&&") return;
  for (const [dir, branch] of switched) {
    if (branch !== PROTECTED) switched.delete(dir);
  }
}

/** Per directory: whether it is an AR-js-org repository (see scope.mjs). */
const scopes = new Map();

/**
 * Block the tool call, with `reason`, when `dir` is an AR-js-org repository.
 * Anywhere else, or in no repository at all, return and let it through.
 */
function block(dir, reason) {
  if (!scopes.has(dir)) scopes.set(dir, isArjsRepo(dir));
  if (!scopes.get(dir)) return;
  console.error(
    `Blocked: ${reason}. Work on a feature branch and open a pull request ` +
      "(see the repository's AGENTS.md, 'Git').",
  );
  process.exit(2);
}

let cwd = input.cwd || process.cwd();

// A separator applies after the segment it ends, before the next one.
let previous = null;
for (const { text: seg, sep } of segments(command)) {
  crossSeparator(previous);
  previous = sep;
  if (!seg) continue;
  const w = words(seg);
  const isCd = POWERSHELL
    ? POWERSHELL_CD_COMMANDS.has(w[0]?.toLowerCase())
    : CD_COMMANDS.has(w[0]);
  // PowerShell may name the directory with a parameter: `Set-Location -Path x`.
  const dirArg =
    POWERSHELL && /^-(path|literalpath)$/i.test(w[1] ?? "") ? w[2] : w[1];
  if (isCd && dirArg) {
    const target = nativePath(dirArg);
    cwd = isAbsolute(target) ? target : resolve(cwd, target);
    continue;
  }

  const gi = gitIndex(w);
  if (gi === -1) continue;

  // Global options before the subcommand, notably -C <dir>.
  let dir = cwd;
  let i = gi + 1;
  while (i < w.length && w[i].startsWith("-")) {
    if (w[i] === "-C" && w[i + 1]) {
      const target = nativePath(w[i + 1]);
      dir = isAbsolute(target) ? target : resolve(dir, target);
      i += 2;
    } else if (w[i] === "-c") {
      i += 2;
    } else {
      i += 1;
    }
  }
  dir = resolve(dir);
  const sub = w[i];
  const args = w.slice(i + 1);

  if (sub === "switch" || sub === "checkout") {
    const branch = switchedTo(sub, args, dir);
    if (branch !== undefined) switched.set(dir, branch);
    continue;
  }

  if (sub === "commit") {
    if (currentBranch(dir) === PROTECTED) {
      block(dir, `'git commit' on '${PROTECTED}' in ${dir}`);
    }
    continue;
  }
  if (sub !== "push") continue;

  // push: positional args after the options are [remote] [refspec...]
  const pushesAll = args.find((a) => a === "--all" || a === "--mirror");
  if (pushesAll) {
    block(dir, `'git push ${pushesAll}' includes '${PROTECTED}' in ${dir}`);
    continue;
  }
  // Collect the positional arguments: skip options, including the value of
  // those that take one as the next word, and take everything after `--`.
  const positional = [];
  let repoOption = false;
  for (let k = 0; k < args.length; k++) {
    const a = args[k];
    if (a === "--") {
      positional.push(...args.slice(k + 1));
      break;
    }
    if (a === "--repo" || a.startsWith("--repo=")) repoOption = true;
    if (PUSH_VALUE_OPTIONS.has(a)) k += 1;
    else if (!a.startsWith("-")) positional.push(a);
  }
  // Normally [remote] [refspec...]. With --repo naming the remote, a
  // positional argument may be either, so every one is checked as a refspec.
  const refspecs = repoOption ? positional : positional.slice(1);
  // Each refspec's destination: after the colon if there is one, without the
  // force marker `+`, and with `HEAD` meaning the branch checked out. With no
  // refspec the branch checked out is pushed, unless `--tags` asks for tags
  // alone (`--follow-tags` pushes the branch as well).
  let targets;
  if (refspecs.length) {
    targets = refspecs.map((r) => {
      const dst = r.replace(/^\+/, "").split(":").pop();
      return dst === "HEAD" ? currentBranch(dir) : dst;
    });
  } else {
    targets = args.includes("--tags") ? [] : [currentBranch(dir)];
  }
  // A null branch: not a repository, or git could not tell.
  if (targets.some((t) => t && reachesProtected(t))) {
    block(dir, `'git push' to '${PROTECTED}' in ${dir}`);
  }
}
