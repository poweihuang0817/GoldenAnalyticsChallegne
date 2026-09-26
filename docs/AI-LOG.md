# AI collaboration log

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
