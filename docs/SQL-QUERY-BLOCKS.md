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

Local validation: TypeScript and documentation type checks; 61 unit tests;
74 integration tests; one three-backend snapshot conformance test, all passed.
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

Pass a fresh LoweringDecision[] as compilePlanSync's fourth argument, { trace }, to
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

Committed compact evidence is in [summary.json](evidence/sql-query-blocks/summary.json):
exact baseline/candidate revisions, result equality and SHA-256 hashes, SELECT
counts, and timing medians/ranges. Full raw rows, plans and timing samples are
local artifacts in ignored .perf-results/, not regression fixtures. Engine patch
versions missing from the original capture are explicitly marked unknown.
The original baseline collector used clean main fa86807; candidate compiler was
cf8643c. Compiler snapshots remain committed in test/fixtures/sql-query-blocks/.

To reproduce full current evidence:

```powershell
New-Item -ItemType Directory -Force .perf-results
npx tsx scripts/check-query-performance.ts .perf-results/current.json
npx tsx scripts/investigate-duckdb-freight.ts
```

For a full historical baseline, run the same collector in a separately installed
checkout of the recorded baseline revision. Do not compare engine plans as
fixed expected outputs. The freight investigation uses one small committed
baseline SQL/parameters fixture, so it does not need the full historical report.

Initial DuckDB freight medians were 29.03 -> 37.88 ms. A follow-up on one seeded
connection alternated old/new SQL (AB/BA), discarded three warm-up pairs and
measured 21 pairs: 38.70 -> 40.81 ms. Results matched. This observation was subsequently investigated below; neither these small samples nor shorter SQL establish
an overall performance win. Other timings are mixed and mostly close. Preserve
both observations rather than selecting favorable runs. The compact summary retains paired medians/ranges. Future work: repeated independent runs,
larger fixtures, engine-version capture, and investigation of DuckDB's exact
decimal division plan. Do not claim every backend/query is faster.

Additional hand-calculated regressions run on all three databases: filters
before/after window, renamed window inputs with null partitions/ties and both
null orderings, nested offset/limit and replacement sort, zero-row aggregate,
and ranking aggregated outputs then aggregating filtered ranks. Integration
suite increased from 62 to 74 tests; all passed, alongside 60 unit tests and the
three-backend conformance test.

## Compiler snapshots (not database optimizer snapshots)

The normal unit suite compares exact compiler-generated SQL, ordered parameters
and lowering decisions for eight examples on each backend (24 snapshots).
Fixtures live in test/fixtures/sql-query-blocks/. No EXPLAIN plan or timing is an
assertion: engine upgrades, statistics and cost estimates may legitimately change
those. Snapshot changes require SQL/trace review plus semantic integration tests;
matching snapshots alone do not prove correctness. To explicitly regenerate:

```powershell
$env:UPDATE_SQL_SNAPSHOTS = '1'
npx tsx --test test/analytics-compiler.test.ts
Remove-Item Env:UPDATE_SQL_SNAPSHOTS
npm test
```

Snapshots contain only fixed public sample parameters. Do not capture user data.
The expanded unit suite now has 61 passing tests.

## DuckDB freight deeper investigation

Reproduce with `npx tsx scripts/investigate-duckdb-freight.ts`. This investigation
uses the committed before SQL and checks the known fixed parameter order [0,0,1].
It does not load a second compiler. The baseline is specific to this change;
future compiler changes must review fixture/parameter compatibility first.

DuckDB v1.5.5, six independently seeded in-memory instances, five warm-up pairs
then 21 measured pairs per instance, alternating AB/BA; every instance checks
exact result equality. The script writes full analyzed profiles and samples to ignored
`.perf-results/duckdb-freight-investigation.json`; committed summary.json retains
the original six rounds of medians/ranges. Re-running does not overwrite the
committed historical summary.

| Threads | Round | Old median ms | New median ms |
| --- | --- | ---: | ---: |
| 22 (default) | 1 | 20.27 | 18.55 |
| 22 (default) | 2 | 20.77 | 20.95 |
| 22 (default) | 3 | 27.58 | 26.07 |
| 1 | 1 | 18.98 | 18.93 |
| 1 | 2 | 15.61 | 14.86 |
| 1 | 3 | 15.54 | 15.65 |

The earlier slowdown did not reproduce consistently. This supports treating it
as an inconclusive timing observation, not an established regression or speedup.
Single-thread testing is diagnostic only; production settings are unchanged.

In the first captured plan pair, the new plan has 15 projection nodes versus 16.
Both have the same counts of scans (3), hash joins (3), hash groups (2), perfect
hash groups (1), and LEFT_DELIM_JOIN (1). Counts do not prove plan equivalence.
The correlated exact-decimal division remains in both plans; its delim join is
not newly introduced by the simplification. Operator timings vary across runs,
and parallel CPU totals are not wall-clock duration. Decimal arithmetic and
correlated division are possible future optimization targets, not demonstrated
causes of this initial timing difference. No precision relaxation is proposed.
