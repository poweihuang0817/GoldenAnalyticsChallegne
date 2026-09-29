# Source and table reference

[API guide](README.md)

## Objects and evaluation

| Object | Responsibility |
| --- | --- |
| Source, returned by `createSource(catalog)` | Snapshots the logical schema and creates table descriptions; does not connect to a database |
| `Table` | A relation and its output schema; transformations return new tables |
| `Columns` | Callback-scoped access to the current input fields using `col(name)` |
| `Expr` | A typed scalar expression, such as a column, literal, comparison or arithmetic operation |
| `Measure` | An aggregate description, accepted by `aggregate`, not by `select` |

Callbacks execute immediately to build descriptions. They do not run once per fetched row. Data operations are lazy until `client.execute(query)` (or the lower-level `db.executeQuery(...)`). A base table can be reused to build independent query branches.

## Source and catalog

`createSource(catalog: Catalog)` returns an object with `table(name: string): Table`. The catalog maps table names to ordered fields `{ name, type, nullable }`. Supported kinds are `i32`, `i64`, `bool`, `string`, `date`, `fp64` and `decimal` (fixed precision 38, scale 10). The type is exported from `src/compiler.ts`.

The Northwind catalog is exported as `challengeCatalog` from `src/challenge.ts`. Unknown tables/columns fail; schema discovery is not performed. Reuse one source object for tables that will be joined: two separately created sources have different identities even when their catalogs contain identical fields. The compiler also receives the trusted catalog, which must match the plan's logical field definitions.

## Table methods

`Record<string, Expr>` means an object mapping output column names to expressions. `Record<string, Measure>` maps aggregate output names to aggregate descriptions. Names must be nonempty and unique; group keys and measure names cannot collide.

The callback parameter and return types appear below; their exact TypeScript signatures are defined in [src/api.ts](../../src/api.ts). Ordering uses:

```ts
type Sort = {
  column: string;
  direction?: 'asc' | 'desc';
  nulls?: 'first' | 'last';
};
```

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

## Scope ownership and common mistakes

Callbacks resolve columns against the current relation. A captured expression from an earlier relation is rejected rather than silently reinterpreted after projection or aggregation. Build a fresh expression with the callback's columns. A source is a logical catalog identity, not a database connection; the same query can run on any of the three backends within their documented supported semantics. Cross-source joins fail explicitly; there is no federation.

After aggregation, refer to the new aggregate column with `t.col('units')`; the original `quantity` field is no longer available. Do not write JavaScript `===`, `&&` or `/` between expressions: use `eq`, `and` or `div`. Use `aggregate` for `Measure` values, then use `select` or `filter` on the resulting Table.
