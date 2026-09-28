# Proposed migration: make Kysely the public query API

**Status: proposed for review only.** This document is a plan PR. It changes no application behavior and does not authorize implementation. Wait for the user's review before creating the test or migration PRs.

## Decision under consideration

Replace Golden's custom immutable `Table`/`Expr` application API and public Substrait serialization boundary with Kysely's typed TypeScript query-builder API. Applications build Kysely queries and execute them directly through the selected PostgreSQL, MySQL, or DuckDB connection.

This proposal explicitly does **not** introduce DataFusion, federation, or a replacement custom IR. The database remains responsible for executing each query. A future engine could be reconsidered only if a concrete cross-source or file-query use case appears.

Target flow:

```text
Application query function (Kysely<NorthwindDatabase>)
        |
        +-- compile() -> inspect SQL + bound parameters
        |
        +-- execute() -> selected PostgreSQL / MySQL / DuckDB backend
```

The application API becomes SQL-builder-shaped. Kysely is the public abstraction, not merely an internal SQL compiler. This removes the existing Golden relational facade rather than wrapping Kysely in another facade.

## Why consider this change

The current path has two application-facing representations before execution:

```text
Golden Table/Expr -> Substrait profile -> Golden compiler -> Kysely -> database
```

For the current scope, Substrait does not provide a required external plan-exchange boundary. Kysely already provides typed query construction, SQL compilation, dialect quoting, and parameter binding. Removing the translation layer should reduce Golden-owned code and put ordinary SQL composition in a familiar TypeScript API.

This trades away a backend-independent relational API and an interoperable plan format. Kysely's types are compile-time checks, not runtime schema discovery or cross-database semantic normalization. PostgreSQL, MySQL, and DuckDB differences still require explicit behavior tests and narrow backend-specific SQL where needed.

## Proposed API shape

Define one static `NorthwindDatabase` schema type for the supported tables. Query examples become functions over a typed Kysely handle, so the same query definition can be built for each dialect:

```ts
function recentOrders(db: Kysely<NorthwindDatabase>, n: number) {
  return db.selectFrom('orders')
    .select(['order_id', 'order_date'])
    .orderBy('order_date', 'desc')
    .orderBy('order_id', 'desc')
    .limit(n);
}

const query = recentOrders(db, 5);
const preview = query.compile(); // SQL and bound parameters
const rows = await query.execute();
```

The public API uses Kysely directly: no second `createSource/Table/Expr` wrapper. Connection factories continue selecting the dialect and driver. If the project keeps a small helper for connection lifecycle, it must not recreate a query DSL.

Values remain bound parameters. Any Kysely `sql` tag use must be limited to trusted SQL templates; user-provided values remain parameters and identifiers must come from typed query structure.

## Behavior that must not change

The migration is a representation/API change, not a feature-expansion pass. Preserve and test the established semantics for:

- All six challenge query families and the row-number top-N extension.
- Deterministic sort/tie-break behavior and explicit NULL ordering.
- Case-insensitive, accent-sensitive city matching.
- Average units at the per-order grain, employee rows with zero orders, and freight counted once per order with the existing discount rule.
- Continuous exact percentile behavior, including NULLs, empty/all-NULL groups, ties, endpoints, interpolation, and large decimal values beyond JavaScript's safe-integer range.
- Decimal precision/overflow boundaries, zero-denominator behavior, date strings, i64/decimal result strings, and fp64 tolerance.
- Parameter binding and rejection/handling of invalid query inputs at the new API boundary.

Do not treat PostgreSQL/MySQL result equality alone as an oracle. Keep the independent BigInt/hand-calculated fixtures and direct expected-value assertions.

## Required sequence

### PR 1 — this plan

Documentation only. Review the target API, semantics, test gate, and treatment of open work before implementation.

### PR 2 — behavior-characterization tests

Tests only; they must pass against the existing implementation before migration begins. First inventory current unit and integration cases. Add only meaningful gaps rather than duplicating coverage already present.

The test PR should strengthen independent expected-result fixtures for boundary cases and ensure the same behavior corpus runs against PostgreSQL, MySQL, and DuckDB. Keep database-mutating fixtures isolated. Do not change production query code in this PR. Record the exact commands and results.

### PR 3 — migrate query definitions and driver to direct Kysely

After PR 2 is merged, change the challenge query definitions and driver to use Kysely directly. Add a concrete `NorthwindDatabase` type and compile-time type checks for misspelled tables/columns and invalid comparisons. Run the unchanged behavior corpus against each backend. Preserve SQL preview through Kysely's `compile()`; keep connection/result handling separate from query construction.

Treat percentile and window ranking as explicit risk areas. Reproduce the existing exact semantics with Kysely's expression/query APIs or a small trusted SQL helper. Do not substitute an approximate percentile or silently alter result representations to make the query compile.

### PR 4 — remove the obsolete Substrait path

Only after the migrated driver and test suite no longer import it, remove Substrait generation/codec/profile code, custom relational API and compiler visitors, generated files, scripts, schemas/spec artifacts, and dependencies that have no remaining use. Update architecture/API documentation and examples. Use repository search and a fresh install to prove the legacy path is actually unused.

If that deletion makes PR 3 too broad, split it into a final cleanup PR; do not leave an undocumented second public API.

## Validation gate

Before merging the test PR, the tests must pass against the pre-migration implementation. Before merging the Kysely migration:

- TypeScript check and all local unit tests pass.
- Shared PostgreSQL/MySQL integration cases pass.
- DuckDB conformance cases pass using the documented seeded snapshot or isolated fixtures.
- SQL compilation checks confirm values are parameterized for each dialect.
- Independently computed expected results still pass, including percentile and decimal edge cases.
- Demo output and documented API examples use the new public API.
- The final diff has no accidental credentials, generated local database files, or unused production path.

These commands are evidence only when actually run; a plan PR makes no test/CI claim.

## Open review points

1. Approve direct Kysely as the public API, including the trade that application code becomes SQL-builder-shaped and no longer uses Golden's Ibis-inspired Table/Expr API.
2. Agree that the behavior-test PR merges before any production migration.
3. Decide what to do with open PR #18 (`createClient` over the existing Substrait API). It is not a migration prerequisite and should not be stacked under the migration. If merged, the Kysely PR should treat it as temporary compatibility surface and remove or supersede it; alternatively, close it as superseded once this plan is approved.
4. Keep the current API documentation and README PRs independent; reconcile their examples only after the target API is approved.

No test additions, source refactor, PR #18 action, or migration should begin until this plan has been reviewed.
