# AGENTS.md

`arjs-dev-tools` is the Claude Code plugin marketplace for the AR.js-next
repositories. It ships one plugin, `arjs`, under `plugins/arjs/`: skills
(`release`, `event-contract`, `vite-example`) and hooks (a protected-branch
guard and a formatter). See the README for what each does.

## Git

- Work on a feature branch and open a pull request into `dev`. Releases go
  `dev` → `main`.
- Never commit on `main` or push to `main` directly; the `arjs` plugin's guard
  refuses it.
- Plain `git commit`, with the repository's own identity.

## Plugin versions

Bump `version` in both `plugins/arjs/.claude-plugin/plugin.json` and
`.claude-plugin/marketplace.json` when anything in the plugin changes.

## Tests

`npm install && npm test`
