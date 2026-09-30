# AI collaboration log

## September 30: resolve challenge-query ambiguity (#38)

- User requested completing #38 while personally writing the README, and authorized a separate agent to close out PRQL/Ossie research. Root used an isolated query-semantics worktree; candidate README left untouched.
- Added independent raw-row rational calculations for a finite variant matrix, adversarial reference fixtures, and baseline Golden execution on PostgreSQL/MySQL/private in-memory DuckDB. Kept alternative-reference results distinct from API-supported queries; no compiler or default semantic changes.
- Observed concrete differences for date cutoff ties, city accents, order-versus-line averages, freight ratio grain and percentile definition. Some populations coincide on Northwind, so fixtures establish their distinction. Exact monetary inputs are validated before integer arithmetic; no blanket floating normalization.
- Initial typecheck caught a reference-helper row spread losing indexed properties; corrected the type annotation before execution. All baseline driver results and alternative-reference matrices agreed across three backends. This is local evidence and not a claim of final-release CI or a candidate-authored README.

## Initial setup

- User supplied the challenge and directed the assistant to start by checking the Docker image.
- Assistant checked Docker availability, registry metadata, image configuration, startup logs, authentication, and sample table counts.
- User installed Docker and started its engine. The existing assistant environment had stale PATH information; refreshing PATH outside the sandbox made Docker accessible.
- Assistant found the image's PostgreSQL health-check socket mismatch and verified database access independently.

## Version control

- User requested Git setup and a private repository under `poweihuang0817` to save progress.
- Assistant prepared a Git ignore file, Docker Compose configuration, and these progress notes.

## Architecture and workflow discussion

- User challenged a custom IR proposal and asked for established production representations, distinguishing SQL ASTs from physical query plans.
- Assistant investigated Substrait, Kysely, SQLGlot, Calcite, DataFusion, Trino, and Malloy. Logical relational algebra was clarified as a valid representation of query semantics, without prescribing physical execution.
- User requested that delivery plans and Git workflow be recorded before settling the architecture.
- Added `PLAN.md`, `GIT-WORKFLOW.md`, and a proposed `ARCHITECTURE.md`. No architecture or extension has been accepted yet.

## Accepted architecture and first implementation

- User clarified this is a relational query translation/folding problem, not BI semantic modeling, and explicitly chose a Substrait subset with Kysely.
- Assistant implemented a strict v0.63.0 JSON profile, a positional-field compiler, PostgreSQL/MySQL adapters, and a recent-orders driver.
- Initial scope is read/project/sort/fetch. Unsupported operators are rejected rather than accepted with incomplete semantics.
- Compiler tests cover parameter binding, validation, and append-before-emit projection behavior; shared integration tests compare each backend to reference SQL.
- Node.js LTS was installed and Docker restarted to run validation. Actual elapsed work time has not been recorded by the candidate.

## User correction: standard definitions before subset restrictions

- User identified that PR #2 used handwritten Substrait-shaped types and requested official standard definitions with unsupported features explicitly blocked.
- Assistant revised the existing PR #2 branch in an isolated worktree, without merging it or altering PR #3.
- Vendored upstream v0.63.0 Protobuf schemas and generated TypeScript declarations/codecs using pinned protobufjs tooling. This uses the official schemas, not the separate substrait-js package.
- Kept capability restrictions as validation rules; removed the manually declared relation type union and built the example with generated interfaces/enums.
- Added binary round trips, separate reflection checks against the upstream schemas, unsupported-feature rejection, and malformed/unknown-field checks. Database integration now includes the binary round trip.

## Architecture diagram

- User requested a real architecture image in PR #2. Added a reproducible PNG diagram showing generated types/JSON/binary inputs, capability validation, Kysely compilation, and remote execution. Visually checked the rendered image before delivery.

## Agent workflow guidance

- User requested worktree and agent best practices in a skill or agent instruction file, in a separate PR.
- Selected repository-level `AGENTS.md` so future agents receive project-specific guidance without requiring a personal skill installation.
- Created an isolated `docs/agent-workflow` worktree from `origin/main`, separate from open implementation PR #2.
- Documented worktree ownership, explicit delegation, shared-service limitations, prerequisite PR sequencing, validation, and safe cleanup.

## Lower-layer coverage before the high-level API

