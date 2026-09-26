# Initial Substrait profile and development commands

This is the first working slice, not the complete challenge. The public input follows a restricted subset of [Substrait v0.63.0](https://github.com/substrait-io/substrait/tree/v0.63.0/proto/substrait) Protobuf JSON conventions. It is not the separate Substrait text format. `src/plan.ts` validates this profile; no binary codec or complete generated schema is included yet.

## Supported input

- Exactly one root relation and explicit version 0.63.0.
- Named-table read using a single logical table name and explicit flat base schema.
- Catalog types: i32, date, string; explicit required/nullable declarations.
- Positional root field references, not nested field paths or correlated references.
- Project appends referenced fields to its input; optional emit maps positions over that combined output.
- Read also supports direct/emit. Output names are supplied at the root and must be unique.
- One sort, with explicit ASC/DESC and NULLS FIRST/LAST.
- One fetch following sort (or an unordered fetch). Count/offset use canonical nonnegative decimal strings within JavaScript's safe integer range. These are the older, still defined v0.63 fields; expression-based fetch is unsupported.
- Field-only projections can surround sort/fetch because they do not alter row cardinality or sort expressions.

The catalog binds logical schemas to physical table columns. The example exposes a two-column logical view of `orders`; it does not claim to describe every physical column in Northwind. Catalog entries are trusted application configuration and must accurately describe the remote columns.

Unknown JSON keys, unsupported operators, mismatched schemas, invalid field positions, duplicate output names, unsafe pagination, excessive plan size/depth, repeated sorts, and repeated fetches fail before execution. This profile intentionally requires some explicit defaults that general Protobuf JSON can omit. Valid Substrait outside this profile is rejected, not silently approximated.

## Compilation and execution

`compilePlan(db, plan, catalog)` returns Kysely's compiled SQL and bound parameters. The caller executes it through the selected adapter. Kysely quotes identifiers and binds pagination values. A CASE sort key implements identical explicit null placement in MySQL and PostgreSQL.

No local optimizer, joins, aggregation, or data movement engine is involved. PostgreSQL/MySQL execute the SQL remotely. DATE results remain calendar-date strings on both adapters. Decimal and count normalization are deferred until those types/operators are added; precision must not be silently discarded.

## Run locally

Requires Node.js 22+ and the challenge databases on localhost (or `POSTGRES_URL` / `MYSQL_URL` overrides).

```powershell
npm ci
npm run check
npm test
npm run test:integration
npm run demo
```

Use `docker compose up -d` for fresh database setup. If the previously created manual container is running, use it directly or stop it before starting Compose to avoid port conflicts. See `PROGRESS.md`.

Unit tests compile without connecting to databases. Integration tests execute the same plan against both backends and compare to independent reference SQL; missing databases fail rather than silently skipping tests.

## Next increments

1. Function extension anchors and typed literals, then filtering with explicit case semantics.
2. Aggregate and join relations, with subquery scopes preserving relation boundaries and aggregate grain.
3. Nested analytical queries and the remaining examples.
4. Official protobuf schema/binary round-trip conformance tests and broader malformed-plan tests.
5. A separately selected advanced extension.

The handwritten validator deliberately limits the first implementation. It is not a substitute for full Substrait validation or a production authorization boundary.
