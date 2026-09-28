# Execute queries and inspect SQL

```ts
import { createClient } from '../src/client.js';
import { cityQuery } from '../src/queries.js';
import { challengeCatalog } from '../src/challenge.js';

const client = createClient('postgres', challengeCatalog);
try {
  const query = cityQuery('London');
  // Optional: validation and SQL generation, with no database query.
  const preview = client.compile(query);
  console.log(preview.sql, preview.parameters.length);
  const { rows } = await client.execute(query);
  console.table(rows);
} finally {
  await client.destroy();
}
```

`createClient(backend, catalog, options?)` supports `postgres`, `mysql`, and `duckdb`.
Connection settings remain the environment variables described in [RUNNING.md](RUNNING.md).
DuckDB optionally accepts `{ duckdbPath: 'northwind.duckdb' }` as the third argument.
The catalog is copied at construction; subsequent caller mutations do not alter compilation.

`compile(query)` returns `{ sql, parameters }`. Parameters contain actual bound values and may be sensitive; do not log them by default. Preview does not execute SQL or test connectivity. `execute(query)` compiles internally and returns `{ rows }`; no prior preview is required. It recompiles the query rather than executing a mutable preview object. The low-level `compilePlan` and Kysely connection APIs remain available for internal/compiler work.

Reuse a client across queries. Wait for in-flight queries before `destroy()`; a long-running service normally destroys its pool at shutdown. Compile/execute reject after destruction. Driver errors propagate unchanged. Results retain existing driver representations (including decimal/i64 strings); schema-inferred TypeScript row types are future work.

## What callbacks can contain

Callbacks are ordinary synchronous TypeScript functions invoked during query construction. They receive column builders, not data rows. Golden does not parse callback source code or translate arbitrary JavaScript into SQL.

| Callback | Receives | Must return |
| --- | --- | --- |
| `filter` | `Columns` | Boolean `Expr` |
| `select` | `Columns` | Object mapping output names to `Expr` |
| `aggregate` / grouped `aggregate` | `Columns` | Object mapping names to `Measure` |
| join `on` | Left and right `Columns` | Boolean `Expr` |
| join `select` | Left and right `Columns` | Object mapping names to `Expr` |

Supported expression methods currently include `eq`, `lte`, `and`, `lower`, `isNull`, `isNotNull`, `coalesce`, `mul`, `sub`, and `div`. Measures are `sum`, `avg`, column `count`, row `count()`, and `percentile`. Helpers include `literal`, `integer`, and `caseWhen`. Each retains the type/combination restrictions described in [PUBLIC-API.md](PUBLIC-API.md); this is not arbitrary SQL/function support.

Use local variables and helpers for readability:

```ts
customers.filter(t => {
  const inLondon = t.col('city').lower().eq('london');
  const inUK = t.col('country').eq('UK');
  return inLondon.and(inUK);
});
```

An application setting may choose which expression to build:

```ts
customers.filter(t => includeAll ? literal(true) : t.col('city').eq(city));
```

Here `includeAll` is an actual JavaScript boolean known before querying. Conversely, `if (t.col('city').eq(city))` checks the truthiness of an expression object; it does not inspect database values. Use `caseWhen(condition, yes, no)` for a per-row conditional expression.

Do not use JavaScript `===`, `&&`, `+`, or `Math.*` to compute over column objects. Use supported expression methods. `async` callbacks/Promises are not supported. Database calls or other side effects placed inside callbacks would be normal JavaScript side effects during construction, not part of the relational plan; keep callbacks pure. Fetch external settings first, then build the query synchronously.

Keep simple callbacks inline. Name intermediate expressions or extract a helper accepting `Columns` when logic repeats. Do not capture a column expression from another relation and reuse it: scope validation rejects mismatched relation identities. A different callback over the same relation is not automatically a different scope.

Ibis is a design reference for Table/Expression composition, not a runtime dependency or the origin of callbacks/lazy queries. Our reasons for separating construction, compilation, and execution are query composition, backend-independent intent, offline compiler tests, and optional SQL inspection.
