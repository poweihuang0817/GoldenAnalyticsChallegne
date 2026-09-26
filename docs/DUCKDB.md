# DuckDB third-backend extension

The same public Table/Expression queries now execute inside DuckDB through a small Kysely adapter. PostgreSQL/MySQL still execute remotely on the supplied image. DuckDB executes against a separately seeded local snapshot; there is no federation, Python dependency, live cross-source join, or hidden fallback from either remote backend.

## Run

Requires Node.js 22+, `npm ci`, and the challenge PostgreSQL database running for the initial snapshot:

```powershell
npm run seed:duckdb
npm run demo:duckdb
npm test
npm run test:integration
npm run test:duckdb
```

`seed:duckdb` reads `POSTGRES_URL` (or the existing challenge-local connection default) in a repeatable-read, read-only transaction. It copies only the logical catalog columns of `orders`, `customers`, `employees`, and `order_details`. Money columns are selected as decimal strings, dates as calendar strings. The source is `goldenbeers/golden-query-challenge:1.0`, image digest `sha256:2b42448660486dfb7778e74854e5888064ae8a004bbf6895ca68f57a81d38e0e`. No source rows are changed.

The command atomically replaces those four tables in the local destination. Use a dedicated demo file, not a database containing unrelated tables with those names. Default destination: `northwind.duckdb` in the current working directory. Override with `DUCKDB_PATH`; its parent directory must exist. DuckDB files, WALs, and temporary directories are ignored by Git. Do not run a refresh while another process owns the destination database file. The console reports row counts and a SHA-256 of the ordered source snapshot without credentials.

Verified supplied snapshot: 830 orders, 91 customers, 9 employees, 2,155 detail rows; SHA-256 `83925750f4c70d986bd4efc86ae3e939a4e29efea4b20364a44ebdeabfe01803`. The hash identifies the selected rows/columns, not the entire source database. Once seeded, `demo:duckdb` does not need either remote database. The normal `demo` continues to run PostgreSQL and MySQL.

## Adapter boundary and types

`connect('duckdb')` returns the same `Kysely<Database>` interface as the original backends. `connect('duckdb', { duckdbPath: ':memory:' })` creates an isolated in-memory test instance. A driver owns one DuckDB instance and acquires separate native connections for queries/transactions, closing them on release. Call `db.destroy()` after use. Reuse one handle per file in a process; simultaneous independent instances/processes sharing a file are outside this prototype's lifecycle contract.

The pinned official [`@duckdb/node-api`](https://duckdb.org/docs/current/clients/node_neo/overview) version is `1.5.5-r.5`. Kysely's [custom dialect interface](https://kysely-org.github.io/kysely-apidoc/interfaces/Dialect.html) allows the driver to reuse PostgreSQL-style identifier quoting and `$n` placeholders for our supported SQL subset. This does not imply general PostgreSQL compatibility. Streaming, schema introspection, migration locks, configurable isolation/access modes, and arbitrary parameter/result types explicitly fail instead of silently pretending support.

- Decimal results use the binding's exact scaled-integer string conversion; no JavaScript number conversion.
- i64 values are strings; calendar DATE values are strings; null remains null.
- fp64 stays a JavaScript number. No generic coercion normalizes away real differences.
- Values are bound parameters; the seed's identifiers/types come only from the trusted catalog.

## Decimal semantics and bounded support

DuckDB [decimal division returns floating point](https://duckdb.org/docs/current/sql/data_types/numeric), so reusing `/` would violate our decimal contract. A failing regression showed `9007199254740993 / 3` returning `3002399751580330.3803355136` after a decimal cast. The DuckDB lowering now uses SQL HUGEINT quotient/remainder arithmetic and rounds to ten places, half away from zero. It never evaluates the ratio in JavaScript or falls back to DOUBLE. Null and zero denominators produce null, including with large numerators.

The intermediate scaled numerator must fit signed HUGEINT; the final result must fit decimal(38,10). Absolute numerators up to `10^18` fit the intermediate bound; some larger values fit, but arbitrary decimal(38,10) division is not promised. Overflow throws an execution error. Exact decimal AVG is explicitly rejected because DuckDB's AVG returns floating point; the challenge's average-units query uses explicit fp64 input and remains supported. Decimal multiplication and percentile interpolation also remain bounded by DuckDB's fixed-precision arithmetic, with overflow reported rather than normalized away.

These are narrow backend-specific decisions in relational lowering, not a new capability framework. PostgreSQL/MySQL lowering is unchanged. The existing portable percentile rewrite is retained, preserving its null/empty-group behavior and tested exact interpolation above JavaScript's safe-integer range.

## Verification

- Local DuckDB adapter tests exercise parameter binding, exact result conversion, transactions/rollback, concurrent queries and closed-handle rejection.
- Hand-calculated fixtures independently cover all six sample families, including customers/employees without orders and orders without detail rows.
- Decimal division tests cover precision above `2^53`, signs, rounding ties, nulls, zero denominators, and explicit overflow. Percentile tests cover large exact decimals, singleton/tied/all-null groups and empty input.
- `test:duckdb` builds an isolated memory snapshot from the provided PostgreSQL instance and executes the same public queries on PostgreSQL, MySQL and DuckDB. It also checks the merged window-ranking extension at N=0,1,3,1000 through binary round trips, preserving string rank output. Exact strings must match; only the declared fp64 average permits a small tolerance. It requires both remote databases and does not read or overwrite the user's local demo file.

Window ranking is now merged from main and runs in the DuckDB driver demonstration as well. Broader DuckDB syntax, full Substrait compatibility, other operating-system validation, performance tuning, and production resource controls remain future work.
