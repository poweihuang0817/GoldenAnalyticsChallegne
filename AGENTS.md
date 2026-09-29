# Repository instructions for coding agents

## Start each task

- Read `docs/ARCHITECTURE.md`, `docs/PLAN.md`, and `docs/GIT-WORKFLOW.md` for current decisions and scope. Do not treat a proposal as an accepted decision.
- Inspect `git status --short --branch`, `git worktree list`, and relevant open PRs before editing. Preserve existing user changes and other agents' work.
- Keep the primary checkout on `main`. Prefer a separate worktree for a new coding or documentation task; a branch in the existing checkout is acceptable for a single sequential task if it is clean and no other process owns it.
- Start independent work from freshly fetched `origin/main`, not another open PR branch. Do not create dependent work before its prerequisite PR is merged unless the user explicitly requests stacked work.

## Architecture and scope checkpoint

- Table/Expr is the current application-facing frontend. A constrained Substrait profile is the canonical relational contract; Substrait is not the public semantic API.
- Kysely constructs backend SQL below Golden's relational lowering. PostgreSQL, MySQL and DuckDB are current backends; DuckDB uses a separately seeded local snapshot.
- Retain Substrait unless the user explicitly accepts a new architecture decision. The earlier Kysely-only migration proposal is superseded.
- Learn from Kysely's schema-aware API without translating its AST back into Substrait. Compile-time schema propagation and typed filters are proposed in [the API plan](docs/TYPED-RELATIONAL-API-PLAN.md), not implemented features. Review that plan before implementation.
- A future semantic frontend could be Malloy-like, but no semantic-layer product or dependency has been selected. It would resolve business concepts before producing relational operations.
- Before submission, do not add a full Substrait engine, federation, schema/authentication frameworks, or new duplicate compiler paths. Existing compiler duplication is known; do not consolidate it without characterization tests and explicit scope.
- Prioritize correctness, reviewer experience, candidate-authored README/docs, and a clear demo. Keep changes small and defer speculative architecture work.

## Correctness and continuity

- Every behavioral component change needs focused unit/type tests appropriate to that boundary. Documentation-only changes need documentation checks, not artificial runtime tests.
- For compiler/semantic bugs, first add a failing regression test; preserve independent oracles and cross-backend checks for NULLs, decimals, duplicates, empty inputs and boundaries. Reject unsupported capabilities explicitly.
- Compile-time types do not replace runtime profile/catalog/scope validation or prove driver result representations.
- Use GitHub issues/PRs and repository decision documents as persistent context. At a new session, read these instructions and relevant plans, then verify current PR status; historical chat summaries are not live status.
- Keep accepted decisions, pending proposals, test evidence and deferred work distinct. Record major user redirects in docs/AI-LOG.md. A new task-specific thread should not need the full prior conversation.

## Worktree and branch ownership

- Use one branch and one worktree per independently edited task. Suggested paths: `.worktrees/<task>` and branches `feat/<task>`, `fix/<task>`, or `docs/<task>`.
- A worktree isolates checked-out files and the index, but shares repository history, refs, and configuration. Never assume it isolates databases, ports, credentials, or external services.
- Do not switch, reset, rebase, clean, or edit another task's worktree. Never use destructive cleanup or forced checkout to make a task fit.
- Install dependencies separately in each worktree with the committed lockfile when available. Do not share or copy `node_modules` between worktrees.
- Use Git's worktree commands to remove worktrees. First verify the exact path, clean status, pushed commits, and that no user/agent is using it. Do not remove an active or unmerged task's worktree or delete its branch without authorization. Never use `--force` to bypass these checks.

## Agent collaboration

- Default to one agent. This file does not authorize spawning agents; delegate only when the user or a higher-priority instruction explicitly requests it.
- When delegation is authorized, assign a concrete task, owning branch/worktree, permitted files, acceptance criteria, and integration owner before edits begin.
- Independently editing agents need separate worktrees. Read-only reviewers may inspect the same checkout but must not modify files, run formatters, or change Git state.
- Coordinate ownership of shared interfaces, dependency manifests/lockfiles, and documentation. Assign one writer to overlapping changes; isolated worktrees do not prevent merge conflicts.
- Agents report their branch and commit, changed files, checks/results, and unresolved limitations. The integration owner reviews the diff and runs integration checks; an agent's success report alone is not validation.
- Avoid concurrent tests that mutate shared databases. Use isolated fixtures/databases or serialize them; read-only tests may share the supplied data.

## Commits, PRs, and review

- Keep commits focused. Stage specific intended files and inspect the staged diff. Do not commit secrets, generated dependencies, or another task's changes.
- Update `docs/AI-LOG.md` for major prompts and user redirections. Record actual time only when known; never invent it.
- Run checks appropriate to the branch's changes. For documentation: inspect links/commands and run `git diff --check`. For code: run the branch's type checks and meaningful tests, including provided-database integration tests where relevant.
- Push the task branch and open a separate PR targeting `main`. State behavior, validation actually performed, and remaining limitations. Do not claim local checks are CI.
- Self-review the final PR diff against its base and ensure unrelated changes are absent. Keep the PR title/description aligned with its final scope.
- Opening a PR is not permission to merge it. Merge when the user authorizes it. Use squash merge unless instructed otherwise, then sync the primary checkout with `git pull --ff-only`.
- If a stack is explicitly requested, record dependencies and merge order. After a prerequisite is squash-merged, retarget/reconcile the dependent branch and verify its PR diff contains only intended remaining changes. Do not rewrite a shared/published branch without authorization.
- Report PR URL, branch, commit, validation, and whether it is open or merged. Leave work saved and pushed at session end.

## Challenge-specific constraints

- PostgreSQL/MySQL execute analytical work remotely; do not silently replace this with local execution.
- Reject unsupported query operations explicitly and document the supported Substrait profile. Avoid claiming full standard compliance from a subset implementation.
- The candidate must write the submission README and record the walkthrough. AI may maintain supporting notes, but must not present them as candidate-authored work.
- Deadline: October 2, 2026; target submission October 1. Keep scope consistent with the challenge's approximately 45-minute expectation and document deferred work.
