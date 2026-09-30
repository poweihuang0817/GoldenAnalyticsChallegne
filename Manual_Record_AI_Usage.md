# Golden Interview Challenge: AI usage record

Original notes: Po-wei Huang. Organization and technical clarifications below were AI-assisted at the candidate's request; the candidate reviews the final account. Prompts below are summaries, not a verbatim transcript. The detailed development history is in [docs/AI-LOG.md](docs/AI-LOG.md).

## Architecture exploration

**Prompt summaries:** Find open-source projects such as Substrait and Calcite; investigate alternatives to Power Query M; research Malloy; compare Substrait and PRQL for SQL semantics.

**Candidate direction:** Reconsider using Kysely directly, then retain a constrained Substrait profile as the relational IR. Keep possible future semantic frontends separate from the current application API. Defer PRQL migration to future work rather than changing architecture before submission.

**Outcome:** Typed Table/Expr queries lower into the supported Substrait profile, then Golden's compiler uses Kysely to construct backend SQL. Malloy, PRQL and Ossie are research directions, not integrated runtime dependencies. The profile uses Golden-specific function definitions; selecting Substrait does not automatically provide all official function semantics.

## API design

**Prompt summaries:** Make execution asynchronous; use types and avoid callbacks; learn from Kysely's schema-aware typing and typed filters.

**Candidate redirect:** The earlier API used callbacks. The candidate preferred readable predicate/projection objects and requested one typed expression API rather than retaining two styles.

**Outcome:** The current API uses relation-scoped typed expressions and projection objects. `execute()` is asynchronous; `compile()` remains synchronous and can preview SQL. Asynchronous execution does not imply all compilation work is nonblocking or that an end-to-end deadline exists.

## Implementation and extension

**Prompt summaries:** Connect a Substrait subset to Kysely; inspect compiler tree-traversal context; plan DuckDB integration.

**Candidate direction:** Keep PostgreSQL/MySQL execution remote and add DuckDB as a third-backend extension. Investigate compiler context and duplication without introducing a broad replacement compiler before submission.

**Outcome:** The same API queries run on PostgreSQL, MySQL and a separately seeded local DuckDB snapshot. DuckDB is not federation. Compiler consolidation remains deferred; no claim is made that all compiler complexity was eliminated.

## Correctness and testing

**Prompt summaries:** Implement equivalence tests; brainstorm formal testing; use independent calculations to compare results rather than relying on the implementation under test.

**Candidate redirect:** Add behavioral tests before large changes and go beyond cross-backend agreement, since backends can share a compiler bug. Investigate ambiguous challenge definitions rather than presenting one interpretation as uniquely required.

**Outcome:** Component/type tests, real-database integration, independent raw-data/BigInt references and bounded metamorphic tests complement each other. A compound filter is compared with sequential filters, and bounded grouped integer results are checked under reversed insertion order. Formal solvers, large fuzzing and TPC-H remain future work. Chosen interpretations and measured alternatives are recorded in [query semantics](docs/QUERY-SEMANTICS.md).

## Planning and submission

**Prompt summary:** Plan daily work before submission.

**Candidate direction:** Use separate worktrees and focused PRs, preserve progress in GitHub, and stop broad research to focus on submission.

**Outcome:** AI assisted implementation, research, test development and review. The candidate wrote the initial README and this record's original notes. Later targeted README corrections and organization of this record were explicitly requested from AI and remain visible in PR history. The candidate records the walkthrough and owns the final submission.
