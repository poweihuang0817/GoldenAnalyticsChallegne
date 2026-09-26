# Git workflow

Repository: https://github.com/poweihuang0817/GoldenAnalytics (private).

## Branches and commits

- Keep `main` runnable. No separate `develop` branch.
- Use short-lived branches for meaningful changes, such as `docs/project-plan`, `feat/query-api`, `feat/backend-adapters`, or `feat/window-functions`.
- Commit working checkpoints with descriptive messages. Avoid one giant final commit.
- Push at the end of every work session; local commits alone are not a remote backup.
- Include relevant AI log updates alongside implementation changes.

## Pull requests

- Open a PR to `main` for each branch, and self-review the full diff.
- Describe the problem, resulting behavior, key design tradeoff, validation, and remaining limitations.
- Run checks appropriate to the change before merging. Documentation-only changes need review and a whitespace/diff check, not artificial tests.
- Squash merge for a concise history on `main`.
- Keep implementation out of an architecture-only PR until the decision is accepted.
- Merge prerequisite PRs before starting dependent implementation unless stacked work is explicitly requested. Independent documentation or implementation PRs can proceed from `origin/main` in separate worktrees.
- Agents may prepare and push PRs within the task scope; merge only when the user authorizes it.

## Worktrees and agents

Repository-wide agent instructions live in [`AGENTS.md`](../AGENTS.md). Prefer one worktree per independently edited task, keeping the primary checkout on `main`. Worktrees share Git refs/configuration and external services, so they do not isolate database mutations or port usage.

Use a single agent by default. If delegation is explicitly requested, give each editing agent a separate branch/worktree and clear file ownership. Read-only reviewers may share a checkout. Coordinate changes to shared interfaces and lockfiles, and serialize tests that mutate shared databases.

## Typical session

```powershell
git switch main
git pull --ff-only
git fetch origin
git worktree add .worktrees/query-api -b feat/query-api origin/main
Set-Location .worktrees/query-api
# Install this branch's dependencies with npm ci when a lockfile exists.
# Make a focused change and run its relevant checks.
git add <specific-files>
git commit -m "Add portable recent-orders query"
git push -u origin feat/query-api
```

Create a PR with a description of the actual final change. Commit only intended files; do not blindly stage secrets or unrelated edits.

The `.worktrees/` directory is ignored. Before this ignore rule reaches the primary branch, add `/.worktrees/` once to the local exclude file reported by `git rev-parse --git-path info/exclude`.

After an authorized merge, return to the primary checkout and fast-forward `main`. Remove a completed worktree with `git worktree remove <exact-path>` only after checking it is clean, its work is preserved remotely, and no process or agent owns it. Do not use forced removal or recursive directory deletion. Branch deletion is a separate cleanup step, not a prerequisite for merging.

For an explicitly requested stack, merge the prerequisite first. A squash merge changes commit ancestry: retargeting alone may leave earlier commits visible in the dependent PR. Inspect its full diff and reconcile its base before merging; do not force-push shared work without authorization.

## Release

Freeze features September 30. After fresh-clone validation and final documentation, tag the chosen commit `submission-v1` and push that tag. Submit October 1 if possible, retaining October 2 as a buffer. Tagging is a release checkpoint, not proof that tests passed.

Git identity is configured locally for this repository using the GitHub username and GitHub noreply email. Authentication credentials belong in the credential manager, never repository files.
