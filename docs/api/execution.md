# Compilation, execution and serialization

[API guide](README.md)

## Normal application execution

Use `createClient(backend, catalog, options?)` from `src/client.ts`. `await client.execute(query)` returns `{ rows }`; `await client.compile(query)` returns `{ sql, parameters }` without querying the database. Reuse the client and call `await client.destroy()` after in-flight queries finish. Preview parameter values may be sensitive; do not log them by default. Result rows are inferred from the query schema with conservative driver value types; no new result normalization occurs. Compiler errors preserve stable details; execution failures use the existing ExecutionError wrapper and driver cause.

See the [tutorial](tutorial.md) and [client/expression guide](../QUERY-CLIENT.md). The lower-level interfaces below remain available for compiler tests and serialized-plan consumers.

## Advanced: compile, execute and serialize

| Entry point | Behavior |
| --- | --- |
| `connect(backend, options?)` from `backend.ts` | Backend is `'postgres'`, `'mysql'` or `'duckdb'`. Returns `Kysely<Database>`. Optional `{ duckdbPath?: string }` configures DuckDB; otherwise `DUCKDB_PATH` or `northwind.duckdb`. PG/MySQL use `POSTGRES_URL` / `MYSQL_URL` or local sample defaults. |
| `compilePlanSync(db, input, catalog)` from `compiler.ts` | Synchronous validation/lowering; returns Kysely's compiled query, including `sql` and `parameters`. Does not execute SQL or inspect live database metadata. Compile separately for each backend. |
| `await db.executeQuery(compiled)` | Executes through the selected driver and returns a result containing `rows`. Database failures surface here. |
| `await db.destroy()` | Releases backend resources; call in `finally`. |
| `encodePlan(input)` from `plan.ts` | Profile-validates a JSON plan and returns protobuf `Uint8Array`. |
| `decodePlan(bytes)` from `plan.ts` | Checks the wire/profile boundary and returns normalized `SupportedPlanJson`; input has a 1 MB limit. |

Values are bound parameters. Use trusted catalogs/connection selection; parameterization does not implement authorization. `Table`, `Expr` and `Measure` are public TypeScript interfaces. `Expr.resolve` is implementation plumbing; use the documented factories rather than constructing internal relations manually.

## Optional binary interchange

For a file inside `docs/api/`:

```ts
import { cityQuery } from '../../src/queries.js';
import { encodePlan, decodePlan } from '../../src/plan.js';

const jsonPlan = cityQuery('london').toSubstrait();
const bytes = encodePlan(jsonPlan);
const decoded = decodePlan(bytes);
// Pass decoded to compilePlanSync with the intended connection and trusted catalog.
```

`fromPlanJson(input)` validates the supported JSON shape and returns a generated protobuf Plan; `toPlanJson(plan)` normalizes a generated Plan back to `SupportedPlanJson`. These are lower-level codec boundaries. Application code normally uses `Table.toSubstrait` plus the optional encode/decode helpers. Generated enums/types, field/wire guards and `ref` are compiler/protocol implementation tools, not a general public builder API.

Structural limits include a 1 MB binary input cap and object size/depth budgets. Unknown wire fields are deliberately rejected by this profile, which limits normal protobuf forward compatibility. Decoding does not authenticate the plan, authorize table access or guarantee external-engine interoperability.

## Resource ownership

Reuse a handle for multiple queries and close it in `finally`. For DuckDB, use one owned instance per destination file per process; independent concurrent handles/processes sharing that file are outside the prototype's lifecycle contract. `':memory:'` is suitable for isolated database instances but contains no Northwind rows until seeded.

The facade accepts execution AbortSignal and timeoutMs controls; the timeout covers running database work only. Compilation uses a bounded worker queue and is excluded from that timeout. See [compilation lifecycle and limits](../QUERY-CLIENT.md#asynchronous-compilation). No streaming API, retry policy, configurable transaction isolation or result normalization is added. The exposed connection's lower-level facilities are not a promise that every backend supports arbitrary Kysely operations.

## Failure boundaries

| Stage | Example failures |
| --- | --- |
| API construction | Unknown column, incompatible scalar types, nonboolean filter, wrong relation scope, invalid limit, percentile combined with another measure |
| Export / decode | Unsupported profile fields, invalid types/shapes, plan size/depth limits |
| Compilation | Catalog mismatch, unsupported function signature, dropped sort field, backend limitation such as DuckDB decimal AVG |
| Execution | Connection failure, missing physical table/column, database numeric overflow |

CompileQueryError retains its code, stage, backend and capability across the worker boundary. ExecutionError retains execution control/driver failure codes and the original driver cause. Queue saturation, worker lifecycle failures and API construction can still produce ordinary Error instances; do not depend on exact message text as a public contract.
