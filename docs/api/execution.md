# Compilation, execution and serialization

[API guide](README.md)

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

## Optional binary interchange

For a file inside `docs/api/`:

```ts
import { cityQuery } from '../../src/queries.js';
import { encodePlan, decodePlan } from '../../src/plan.js';

const jsonPlan = cityQuery('london').toSubstrait();
const bytes = encodePlan(jsonPlan);
const decoded = decodePlan(bytes);
// Pass decoded to compilePlan with the intended connection and trusted catalog.
```

`fromPlanJson(input)` validates the supported JSON shape and returns a generated protobuf Plan; `toPlanJson(plan)` normalizes a generated Plan back to `SupportedPlanJson`. These are lower-level codec boundaries. Application code normally uses `Table.toSubstrait` plus the optional encode/decode helpers. Generated enums/types, field/wire guards and `ref` are compiler/protocol implementation tools, not a general public builder API.

Structural limits include a 1 MB binary input cap and object size/depth budgets. Unknown wire fields are deliberately rejected by this profile, which limits normal protobuf forward compatibility. Decoding does not authenticate the plan, authorize table access or guarantee external-engine interoperability.

## Resource ownership

Reuse a handle for multiple queries and close it in `finally`. For DuckDB, use one owned instance per destination file per process; independent concurrent handles/processes sharing that file are outside the prototype's lifecycle contract. `':memory:'` is suitable for isolated database instances but contains no Northwind rows until seeded.

No cancellation, streaming API, retry policy, configurable transaction isolation, timeout option or stable normalized result/error wrapper is added by the query facade. The exposed connection's lower-level facilities are not a promise that every backend supports arbitrary Kysely operations.

## Failure boundaries

| Stage | Example failures |
| --- | --- |
| API construction | Unknown column, incompatible scalar types, nonboolean filter, wrong relation scope, invalid limit, percentile combined with another measure |
| Export / decode | Unsupported profile fields, invalid types/shapes, plan size/depth limits |
| Compilation | Catalog mismatch, unsupported function signature, dropped sort field, backend limitation such as DuckDB decimal AVG |
| Execution | Connection failure, missing physical table/column, database numeric overflow |

There is no stable normalized error-code API yet. Errors may be ordinary Error instances, validation errors or vendor exceptions; do not depend on exact message text as a public contract.
