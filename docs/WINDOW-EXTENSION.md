# Extension: recent N orders per customer

This is the separately demonstrated advanced feature requested by the challenge, beyond its six sample query families. Both databases execute native `ROW_NUMBER()`; no local query execution or approximation is introduced.

```ts
const query = source.table('orders')
  .withRowNumber('position', {
    partitionBy: ['customer_id'],
    orderBy: [
      { column: 'order_date', direction: 'desc', nulls: 'last' },
      { column: 'order_id', direction: 'desc' },
    ],
  })
  .filter(t => t.col('position').lte(3))
  .orderBy({ column: 'customer_id' }, { column: 'position' });
```

The driver runs `recentOrdersPerCustomer(3)` from `src/queries.ts`. `npm run demo` demonstrates this after the six existing query families.

## Semantics and boundary

- The API emits the existing official Substrait v0.63.0 `ConsistentPartitionWindowRel` (`Rel.window`), appending one required i64 column. No vendored schema or generated codec changes are necessary.
- Partition/sort inputs are column references. Empty partition keys mean one global partition. At least one explicit sort is required. Caller-provided tie breakers must make ordering total when deterministic membership is needed; the example uses unique order IDs.
- Dates sort descending with nulls last; equal dates break by descending order ID. NULL customer IDs, if present, form one partition. Fewer than N rows returns all available rows; N=0 returns none.
- Window ordering determines rank, not final result ordering. Use `orderBy` for presentation. Rank outputs are strings, following the existing i64 result contract.
- Lowering places the window in a derived table, then filters its rank in an outer query. Filtering before/after ranking is not interchangeable. Numeric `lte` accepts matching numeric types or i32/i64 comparisons without converting ranks to floating point. Rank's numeric shorthand accepts i32 limits.
- Profile accepts exactly one zero-argument `row_number` per window relation with required i64 output, INITIAL_TO_RESULT and ALL. Arbitrary window functions, frames/bounds/options, multiple functions per relation, and non-column partition/sort expressions fail explicitly.
- Trust boundary: callers use `compilePlan`, which runs the strict profile before internal `compileAnalytics` lowering. The window lowerer resolves the function name; it relies on the profile for signature restrictions. A TypeScript `SupportedPlanJson` annotation alone does not establish runtime validity. Direct lowering is not a public untrusted-input entry point.
- Function names are declared in the existing Golden extension library. This is not a promise that every external Substrait consumer recognizes that library. Metadata-based compiler dispatch remains the documented issue #7 debt; this PR does not consolidate compilers.
- Backend text collation behavior remains outside this narrow extension's portability guarantees; Northwind customer IDs and fixture keys use consistent ASCII identifiers.

## Verification

- Offline tests: official-schema binary round trip, appended output/nullability, duplicate/missing names, invalid partitions/sorts/N, unsupported window signatures/frames, bound threshold, both SQL dialects.
- Northwind: independent JavaScript grouping/sorting oracle for N=0,1,3,1000 on both databases, plus direct cross-backend comparison.
- Connection-local temporary fixtures: equal dates, null dates/partition keys, singleton/small partitions, nulls-first ascending order, global ranking and empty input. Fixtures are dropped without modifying Northwind rows.

References: [PostgreSQL window functions](https://www.postgresql.org/docs/17/functions-window.html), [MySQL window usage](https://dev.mysql.com/doc/refman/8.4/en/window-functions-usage.html). Exact Substrait fields come from the pinned `vendor/substrait/proto/substrait/algebra.proto`.
