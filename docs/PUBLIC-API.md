# Public relational API

The application builds immutable, lazy tables and expressions in TypeScript. The Table/Expression model references [Ibis](https://ibis-project.org/reference/expression-tables); it does not depend on Python or Ibis. Operations construct generated Substrait relations. The compiler validates the supported profile and produces SQL; the client executes it through the selected backend.

```ts
import { createSource, count, literal } from '../src/api.js';
import { createClient } from '../src/client.js';
import { challengeCatalog } from '../src/challenge.js';

const source = createSource(challengeCatalog);
const query = source.table('customers')
  .filter(t => t.col('city').lower().eq(literal('london').lower()))
  .aggregate(() => ({ customer_count: count() }));

const client = createClient('postgres', challengeCatalog);
try {
  const result = await client.execute(query);
  console.table(result.rows);
} finally { await client.destroy(); }
```

See [queries.ts](../src/queries.ts) for all six challenge families, including nested aggregation and exact decimal percentile. The driver now uses these queries. Existing handwritten plans remain as lower-layer test fixtures; they are not the recommended application interface.

Import `createClient` from `src/client.ts`. See [execution and callback guide](QUERY-CLIENT.md) for SQL previews, lifecycle, and readable callback examples.

## Supported surface

- `createSource(catalog).table(name)` snapshots the logical catalog; unknown tables fail.
- `select(callback)` names and projects expressions; `filter(callback)` requires a boolean expression.
- `groupBy(...names).aggregate(callback)` and global `aggregate(callback)` produce new tables, so aggregates can be nested or filtered afterward.
- `join(right, { how, on, select })` supports inner/left joins and requires explicit output names. Callback arguments distinguish left/right occurrences, including self-joins. Right output fields become nullable for a left join.
- `orderBy(...{ column, direction, nulls })` defaults to ascending/nulls last. `limit(count, offset)` requires nonnegative safe integers. Supply a deterministic order when pagination matters.
- Expressions: `eq`, `lower`, `isNull`, `isNotNull`, `and`, `coalesce`, `mul`, `sub`, `div`, `sum`, `avg`, `count`, `percentile`; helpers `literal`, `integer`, `caseWhen`, `count`.
- `count()` counts rows; `column.count()` counts non-null values.
- `toSubstrait()` returns a fresh validated JSON plan accepted by existing binary codecs and compilers. Structural validation does not replace compiler semantic validation.

Callbacks resolve columns against the current relation. A captured expression from an earlier relation is rejected rather than silently reinterpreted after projection or aggregation. Build a fresh expression with the callback's columns. A source is a logical catalog identity, not a database connection; the same query can run on either backend with that catalog. Cross-source joins fail explicitly; there is no federation.

## Types and limits

This MVP has runtime column-name/type validation, not schema-inferred TypeScript row types. Catalog kinds reuse the existing supported profile. Methods reject incompatible expressions before lowering where possible; compiler checks remain authoritative. Internal constructors and `resolve` are implementation plumbing, not a raw SQL API or security boundary.

Numeric `literal` defaults to fp64. `integer` explicitly constructs i32. Numeric shorthand in an i32 or decimal expression accepts i32 integers only; use existing decimal columns for exact monetary arithmetic. Decimal/fp64 mixing fails. Non-decimal sums/averages/arithmetic use fp64 under the existing profile. Counts and decimal results are strings, dates are calendar strings, and division by zero returns null.

Percentile is continuous, uses all non-null values, and is the sole measure in its aggregate. Decimal inputs use the existing decimal(38,10) rewrite with its documented precision limits, not a floating-point native substitution.

There is no general cast, decimal literal, timestamp, union, distinct, window API, mutation API, raw SQL escape hatch, or full Ibis/Substrait implementation. Sorting is field-based; projecting away a sort field is rejected by the compiler. General function resolution, capability selection, normalized errors, and structured logging are deferred to a separate PR.

## Verification

`npm test` includes API boundary tests: scope ownership, branch immutability, schema snapshotting, typing/nullability, invalid names/limits, self-join compilation, nested aggregates, binary round trips, and parameter binding on both dialects without database connections.

`npm run test:integration` runs the public queries through both databases against the existing independent raw-data/BigInt oracle and compares backend results directly. Recent orders have an independent SQL reference. Deterministic equivalence cases cover true filters, identity projection, composed filters, and nested limits on a total ordering; additional cases cover empty aggregates and unmatched joins. These are finite property examples, not randomized property-based testing or full conformance.

Next verification priorities: more isolated expression cases and schema-derived typing; small generated cases with shrinking; selected supported Substrait consumer cases. These precede capability/error/logging expansion. Mutation testing, formal solvers, additional engines, and large benchmark corpora remain future work.

## Temporary compiler dispatch dependency — review follow-up

Function-free public API plans currently emit the allowlisted function declarations and select the scoped analytics compiler. This is a known metadata/dispatch coupling, not evidence that the query uses those functions. A focused test verifies it with Read -> Project -> Sort -> Fetch on both dialects.

The same test shows that removing unused declarations alone breaks a valid function-free nested-limit query: the original visitor rejects nested fetch. Following the review's option 2, this PR deliberately preserves behavior and defers declaration minimization/dispatch cleanup to [issue #7](https://github.com/poweihuang0817/GoldenAnalytics/issues/7). That work must compare both visitors before changing dispatch; the temporary characterization test should then be replaced by metadata-independent composition tests. No compiler refactor is included here.

## Window extension

The separately demonstrated extension adds `withRowNumber(name, { partitionBy, orderBy })` and numeric `lte`. See [window extension](WINDOW-EXTENSION.md) for semantics, supported bounds and tests. This is a narrow ranking API, not a general window/cast/mutation API.
