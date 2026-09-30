# Bounded SQL query-block simplification

The analytical lowering previously emitted a derived table for almost every
relational operation, plus a final wrapper for output names and representations.
Kysely rendered that structure; neither Kysely nor Substrait required it.

The compiler now retains SQL emission state (source, output expressions, WHERE,
GROUP BY, and whether the block can absorb an operation). This is internal SQL
construction state, not a new canonical relational IR. Read, filter, direct-field
projection, and ordinary aggregation can share a SELECT. Root names and result
casts are emitted in the block when available. Values remain parameterized.

Aggregate outputs, computed projections, windows and fetches remain boundaries
for subsequent operations. Join and percentile lowering retain their existing
derived tables. This is deliberately a bounded simplification, not a general
optimizer, join rewrite, cast cleanup, or compiler consolidation.

## Evidence

Compared against main fa86807 using all seven driver examples and window top-N,
on PostgreSQL, MySQL and independently seeded in-memory DuckDB: 24 raw result
comparisons passed without normalization. This was a one-off comparison; the
committed suites retain independent expected-result and conformance checks.

SELECT counts (counts, not maximum nesting depth):

| Query | Before | After |
| --- | ---: | ---: |
| Recent orders | 4 | 3 |
| City count (each city) | 4 | 1 |
| Average units | 7 | 5 |
| Shipped/unshipped | 6 | 5 |
| Freight ratio, PostgreSQL/MySQL | 11 | 8 |
| Freight ratio, DuckDB | 14 | 11 |
| Percentile | 11 | 10 |
| Window top-N | 5 | 2 |

PostgreSQL city SQL decreased from 377 to 153 characters. EXPLAIN changed from
Subquery Scan -> Aggregate -> Seq Scan to Aggregate -> Seq Scan. MySQL's city
EXPLAIN FORMAT=JSON no longer contains the outer materialized aggregate derived
table. These observations do not establish a latency or throughput improvement.

Local validation: TypeScript and documentation type checks; 60 unit tests;
62 integration tests; one three-backend snapshot conformance test, all passed.
The new one-block regression failed on the original implementation (4 versus 1
SELECT). Boundary tests cover nested aggregates, computed projections, fetch
before filtering, and windows. Existing database fixtures cover NULLs, duplicates,
empty/all-null aggregates, decimals, ordering, and driver representations.
No formal proof or large-data performance benchmark has been performed.

## References

- [Calcite SqlImplementor](https://github.com/apache/calcite/blob/main/core/src/main/java/org/apache/calcite/rel/rel2sql/SqlImplementor.java): clause-aware subquery decisions.
- [DataFusion unparser](https://github.com/apache/datafusion/blob/main/datafusion/sql/src/unparser/plan.rs): preservation of required derived-table boundaries.
- [PRQL SQL generation](https://github.com/PRQL/prql/blob/main/prqlc/prqlc/src/sql/gen_query.rs): pipeline-to-query-block construction.

These are design references, not imported implementations or correctness proofs.

## Diagnostics and final window refinement

The initial 24-way before/after comparison preceded the additional window-input
merge (then 3 SELECTs). The final two-SELECT window form passes the independent
window oracles and three-backend conformance suite.

Pass a fresh LoweringDecision[] as compilePlan's fourth argument, { trace }, to
collect unary-operation merge/boundary decisions. Relation IDs identify traversal
nodes, not SQL blocks. This bounded diagnostic omits literals and is not an
exhaustive event log. Function-free dispatch reports detailed tracing unavailable.
Playground shows it under Generated SQL > Compilation details. Tests confirm
tracing preserves SQL and bindings. Execution timing and EXPLAIN automation are
separate future work.
## Performance evidence follow-up

Run `npx tsx scripts/check-query-performance.ts <output.json>` with the provided
PostgreSQL/MySQL services available. It seeds an in-memory DuckDB snapshot and
runs the fixed public Northwind corpus only. EXPLAIN ANALYZE executes each query.
Reports contain public sample rows and literal-bearing database explain plans;
do not reuse this reporting policy for sensitive production datasets.

Committed reports are in docs/evidence/sql-query-blocks/: before.json uses
fa86807, after.json uses compiler cf8643c, with the same collector. Each contains
SQL, result rows, plain/analyzed plans, seven samples and their median after one
warm-up. A held connection excludes acquisition; timings include transfer and
decoding. The baseline collector was temporarily pointed at the clean main
checkout; it is not a second maintained compiler. All 24 raw result comparisons
passed. Test/script additions were uncommitted during collection; compiler code
was unchanged from cf8643c. These are local observations, not CI thresholds.

Initial DuckDB freight medians were 29.03 -> 37.88 ms. A follow-up on one seeded
connection alternated old/new SQL (AB/BA), discarded three warm-up pairs and
measured 21 pairs: 38.70 -> 40.81 ms. Results matched. This smaller remaining
slowdown is unresolved; neither these small samples nor shorter SQL establish
an overall performance win. Other timings are mixed and mostly close. Preserve
both observations rather than selecting favorable runs. The paired report is
recorded in duckdb-freight-paired.json. Future work: repeated independent runs,
larger fixtures, engine-version capture, and investigation of DuckDB's exact
decimal division plan. Do not claim every backend/query is faster.

Additional hand-calculated regressions run on all three databases: filters
before/after window, renamed window inputs with null partitions/ties and both
null orderings, nested offset/limit and replacement sort, zero-row aggregate,
and ranking aggregated outputs then aggregating filtered ranks. Integration
suite increased from 62 to 74 tests; all passed, alongside 60 unit tests and the
three-backend conformance test.
