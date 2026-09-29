# API behavior characterization before typed API changes

Original characterization base: main 1603551 (merged plan #19), delivered in PR #21 before API changes. Those expected results are preserved by the typed API migration. The new API uses predicate/projection objects; compiler and driver representations remain unchanged.

## Coverage inventory

| Behavior | Existing coverage retained | Gap added here |
| --- | --- | --- |
| Scope and schemas | api.test.ts: catalog snapshots, unknown names, captured scope, join predicate/output separation | Projection/aggregate output aliases replace available field names; removed columns cannot filter/group/sort |
| Predicate semantics | api-integration.test.ts: combined vs sequential filters on Northwind | Literal TRUE/FALSE/UNKNOWN oracle, including FALSE AND UNKNOWN, CASE and filter result |
| Projection | Identity projection and compiler emit mapping | Reordered aliases used by later filters, same field emitted twice, duplicate rows preserved |
| Composition | Nested limits and nested sample aggregates | Filter-after-limit deliberately differs from limit-after-filter |
| Aggregation | Empty global count/grouped input, challenge independent oracles | All-null SUM/AVG/count, nullable grouping key, filter on aggregate alias and aggregate over aggregates |
| Joins | Compile-time self-join shape, nullable outputs, empty-right execution | Asymmetric real-engine self-join, duplicate matches, NULL keys on both sides, unmatched rows and coalesce |
| Numeric/window contracts | percentile.test.ts, duckdb.test.ts, window suites | No duplicated decimal/window corpus; existing suites rerun |

New fixture corpus: test/api-characterization.test.ts, five named scenarios on PostgreSQL, MySQL and DuckDB using exactly the same public queries. Each compares to manually calculated expected rows, not merely another backend. Sorting is explicit where rows differ. Fixtures have seven rows, include duplicate values/nulls, and never modify the Northwind tables.

MySQL cannot reference a temporary table twice in a self-join. Fixtures therefore use random names for ordinary tables, created and dropped on the owned connection in try/finally. DuckDB is in-memory. CREATE/DROP permission is required, as in other integration fixtures. An interrupted process can leave its uniquely named fixture behind; cleanup only an identified test-owned table.

## Observed result-typing limitation

The first run revealed that MySQL returns the tested computed i32 CASE/COALESCE outputs as strings because CAST AS SIGNED is reported through mysql2 as BIGINT. PostgreSQL/DuckDB return numbers for these cases. The test asserts that existing behavior explicitly in the expected values; it does not coerce actual rows or claim a uniform representation contract.

The typed client now uses `number | string` for i32: do not promise every logical i32 expression returns a JS number without a deliberate normalization decision and regression tests. The API migration does not change the driver/compiler or establish that the divergence is desirable. Existing raw i32 column outputs remain numbers in the fixture.

## Verification

- Fresh npm ci in isolated .worktrees/api-characterization.
- npm run check passed.
- Focused API tests passed after correcting fixture setup and recording the observed MySQL representation.
- npm test: 34 passed.
- npm run test:integration: 34 reported passed (includes 3 parent tests and 15 scenario subtests for the new corpus).
- npm run test:duckdb: 1 passed.
- Independent agent reviewed fixture oracles and scope; root executed all database suites serially across commands.

These are local results, not hosted CI, full SQL equivalence, fuzzing, or final-release fresh-clone evidence. The typed API adds `test/api-types.ts`, compiled by `npm run check`: it covers names, expression kinds, scalar/measure separation, nullable joins, inferred results, callback rejection and dynamic/union structural-name rejection. The evidence above records the original #21 checkpoint; see the typed API PR for its own validation.
