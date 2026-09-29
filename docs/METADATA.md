# Scoped metadata discovery

`src/metadata.ts` provides asynchronous, read-only discovery for PostgreSQL, MySQL, and DuckDB. It is separate from query execution and does not replace the hand-written Northwind catalog.

```ts
import { discoverMetadata, metadataToCatalog } from '../src/metadata.js';

const metadata = await discoverMetadata('postgres', {
  schema: 'public',
  tables: ['customers'],
});
// Physical names, ordered columns, nullable, precision, scale, unsigned, and domain name.
console.log(metadata.tables);
// Throws if any column cannot be represented faithfully by the current profile.
const catalog = metadataToCatalog(metadata);
```

`discoverCatalog(backend, options)` combines those steps. `duckdbPath` selects a DuckDB file. Every discovery owns and closes its connection handle, including failure paths. With the current DuckDB adapter, close another independently created handle to that file before discovery; this API does not share its native instance with an existing client.

## Scope and mapping

Schema and one to 100 distinct table names are mandatory. Simple ASCII SQL identifiers are supported. Names are bound as values in information-schema predicates. Queries only request columns from that scope and preserve ordinal order. A missing or inaccessible table raises `INVALID_METADATA`; absence of permission cannot be distinguished from absence of the table.

Kysely's pinned generic introspector has neither a requested-table filter nor decimal precision/scale or MySQL unsigned fields. The provider therefore uses small bound `information_schema.columns` queries through Kysely. This does not discover keys, relationships, defaults, indexes, views versus base tables, or arbitrary catalogs.

Physical discovery works for other schemas, but catalog conversion requires the schema reported as the connection's default (`current_schema()` / `database()`). The current relational compiler expects a single, unqualified table identifier; returning dotted catalog keys would silently create an unusable catalog. Use the same connection configuration and default schema when executing a discovered catalog. Discovery is a snapshot, not protection from later DDL or search-path changes.

Supported mappings are signed integer widths through 64 bits, float/double, strings, dates, booleans, and exactly signed decimal(38,10). MySQL unsigned int maps to i64; unsigned bigint is rejected. MySQL tinyint(1) remains i32, since physical metadata cannot prove a boolean value domain. PostgreSQL domains, timestamps, arrays, JSON, unsupported unsigned types, and other decimal precisions/scales fail explicitly. No rounding, truncation, or guessed timezone conversion occurs.

Decimal handling is deliberately conservative: the existing canonical catalog only expresses decimal(38,10). Physical discovery preserves other precisions (including Northwind monetary fields), but automatic conversion rejects them. A richer catalog or separately verified widening rule is future work. Some complete Northwind tables will therefore require manual catalogs; automatic conversion of every existing challenge table is not promised.

## Errors and typing

`MetadataError` carries `stage: 'metadata'`, `backend`, and `code`: `INVALID_METADATA`, `UNSUPPORTED_TYPE`, or `METADATA_FAILED`. Vendor failures remain in `cause`; normal messages do not print connection strings. Avoid logging an unredacted cause.

Runtime discovery does not create compile-time TypeScript knowledge of column names. Keep literal hand-written catalogs for today's typed application API. Schema code generation, cache invalidation, permissions, and consistency across discovery/execution are future work.

## Verification

- `test/metadata.test.ts`: mapping boundaries, scope validation, default-schema rejection, domains, malformed metadata.
- `test/metadata-integration.test.ts`: isolated random fixture tables on PostgreSQL/MySQL and a temporary DuckDB file; checks ordered columns, nullability, precision/scale, unsigned metadata, missing tables, and discovery through real API execution. Fixtures are removed in finally blocks.

Both files are included in the existing local/integration npm scripts. No supplied Northwind table is modified.
