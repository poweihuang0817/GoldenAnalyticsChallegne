# Generated SQL audit

## Implemented audit follow-up (September 30, 2026)

The user approved addressing the findings below. The compiler now absorbs compatible
terminal pagination, inlines simple scan/projection join inputs, merges safe
CASE/COALESCE projections into aggregates, prunes unused intermediate columns,
removes casts only with explicit physical-type provenance, and omits null-order
CASE expressions only for fields still known non-null at that stage. Percentile
rank position is computed in its existing ranking block and its fraction is bound
once. SQL semantics and public result representations are unchanged.

The 24 linked SQL files now show the updated compiler. The original findings below
remain historical context; their old counts are not the current generated SQL.

| Family | Previous SELECTs PG/MySQL/DuckDB | Current SELECTs PG/MySQL/DuckDB |
| --- | --- | --- |
| Recent orders | 3/3/3 | 1/1/1 |
| London / Mexico count (each) | 1/1/1 | 1/1/1 |
| Average units | 5/5/5 | 2/2/2 |
| Shipping status | 5/5/5 | 1/1/1 |
| Freight ratio | 8/8/11 | 4/4/7 |
| Percentile | 10/10/10 | 5/5/5 |
| Window top-N | 2/2/2 | 2/2/2 |

These count SELECT tokens, including scalar subqueries; they are not plan costs or
latency measurements. No general runtime speedup or arbitrary-plan correctness is
claimed. Current fixtures protect exact SQL, parameters and lowering trace.

### Disposition and retained boundaries

All eight demo families were reviewed. The actionable structural findings above
are implemented; these remaining structures are intentional:

- City output casts preserve i64 strings; MySQL binary comparisons preserve the
  declared accent-sensitive semantics. Schema/index tuning is separate work.
- Nested aggregation, computed grouping keys with parameters, pagination before
  filtering/re-sorting, and filtering a window result retain necessary boundaries.
- DuckDB freight retains three scalar stages for exact scaled-integer division.
  Attempts to reuse aliases in fewer stages exposed correlated-name resolution,
  binder failures and floating-point results. Regression fixtures now cover outer
  columns named n/d/q and large exact decimals; DOUBLE division is not a substitute.
- Window top-N retains two blocks for ranking then filtering. Nullable date/customer
  sort keys retain null ranking; required order_id/rank keys do not.
- Native percentile, DuckDB QUALIFY, global common-expression elimination and a
  general optimizer remain future options, not missing fixes in this change.

### Verification and design reference

Local validation: code/docs type checks, 68 unit tests, 98 integration tests, and
one real three-backend conformance test passed. Tests include independent raw-data
oracles, PostgreSQL native percentile comparison, NULLs, duplicates, empty groups,
decimal boundaries, pagination and alias scopes. New fixtures specifically protect
ON-only grandchild keys, WHERE-only columns, hidden window dependencies, and
parameterized CASE/literal grouping. A failing recent-orders shape regression was
observed before implementation. These local results are not hosted CI results.

