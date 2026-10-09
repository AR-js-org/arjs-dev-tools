// Preloaded with `node --import` by the guard suite: appends the arguments of
// every git process a hook spawns to the file named by GIT_SPAWN_LOG, so a
// test can count them. The hooks import execFileSync by name, so the patched
// function is pushed to the ES module bindings too.
import childProcess from "node:child_process";
import { appendFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";

const original = childProcess.execFileSync;
childProcess.execFileSync = function (file, args, ...rest) {
  if (file === "git") {
    appendFileSync(process.env.GIT_SPAWN_LOG, `${args.join(" ")}\n`);
  }
  return original.call(this, file, args, ...rest);
};
syncBuiltinESMExports();
