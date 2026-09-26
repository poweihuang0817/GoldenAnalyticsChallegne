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

## Typical session

```powershell
git switch main
git pull --ff-only
git switch -c feat/query-api
# Make a focused change and run its relevant checks.
git add <specific-files>
git commit -m "Add portable recent-orders query"
git push -u origin feat/query-api
```

Create a PR with a description of the actual final change. Commit only intended files; do not blindly stage secrets or unrelated edits.

## Release

Freeze features September 30. After fresh-clone validation and final documentation, tag the chosen commit `submission-v1` and push that tag. Submit October 1 if possible, retaining October 2 as a buffer. Tagging is a release checkpoint, not proof that tests passed.

Git identity is configured locally for this repository using the GitHub username and GitHub noreply email. Authentication credentials belong in the credential manager, never repository files.
