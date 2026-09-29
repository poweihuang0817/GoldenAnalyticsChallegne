# Proposal: typed relational API with Substrait retained

Status: API design for review; no implementation in this PR. The user has redirected the earlier Kysely-only migration proposal: retain Substrait and continue designing compile-time schema checks. Exact syntax and implementation phases still require review.

## Decision and rationale

Keep the existing boundary:

```text
Application / future semantic-query frontend
    -> typed Table / Expr API
    -> supported Substrait profile
    -> validation and backend lowering
    -> Kysely
    -> PostgreSQL / MySQL / DuckDB
```

A future semantic frontend would resolve metrics, dimensions, grain, and relationships before producing relational operations. Substrait can be the shared relational contract for that frontend and other producers. It does not itself define business metrics, supply connectors/folding, or make engine interoperability automatic.

The reason is representation independence, not a claim that relational algebra is universally more expressive than SQL. SQL and relational plans overlap substantially. A semantic frontend could also compile to SQL. Retaining Substrait is a deliberate reuse/interchange option with real compiler, function-mapping, and validation costs; there is no demonstrated external plan consumer today.

Kysely remains internal SQL construction machinery. Do not adopt Kysely's public query builder and then reverse-engineer its operation nodes into Substrait. Do not introduce another serialized/custom IR. API expression objects are typed construction helpers over the existing Substrait boundary.

## Current implementation and gap

In `src/api.ts`, `Columns.col(name: string)` returns an unparameterized `Expr`; `Table` does not carry an inferred output schema. Unknown fields, invalid scalar operations, and relation scopes are checked at runtime. `src/queries.ts` already expresses all challenge families and ranking through this API.

Improve these types incrementally without replacing the compiler. Callback syntax is independent of type safety: callbacks can receive fully typed columns, and object syntax can be typed as well.

## One schema definition

Infer static types from the same literal catalog used for runtime validation. Proposed helper syntax (not implemented):

```ts
const catalog = defineCatalog({
  orders: [
    { name: 'order_id', type: 'i32', nullable: false },
    { name: 'customer_id', type: 'string', nullable: true },
    { name: 'order_date', type: 'date', nullable: true },
  ],
});
const source = createSource(catalog);
const orders = source.table('orders');
```

This is a partial Northwind example, not a replacement for the complete challenge catalog. The helper must preserve literal table names, column names, kinds, and nullability; avoid widening the value to `Catalog` at its declaration. It must also retain runtime catalog validation. Do not maintain a separate manually synchronized database interface.

Conceptual type propagation:

- `Source<Catalog>` restricts `table()` to known names.
- `Table<Schema>` carries the current output fields.
- `Columns<Schema>.col<K extends keyof Schema>(key: K)` preserves the chosen field's type.
- `Expr<Kind, Nullable>` represents a scalar; `Measure<Kind, Nullable>` represents an aggregate.
- Selection maps output keys to expression types; aggregation maps grouping keys plus measures to the next table schema.
- Execution infers result rows from that output schema.

These are design signatures, not a verified generic implementation. Use nominal/private type markers so unrelated Expr/Measure types cannot become structurally interchangeable. Avoid signatures that infer a broad union to accept incompatible operands.

## Kysely-inspired typed filter: preferred simple form

User clarification: learn from Kysely's API, especially schema-aware filter arguments. Prefer a small typed column/operator/value overload for ordinary conditions:

```ts
const query = source.table('orders')
  .filter('order_id', '<=', 11000)
  .select(['order_id', 'order_date'])
  .orderBy({ column: 'order_date', direction: 'desc', nulls: 'last' },
           { column: 'order_id', direction: 'desc' })
  .limit(5);

source.table('customers').filter('city', '=', 'London');
// compile-time errors in the proposed API:
// orders.filter('order_typo', '=', 1)
// orders.filter('order_id', '=', 'London')
// customers.filter('city', '=', 123)
```

Use `filter` to retain relational transformation semantics; Kysely's comparable method is `where`. This borrows developer experience, not Kysely's AST or complete SQL surface. A subsequent filter applies to the current relation (including after limit/aggregate), rather than mutating an earlier SQL WHERE block.