- User merged PR #3 and authorized merging PR #2. Documentation conflicts from the earlier stacked branches were resolved preserving both accepted architecture and worktree guidance; PR #2 was merged.
- User directed the assistant to ensure the lower layer can express all challenge sample queries before building the fluent API.
- Added function declarations, filters, CASE, inner/left joins, aggregates, and scoped SQL compilation in a new worktree from main.
- User challenged rank/count interpolation as approximate. Clarified continuous versus discrete percentiles, then replaced floating monetary calculations with explicit decimal(38,10) arithmetic.
- Added independent BigInt price/percentile oracles, native PostgreSQL percentile comparison, and temporary fixtures covering nulls, ties, empty inputs, endpoints, and decimals beyond JavaScript's safe integer range.
- City matching is explicitly case-insensitive and accent-sensitive. The sample stores the accented Mexico city spelling; tests cover both spellings.

## Candidate README

The challenge explicitly requires a README written by the candidate. The assistant has not written that README. These notes are supporting material for the candidate's own account of the work.
# Public API iteration — September 26, 2026

- User supplied a full architecture/verification brief, then explicitly prioritized: Ibis-inspired public API, unit/case coverage, more verification, and only afterward capabilities/errors/logging.
- Inspected the merged lower layer, tests, generated Substrait bindings and Docker connectivity. Proposed the boundary before implementation; user accepted this order.
- Added a small lazy Table/Expr facade directly over generated Substrait relations. Kept existing lowering, function semantics, and independent raw-data/BigInt oracles. Extracted shared function identities so the API does not import the SQL implementation.
- Re-expressed all six query families through callback-scoped named columns; explicit join outputs handle duplicate names/self-joins and left-join nullability.
- Added isolated API checks, direct cross-backend comparisons, and finite relational equivalence/empty-input cases. No randomized fuzzing or full conformance claim. No candidate README was written.
- Limits: runtime schema/type validation rather than inferred TypeScript row types; no arbitrary new operators, decimal literals, or full Ibis support. Backend adapter expansion and the separate extension remain later work.

## PR #5 self-review

- Found a join-scope leak: a column captured in `on` could be reused in `select` with pre-join nullability, despite left-join null extension. This could give later expressions misleading metadata and cause compiler rejection.
- Added a minimal regression test and confirmed it failed before the fix. Separated predicate and output scope identities; the stale reference now fails immediately.
- Re-ran type checking, 16 unit tests and 11 integration tests successfully. All six challenge query families remain covered on both databases.
- Remaining MVP gaps are the separately demonstrated extension, fresh-clone setup verification, candidate README/video, and reviewer access. Capabilities/errors/logging are useful future improvements, not prerequisites to demonstrating the current core.

## Independent review comment on PR #5

- Verified the reported coupling with a minimal function-free read/project/sort/fetch test: the public API emits declarations and compilePlan selects compileAnalytics on both dialects.
- Verified the risk before changing behavior: deleting declarations from a function-free nested-limit plan causes the old visitor to reject it. The existing API integration suite relies on this supported composition.
- Chose the review's explicitly permitted option 2: preserve behavior, document the dependency, defer metadata/dispatch cleanup to #7. Added a focused characterization test; no compiler refactor or schema-validation expansion.

## PR #14 local walkthrough review

- User requested fixes for the independent demo-page review. Read the latest comment; it found no blocking P0/P1 issue and asked for two explicit boundary clarifications.
- Clarified in server comments and supporting documentation that HTTP receive timeouts do not bound or cancel database execution, and Host/Origin checks are not authentication. Preserved loopback binding, the fixed query allowlist and the warning against public proxies.
- No timeout/authentication framework or runtime behavior changed. Validation for this follow-up is staged diff inspection and `git diff --check`; the prior type check, 17 existing unit tests, two HTTP tests and six real database smoke runs were not rerun for comments/docs only.
- Browser visual verification remains pending: the prior attempt reported no available IAB and an empty enabled-browser inventory. No visual inspection is claimed.

## Window extension and delegated review checkpoint

