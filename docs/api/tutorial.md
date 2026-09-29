# Your first Northwind query

[API guide](README.md)

This complete example assumes a TypeScript file in `docs/api/`. From the repository root, run it with `node --import tsx docs/api/<filename>.ts` after [installing dependencies and starting the databases](../RUNNING.md). The checked companion is [examples.ts](examples.ts), which compiles offline by default.

## Start here: one complete query

```ts
import { createSource, count, literal } from '../../src/api.js';
import { challengeCatalog } from '../../src/challenge.js';
import { compilePlan } from '../../src/compiler.js';
import { connect } from '../../src/backend.js';

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

See [queries.ts](../../src/queries.ts) for all six challenge families, including nested aggregation and exact decimal percentile. The driver now uses these queries. Existing handwritten plans remain as lower-layer test fixtures; they are not the recommended application interface.

## What each step means

1. `createSource` captures the Northwind logical schema, without opening a database connection.
2. `table`, `filter` and `aggregate` create a relation description. The callback's `t` describes columns; it is not one customer row.
3. `toSubstrait` exports the relation in the supported standard representation.
4. `compilePlan` produces dialect-specific SQL and bound parameters using the selected backend. It does not fetch rows.
5. `executeQuery` executes the query. The count is returned as a string to preserve i64 precision.
6. `destroy` releases resources even if execution fails.

The same plan can be compiled separately for another backend. It is the compiled SQL, not the logical plan, that changes with the dialect. The query must still remain within that backend's supported semantic limits.

Continue with [Northwind recipes](northwind.md) for joins/nested aggregates and [the Ibis-style design rationale](design.md#why-take-inspiration-from-ibis) for the reasoning behind these boundaries.
