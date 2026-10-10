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
6. `CHANGELOG.md`: `## [Unreleased]` covers the milestone's closed issues and
   merged PRs, and every breaking change is marked **Breaking** and says what
   consumers must change. The target version must agree with any "Planned
   as …" line and the breaking statement; before 1.0, a **Breaking** entry
   means a minor bump, not a patch. Report any gaps, then either add the
   missing entries in the release commit (after asking) or stop. If the
   repository has no `CHANGELOG.md`, say so and continue without one; never
   create it as part of a release.

## 2. Version bump (on a branch off `dev`)

```bash
git switch dev && git pull --ff-only
git switch -c chore/release-v<version>
npm version <version> --no-git-tag-version
```

Then update `CHANGELOG.md` (skip if the repository has none):

1. Rename `## [Unreleased]` to `## [<version>] - <YYYY-MM-DD>` (today, UTC)
   and add a new, empty `## [Unreleased]` above it.
2. Remove planning sentences such as "Planned as <version>." from the
   renamed `## [<version>]` section; keep the breaking/non-breaking statement
   ("No breaking changes.").
3. Compare links at the bottom: `[Unreleased]` becomes
   `…/compare/v<version>...HEAD`; add
   `[<version>]: …/compare/<previous>...v<version>`, where `<previous>` is the
   base of the old `[Unreleased]` link, copied as written (old tags may lack
   the `v`).

Update the README's "Upgrading to <version>" notes from the milestone's
closed issues. Run the full check: tests, lint, format check, build. Commit
`chore: release v<version>` (after asking), including `CHANGELOG.md` in the
same commit as `package.json`, PR into `dev`.

## 3. Merge and tag (the order is load-bearing)

1. After the bump PR is merged: PR `dev` → `main`, merge.
2. Tag **the merge commit on `main`, after the merge**. Tagging earlier runs
   the previous release's workflows.

   ```bash
   git switch main && git pull --ff-only
   git tag v<version> && git push origin v<version>
   ```

3. Re-sync `dev`:
   `git switch dev && git merge --ff-only origin/main && git push origin dev`.

## 4. Verify

- `gh run list --limit 5`: `release.yml` and `publish.yml` succeeded for the
  tag.
- The GitHub Release exists with its zip.
- The GitHub Release notes are the changelog section. `release.yml` creates
  the release with generic notes, so after asking, write the `## [<version>]`
  section body (the lines after its `## [<version>] - …` heading, up to the
  next `## [` heading) to a temp file and run
  `gh release edit v<version> --notes-file <file>`.
- npm: trust the `+ @ar-js-org/<pkg>@<version>` line in the publish log;
  `npm view` can lag by minutes.
- Close the milestone and the release issue.

If one workflow failed, follow "Recovering a partial release" in
`MAINTAINERS.md`; never publish by hand.