- User approved a separate top-N-per-customer extension and later clarified it should continue independently while agents investigate issues and local architecture instructions.
- Added a narrow withRowNumber API using official v0.63.0 WindowRel and numeric lte; native windows execute remotely, then an outer filter selects top N. No general optimizer/window API or compiler unification.
- Added binary/profile rejection checks, independent Northwind sorting oracles, cross-backend comparison, and isolated fixtures for ties/nulls/empty/small partitions. No sample rows changed.
- User explicitly authorized agents for #6/#7/#8: #6 validation and #8 wire hardening concluded KEEP/FREEZE with no code change. Per user direction, findings were posted to issues and those investigations closed; documentation-only PRs #9/#10 were closed unmerged. #7 comparison tests remain PR #11; root independently reran all four tests successfully. Analytics is not a strict semantic superset, so consolidation is deferred.
- Agents read the complete Arch_instruction_V2.txt and rerendered/read the original formal email PDF. V2 matches the earlier brief. Original email requires an extension, driver, DB tests, candidate README/video; it allows incomplete polish and only some sample queries. Capability/error/logging layers are not original email obligations. Latest user direction defers README/video/access/final packaging.
- Agent verified fresh remote main 8fe7d4a with fresh dependencies and a separate healthy Docker container on alternate ports: check, 17 unit tests, 11 integration tests, demo and codec regeneration passed. Extension branch requires its own fresh-clone rerun before this checkpoint is complete.
- An automatic approval review blocked root editing another agent's worktree for a shared log update. No write occurred; this coordinated entry is recorded in root's own extension worktree instead.

- Fresh clone of window code 603accf passed fresh install, separate fresh Docker instance, typecheck, all 36 tests and driver; isolated container/network cleaned up. See CHECKPOINT.md. User explicitly requested capabilities, authentication/authorization and useful errors be recorded as essential cross-database production work outside MVP; FUTURE-WORK.md captures these plus researched follow-ups without writing the final README.

- Independent PR #13 review found no blocking correctness issue. Its non-blocking note about validated-input assumptions is now explicit in compileAnalytics JSDoc and window documentation. No new validation or behavior change; local/fresh-clone results still apply to unchanged executable logic.

## DuckDB third backend and PR #15 merge reconciliation

- User explicitly requested DuckDB as an additional submission backend. The delegated implementation uses the pinned official Node client and a small Kysely driver; a consistent read-only PostgreSQL snapshot supplies four local Northwind tables. PostgreSQL/MySQL remain remote; no federation or Python runtime was added.
- Real-engine regression tests first exposed DuckDB decimal division losing digits above JavaScript's safe integer range, then large-numerator division by zero overflowing despite the null contract. Bounded SQL HUGEINT quotient/remainder lowering and an explicit null guard fixed those failures; decimal AVG and arithmetic overflow explicitly reject rather than silently approximate.
- User requested PR #15 conflicts be resolved after the window extension merged. Merged origin/main at 1ba187a without rebasing or force-pushing. Combined package scripts to retain both window and DuckDB tests; combined the driver backend switch with the window demo. The compiler merge retained both native ranking/lte and DuckDB-specific decimal handling.
- Added three-backend window compatibility checks at N=0,1,3,1000 through Substrait binary round trips. Kept sample-query comparisons and independent hand-calculated DuckDB fixtures. Coordinated with the demo-page agent so shared-database suites run serially. This entry is supporting AI-development history, not the candidate's final README.
- After reconciliation, local type checking, 26 local tests, 16 PostgreSQL/MySQL integration tests, and one three-backend conformance test passed (43 total). The snapshot seed and both driver commands passed, including the window example on all three engines. No CI or new fresh-clone verification is claimed for this merge.

## PR #14 merge-conflict resolution

- User requested reconciliation with current main. Merged origin/main without rebasing or rewriting published commits. The only conflict was concurrent appended AI-log entries; preserved both the walkthrough review and main's window/review checkpoint. Runtime files merged cleanly.
- Integration owner requested adding the HTTP boundary tests to the default npm test command now that package-script ownership is available. No new UI examples or backend behavior were added.
- Merged-branch typecheck, all 22 default unit/HTTP tests and diff checks passed. Database-mutating integration was reserved for the parallel DuckDB agent, avoiding concurrent fixture work. Browser visual verification remains pending as recorded above.

## PR #15 reconciliation after the walkthrough merged

- User merged PR #14 and requested PR #15's remaining conflicts be resolved. Merged origin/main d1a2b32 without rebasing or force-pushing. Preserved both branches' AI-log entries and included compiler/API/window/playground/DuckDB suites together in the default test command. Runtime files merged without conflict; the playground's existing two-backend HTTP allowlist is unchanged.
- Validation after this merge: typecheck, 28 default local/HTTP tests, 16 PostgreSQL/MySQL integration tests, one three-backend sample/window conformance test, and diff checks passed (45 tests total). No new UI browser inspection, CI, or fresh-clone claim.

