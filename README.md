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

## Layout

```
.claude-plugin/marketplace.json
plugins/arjs/
  .claude-plugin/plugin.json
  skills/<name>/SKILL.md
```

Bump `version` in both `plugin.json` and `marketplace.json` when a skill
changes, so installed copies update.

## License

MIT
