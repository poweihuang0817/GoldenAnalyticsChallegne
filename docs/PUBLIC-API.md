# Public relational API

The application builds immutable, lazy tables and expressions in TypeScript. This is inspired by [Ibis](https://ibis-project.org/reference/expression-tables); it does not depend on Python or Ibis. Operations construct generated Substrait relations. The compiler validates the supported profile and lowers it through Kysely; the selected backend executes on remote PostgreSQL/MySQL or a separately seeded local DuckDB database.

This is the API reference and usage guide for the implementation at `d8a5fb0`. All examples use the supplied Northwind catalog. The [AI README draft](../README.AI-DRAFT.md) explains the project; this page documents how to call the API. Imports below assume an example file in `docs/`, run from the repository root with `node --import tsx docs/<example>.ts`.

## Start here: one complete query

```ts
import { createSource, count, literal } from '../src/api.js';
import { challengeCatalog } from '../src/challenge.js';
import { compilePlan } from '../src/compiler.js';
import { connect } from '../src/backend.js';

const source = createSource(challengeCatalog);
const query = source.table('customers')
  .filter(t => t.col('city').lower().eq(literal('london').lower()))
  .aggregate(() => ({ customer_count: count() }));

const plan = query.toSubstrait();
const db = connect('postgres'); // 'mysql', or 'duckdb' after seeding
try {
  const compiled = compilePlan(db, plan, challengeCatalog);
  const { rows } = await db.executeQuery(compiled);
  console.log(rows); // Supplied Northwind data: [{ customer_count: '6' }]
} finally {
  await db.destroy();
}
```

See [queries.ts](../src/queries.ts) for all six challenge families, including nested aggregation and exact decimal percentile. The driver now uses these queries. Existing handwritten plans remain as lower-layer test fixtures; they are not the recommended application interface.

## Objects and evaluation

| Object | Responsibility |
| --- | --- |
| Source, returned by `createSource(catalog)` | Snapshots the logical schema and creates table descriptions; does not connect to a database |
| `Table` | A relation and its output schema; transformations return new tables |
| `Columns` | Callback-scoped access to the current input fields using `col(name)` |
| `Expr` | A typed scalar expression, such as a column, literal, comparison or arithmetic operation |
| `Measure` | An aggregate description, accepted by `aggregate`, not by `select` |

Callbacks execute immediately to build descriptions. They do not run once per fetched row. Data operations are lazy until `db.executeQuery(...)`. A base table can be reused to build independent query branches.

## Source and catalog

`createSource(catalog: Catalog)` returns an object with `table(name: string): Table`. The catalog maps table names to ordered fields `{ name, type, nullable }`. Supported kinds are `i32`, `i64`, `bool`, `string`, `date`, `fp64` and `decimal` (fixed precision 38, scale 10). The type is exported from `src/compiler.ts`.

The Northwind catalog is exported as `challengeCatalog` from `src/challenge.ts`. Unknown tables/columns fail; schema discovery is not performed. Reuse one source object for tables that will be joined: two separately created sources have different identities even when their catalogs contain identical fields. The compiler also receives the trusted catalog, which must match the plan's logical field definitions.

## Table methods

`Record<string, Expr>` means an object mapping output column names to expressions. `Record<string, Measure>` maps aggregate output names to aggregate descriptions. Names must be nonempty and unique; group keys and measure names cannot collide.

| Method | Returns | Arguments and behavior |
| --- | --- | --- |
| `select(build)` | `Table` | `build: (t: Columns) => Record<string, Expr>`; at least one output. Object keys name the resulting columns; columns not selected are omitted. |
| `filter(build)` | `Table` | `build: (t: Columns) => Expr`; expression must be boolean. Keeps only rows where the predicate is true; NULL does not pass. |
| `groupBy(...keys)` | Grouping builder | Existing, unique column names. Follow with `.aggregate(build)`; keys appear automatically in the aggregate output. An empty key list is global aggregation. |
| `aggregate(build, keys = [])` | `Table` | `build: (t: Columns) => Record<string, Measure>`; at least one measure. Without keys, produces a global aggregate. `groupBy(...).aggregate(...)` is the usual grouped form. |
| `join(right, options)` | `Table` | Another table from the same source plus the join options below. |
| `orderBy(...sorts)` | `Table` | At least one `{ column, direction?, nulls? }`; defaults: `direction: 'asc'`, `nulls: 'last'`. Fields must exist. |
| `limit(count, offset = 0)` | `Table` | Both values must be nonnegative safe integers. Zero is valid. Add a total ordering for deterministic pagination. |
| `withRowNumber(name, options)` | `Table` | Appends a required i64 rank column; details below. |
| `toSubstrait()` | `SupportedPlanJson` | Exports a fresh normalized, profile-validated plan with root names and function declarations. Compiler semantic validation is still required. |

### Join options

- `how: 'inner' | 'left'` is required.
- `on: (left: Columns, right: Columns) => Expr` must return a boolean expression.
- `select: (left: Columns, right: Columns) => Record<string, Expr>` names the outputs explicitly, avoiding ambiguous duplicate field names.
- With a left join, right-side output fields become nullable. The `on` and `select` callbacks have separate scopes; reconstruct expressions in each callback rather than capturing predicate columns for output.

### Window options

`withRowNumber(name, { partitionBy: string[], orderBy: Sort[] })` appends the given column name, which must not already exist. Partition keys must exist and be unique; `[]` gives one global partition. Ordering must be nonempty. Ranks start at 1 and return as strings. Include a unique tie-breaker when equal sort values are possible. This supports row_number only, with no frame options.

## Expressions and aggregation

`Columns.col(name: string): Expr` resolves a field in the current callback. Unless otherwise stated, the methods below return `Expr`.

| Method | Arguments / contract |
| --- | --- |
| `eq(value)` | `Expr` or string/number/boolean shorthand; resulting operand kinds must match. SQL NULL comparison semantics apply; use `isNull()` for NULL checks. |
| `lte(value)` | Numeric `Expr` or number; matching kinds or mixed i32/i64 widths. Useful for filtering row numbers. For an i64 receiver, number shorthand constructs an i32 literal. |
| `lower()` | String input; returns a lowercase string expression. |
| `isNull()`, `isNotNull()` | Any supported kind; return a non-null boolean expression. |
| `and(other)` | Another boolean `Expr`; follows SQL three-valued logic. |
| `coalesce(value)` | Same-kind expression or supported shorthand; also accepts i32 as fallback for decimal. Returns the first non-null operand. |
| `mul(value)`, `sub(value)`, `div(value)` | Numeric `Expr` or number. Decimal mixed with fp64 is rejected. Non-decimal result kind is fp64; decimal input produces decimal. Zero divisor yields NULL. |
| `sum()`, `avg()` | Numeric input; return `Measure`, ignoring NULL values. Result is decimal for decimal inputs, otherwise fp64. Empty/all-null inputs yield NULL. DuckDB rejects exact decimal AVG. |
| `count()` | Returns i64 `Measure` counting non-null input values; zero for empty input. |
| `percentile(fraction)` | Numeric input; returns continuous percentile `Measure`. Finite fraction in [0,1]; decimal inputs allow at most ten fractional places. It must be the only measure in its aggregate. NULL inputs are ignored; no non-null values yields NULL. |

| Helper export | Returns / contract |
| --- | --- |
| `literal(value)` | `Expr`; string, finite number or boolean. Numbers become fp64. No null/date/decimal literal overload exists. |
| `integer(value)` | Required i32 `Expr`; integer from -2147483648 through 2147483647. |
| `count()` | Row-count `Measure`, implemented as counting a non-null constant. Distinct from `column.count()`. |
| `caseWhen(condition, yes, no)` | `Expr`; boolean condition and same-kind Expr branches. A false or NULL condition selects `no`. |

For number shorthand on i32/decimal receivers, the API creates an i32 literal; other receivers generally use fp64, with the `lte` exception above. For example, `integer(1)` can participate in exact price arithmetic; `literal(1)` is fp64 and cannot be mixed with decimal columns.

## Northwind recipes

The following construction snippets share `source` from the complete example above. They create independent queries; pass each through the same compile/execute sequence.

### Recent orders: projection, sorting and pagination

```ts
const recent = source.table('orders')
  .select(t => ({ order_id: t.col('order_id'), order_date: t.col('order_date') }))
  .orderBy(
    { column: 'order_date', direction: 'desc', nulls: 'last' },
    { column: 'order_id', direction: 'desc' },
  )
  .limit(5);
```

### Average units: nested aggregation and left join

```ts
const units = source.table('order_details')
  .groupBy('order_id')
  .aggregate(t => ({ units: t.col('quantity').sum() }));
const averageUnits = source.table('orders').join(units, {
  how: 'left',
  on: (o, u) => o.col('order_id').eq(u.col('order_id')),
  select: (_o, u) => ({ units: u.col('units').coalesce(0) }),
}).aggregate(t => ({ average_units: t.col('units').avg() }));
```

`units` is a reusable intermediate relation. The left join includes every order, and an order without details contributes zero. The outer average operates on per-order totals, not individual detail quantities.

### Recent three orders per customer: rank, then filter

```ts
const ranked = source.table('orders')
  .select(t => ({
    customer_id: t.col('customer_id'),
    order_id: t.col('order_id'),
    order_date: t.col('order_date'),
  }))
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

The filter is applied outside the SQL query that computes ranks. See [queries.ts](../src/queries.ts) for shipped/unshipped CASE expressions, exact freight arithmetic and country percentiles.

## Scope ownership and common mistakes

Callbacks resolve columns against the current relation. A captured expression from an earlier relation is rejected rather than silently reinterpreted after projection or aggregation. Build a fresh expression with the callback's columns. A source is a logical catalog identity, not a database connection; the same query can run on any of the three backends within their documented supported semantics. Cross-source joins fail explicitly; there is no federation.

After aggregation, refer to the new aggregate column with `t.col('units')`; the original `quantity` field is no longer available. Do not write JavaScript `===`, `&&` or `/` between expressions: use `eq`, `and` or `div`. Use `aggregate` for `Measure` values, then use `select` or `filter` on the resulting Table.

## Compile, execute and serialize

| Entry point | Behavior |
| --- | --- |
| `connect(backend, options?)` from `backend.ts` | Backend is `'postgres'`, `'mysql'` or `'duckdb'`. Returns `Kysely<Database>`. Optional `{ duckdbPath?: string }` configures DuckDB; otherwise `DUCKDB_PATH` or `northwind.duckdb`. PG/MySQL use `POSTGRES_URL` / `MYSQL_URL` or local sample defaults. |
| `compilePlan(db, input, catalog)` from `compiler.ts` | Synchronous validation/lowering; returns Kysely's compiled query, including `sql` and `parameters`. Does not execute SQL or inspect live database metadata. Compile separately for each backend. |
| `await db.executeQuery(compiled)` | Executes through the selected driver and returns a result containing `rows`. Database failures surface here. |
| `await db.destroy()` | Releases backend resources; call in `finally`. |
| `encodePlan(input)` from `plan.ts` | Profile-validates a JSON plan and returns protobuf `Uint8Array`. |
| `decodePlan(bytes)` from `plan.ts` | Checks the wire/profile boundary and returns normalized `SupportedPlanJson`; input has a 1 MB limit. |

Values are bound parameters. Use trusted catalogs/connection selection; parameterization does not implement authorization. Exported `Table`, `Expr`, `Measure`, `Columns` constructors and `Expr.resolve` expose implementation plumbing; use the documented builders rather than constructing internal relations manually.

## Failure boundaries

| Stage | Example failures |
| --- | --- |
| API construction | Unknown column, incompatible scalar types, nonboolean filter, wrong relation scope, invalid limit, percentile combined with another measure |
| Export / decode | Unsupported profile fields, invalid types/shapes, plan size/depth limits |
| Compilation | Catalog mismatch, unsupported function signature, dropped sort field, backend limitation such as DuckDB decimal AVG |
| Execution | Connection failure, missing physical table/column, database numeric overflow |

There is no stable normalized error-code API yet. Errors may be ordinary Error instances, validation errors or vendor exceptions; do not depend on exact message text as a public contract.

## Types and limits

This MVP has runtime column-name/type validation, not schema-inferred TypeScript row types. Catalog kinds reuse the existing supported profile. Methods reject incompatible expressions before lowering where possible; compiler checks remain authoritative. Internal constructors and `resolve` are implementation plumbing, not a raw SQL API or security boundary.

Numeric `literal` defaults to fp64. `integer` explicitly constructs i32. Numeric shorthand in an i32 or decimal expression accepts i32 integers only; use existing decimal columns for exact monetary arithmetic. Decimal/fp64 mixing fails. Non-decimal sums/averages/arithmetic use fp64 under the existing profile. Counts and decimal results are strings, dates are calendar strings, and division by zero returns null.

Percentile is continuous, uses all non-null values, and is the sole measure in its aggregate. Decimal inputs use the existing decimal(38,10) rewrite with its documented precision limits, not a floating-point native substitution.

There is no general cast, decimal literal, timestamp, union, distinct, general window API beyond row_number, mutation API, raw SQL escape hatch, or full Ibis/Substrait implementation. Sorting is field-based; projecting away a sort field is rejected by the compiler. General function resolution, capability selection, normalized errors, and structured logging are deferred. See [DuckDB limits](DUCKDB.md) for bounded exact division and decimal AVG rejection.

Result values follow the implemented type contract: i32/fp64 are numbers; i64 counts/ranks and decimals are strings; dates are calendar strings; nullable outputs may be null. PostgreSQL/MySQL boolean-shaped values are not given a new uniform driver-normalization layer in this API. Result rows use runtime column names with unknown TypeScript values, not inferred schema-specific row types.

## Verification

`npm test` includes API boundary tests: scope ownership, branch immutability, schema snapshotting, typing/nullability, invalid names/limits, self-join compilation, nested aggregates, binary round trips, and parameter binding on both dialects without database connections.

`npm run test:integration` runs the public queries through both databases against the existing independent raw-data/BigInt oracle and compares backend results directly. Recent orders have an independent SQL reference. Deterministic equivalence cases cover true filters, identity projection, composed filters, and nested limits on a total ordering; additional cases cover empty aggregates and unmatched joins. These are finite property examples, not randomized property-based testing or full conformance.

Next verification priorities: more isolated expression cases and schema-derived typing; small generated cases with shrinking; selected supported Substrait consumer cases. These precede capability/error/logging expansion. Mutation testing, formal solvers, additional engines, and large benchmark corpora remain future work.

`npm run test:duckdb` compares all three backends using a snapshot of the supplied Northwind data, including the window extension. `npm test` also runs embedded DuckDB adapter/precision fixtures and HTTP boundary tests without remote database connections.

## Temporary compiler dispatch dependency — review follow-up

Function-free public API plans currently emit the allowlisted function declarations and select the scoped analytics compiler. This is a known metadata/dispatch coupling, not evidence that the query uses those functions. A focused test verifies it with Read -> Project -> Sort -> Fetch on both dialects.

The same test shows that removing unused declarations alone breaks a valid function-free nested-limit query: the original visitor rejects nested fetch. Following the review's option 2, this PR deliberately preserves behavior and defers declaration minimization/dispatch cleanup to [issue #7](https://github.com/poweihuang0817/GoldenAnalytics/issues/7). That work must compare both visitors before changing dispatch; the temporary characterization test should then be replaced by metadata-independent composition tests. No compiler refactor is included here.

## Window extension

The separately demonstrated extension adds `withRowNumber(name, { partitionBy, orderBy })` and numeric `lte`. See [window extension](WINDOW-EXTENSION.md) for semantics, supported bounds and tests. This is a narrow ranking API, not a general window/cast/mutation API.