## Kysely migration plan PR — September 28, 2026

- User correction: do not begin test additions or migration yet; first submit a plan PR for review.
- Drafted a plan-only proposal to replace the public Golden Table/Expr + Substrait boundary with direct Kysely query builders. No DataFusion/federation is proposed for current scope.
- Proposed sequencing: review plan; merge behavior-characterization tests that pass on the current code; migrate query definitions/driver while preserving those tests; then remove unused Substrait code and dependencies.
- Found open PR #18 adds a client wrapper around the current API. The plan records it as a disposition to resolve before migration and explicitly forbids stacking migration work on it.
- No source or test implementation changes were made. No checks or test claims are made by the plan PR.

## PR #19 direction revision — September 28, 2026

- User chose to retain Substrait as a relational contract, potentially useful beneath a future semantic-query frontend, and requested these findings be saved in the PR.
- Clarified that Substrait does not supply a semantic layer and relational algebra is not universally more expressive than SQL. No concrete external consumer is claimed; compiler/interchange costs remain.
- User reiterated compile-time schema checks and redirected the API design to learn from Kysely, especially typed filters. Proposed schema-correlated column/operator/value arguments, typed select/output inference, expression objects, and typed callback compatibility.
- Kept runtime scope/profile validation, exact result semantics, and test-first sequencing. No new serialized IR, Kysely AST translation, semantic layer, or compiler replacement is proposed.
- Updated only planning documents and PR metadata. API examples are proposals, not implemented or typechecked features. PR #17/#18 were neither merged nor closed.

## Persistent context checkpoint

- User requested durable architecture/scope/correctness guidance for shorter task-specific sessions. Extended the existing AGENTS.md rather than replacing its worktree and review rules.
- Recorded the retained Substrait/Kysely boundary, current three backends, deferred semantic/federation work, and the distinction between proposed typed filters and implemented behavior.
- User subsequently merged #17. PR #18 was reconciled with main and pushed at 6901985; 50 tests and 21 three-backend example executions passed locally. Verify live PR status when resuming; this is historical evidence, not an automatic merge authorization.

## September 28: simple client and explicit callback semantics

- Human redirect: ordinary application callers should execute a Table directly, while retaining an optional SQL preview. Explain what callbacks can contain and improve readability without adding another query language.
- Added createClient with execute(Table), compile(Table), and destroy(); kept the existing Substrait/compiler/driver boundaries internally. Driver demonstration now uses this client. Catalogs are snapshotted and previews are detached from execution.
- Documented callback return contracts, named expressions/helpers, configuration-time branching versus SQL CASE, unsupported async/arbitrary JavaScript translation, and relation scope limits. Ibis is a design reference, not justification for common lazy/callback patterns.
- Tests cover all three dialect previews, parameter binding, invalid plans, closed clients, catalog mutation, real DuckDB results/error propagation, and callbacks running once at construction. Existing PostgreSQL/MySQL challenge conformance now exercises the client.
- Initial test incorrectly assumed DuckDB uses question-mark placeholders; actual existing dialect uses numbered dollar placeholders. Corrected the test expectation, with no compiler change.
- Validation passed: npm run check, npm test, npm run test:integration (16 tests), npm run test:duckdb (1 three-backend conformance test), PostgreSQL/MySQL demo, git diff --check. These are local checks, not CI. Existing supplied database container was used.
- API documentation PR #17 and AI README draft #16 remain separate and unmerged; their examples will need reconciliation when merging this API addition. No candidate-authored README was written.

## Dedicated API documentation — September 28, 2026

