# Execute queries and inspect SQL

```ts
import { createClient } from '../src/client.js';
import { cityQuery } from '../src/queries.js';
import { challengeCatalog } from '../src/challenge.js';

const client = createClient('postgres', challengeCatalog);
try {
  const query = cityQuery('London');
  const preview = await client.compile(query); // Optional; no SQL execution.
  console.log(preview.sql, preview.parameters.length);
  const { rows } = await client.execute(query);
  console.table(rows); // Inferred customer_count: string.
} finally {
  await client.destroy();
}
```

`createClient(backend, catalog, options?)` supports `postgres`, `mysql`, and `duckdb`. Connection environment variables are described in [RUNNING.md](RUNNING.md). DuckDB optionally accepts `{ duckdbPath: 'northwind.duckdb' }`. The catalog is copied at construction.

`await compile(query)` returns SQL and bound parameters; parameter values may be sensitive. Preview neither executes SQL nor checks connectivity. `execute(query)` compiles internally, returning inferred `{ rows }`; it does not execute a mutable preview object. Reuse the client and wait for queries before destroying it. Compile/execute reject after destruction. Compiler errors preserve their code, stage, backend and capability; execution errors retain their existing wrapper and driver cause.

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

## Asynchronous compilation

`client.compile(query)` returns `Promise<QueryPreview>`. Each client lazily starts one reusable worker and accepts at most 32 outstanding compilation requests, including the active request; excess requests reject. The worker receives only the supported Substrait JSON plan, the copied catalog and backend name. A connection-free Kysely DummyDriver compiles SQL and bound parameters. Database pools and execution stay in the application process. The internal `compilePlan` API stays synchronous, including the demo HTTP handler that uses its lowering trace directly.

Reuse the client to amortize worker startup. `destroy()` rejects queued/in-progress compilation and terminates the worker, then releases the backend pool. A fatal worker error/exit rejects outstanding and subsequent compilations; create a new client after such a failure. Finish database executions before destroying the client. Workers are an internal detail and require no driver-side setup. The repository's tsx source runtime registers its loader inside the worker through `compile-worker.mjs`.

Worker isolation does not promise faster compilation. Query construction, `toSubstrait()` export and structured cloning still run on the main thread. `execute(query, { timeoutMs })` applies to running database work, excluding compilation, the worker queue and connection acquisition. Aborting during compilation prevents subsequent database execution but does not interrupt that CPU job; it settles after compilation responds. There is no compilation deadline or end-to-end hard deadline. Destroying the client does terminate its compiler CPU work.

### Worker-to-executor contract

Execution reconstructs a Kysely executable query with
`CompiledQuery.raw(preview.sql, preview.parameters)`. SQL plus ordered parameters
are sufficient for the current PostgreSQL, MySQL and DuckDB execution paths;
worker equivalence and real execution tests protect this boundary. If a future
adapter, plugin or driver requires additional compiled-query metadata, revisit
this transport contract rather than assuming raw reconstruction remains equivalent.

### Join characterization

Reproduce with `npx tsx scripts/characterize-compilation.ts`. Local observation on Windows / Node v24.19.0, compiler base `683c5cc`, using a left-deep chain of inner joins over one required i32 column per read and retaining all outputs. Counts below are join operators (11/21/32 table occurrences). Each warm worker call is checked against direct synchronous SQL and ordered parameters. These observations are not CI performance thresholds or representative of every query shape.

| Backend | Joins | Direct compile ms | Warm worker roundtrip ms | SQL bytes |
| --- | ---: | ---: | ---: | ---: |
| PostgreSQL | 10 | 16.25 | 8.49 | 2,672 |
| PostgreSQL | 20 | 6.38 | 6.46 | 7,372 |
| PostgreSQL | 31 | 6.99 | 10.07 | 15,083 |
| MySQL | 10 | 4.16 | 9.63 | 2,672 |
| MySQL | 20 | 6.11 | 6.91 | 7,372 |
| MySQL | 31 | 5.15 | 10.84 | 15,083 |
| DuckDB | 10 | 4.42 | 8.84 | 2,672 |
| DuckDB | 20 | 4.54 | 10.92 | 7,372 |
| DuckDB | 31 | 9.01 | 8.27 | 15,083 |

All cases have zero bound values; bound-value equivalence is covered separately by all fixed example queries on every backend. Startup plus first one-join compilation took 841 / 846 / 1,815 ms for PostgreSQL / MySQL / DuckDB in the same run. Warm roundtrip includes message cloning, queuing and result transfer. JIT/cache/system-load variation explains nonmonotonic timings; one observation establishes neither a speedup nor a complexity guarantee. SQL size is unchanged by worker isolation. The existing profile depth/size limits still apply; a public API join-and-project chain has a different depth from this direct Substrait fixture.
