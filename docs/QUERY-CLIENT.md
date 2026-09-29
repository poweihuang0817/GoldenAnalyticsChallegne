# Execute queries and inspect SQL

```ts
import { createClient } from '../src/client.js';
import { cityQuery } from '../src/queries.js';
import { challengeCatalog } from '../src/challenge.js';

const client = createClient('postgres', challengeCatalog);
try {
  const query = cityQuery('London');
  const preview = client.compile(query); // Optional; no SQL execution.
  console.log(preview.sql, preview.parameters.length);
  const { rows } = await client.execute(query);
  console.table(rows); // Inferred customer_count: string.
} finally {
  await client.destroy();
}
```

`createClient(backend, catalog, options?)` supports `postgres`, `mysql`, and `duckdb`. Connection environment variables are described in [RUNNING.md](RUNNING.md). DuckDB optionally accepts `{ duckdbPath: 'northwind.duckdb' }`. The catalog is copied at construction.

`compile(query)` returns SQL and bound parameters; parameter values may be sensitive. Preview neither executes SQL nor checks connectivity. `execute(query)` compiles internally, returning inferred `{ rows }`; it does not execute a mutable preview object. Reuse the client and wait for queries before destroying it. Compile/execute reject after destruction; vendor errors propagate unchanged.

## Predicates and projection objects

Use this after creating `customers` from a typed source:

```ts
const inLondon = customers.columns.city.lower().eq('london');
const inUK = customers.columns.country.eq('UK');
const londonUK = customers.filter(inLondon.and(inUK));
const query = londonUK.select({
  customerId: londonUK.columns.customer_id,
  city: londonUK.columns.city,
});
```

Expressions describe computation, not row values. `filter` takes an Expr, `select` an object of Expr values, and `aggregate` an object of Measures. The API does not accept the old callback forms or parse arbitrary JavaScript. [Staged joins](api/tables.md#joins-and-nullability) expose separate input/output column maps.

A JavaScript setting can choose which predicate to construct: `customers.filter(includeAll ? literal(true) : inLondon)`. In contrast, `if (inLondon)` tests object truthiness, not database rows. Use `caseWhen` for per-row conditions, expression methods for comparisons/arithmetic, and fetch any external configuration before construction.

Every transformation returns a new relation scope. Rebuild later expressions from that relation's columns; runtime checks reject stale references. Schema-aware TypeScript checks do not prove relation-instance identity.

## Types without changing driver values

Literal catalogs preserve column names/kinds/nullability through filtering, projection, aggregation and joins. `execute` infers result aliases and nullable fields. i64/decimal/date/string values are strings, fp64 values are numbers, i32 is conservatively number|string, and boolean is boolean|number. This describes existing drivers; it does not add normalization. See [semantics](api/semantics.md).

A broadly typed dynamic Catalog cannot provide exact field inference. Runtime checks remain for dynamic inputs, scopes and the supported profile. SQL preview, lower-level `compilePlan`, and optional Substrait serialization remain available for debugging and advanced consumers.

Ibis, Drizzle, Polars and Kysely are design references for different aspects of [the public API](api/design.md). Substrait remains the relational IR; Kysely remains below lowering, and PostgreSQL/MySQL still execute remotely.