- Candidate requested a separate comprehensive API-doc PR and an explicit explanation of why the API follows Ibis's design. Moved reference work out of README PR #16 without force-pushing; this branch starts independently from main d8a5fb0.
- Organized docs/api into tutorial, Table/Expr reference, execution, Northwind recipes, semantics, design and maintenance pages. The design compares Ibis-style composition with direct Kysely and raw Substrait and states there is no Ibis runtime dependency.
- Added source documentation comments and a runnable/type-checkable Northwind companion. No query behavior changed and no documentation-site dependency was introduced. TypeDoc/API Extractor are documented as possible later tooling, not installed capabilities.
- Documentation remains supporting material; the candidate-authored submission README is separate. The code MVP stays frozen while its interface is explained.
- Validation: npm run check and npm run check:docs passed; seven Northwind analyses compiled through binary round trips for each of three backends (21 combinations), then all 21 executed successfully after seeding this worktree's dedicated DuckDB file. Verified 10 Markdown pages / 58 local links and diff checks. Source-only comment edits preserve identical emitted runtime output, checked with the already-installed esbuild transpiler. An initial auxiliary check using the TypeScript compiler API could not use ScriptTarget from the installed package; the actual tsc checks passed and no new tool dependency was added. No full-suite rerun or hosted CI claim.

## PR #18 reconciliation after #17 merged

- User merged #17 and requested resolution of #18 conflicts. Merged current main without rebasing or force-pushing; retained both AI histories, documentation scripts and client tests.
- Preserved the docs/api directory and updated the tutorial, execution reference and runnable examples to use createClient. Low-level compilation and serialization remain documented for advanced use.
- No compiler, result semantics or client runtime changes were needed. Compile-time schema inference remains follow-up design work in #19.
- Reconciliation validation passed: fresh npm ci in the isolated worktree, normal/docs typechecks, 33 local tests, 16 PostgreSQL/MySQL integration tests, one three-backend conformance test, 21 offline example compilations and 21 real example executions with a dedicated DuckDB snapshot. These are local checks, not CI.

## PR #19 reconciliation and retained IR confirmation

- User merged #18 and requested #19 conflicts be fixed, explicitly confirming retained Substrait IR for a future semantic-query frontend. Merged main 7b806e2 without rebase/force-push; preserved all AI-log histories.
- Clarified the shared IR boundary: the current relational API and a future semantic frontend can both produce the supported Substrait profile. Metrics, dimensions, grain and relationship resolution belong above it; no semantic engine is implemented by this plan.
- Updated references to merged #17/#18 and the architecture checkpoint. Typed filters/schema inference remain proposed follow-up work. Documentation-only; no source/test changes or new runtime test claims.

## API philosophy and early submission schedule

- User prefers readable predicate/projection objects to callbacks and requested the design research be finished today, with submission planned before Friday Oct 2.
- Compared official Kysely, Drizzle and Polars expression/schema documentation. Recommended Drizzle-inspired typed helpers/projection objects, Polars composition ideas, and Kysely type experience; no new runtime dependency or alternate IR. Exact syntax remains for review.
- Replaced the stale delivery schedule with Sep 28 design, Sep 29 bounded optional type work plus README preparation, Sep 30 freeze/fresh-clone verification/first video, Oct 1 submission, Oct 2 buffer. Existing tests are evidence, not final-version fresh-clone proof.
- Recorded a fallback to the verified existing API if optional redesign threatens packaging. Candidate-authored README/video/access remain unconfirmed. No implementation, merge or submission was performed.

## PR #19 review: application API versus relational IR

- Addressed review comment 5881414944: removed stale wording that called the Substrait profile the public query representation. The accepted-architecture section now identifies Table/Expr as the application frontend and Substrait as the relational contract consumed by backend compilation.
- Updated the adjacent text flow to include the frontend and all three existing backends. No implementation change; merging the plan is not authorization to implement the optional typed API.
- Validation: reviewed the documentation diff, checked local links and git diff --check. No runtime tests required or claimed.

## API characterization before typed API work

- User approved a tests-only checkpoint and explicitly requested parallel agents in different worktrees. Root owns test/api-characterization; independent read-only review used review/api-test-review, and submission notes use docs/submission-guide in separate worktrees.
- Inventoried existing API/decimal/window coverage; added one schema-boundary unit test and five fixture scenarios across all three backends for predicates, projection, relation order, aggregation and self-joins. No production API/compiler changes.
- Initial run exposed MySQL's temporary-table self-join restriction and computed i32 CASE result strings. Switched to uniquely named disposable ordinary fixture tables and explicitly characterized MySQL CASE/COALESCE representation; no result normalization hid the difference. Typed-result work must address this limit before promising i32 numbers universally.
- Independent reviewer checked hand-calculated expectations and found no blocking correctness issue. Root verified typecheck, 34 local tests, 34 reported integration tests (including nested test containers), and 1 three-backend conformance test. Supplied Northwind data remained unchanged. See API-TEST-COVERAGE.md for exact scope and limits.

