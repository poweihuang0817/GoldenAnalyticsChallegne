# Fresh-clone verification in GitHub Actions

The `Fresh clone` workflow checks each pull request, pushes to `main`, and manual runs. It uses one disposable Ubuntu 24.04 runner with Node 22, a fresh checkout and `npm ci` from the committed lockfile. It does not reuse `node_modules` or require repository secrets.

It runs code/documentation typechecks, unit tests, offline documentation examples, the supplied `goldenbeers/golden-query-challenge:1.0` Compose image, PostgreSQL/MySQL integration cases, three-backend DuckDB conformance, both drivers, and executing documentation examples. DuckDB demo data is seeded into the runner's temporary directory. Database fixtures are isolated from developers' machines; the job tears down its own Compose project even after failure and prints bounded database diagnostics on failure.

The job has a 20-minute timeout and cancels superseded runs on the same PR/ref. Actions are pinned to commit hashes with read-only repository permissions. No billing settings or branch protection are changed. Private-repository Actions usage counts against the owner's allowance; a single Linux job limits duplicate work. A green check is evidence for its tested revision, not later unmerged API work or a guarantee across all operating systems.

## Initial verification

The CI work started from a genuine remote clone of `main` at `cb4678d9c0d3c26f6817029db283148ec12ba233`, after PR #21. No local dependency directory or database was reused. Hosted run results are recorded below after execution; adding a workflow alone is not a passing verification.

The separate typed API branch is not covered until this workflow runs on that branch's final merge candidate. Final submission still requires the candidate-authored README, walkthrough, access checks, and selecting the verified submission commit.

### Observed local results and hosted blocker

On the fresh clone, Node 24.19.0 on Windows completed `npm ci`, `npm run check`, `npm run check:docs`, all 34 unit tests, and all 21 offline documentation compilations. The initial sandboxed tsx process could not read Windows user information; rerunning outside the sandbox passed. This is not verification of the workflow's Node 22/Linux environment.

GitHub rejected the initial workflow push because the CLI OAuth token lacks the `workflow` scope. Therefore no hosted run or CI PR has been created yet, and no PostgreSQL/MySQL integration, DuckDB conformance, or executing driver/docs result is claimed for this fresh clone. The account owner can grant the required scope with `gh auth refresh -h github.com -s workflow`, then push this branch and open its PR. Do not treat the workflow as active until a hosted run is observed.

### Typed API merge checkpoint

The user granted workflow scope after merging PR #22. The CI branch now includes main `fc5e1e4` (typed API and nominal-brand review fix). The earlier permission blocker is resolved; hosted verification is pending publication and execution. Original local results above remain attributed to their original revision.
