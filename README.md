# arjs-dev-tools

[Claude Code](https://code.claude.com) plugin marketplace for the AR.js-next
repositories:
[AR.js-next](https://github.com/AR-js-org/AR.js-next),
[arjs-plugin-artoolkit](https://github.com/AR-js-org/arjs-plugin-artoolkit) and
[arjs-plugin-threejs](https://github.com/AR-js-org/arjs-plugin-threejs).

Per-repository rules live in each repository's `AGENTS.md`. This repository
holds what spans all of them.

## Install

```bash
claude plugin marketplace add AR-js-org/arjs-dev-tools
claude plugin install arjs@arjs-dev-tools
```

or, inside a session, `/plugin marketplace add AR-js-org/arjs-dev-tools`
followed by `/plugin install arjs@arjs-dev-tools`.

## Skills (`arjs` plugin)

| Skill            | Invoke                 | Does                                                                                    |
| ---------------- | ---------------------- | --------------------------------------------------------------------------------------- |
| `release`        | `/arjs:release 0.3.0`  | Milestone readiness, version bump, merge-then-tag, `dev` re-sync, publish verification  |
| `event-contract` | `/arjs:event-contract` | Audits and changes the `ar:*` event contract consistently across the three repositories |
| `vite-example`   | `/arjs:vite-example`   | Creates or converts an example into an npm-based Vite project, no vendored builds       |

`release` runs only when invoked explicitly. The other two can also be picked
up automatically when a task matches.

## Hooks (`arjs` plugin)

| Hook                   | Event / matcher                        | Does                                                                                                                   |
| ---------------------- | -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| protected-branch guard | `PreToolUse` `Bash\|PowerShell`        | Refuses `git commit` on `main` and any push that reaches `main`; exits 2 with a message                                |
| format-on-edit         | `PostToolUse` `Edit\|Write\|MultiEdit` | Runs the edited file's repository-local `prettier` and `eslint --fix`; problems come back as context, never as a block |

Both hooks act only in AR-js-org repositories. A repository is in scope when
any of its `remote.<name>.url` values matches `github.com[:/]AR-js-org/`
(case-insensitive), so a fork that has an `upstream` remote on AR-js-org
counts too. Anywhere else they do nothing. The formatter uses the repository
that holds the edited file, not the session's working directory, and skips
`node_modules`, `dist`, `types`, `coverage` and `vendor`.

The hook scripts need only Node built-ins. Running their tests needs Node
22.12 or later (see [Run the tests](#run-the-tests)).

## Use in a repository

Commit this to the repository's `.claude/settings.json`:

```json
{
  "extraKnownMarketplaces": {
    "arjs-dev-tools": {
      "source": { "source": "github", "repo": "AR-js-org/arjs-dev-tools" }
    }
  },
  "enabledPlugins": { "arjs@arjs-dev-tools": true }
}
```

A contributor who trusts the repository folder gets the marketplace
registered, and `arjs` is enabled without a manual install. Installing it by
hand (see [Install](#install)) still works.

During migration, Claude Code does not deduplicate project and plugin hooks:
if a repository still has its own copy under `.claude/hooks`, both the
plugin's hook and the repository's copy run. A repository therefore drops its
`.claude/hooks` copy in the same pull request that enables the plugin.

## Layout

```
.claude-plugin/marketplace.json
.github/workflows/test.yml
package.json
plugins/arjs/
  .claude-plugin/plugin.json
  skills/<name>/SKILL.md
  hooks/hooks.json
  hooks/*.mjs
  hooks/tests/
```

Bump `version` in both `plugin.json` and `marketplace.json` when a skill or
hook changes, so installed copies update.

## Run the tests

```bash
npm install
npm test
```

The tests cover the hook scripts and run on Linux and Windows in CI. They need
Node 22.12 or later. They exercise the hooks directly; to check the wiring
through Claude Code itself, start `claude --plugin-dir ./plugins/arjs` in a
scratch clone of an AR-js-org repository on `main` and ask for a
`git commit`, which should be refused (manual check).

## License

MIT
