# Northwind query recipes

[API guide](README.md)

## Northwind recipes

All examples use the supplied Northwind catalog. The snippets below share this setup (for a file inside `docs/api/`):

```ts
import { createSource } from '../../src/api.js';
import { challengeCatalog } from '../../src/challenge.js';
const source = createSource(challengeCatalog);
```

They create independent queries; pass each through the [compile/execute sequence](tutorial.md). The [runnable companion](examples.ts) compiles all six challenge families plus ranking for each backend. Use `npm run docs:examples -- --execute` after database setup and DuckDB seeding for results.

| Analysis | Source function | Relational reasoning |
| --- | --- | --- |
| Recent N orders | `recentOrdersQuery(n = 5)` | Project fields, sort deterministically, limit |
| Customers in a city | `cityQuery(city)` | Explicit lowercase comparison followed by row count |
| Average units per order | `averageUnitsQuery()` | Sum details per order, left join orders, coalesce missing totals, then average |
| Shipped/unshipped per employee | `shippingQuery()` | Left join orders and count CASE expressions; do not count an unmatched row as an unshipped order |
| Freight/price per customer | `freightQuery()` | Sum discounted line prices per order before joining freight, avoiding freight multiplication by detail rows |
| Country percentile | `percentileQuery(fraction = 0.75)` | Compute order prices before grouping by customer country; continuous percentile |
| Recent N per customer | `recentOrdersPerCustomer(n = 3)` | Rank within customer partitions, then filter; n must be a nonnegative i32 |

Functions are defined in [src/queries.ts](../../src/queries.ts); their returned values are ordinary Tables which can be compiled through the same entry point.

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

For actual Northwind orders 10248, 10249 and 10250, the total quantities are 27, 49 and 60. For that subset, average units per order is 136/3; averaging the eight detail quantities gives 136/8, a different measure. The code above runs over all orders, not just this illustrative subset.

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

The filter is applied outside the SQL query that computes ranks. See [queries.ts](../../src/queries.ts) for shipped/unshipped CASE expressions, exact freight arithmetic and country percentiles.

## Numerical rules used by the other recipes

Line price is `unit_price * quantity * (1 - discount)`. Use `integer(1)` with decimal fields; `literal(1)` is fp64 and cannot be mixed with decimal. Freight is aggregated once per order and excluded from the order-price denominator. A zero denominator produces NULL.

Shipped/unshipped expressions check `order_id.isNotNull()` as well as the shipped date, so an employee with no matched order contributes zero to both counts. The full function remains in source to keep this nontrivial example maintained beside its tests.

Country percentile includes the computed order prices; the helper treats missing detail totals as zero. A customer without an order contributes no order to the percentile. NULL inputs to the percentile itself are ignored. See [semantic rules](semantics.md) and the existing challenge tests for independent expected results.
