---
name: release
description: Prepare and cut a release of AR.js-next, arjs-plugin-artoolkit or arjs-plugin-threejs following the milestone-based process in MAINTAINERS.md. Use when the user asks to release, publish, tag or bump the version of one of these packages, or to check whether a release is ready.
argument-hint: "[version, e.g. 0.3.0]"
disable-model-invocation: true
---

# Release an AR.js-next package

Target version: `$ARGUMENTS` (ask if missing).

Read the repository's `MAINTAINERS.md` first: it states what differs from the
shared process (trusted publishing vs `NPM_TOKEN`, workflow quirks). The
repository's `AGENTS.md` rules apply throughout. **Ask the user before every
commit, push, tag, merge and GitHub write.**

## 1. Readiness

1. Find the milestone named `v<version>`:
   `gh api repos/{owner}/{repo}/milestones -q '.[] | select(.title=="v<version>")'`.
   If it does not exist, stop and ask.
2. List open items: `gh issue list --milestone v<version> --state open` and
   `gh pr list --search "milestone:v<version>" --state open`. A release is
   ready only when both are empty; otherwise report what is left and stop.
3. Check cross-repo order on the
   [AR.js-next roadmap](https://github.com/orgs/AR-js-org/projects/2): when
   the marker event contract changes, threejs ships before artoolkit, and
   AR.js-next last.
4. CI must be green on `dev`: `gh run list --branch dev --limit 5`.
5. Find or open the release issue (template "Release", label `release`) and
   keep its checklist updated as you go.

## 2. Version bump (on a branch off `dev`)

```bash
git switch dev && git pull --ff-only
git switch -c chore/release-v<version>
npm version <version> --no-git-tag-version
```

Update the README's "Upgrading to <version>" notes from the milestone's
closed issues. Run the full check: tests, lint, format check, build. Commit
`chore: release v<version>` (after asking), PR into `dev`.

## 3. Merge and tag (the order is load-bearing)

1. After the bump PR is merged: PR `dev` → `main`, merge.
2. Tag **the merge commit on `main`, after the merge**. Tagging earlier runs
   the previous release's workflows.

   ```bash
   git switch main && git pull --ff-only
   git tag v<version> && git push origin v<version>
   ```

3. Re-sync `dev`: `git switch dev && git merge --ff-only origin/main && git push`.

## 4. Verify

- `gh run list --limit 5`: `release.yml` and `publish.yml` succeeded for the
  tag.
- The GitHub Release exists with its zip.
- npm: trust the `+ @ar-js-org/<pkg>@<version>` line in the publish log;
  `npm view` can lag by minutes.
- Close the milestone and the release issue.

If one workflow failed, follow "Recovering a partial release" in
`MAINTAINERS.md`; never publish by hand.
