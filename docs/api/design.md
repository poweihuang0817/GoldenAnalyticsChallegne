# Why this API has these boundaries

[API guide](README.md)

## Why take inspiration from Ibis?

The application needs to express analytical computation independently of a backend. Ibis's Table/Expression model is a useful reference because transformations compose into relations, and expressions can be constructed before binding to execution. See Ibis's [table API](https://ibis-project.org/reference/expression-tables) and [unbound-expression guide](https://ibis-project.org/how-to/extending/unbound_expression).

**This project does not depend on Ibis.** It implements a small TypeScript API inspired by that model. It does not port Ibis's Python API, optimizer, backend support or complete type system. The API uses typed column objects, predicates and projection objects without callbacks. This is our TypeScript design, not a port of Ibis syntax.

| Design choice | Benefit in this challenge | Concrete example |
| --- | --- | --- |
| Transformations produce another Table | Intermediate results can be reused as inputs to further computation | Aggregate order details, join those totals to orders, then average |
| Expressions represent intent before execution | The application query can be compiled for a chosen compatible backend | The same city-count plan runs on PostgreSQL, MySQL or DuckDB |
| Explicit expression objects and a schema | Reject invalid field names, incompatible types and stale references before execution where possible | A projected-away quantity column cannot be reused as though it still exists |
| Immutable query descriptions | Build multiple analyses from the same starting table without one changing another | Recent orders and per-customer order counts can share a base relation |
| Relational composition in the public API | SQL query-block/subquery details remain the compiler's responsibility | Filtering a computed row number needs an outer SQL query |

These are properties implemented by this prototype and checked by its tests, not automatic guarantees obtained from using the Ibis name. Portability still depends on our function semantics, compiler and backend tests.

### What we borrow from Drizzle, Polars and Kysely

The API combines typed column/projection objects (a useful [Drizzle reference](https://orm.drizzle.team/docs/select)), composable expressions (a useful [Polars reference](https://docs.pola.rs/user-guide/concepts/expressions-and-contexts/)), and schema-aware feedback (a useful [Kysely reference](https://kysely.dev/docs/getting-started)). These are design references, not new runtime dependencies. Kysely remains the internal SQL layer.

A predicate can be named before calling filter; a projection object exposes output aliases directly. We chose one callback-free surface. The tradeoff is explicit intermediate variables: each new relation owns its columns, and staged joins separate input scopes from nullable output scopes.

### Why not expose Kysely directly?

Direct Kysely would be a reasonable, smaller choice for an application whose contract is explicitly SQL. It already supplies a rich TypeScript query builder, parameterization and dialect support. Keeping it internal here lets the public contract describe operations over relations while the compiler decides where SQL subqueries are needed and how backend-specific semantics are represented.

| Boundary | Direct Kysely API | This Table/Expr API |
| --- | --- | --- |
| Application vocabulary | SQL clauses, aliases and derived SELECTs | Relations, expressions and transformations |
| Nested analysis | Caller can explicitly construct SQL subqueries | Compiler preserves the relation boundaries |
| Execution targets | SQL through supported/custom dialects | Currently SQL too; a relational contract leaves room for another target later |
| Cost and maturity | Reuses established SQL builder functionality | Adds validation/lowering code and supports far fewer operations |

Kysely itself can express these SQL queries; the benefit of our layer is controlling the application contract and portable semantics. The cost is maintaining a compiler and a restricted type/function profile. For this take-home the supported set stays small. DataFusion, federation and other non-SQL targets remain unimplemented possibilities, not reasons to expand the current project.

### Why not expose raw Substrait?

Application developers would otherwise manage positional field indices, function anchors, protobuf enum values and output mappings. Named `Table`/`Expr` builders handle that construction while preserving Substrait at the interchange boundary. Using official schemas reduces custom format design, but does not remove the need to validate a supported profile.

## A Table describes a relation

A table expression represents both a relational computation and its output fields. `filter` retains the field schema; `select` defines a new one; `aggregate` replaces the inputs with group keys and measures. Each returns a new Table, leaving its input reusable. These methods describe computation rather than executing it.

`groupBy` returns a small builder with an `aggregate` method, not a materialized dataset. Aggregation then returns another Table, which can be joined, filtered or aggregated again. Northwind's average-units query needs exactly this composition: detail totals per order -> left join all orders -> average totals.

## An Expr belongs to a relation scope

Each Table exposes its available fields through `columns` and typed `col(name)`. Internally each relation has a symbol identity; a column resolves to a positional Substrait field only within its valid scope. This allows named application code without letting a stale column silently refer to a different positional field after projection.

Join predicates receive distinct left/right occurrences, including for self-joins. Join outputs receive fresh scopes, with nullable right-side fields for a left join. A predicate expression cannot escape into output selection with incorrect non-nullability.

The catalog is a logical schema, not a live database connection. One query can be compiled for several compatible backends. Separate `createSource` calls have separate identities; cross-source joins are explicitly rejected. That avoids implying federation which the prototype does not implement.

## Expr and Measure are different

Scalar expressions describe values within a row; Measures describe aggregates across rows. `select` accepts Expr values and `aggregate` accepts Measure values. After aggregation, use `result.columns.alias` to reference the resulting column and perform further scalar arithmetic.

These boundaries prevent accidentally flattening nested operations. TypeScript catches some misuse; runtime checks and compiler validation catch others. Literal catalog types propagate through transformations into result-row inference. Dynamic catalogs lose static precision; relation identity still requires runtime checks.

## Substrait is the interchange contract

Builders create generated Substrait relation structures directly; there is no separately serialized proprietary Table AST. Export adds version, root names and function declarations, then normalizes and validates the supported JSON representation. Binary serialization is optional; the ordinary driver passes JSON plans directly to compilation.

Official v0.63.0 protobuf schemas define the available structures. The project supports a restricted subset, and its function library is application-defined using Substrait's extension mechanism. The standard alone does not guarantee that another engine accepts these functions or exact semantics. See the [profile and provenance](../SUBSTRAIT-PROFILE.md).

## SQL lowering must preserve boundaries

An arbitrary relational composition is not one SQL SELECT block. For example, grouping detail rows before averaging order totals requires a derived query. Ranking orders and then filtering their ranks also requires an outer query. The compiler is responsible for those boundaries, explicit NULL ordering and supported numerical semantics.

Kysely supplies construction, quoting, parameters and execution infrastructure. It does not decide our relational meaning or ensure identical decimal behavior across engines. DuckDB's bounded exact decimal division is one example of work the backend/compiler must still supply.

The application facade returns inferred rows from `execute` and SQL/parameters from `compile`; the lower-level backend module exposes Kysely connections. A fully backend-independent execution service and native non-SQL targets remain future work.

## Current tradeoffs

Two compiler visitors remain: the original restricted field-only path and the analytical path used by public API queries. Function declarations currently select the latter, including for queries that use no functions. Removing declarations alone breaks some valid compositions such as nested limits.

This is known coupling, not a recommended long-term design. [Issue #7](https://github.com/poweihuang0817/GoldenAnalytics/issues/7) and [PR #11](https://github.com/poweihuang0817/GoldenAnalytics/pull/11) record compatibility differences and the comparison work needed before consolidation. Neither arbitrary Substrait support nor a general optimizer/capability framework is claimed.

Production identity, authorization, cancellation, normalized errors and observability are separate boundaries in the [future plan](../FUTURE-WORK.md). They are not implicitly provided by a typed query builder or a trusted catalog.