## Fresh-clone CI after PR #21

- Human direction: complete typed API in a separate worktree while another agent verifies fresh setup; then requested hosted CI to avoid repeated manual full-suite runs.
- Used a genuine independent clone from main cb4678d9. Added a single Linux/Node 22 workflow for lockfile installation, typechecks, unit/integration/conformance tests, drivers and documentation examples, with isolated Compose databases and bounded cleanup.
- This does not validate the parallel typed API implementation. Hosted results and limitations are recorded in docs/CI.md; no candidate README or billing configuration changed.

## Unified typed API after PR #21

- User approved completing the typed API in a separate worktree and explicitly redirected the design to one typed predicate/projection surface, removing callback compatibility. A later prompt confirmed finishing this PR before additional UI/CI work.
- Root owns feat/typed-api; authorized agents migrated tests and API docs in separate worktrees, then root integrated their commits. CI remains a separate task/branch. No compiler consolidation, Substrait replacement, dependency or backend change is included.
- Preserved literal catalog schemas; added typed Table/Expr/Measure contracts, expression/projection objects, staged callback-free joins, and inferred client rows. Join input/output scopes remain separate and left-join right fields become nullable. Existing relation-identity checks remain runtime checks.
- Migrated all application queries, driver examples, runnable docs and tests. Substrait remains the canonical IR and Kysely the lowering layer. A one-off comparison against pre-migration query builders confirmed structurally identical Substrait JSON for all eight driver examples, including ranking.
- Retained the observed MySQL computed-i32 behavior: inferred i32 results are conservatively number|string. No numeric coercion or loss of decimal/i64 precision hides backend differences.
- Independent review found union/dynamic structural names could falsely promise multiple output fields. Added failing negative type contracts (confirmed unused expect-error failures), then restricted table/group/window names and output aliases. Fixed grouping tuples and literal aliases keep the bounded type contract honest. Dynamic Catalog annotations intentionally lose precise schema inference.
- Validation on the combined implementation: fresh worktree npm ci; normal/docs typechecks; 35 local tests; 34 reported integration tests (including nested containers); one three-backend Northwind conformance test; 21 documentation examples compiled offline and executed on PostgreSQL/MySQL/seeded DuckDB; both driver commands passed. These are local checks, not hosted CI or final-release fresh-clone proof.
- Known limits: no static per-instance relation identity, no general dynamic-alias inference, no filter-based nullability refinement, no schema introspection or new normalization layer. Numeric literal range/decimal constraints and backend capabilities still require runtime validation. Candidate-authored README/video remain separate deliverables.

## PR #22 review: nominal expression and measure types

- Addressed review 5346505110: structural Expr/Measure interfaces allowed ordinary object literals to match the public shape without factory construction.
- Added compile-only negative assignments for complete structural expression and measure objects. Both directives first failed as unused, confirming the gap; both pass after the fix. Positive factory assignments and existing inference contracts remain checked.
- Added separate unexported unique-symbol brands to the interfaces and internal runtime classes as erased declarations. Marked resolve with @internal and documented that these are compile-time markers, not a runtime security boundary. SQL, Substrait construction and execution behavior are unchanged.
- Validation: normal/docs typechecks, 35 local tests, 34 reported integration tests and one three-backend conformance test passed. Hosted CI remains a separate task; no hosted run is claimed.

## Video UI draft checkpoint, September 28

- User requested a visual driver/API/architecture walkthrough, explicitly including DuckDB. Added DuckDB to the fixed HTTP/UI backend allowlist, explanatory API/Architecture pages, an SVG diagram, and demo:ui script. No compiler or query semantics changed.
- Typecheck and 36 local tests passed, including a real DuckDB HTTP fixture. Headless Edge exercised nine sample/backend combinations successfully. Architecture image route succeeds but browser rendering still fails; this is an open item, not a completed visual check.
- User asked to save a PR and continue tomorrow. Open as draft, preserve incomplete work and record remaining verification. Parallel docs and bounded methodology work have independent branches/PRs. No merge or submission is authorized.

## CI publication after typed API merge

- User completed workflow-scope authorization and merged #22. Integrated main fc5e1e4 into the independent CI clone, preserving both AI-log histories. The upcoming hosted run covers the merged typed API, not only the original #21 baseline.