The design follows Calcite's principle of combining compatible SQL clauses while
preserving semantic boundaries, rather than blindly flattening every relation:
[SqlImplementor](https://github.com/apache/calcite/blob/main/core/src/main/java/org/apache/calcite/rel/rel2sql/SqlImplementor.java)
and [RelToSqlConverter](https://github.com/apache/calcite/blob/main/core/src/main/java/org/apache/calcite/rel/rel2sql/RelToSqlConverter.java).
No Calcite runtime dependency or general optimizer was introduced. Column demand
uses structured Kysely references; pinned-library changes must retain these tests.

## Original audit (historical)
# Generated SQL audit

Reviewed source: `13db90a9e14f2d97c35f3f89ca349918329d092d` (after #52).
Scope: all seven `queryExamples` entries (six challenge families, two city inputs)
plus `recentOrdersPerCustomer(3)`, each on three backends. This is not every query
in the fixture/property corpus. No compiler or semantic changes in this audit.

## Full runtime-test corpus

The user subsequently requested all test-case SQL, not only demo cases. Run
`node scripts/capture-test-sql.mjs` in a dedicated idle worktree with dependencies
installed and supplied databases running. It temporarily instruments compilePlan,
runs unit/integration/three-backend tests, docs compilation and the default driver,
then restores the compiler byte-for-byte in finally. Do not run other work in that
worktree during capture. Forced termination may bypass finally; restore from the
local compiler.ts.backup before any other work if interrupted.

The observed run compiled 527 queries, producing 254 distinct SQL/ordered-binding/
trace tuples, and recorded 52 rejected compilations. All five commands passed.
Full .sql files, trace/binding comments, caller locations, rejected-call inventory,
logs and INDEX.md are in the ignored `.sql-audit-all/run-*/` directory. Random
fixture identifiers remain unchanged; distinct outputs are not necessarily
distinct logical query shapes. Rejected inputs produce no SQL. Type-only negatives
and hand-written oracle SQL are outside this generated-SQL inventory.

The compact [capture summary](capture-summary.json) is committed; full runtime
outputs stay local to avoid repeating the large-artifact issue from #51. Some
fixtures intentionally contain synthetic secret-like values, so inspect before
sharing raw captures. The 24 fixed demo SQL files below remain easy review copies.
The per-case findings below cover those eight families; this is not a claim that
all 254 captured outputs have individually received semantic/performance review.

`npx tsx scripts/export-demo-sql.ts` compiles each query without opening a database
connection, verifies exact SQL/bindings/trace against committed test snapshots,
then writes formatted review copies here. Parameters remain placeholders; ordered
public sample values and trace are comments. These are not standalone executable
SQL files. Test snapshots remain the authoritative regression assertions. Re-run
the export after an intentional compiler/snapshot update.

## Per-case review

Counts below are SELECT tokens, not nesting depth or a performance score.

| Case | PostgreSQL | MySQL | DuckDB | SELECTs PG/MySQL/Duck |
| --- | --- | --- | --- | --- |
| Recent orders | [SQL](postgres/01-recent-orders.sql) | [SQL](mysql/01-recent-orders.sql) | [SQL](duckdb/01-recent-orders.sql) | 3/3/3 |
| London count | [SQL](postgres/02-london-count.sql) | [SQL](mysql/02-london-count.sql) | [SQL](duckdb/02-london-count.sql) | 1/1/1 |
| Mexico count | [SQL](postgres/03-mexico-count.sql) | [SQL](mysql/03-mexico-count.sql) | [SQL](duckdb/03-mexico-count.sql) | 1/1/1 |
| Average units | [SQL](postgres/04-average-units.sql) | [SQL](mysql/04-average-units.sql) | [SQL](duckdb/04-average-units.sql) | 5/5/5 |
| Shipping status | [SQL](postgres/05-shipping-status.sql) | [SQL](mysql/05-shipping-status.sql) | [SQL](duckdb/05-shipping-status.sql) | 5/5/5 |
| Freight ratio | [SQL](postgres/06-freight-ratio.sql) | [SQL](mysql/06-freight-ratio.sql) | [SQL](duckdb/06-freight-ratio.sql) | 8/8/11 |
| Percentile | [SQL](postgres/07-percentile.sql) | [SQL](mysql/07-percentile.sql) | [SQL](duckdb/07-percentile.sql) | 10/10/10 |
| Window top-N | [SQL](postgres/08-window-top-n.sql) | [SQL](mysql/08-window-top-n.sql) | [SQL](duckdb/08-window-top-n.sql) | 2/2/2 |

### 01: recent orders — highest-priority structural candidate

All dialects still wrap the direct projection for FETCH and again for root output.
The sample can be one SELECT with names, deterministic ORDER BY, LIMIT and OFFSET.
Both inner and outer ORDER BY currently serve a purpose; do not just delete outer
ordering while retaining a subquery. Absorb only a compatible terminal fetch and
keep fetch-before-filter, replacement-sort and nested-pagination boundaries.
Validate ties, nullable dates, zero limit, offsets and parameter order on all
three engines. Generated CASE null-order keys on non-null order_id are redundant
when the validated field remains non-null; outer joins can change that fact.

### 02: London count — keep current one-block shape

COUNT(*) now uses only the city parameter. Count-to-text/char preserves the public
i64 string contract. Parameter-to-text/char is conservative typing, not a blocker.
MySQL's two binary casts preserve the intended comparison rather than inheriting
the default accent-insensitive collation; do not remove them for cosmetic parity.
LOWER(city) may affect index use on larger data. Expression indexes/collations
would be schema/backend work, not a safe compiler-only change here.

### 03: Mexico count — same shape, distinct regression input

Only the bound city differs from London. Keep this separate sample to protect
punctuation and parameter binding. Do not normalize/trim values during SQL cleanup.
The PostgreSQL and DuckDB SQLs match; MySQL retains the same collation safeguards.

### 04: average units — repeated casts and over-wide join inputs

All dialects show nested same-type output casts around AVG. Adjacent identical
casts are a candidate for elimination with explicit SQL-type provenance; logical
`kind` alone is not enough to establish physical expression type/precision.
The orders input also selects unused dates, employee/customer fields and freight.
Projection pruning and join-block absorption could reduce this, but need scope
and outer-join tests. Preserve per-order SUM, the LEFT JOIN to all orders, COALESCE
to zero and the outer AVG. Averaging line quantities changes the population.

### 05: shipping status — CASE/SUM composition

Redundant outer same-type casts and broad orders projection occur on all engines.
SUM(CASE ...) can potentially live directly over a join, but is a separate join/
computed-projection absorption rule. Keep the order_id IS NOT NULL guard: a
left-joined employee without orders must not count as an unshipped order.
Do not switch result types from fp64 to i64 as part of structural simplification.

### 06: freight ratio — preserve grain and exactness

Repeated adjacent DECIMAL(38,10) casts are visible. Remove only provably redundant
adjacent conversions; intermediate arithmetic casts may determine rounding and
overflow and cannot be dropped wholesale. Pre-aggregate detail prices by order
before combining with freight, or freight will be multiplied by line count.
Keep zero-denominator handling and customers without orders. PostgreSQL/MySQL
use division with NULLIF; MySQL string join keys also retain binary comparison.
DuckDB adds three scalar-subquery SELECTs for exact scaled-integer division.
Its correlated subquery is a future measured optimization target, not disposable
syntax. Plain DOUBLE division would violate the decimal contract. Existing paired
measurements did not establish a consistent regression or universal speedup.

### 07: percentile — specialized rewrite, defer broader optimization

The same exact interpolation algorithm appears on all three backends. Five bound
copies of the fraction and repeated rank-position expressions increase length.
Computing position once is a candidate but may add a query block/materialization;
fewer expressions or fewer SELECTs alone do not establish a win. Native percentile
is not automatically interchangeable with the chosen decimal semantics.
The shared pricedOrders helper carries freight even though this query uses only
country and price: another projection-pruning opportunity. Preserve non-null
count, all-null groups, interpolation boundaries, ties, discount calculation and
large-decimal accuracy. Output wrapping around specialized lowering is still
conservative. Do not combine ranking and aggregation indiscriminately.

### 08: window top-N — two blocks are appropriate for the portable form

Inner ROW_NUMBER followed by outer filtering is the required scope separation for
the current PostgreSQL/MySQL form. Keep chronological/order_id tie-break sorting
and final customer/rank ordering. Required order_id and row_number values can
potentially omit CASE null-order keys; nullable customer/date keys cannot. DuckDB
QUALIFY is an optional future dialect-specific alternative, not a necessary fix.
The rank's text cast belongs only at output; sorting must remain numeric.

## Recommended next changes, not approved implementation

1. Bounded terminal-fetch/root absorption (recent orders: 3 SELECTs toward 1).
2. Adjacent identical cast elimination using known SQL expression type metadata.
3. Non-null sort-key CASE elimination, respecting nullability after joins.
4. Later: demanded-column pruning and safe join/project/aggregate absorption.
5. Later: percentile common expressions and measured exact DuckDB division work.

Use failing shape/snapshot tests plus independent result oracles and three-backend
execution for each rule. No new correctness defect was demonstrated by this static
audit; that is not a proof of arbitrary-plan correctness. No latency improvement
is claimed. Do not expand QueryBlock into a second relational planning system.

## CI scope

The Fresh clone workflow runs code/docs type checks, npm test (including exact
SQL/binding/trace snapshots), integration tests, three-backend conformance, driver
smoke and executable documentation. It does not run performance investigation
scripts, formal verification, arbitrary-query fuzzing, or this display exporter.
