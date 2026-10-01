# Your first Northwind query

[API guide](README.md)

This complete example assumes a TypeScript file in `docs/api/`. Run it with `node --import tsx docs/api/<filename>.ts` after [setup](../RUNNING.md). The checked companion is [examples.ts](examples.ts), compiling offline by default.

```ts
import { createSource, count, literal } from '../../src/api.js';
import { challengeCatalog } from '../../src/challenge.js';
import { createClient } from '../../src/client.js';

const source = createSource(challengeCatalog);
const customers = source.table('customers');
const predicate = customers.columns.city.lower().eq(literal('london').lower());
const london = customers.filter(predicate);
const query = london.aggregate({ customer_count: count() });

const client = createClient('postgres', challengeCatalog);
try {
  const { rows } = await client.execute(query);
  console.log(rows); // Northwind: [{ customer_count: '6' }]
} finally {
  await client.destroy();
}
```

## What each step means

1. `createSource` snapshots the logical schema without opening a database connection.
2. `customers.columns.city` describes a column, not one customer's value. `filter` takes a boolean expression; `aggregate` takes a named measure object. No callback is needed.
3. These methods construct a query; they do not fetch data.
4. `createClient` selects the backend and owns its connection resources. Use `'mysql'`, or `'duckdb'` after seeding, with the same query.
5. `client.execute(query)` exports, validates and compiles the plan, then executes it. `rows` is inferred as objects with `customer_count: string`, preserving i64 precision.
6. Optional `await client.compile(query)` previews SQL and parameters without executing a database query. A preview is not required before execution.
7. `client.destroy()` releases resources, including when execution fails.

## Named expressions and projections

`customers.col('city')` is the typed lookup equivalent of `customers.columns.city`. Name predicates and projections for readability:

```ts
const inUK = customers.columns.country.eq('UK');
const ukCustomers = customers.filter(inUK);
const projection = {
  id: ukCustomers.columns.customer_id,
  city: ukCustomers.columns.city,
};
const selected = ukCustomers.select(projection);
```

Every new relation has its own column scope; use `ukCustomers.columns` after filtering. Runtime checks reject stale references even when two relations have the same TypeScript schema. With a literal catalog, nonexistent fields and incompatible expression kinds are also compile-time errors. A dynamically widened Catalog loses that static precision.

The former callback signatures are removed. Migrate `filter(t => ...)` to `filter(predicate)`, and `select`/`aggregate` callbacks to named objects. Joins have a [staged interface](tables.md#joins-and-nullability) that distinguishes predicate fields from nullable output fields.

Continue with [Northwind recipes](northwind.md), [design tradeoffs](design.md) and [the complete query functions](../../src/queries.ts). SQL changes by backend; logical intent remains the same within supported semantic limits.