- Hosted run 36507131453 passed at CI head 17d61a1 after correcting the invalid runner.temp job-env reference. All fresh setup/database/driver/docs steps passed. Updated CI history to address the stale-status review comment; local independent-clone checks also passed on merged #22 code.

## Bounded test-methodology expansion after typed API and CI

- User requested a little more correctness evidence before submission while keeping TPC-H, large fuzzing, mutation infrastructure and formal verification as future work.
- Added six deterministic datasets per backend to the existing API characterization suite: explicit empty/all-NULL/duplicate/i32-boundary cases plus three fixed-seed datasets. No runtime/compiler, dependency or package-script change.
- Each engine checks an independent JavaScript bag-aggregate/filter oracle, compound versus sequential scoped filters, and grouped insertion-order invariance. Explicit NULL handling and bounded exact integer sums avoid invalid JavaScript/SQL or floating-point assumptions. Real result encodings are asserted unchanged.
- Documented replay seed, independent oracle boundaries, fixture cleanup, SQL bag/NULL semantics and deferred verification directions in TEST-METHODOLOGY.md. This is a small reproducible corpus, not full property/fuzz/formal verification.

- Validation in the isolated worktree: fresh npm ci, typecheck, 35 local tests, 55 reported integration tests (including parent tests and 18 new dataset subtests), and one three-backend Northwind conformance test passed. These are local results; the PR CI run remains separate evidence.

## September 28 - finish DuckDB walkthrough while candidate is away

User asked to continue as much as possible and save progress without waiting. Finished the dedicated PR25 worktree: repaired a Windows encoding defect that made the SVG invalid UTF-8 (first reproduced with a failing test), replaced inline SVG CSS with CSP-compatible attributes, corrected visible arrow glyphs, and formatted the displayed city query without changing semantics. Added isolated unseeded-DuckDB coverage: compile creates no file; execution reports seed guidance without exposing the internal path.

Validation: code/docs type checks and 37 local tests passed. Temporary headless Edge outside repository dependencies checked three compile-only paths, nine real Northwind runs across PostgreSQL/MySQL/DuckDB, missing-seed UI feedback, navigation, diagram rendering, 1440/900px page width and absence of JavaScript errors. Visually inspected the three 1440px page screenshots. Updated the submission plan and verification notes; no PR merged or submission sent. Final candidate README and video remain human deliverables.

## September 29: bounded long-query execution controls

User requested parallel work on capability, metadata, timeout/cancellation and stable errors. Added optional AbortSignal / running-query timeout to typed client execution, native cancellation for all three backends, and explicit execution error codes. Investigated pinned Kysely abort internals: its executor rejects before background cancellation cleanup. Instead, hold its provided connection until both the native query and cancellation settle. MySQL uses an independent control connection to avoid exhausted-pool deadlock. Kept synchronous compilation and pool queue deadlines explicitly outside this first execution budget. Cancellation failure is observable and does not silently discard server work. Tests include independent lifecycle fakes and actual PG/MySQL/DuckDB interruption; DuckDB public-client test checks native interruption cause. No compiler or result-normalization changes.
## September 29: bounded metadata inspection (issue #27)

- User requested parallel agents for capabilities/errors, long-running-query controls, and metadata inspection. This branch owns metadata only; runtime execution controls remain separate.
- Added explicit-schema/table discovery with preserved physical type information and strict conversion to the existing catalog, including default-schema validation and unsigned/decimal rejection.
- Checked the installed Kysely introspector: no bounded table filter, precision/scale, or unsigned metadata. Used parameterized information-schema queries instead of broad introspection plus guessed types.
- Integration found that dotted table keys are quoted as a single identifier in current relational lowering. Kept the compiler unchanged and restricted catalog conversion to confirmed default-schema names. Also corrected MySQL metadata aliases and serialized independent DuckDB file handles after real database failures.
- Decimal conversion remains exact (38,10); no claim that all Northwind physical types are automatically supported. Discovery does not synthesize compile-time schema types or replace manual catalogs.
## September 29: bounded capabilities and compiler errors (#26)

