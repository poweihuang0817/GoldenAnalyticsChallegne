# Node-first typed PRQL frontend experiment

Research only; no replacement of Golden's API. This tests the user's requirement for schema-aware TypeScript while reusing PRQL rather than adopting untyped source strings as the application interface.

## Executed slice

Run after installing root and spike dependencies:

```sh
npx tsc --project spikes/prql/tsconfig.json
npx tsx spikes/prql/typed-source.ts
```

[typed-source.ts](typed-source.ts) contains a deliberately local, non-exported source generator and tests; [results](typed-source-results.json) preserve six executions/expected rejections. It does not define a serialized custom IR, add dependencies, or change production code. Predicate closures generate a tiny PRQL subset with separately collected parameters.

```ts
const customers = table('customers', {customer_id: 'text', city: 'text'});
const query = customers
  .filter(customers.cols.city.eq('London'))
  .select({id: customers.cols.customer_id});
```

TypeScript verifies unknown-column, wrong-literal-type and projected-output negative cases using `@ts-expect-error`. Projection infers `{id: string}`. Runtime checks reject columns/predicates from a different relation, a malformed identifier, and a type-check bypass using the wrong literal type. Fixed identifiers use a deliberately narrow whitelist; this is not a general identifier-quoting solution or comprehensive PRQL reserved-word policy.

The exact same generated source executes on PostgreSQL and a private in-memory DuckDB snapshot for London and an injection-shaped string. Results match independent fixed SQL with separately bound values. MySQL produces the specifically asserted `$1` missing-column error on both cases; an arbitrary database error does not count as the expected rejection. All connections close; PostgreSQL/MySQL source data is read-only. DuckDB is seeded privately using the existing helper.

The prototype's `rowType` is a compile-time expectation, not a decoder or an executed result value. The test never executes its type-only assertions. Only returned customer IDs are checked as strings. The miniature schema has no nullability descriptor: it must not be used to claim nullable city projections are safe. No i64/decimal/result-normalization guarantee is established.

**Evidence:** typecheck passed; four successful bound executions (two each on PG/DuckDB) and two expected MySQL binding rejections. Node 24.19.0, prqlc 0.13.14. This is feasibility evidence for filter/projection only, not a green adoption gate for all three backends.

## What remains expensive

| Boundary | This slice proves | Not established |
| --- | --- | --- |
| TypeScript expressions | Schema keys, literal types, projection output | Nullable expressions, numeric promotion, dates, aggregate typing |
| Relation identity | Runtime rejection of cross-relation mixing | Joins, aliases/self-joins, derived scopes, correlated references |
| Composition | Immutable filter chain and final projection | Projection followed by more typed transformations, grouping/window scopes |
| Source generation | Narrow identifiers, no user values embedded in source | General identifiers, nested queries, full source-location mapping |
| Execution | Bound PG/DuckDB string queries | MySQL adaptation; public client errors, timeout/cancellation integration |
| Result typing | Simple string identifier results | Runtime i64/decimal/NULL representation and metadata-driven decoding |

This is not evidence that the entire frontend costs only a few dozen lines. The omitted boundaries contain much of the existing API's value. Keeping TypeScript type inference remains Golden-owned regardless of whether source generation is replaced by PL construction.

## Relevant upstream prior art

[PRQL issue #5699](https://github.com/PRQL/prql/issues/5699) asks almost exactly this question: a schema-aware TypeScript relational builder aligned with PRQL semantics. The discussion includes:

- NickCrews's [Tybis](https://github.com/NickCrews/tybis), which describes itself as very experimental and unsuitable to rely on. It is useful API/type-design reference, not a selected dependency. Its README also points to Teta; repository activity alone does not prove production readiness.
- A collaborator's report of an unreleased TypeScript builder using PL construction and PL-to-source/SQL conversion. This is reported experience, not publicly verified code.
- CLI generation of PL JSON Schema (`prqlc debug json-schema --ir-type pl`) as a possible way to generate TS interfaces. Those interfaces describe compiler nodes; they do not automatically infer database schema through a user-facing builder. The comment explicitly notes PL changes and limited documentation.

[Teta](https://github.com/futu2/teta) is another TypeScript relational/SQL EDSL reference with typed schema propagation and its own SQL rendering. Its documented main API uses callbacks. It is not evidence of an official PRQL typed SDK or a drop-in callback-free solution; no dependency adoption or test of Teta was performed here.

## MySQL binding: scope of the missing adapter

The pinned JS [binding implementation](https://github.com/PRQL/prql/blob/0.13.14/prqlc/bindings/js/src/lib.rs) returns SQL strings; its exposed compile options do not provide a parameter-emission callback or final binding map. The [follow-up](FOLLOWUP.md) traces parameter rendering to gen_expr.rs. A correct repair must preserve the correspondence between each final placeholder and its source parameter, including repetitions and compiler-introduced query restructuring.

Prefer evaluating an upstream compiler change that returns a dialect-correct SQL/binding contract. A fork would add a Rust/WASM build-and-release maintenance obligation even though consumers still install npm. A SQL-aware adapter is another option but also adds parser/round-trip conformance work. We cannot honestly estimate this as a simple string replacement. Neither repair is implemented in this spike.

## Updated Node-first recommendation

PRQL can sit below a typed callback-free TypeScript API; that is now demonstrated for a small executable slice. It does **not** supply the type-level frontend for us. Before migration, prove one typed join + aggregate + projected result path with NULL handling and resolve MySQL binding. Then measure the compiler code removed against the new frontend/adaptation work.

The current TypeScript/Substrait/Kysely path remains the stronger verified delivery path. Its custom function contracts still warrant improvement; that does not imply the competing path is already ready. No new runtime service, native binding, custom serialized IR or automatic multi-compiler fallback is proposed here.
