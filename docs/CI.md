# Fresh-clone verification in GitHub Actions

The `Fresh clone` workflow checks each pull request, pushes to `main`, and manual runs. It uses one disposable Ubuntu 24.04 runner with Node 22, a fresh checkout and `npm ci` from the committed lockfile. It does not reuse `node_modules` or require repository secrets.

It runs code/documentation typechecks, unit tests, offline documentation examples, the supplied `goldenbeers/golden-query-challenge:1.0` Compose image, PostgreSQL/MySQL integration cases, three-backend DuckDB conformance, both drivers, and executing documentation examples. DuckDB demo data is seeded into the runner's disposable checkout. Database fixtures are isolated from developers' machines; the job tears down its own Compose project even after failure and prints bounded database diagnostics on failure.

The job has a 20-minute timeout and cancels superseded runs on the same PR/ref. Actions are pinned to commit hashes with read-only repository permissions. No billing settings or branch protection are changed. Private-repository Actions usage counts against the owner's allowance; a single Linux job limits duplicate work. A green check is evidence for its tested revision, not later unmerged API work or a guarantee across all operating systems.

## Initial verification

The CI work started from a genuine remote clone of `main` at `cb4678d9c0d3c26f6817029db283148ec12ba233`, after PR #21. No local dependency directory or database was reused. Hosted run results are recorded below after execution; adding a workflow alone is not a passing verification.

The separate typed API branch is not covered until this workflow runs on that branch's final merge candidate. Final submission still requires the candidate-authored README, walkthrough, access checks, and selecting the verified submission commit.

### Observed local results and hosted blocker

On the fresh clone, Node 24.19.0 on Windows completed `npm ci`, `npm run check`, `npm run check:docs`, all 34 unit tests, and all 21 offline documentation compilations. The initial sandboxed tsx process could not read Windows user information; rerunning outside the sandbox passed. This is not verification of the workflow's Node 22/Linux environment.

The initial workflow push was blocked because the CLI OAuth token lacked workflow scope. The user later granted that scope, and PR #23 published the workflow. See the observed hosted result below; the earlier Windows checks alone were not hosted evidence.

### Typed API merge checkpoint

The user granted workflow scope after merging PR #22. The CI branch now includes main `fc5e1e4` (typed API and nominal-brand review fix). The earlier permission blocker is resolved; hosted verification completed as recorded below. Original local results above remain attributed to their original revision.

The initial hosted attempt was rejected before starting any job. The workflow incorrectly referenced `runner.temp` in job-level env, where the runner context is unavailable. It now uses `github.workspace`; see [GitHub context availability](https://docs.github.com/en/actions/reference/workflows-and-actions/contexts#context-availability). The corrected run below verified execution.

### Passing hosted run

[Run 36507131453](https://github.com/poweihuang0817/GoldenAnalytics/actions/runs/36507131453) passed on CI head `17d61a1`, incorporating main `fc5e1e4` (#22). GitHub used a disposable Ubuntu/Node 22 runner, fresh checkout/install, newly started supplied databases, and a separately seeded DuckDB file. All workflow steps passed: typechecks, unit/integration/conformance tests, offline docs, driver execution and executing docs. This evidence covers that tested revision; later changes require their own run.

The independent Windows clone was also updated to that code and reinstalled using npm ci: both typechecks, 35 local tests, 34 reported integration tests and one three-backend conformance test passed. These local database tests used the existing supplied PostgreSQL/MySQL instance, so only the hosted run proves fresh database startup.