Model allowed arguments as a correlated union/mapped type of tuples by column and supported operator. Derive RHS from that selected column/operator, not a union of all table value types. Prefer rejecting widened ambiguous names over a permissive fallback. Test union-valued keys as well as literals so a string-or-number union cannot bypass checking.

Initial operator allowlist should match existing lowering: `=` for currently comparable kinds, `<=` for supported numeric pairs, and `is` / `is not` with null lowering to isNull/isNotNull. Reject `= null`. Do not claim support for every Kysely operator (IN, LIKE, OR, etc.) without adding and testing its Substrait/function lowering. Distinguish value strings from column references: RHS strings are values; column comparisons use explicit typed Expr references. Plain string/date/decimal literal acceptance must match the existing literal support, not just their result encoding.

A typed `select(['order_id', 'order_date'])` shorthand preserves those fields; the existing named-expression object supports renaming/calculation. Chain filters for AND. More complex supported expressions use the expression overload below. Case-insensitive city matching still uses explicit lower() expressions; simple equality does not silently add case normalization.

Kysely references: [WhereInterface](https://kysely-org.github.io/kysely-apidoc/interfaces/WhereInterface.html) for value vs reference arguments and [schema setup](https://kysely.dev/docs/getting-started) for typed query construction. Our narrower operator/profile guarantees are Golden's proposed contract, not a claim that Kysely checks all SQL semantics.

## Typed expression/object form for composition

Expose typed `table.col()` and accept expressions/selection objects directly, while retaining typed callback overloads for convenient chaining and compatibility:

```ts
const customers = source.table('customers');
const london = customers.filter(
  customers.col('city').lower().eq(literal('London').lower()),
);
const names = london.select({
  customer: london.col('customer_id'),
  city: london.col('city'),
});
```

This is a typed object API: expressions are objects, not executed row predicates or raw SQL. Filter/select resolve these helpers into the existing Substrait structures. Do not build a second generic predicate AST such as an untyped `{ op, args }` tree.

Each transformation produces a new table scope. In the example, select uses `london.col()`, not captured columns from `customers`. Runtime scope checks remain authoritative. TypeScript does not create a unique nominal type for every runtime table instance, so compile-time typing alone cannot guarantee relation identity.

Equivalent optional callback syntax:

```ts
const names = source.table('customers')
  .filter(c => c.col('city').lower().eq(literal('London').lower()))
  .select(c => ({ customer: c.col('customer_id'), city: c.col('city') }));
```

The callback runs while constructing the query, receiving expression builders. It does not receive data rows or execute a database query. Supporting both forms should share one resolver, not duplicate lowering.

## Schema propagation and operation rules

| Operation | Compile-time contract | Runtime responsibility |
| --- | --- | --- |
| table / col | Known literal names only | Validate dynamic input and actual catalog |
| filter | Boolean expression, nullable allowed | SQL three-valued logic; retain only TRUE |
| select | Infer named output fields; removed fields unavailable afterward | Scope and duplicate/empty-name checks |
| eq / lower / arithmetic | Compatible logical kinds; lower only on string, arithmetic only numeric | Literal range, overflow, exact decimal rules |
| groupBy / aggregate | Existing grouping keys; only measures in aggregate output; result includes keys and measures | Preserve grouping grain and empty-input semantics |
| join | Typed left/right fields; compatible on expression; explicit output mapping | Distinct occurrences/self-joins; no cross-source joins |
| left join output | Right fields become nullable in output callback | Separate predicate and output scopes; reject captured predicate expressions |
| sort / window | Keys from current schema; row-number adds non-null i64 field | Explicit NULL order, valid names and window profile |
| limit / percentile | Numeric input types | Integer/range/finite checks; percentile bounds and supported combinations |

Retain separate scalar and measure categories to reject ungrouped scalar fields in aggregate results. Group keys and aggregate aliases must not collide. Duplicate literal output names and grouping keys should fail statically where practical and always be validated at runtime.

For joins, initially keep the existing `on(left, right)` and `select(left, right)` callbacks, but type both. They clearly distinguish predicate fields from null-extended output fields and preserve the existing scope regression protection. A callback-free alias/join builder is a later design, not necessary for the first typed release.

Do not infer non-null fields merely from a general filter, or assume that joining removes NULLs. Nullability refinements can be added separately after proof and tests.

## Logical types are not driver value types

Keep logical kinds separate from JavaScript representations. A plain string type cannot distinguish a date, decimal, i64, and text column for operation checking.

Result mapping must preserve the established contract: i32/fp64 as numbers, i64/decimal as strings, dates as calendar strings, bool as boolean, and nullable columns as unions with null. Confirm these mappings against the existing backend result handling before exposing typed execution; do not use a cast as evidence.

For the first increment, preserve currently accepted literal and aggregate semantics. Do not add arbitrary decimal-string literals or silently map decimals to JS numbers. Count and row-number stay non-null i64; nullable sum/avg and division retain their existing behavior. Mixed numeric operations follow the current explicit promotion rules, not TypeScript's generic number type.

An imported/untyped Substrait plan cannot safely return caller-asserted `Row[]`. Keep that boundary runtime-validated with unknown result fields, unless a validated schema is supplied. Dynamic catalogs do not receive static autocomplete guarantees; do not present generic casts as schema validation.

## Execution and SQL preview

Proposed convenience surface:

```ts
const rows = await client.execute(query); // inferred output rows
const preview = client.compile(query);   // SQL and bound parameters; no DB execution
```

A normal caller needs only execute. It internally performs plan generation, validation, compilation, and database execution. Compile remains independently available for debugging and compiler tests. Query construction is lazy with respect to database I/O, including callbacks. Avoid logging parameter values by default.

PR #18 already proposes this client shape over Substrait. Retaining Substrait removes the previous reason to supersede that PR, but it still requires its own review and an eventual typed execution signature. PR #17's API documentation also remains relevant; reconcile it with the final accepted API. This proposal neither merges nor closes either PR.

## Test-first implementation sequence

1. Review and merge this plan-only PR. Retaining Substrait is the latest direction; object overload syntax and type contracts are proposals.
2. Inventory existing behavioral coverage; add only missing characterization cases in a tests-only PR that passes on current code. Preserve all six challenge query families, ranking, all three backends, parameter binding, NULL ordering, ties, independent numeric oracles, and scope regressions.
3. Add typed catalog/Expr/Table propagation incrementally with compile-time tests in the same implementation PR. Negative type tests cannot pass against today's permissive API, so they belong here rather than being falsely reported as passing characterization tests.
4. Add typed filter tuples, select shorthands, expression/object overloads, and typed client execution after the core type contract works; keep typed callbacks for compatibility. Reuse unchanged runtime semantics and lowering.
5. Update Northwind examples/API docs and rerun local tests, PostgreSQL/MySQL integration, DuckDB conformance, and documented demo commands before claiming completion.

Compile-time tests should be included in a strict tsc no-emit test configuration. Use positive inferred-result assertions and `@ts-expect-error` negative cases (unused directives must fail). Cover unknown tables/columns, string sum, incompatible equality, non-boolean filter, removed projected fields, aggregate misuse, nullable right-side left-join fields, and exact result representations. Test tuple, object, and callback overloads, including mismatched value types, unknown operators, NULL comparisons, and union-key inference. Ban any/as-cast shortcuts in these tests.

Runtime tests must retain wrong-scope expression rejection, captured join-predicate rejection, malformed/dynamic input checks, imported-plan profile validation, and backend capability errors. If a new bug is found, reproduce it with a failing regression test before fixing it.

## Proposed file boundaries and deferred scope

Evolve `src/api.ts` first; extract catalog/type utilities only if needed for readability. Keep `src/queries.ts` as Northwind examples, `src/compiler.ts` and `src/relational.ts` as unchanged lowering, and the current generated schemas/profile. Add a focused compile-time test file/config alongside existing API runtime tests. Integrate `src/client.ts` only after PR #18's disposition is settled.

Deferred: semantic metrics layer, federation, DataFusion/Rust service, schema introspection/code generation, general optimizer, full Substrait interoperability, advanced nullability narrowing, callback-free joins, and broad capability/auth/error frameworks. None is required to demonstrate this type-safety improvement.

Review questions: approve Kysely-inspired typed filter/select shorthands plus typed expression/callback compatibility; approve runtime-only relation identity checks; confirm the small test-first increments above. No runtime implementation is authorized by this document alone.
