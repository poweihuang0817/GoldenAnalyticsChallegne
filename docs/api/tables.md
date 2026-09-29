# Source and table reference

[API guide](README.md)

## Objects and evaluation

| Object | Responsibility |
| --- | --- |
| Source from `createSource(catalog)` | Snapshots the schema and creates table descriptions; does not connect |
| `Table` | A relation with an inferred output schema; transformations return new tables |
| `table.columns`, `table.col(name)` | Typed expressions for fields in that relation |
| `Expr` | Scalar expression with a kind and nullability |
| `Measure` | Aggregate accepted by `aggregate`, not `select` |

Construct predicates and projection objects directly. Callback overloads are not supported. No data is fetched until `client.execute(query)` or the lower-level execution call. A base relation can be reused for independent query branches.

## Source and catalog

The catalog maps table names to ordered `{ name, type, nullable }` fields. Kinds are `i32`, `i64`, `bool`, `string`, `date`, `fp64` and `decimal` (38,10). Preserve literal types with `as const satisfies Catalog` for an authored catalog; the Northwind `challengeCatalog` already preserves them. Avoid annotating it broadly as `Catalog` if you want schema-specific inference.

A dynamically loaded `Catalog` remains supported but cannot supply compile-time knowledge of its field names and kinds. Runtime validation remains mandatory. No schema discovery occurs. Reuse one source for joined tables: separate `createSource` calls have separate identities, even with identical schemas. The compiler's trusted catalog must match the plan.

## Table methods

| Method | Returns | Contract |
| --- | --- | --- |
| `col(name)` / `columns.name` | `Expr` | Existing field, inferred kind and nullability |
| `select(projection)` | `Table` | Nonempty object of output names to Expr values; omitted fields disappear |
| `filter(predicate)` | `Table` | Boolean Expr; only true rows pass, not false or NULL |
| `groupBy(...keys)` | Grouping builder | Unique existing field names; follow with `.aggregate(measures)` |
| `aggregate(measures)` | `Table` | Nonempty object of output names to Measure values; global aggregation. Use groupBy for grouped aggregation, whose keys also appear in output |
| `join(right, { how })` | Join builder | Same-source table, `how: 'inner'` or `'left'`; then `.on(predicate).select(projection)` |
| `orderBy(...sorts)` | `Table` | Nonempty `{ column, direction?, nulls? }` list; defaults ascending, NULLs last |
| `limit(count, offset = 0)` | `Table` | Nonnegative safe integers; use total ordering for deterministic pagination |
| `withRowNumber(name, options)` | `Table` | Appends a required i64 rank column |
| `toSubstrait()` | `SupportedPlanJson` | Fresh normalized profile-validated plan; compiler semantic checks still apply |

Field names in grouping/sorting/window options are checked against the current schema. Projection aliases become the new field names. Group keys and measure aliases cannot collide. Structural names must be unambiguous: narrow union table/group/window names first, use fixed tuples for grouping, and use known projection/aggregate aliases. Arbitrary string output aliases are rejected because they cannot guarantee named result fields. Exact generic signatures live in [src/api.ts](../../src/api.ts).

## Joins and nullability

```ts
const customers = source.table('customers');
const orders = source.table('orders');
const join = customers.join(orders, { how: 'left' });
const matched = join.on(join.left.customer_id.eq(join.right.customer_id));
const query = matched.select({
  customerId: matched.left.customer_id,
  orderId: matched.right.order_id,
});
```

`join.left/right` are input maps for the predicate. `matched.left/right` are fresh output maps: right fields are nullable for a left join. Build the output from those maps, not captured predicate expressions. Output names are explicit, avoiding duplicate names. Separate side identities also make self-joins unambiguous. After `select`, access `query.columns` for further transformations.

## Window options

`withRowNumber(name, { partitionBy: [...keys], orderBy: [...sorts] })` appends a new, noncolliding name. Partition keys must exist and be unique; `[]` gives one partition. Ordering must be nonempty; include a tie-breaker. Ranks start at 1 and return as strings. Only row_number is supported, without general frame options. Window ordering does not order the returned rows: call `orderBy` afterward.

## Scope ownership and common mistakes

Every transformation returns a fresh Table scope, even `filter` with an unchanged schema. Use that new table's columns in its next operation. Runtime identity validation catches stale references; TypeScript's structural schema types do not prove per-instance identity.

```ts
const orders = source.table('orders');
const shipped = orders.filter(orders.columns.shipped_date.isNotNull());
const ids = shipped.select({ id: shipped.columns.order_id });
```

After aggregation, only group keys and measures exist; refer to `totals.columns.units`, not the removed quantity field. Use expression methods rather than JavaScript `===`, `&&` or `/`. A `Measure` belongs in `aggregate`; apply scalar operations to its output Table afterward. Cross-source joins fail explicitly: this API does not implement federation.
