# API philosophy and expression-style review

Status: research conclusion for user review, not implemented API. Read alongside [the typed API plan](TYPED-RELATIONAL-API-PLAN.md). Retaining Substrait is confirmed; exact public syntax remains proposed.

## Principles

- Application code describes relational computation. Database I/O occurs through client.execute; client.compile remains an optional SQL preview.
- Substrait is the canonical supported relational IR. A future semantic frontend resolves metrics, dimensions, relationships and grain above it. It is not necessary to route that frontend through the TypeScript facade.
- Prefer readable typed predicate expressions and named projection objects. The user finds callbacks difficult to read; callbacks should be compatibility/convenience options, not the only way to express a query.
- Infer types from one catalog definition. Logical kind, nullability, expression category and result encoding are distinct. Runtime validation remains necessary.
- Preserve relation order: filter after limit or aggregate applies to that result. Do not turn every filter into an earlier SQL WHERE.
- Reuse one expression/lowering implementation. Do not add a second serialized predicate AST, broad raw SQL API, or translate Kysely/Drizzle internal nodes into Substrait.

## What to learn from each reference

| Reference | Useful design | What not to assume/import |
| --- | --- | --- |
| Kysely | Schema-aware references, value compatibility and result inference | SQL builder structure is not required for Golden; types do not prove backend semantics |
| Drizzle | Column objects, standalone predicate operators and named selection objects | Its SQL expression implementation and dialect schema builders are not Golden's IR |
| Polars | Composable lazy expressions and explicit relational stages | Schema checking before data processing is not host-language compile-time field checking; do not import aggregate broadcasting semantics |
| pandas | Familiar analysis vocabulary | Index alignment and eager masks are not a natural foundation for remote relational compilation |

Official references: [Kysely complex predicates](https://kysely.dev/docs/examples/where/complex-where-clause), [Drizzle selection](https://orm.drizzle.team/docs/select), [Drizzle joins](https://orm.drizzle.team/docs/joins), [Polars expressions](https://docs.pola.rs/user-guide/concepts/expressions-and-contexts/), [Polars schema checks](https://docs.pola.rs/user-guide/lazy/schemas/), [pandas indexing](https://pandas.pydata.org/docs/user_guide/indexing.html).

## Recommended primary style

Prefer Drizzle-inspired typed predicate helpers and projection objects, with Kysely as a type-experience reference. Learn expression composition from Polars without adopting its execution engine. This is a recommendation responding to the user's readability preference, not a decision to add dependencies.

Proposed syntax only:

```ts
const customers = source.table('customers');
const c = customers.columns;
const predicate = and(eq(lower(c.city), 'london'), eq(c.country, 'UK'));
const filtered = customers.filter(predicate);
const projection = {
  customerId: filtered.columns.customer_id,
  city: filtered.columns.city,
};
const query = filtered.select(projection);
const { rows } = await client.execute(query);
```

Projection keys define the output schema. Use columns from the current relation; these are descriptions, not row values. Helpers such as eq/lower/and should delegate to existing supported functions. Do not expose unsupported OR/IN/LIKE merely because a reference library supports them.

A Polars-inspired alternative uses method chains such as c.city.lower().eq('london').and(c.country.eq('UK')). It is concise for sequential transformations, but long boolean chains are less scan-friendly for this user's preference. Existing expression methods can remain for compatibility; new docs should pick one primary style rather than presenting many equivalent spellings.

Kysely-style filter('city', '=', 'London') remains a possible later shortcut. It is no longer the recommended primary interface. Plain nested filter objects such as { city: { eq: 'London' } } are another possible frontend, but calculations and column-to-column comparisons require additional conventions. Do not introduce that separate DSL now.

## Aggregation and join boundaries

An aggregate result exposes only grouping keys and named measures. Tests must reject references to removed input fields. Keep scalar Expr and aggregate Measure distinct; do not borrow Polars scalar broadcasting into Golden select.

Callback-free joins need a separate reviewed design. A candidate is join(right, { how, on: predicate }) followed by explicit output selection from joined.left / joined.right; right outputs of a left join must become nullable. Aliases must distinguish self-join occurrences. These are API namespaces, not a promise of nested Substrait fields. Preserve rejection of captured predicate expressions in output scopes. The existing typed callback join is the safe first increment; do not rebuild join lowering before submission.

TypeScript cannot automatically assign a fresh nominal type to every runtime relation instance. Static schema checks must be complemented by runtime scope checks. Imported plans/dynamic schemas cannot honestly promise statically inferred fields. Boolean result normalization and exact numeric representations must be tested rather than asserted by casts.

## Review completion criteria

- Agree on typed predicate/projection as the primary style, or explicitly choose the chain alternative.
- Review one filter/projection example and one aggregate example against actual schema types.
- Keep left-join scope/nullability and callback-free joins explicit as separate work.
- No additional library survey is needed before submission unless it resolves a concrete blocker.
- Implement only after plan review, with characterization tests first and compile-time positive/negative cases alongside the type implementation.