- User requested agents implement capability/error codes alongside long-query controls and metadata inspection, after the original MVP checkpoint. This explicitly expands the prior post-submission plan.
- Kept the existing SQL semantics: continuous percentile remains a rank/count rewrite on all three backends; DuckDB exact decimal AVG remains rejected.
- Added four inspectable capability keys and stable compiler rejection codes/stages, preserving causes for profile-validation errors and allowing unexpected errors to propagate unchanged. Separated invalid declarations from unsupported implementation choices at explicit rejection sites, without parsing message strings.
- Full-standard Substrait classification, public API-construction error normalization and a generic capability planner remain out of scope. Root coordinated package.json test-script ownership; separate agents own execution controls and metadata.
- Added focused tests for native/rewrite/unsupported behavior, contextual restrictions, validation causes and propagation. Two initial test failures exposed a test that hit the public API before compilation and a declaration split that had not applied; corrected the fixture and explicit classifier before final validation.

## Submission deliverable checklist (September 30, 2026)

- User asked whether the driver exists, whether their README omits test descriptions, and requested a Markdown checklist to annotate themselves.
- Inspected the current candidate README and CLI driver; recorded existing deliverables separately from final-run, video, access and submission evidence. Flagged missing AI-prompt/redirect account and imprecise test-count wording without editing the candidate README.
- Added docs/SUBMISSION-CHECKLIST.md with candidate note fields. Documentation checks only; no new runtime/CI success claimed.

## README setup reference (September 30, 2026)

- User requested saving setup, driver, UI and test instructions into a document to reference from their own README.
- Updated docs/RUNNING.md in a separate worktree; removed obsolete pre-merge branch instructions and documented DuckDB seeding, the fixed-example UI, test commands and cleanup.
- Checked commands and UI port against package.json, compose.yaml and server source, and checked relative links and whitespace. Documentation-only change; no new runtime validation claimed. Candidate README left untouched.

## PR #42 review: compact semantic evidence

- Reviewer requested shrinking the generated artifact and removing repeated SQL. Added compact per-variant fingerprints/population summaries with exact ALFKI/Germany contrasts; baseline rows now have raw driver-result hashes instead of SQL.
- Added --full stdout output for reproducing all reference rows without committing them. Documented that raw driver hashes are representation-sensitive, not a cross-backend equality oracle.
- Validation: code and audit typechecks passed; 54 unit tests (4 focused reference/artifact tests) passed; compact and full audits each matched all 21 baseline executions across PostgreSQL/MySQL/DuckDB; reference fingerprints agreed. Artifact reduced from 727,661 bytes / 21,709 lines to 24,803 bytes / 824 lines. Whitespace check passed. No production semantics or candidate README changed.

## Sequential submission verification (September 30, 2026)

- User requested working through the submission checklist one item at a time. Preserved their uncommitted README and used the checklist worktree.
- Installed locked dependencies and ran both CLI drivers: all 8 examples on each of three backends passed. Seeded a new worktree-owned DuckDB file, leaving existing demo snapshots unchanged.
- Recorded current candidate f43e370 driver evidence and successful hosted fresh-clone run 36741924009. Final revision, candidate narration, video and delivery remain unconfirmed; no PR merged or submission sent.

## Reviewer navigation guide (September 30, 2026)

- User requested a company-friendly guide in its own PR mapping each challenge deliverable to files and commands. Added root REVIEWER_GUIDE.md with driver/extension/test/design/AI/future-work links and an explicit pending video/version/access section.
- Guide is labelled AI-assisted supporting navigation; no README or candidate AI record modifications in this PR. No claim of final submission or new runtime validation.

## AI usage record organization (September 30, 2026)

- Candidate explicitly requested a separate PR to organize the manually started AI record. Preserved the recorded prompt topics and grounded redirects/outcomes in conversation and repository history; labelled summaries and AI-assisted organization rather than claiming verbatim prompts or sole human authorship of the revision.
- Clarified async execution vs synchronous compilation and implemented functionality vs deferred semantic/compiler research. No candidate review or elapsed time invented. README unchanged in this PR.

## Walkthrough readability (September 30, 2026)

- User requested a vertical Typed API/Substrait/backend diagram, consistent green for DuckDB, formatted SQL and a more readable Substrait view for filming.
- Added display-only dialect formatting with original SQL retained and an operator outline with authoritative raw JSON retained. No compiler or execution semantics changed. Diagram is shared by UI and architecture documentation.
- Validation: 57 unit tests, code/docs typechecks, nine fixed-example dialect formatting combinations, XML parse and visual SVG review passed. SQL Formatter is a pinned display dependency; raw SQL remains the execution input. No new full remote integration run claimed.
