# Typed relational API implementation

Status: implemented after the user approved one typed, callback-free API on September 28, 2026. This supersedes PR #19's proposed callback compatibility and deferred callback-free joins. Substrait remains the canonical relational IR; Kysely remains the SQL construction layer.

## Public contract

Start with a literal catalog (`as const satisfies Catalog`, or an inline catalog passed to `createSource`). `table.columns` exposes typed expressions; `table.col(name)` provides checked name access. Use predicate expressions and named projection/measure objects:

```ts
const customers = source.table('customers');
const london = customers.filter(customers.columns.city.lower().eq('london'));
const query = london.select({ customer: london.columns.customer_id, city: london.columns.city });
const { rows } = await client.execute(query);
const preview = client.compile(query); // optional SQL inspection, no database I/O
```

Every transformation creates a new relation scope. Use the resulting table's columns in the next operation. TypeScript checks names, logical kinds, scalar/measure categories and nullability; runtime scope checks enforce relation identity. Neither construction nor predicates execute database queries.

`select`, `filter`, `aggregate` and joins have no callback overloads. Existing callers, the driver and API documentation use the same interface. Helpers can return expressions, but the caller invokes the helper before passing its result to the API.

## Joins

A staged join exposes separate input and output namespaces, including for self-joins:

```ts
const join = employees.join(orders, { how: 'left' });
const matched = join.on(join.left.employee_id.eq(join.right.employee_id));
const query = matched.select({
  employee: matched.left.employee_id,
  order: matched.right.order_id,
});
```

`join.left/right` belong to the predicate inputs. `matched.left/right` belong to the joined result, with right fields nullable for a left join. Predicate references cannot be reused in the output projection. These namespaces are expression scopes, not nested result objects. Lowering still uses the existing Substrait join/project relations.

## Inference and limits

- Projection keys become the output schema; removed fields disappear.
- Aggregation exposes only grouping keys and measure aliases. Alias/key collisions fail.
- Count and row number are required i64; sum/avg/percentile are nullable. Division remains nullable. General filters do not refine nullability.
- Output aliases and window names must be known literal names. Union table/grouping/window names must be narrowed before construction, rather than incorrectly promising all possible fields. Grouping arrays must be fixed tuples.
- A catalog widened to `Catalog` intentionally loses precise names/kinds. Runtime validation remains necessary; static typing does not discover or verify a remote schema.
- Primitive comparison shorthands follow actual runtime coercions: i32/fp64 numbers, strings and booleans. i64/decimal equality requires a matching expression; i64 `lte(number)` is the existing i32-range convenience. Decimal `lte` requires a decimal expression. Decimal arithmetic/coalesce number shorthands must be signed i32 integers.
- Unsupported functions, casts and backend capabilities continue to fail explicitly. This is not a general SQL/ORM API.

`client.execute` infers the row shape while preserving `{ rows }`. Driver representations are deliberately conservative:

| Logical kind | TypeScript result |
| --- | --- |
| i32 | `number \| string` (computed MySQL i32 can be BIGINT strings) |
| fp64 | `number` |
| i64 / decimal / date / string | `string` |
| bool | `boolean \| number` |

Nullable expressions add `null`. No result normalization, precision-losing conversion or caller-supplied result assertion is introduced. Unknown `Query` objects return unknown fields.

## Implementation and verification

`src/api.ts` contains one runtime builder and its generic public type surface. Factory assertions connect runtime schema facts to TypeScript; they are not an independent compiler or a result conversion. `src/client.ts` propagates inferred rows. `src/challenge.ts` retains literal catalog types. The compiler, profile and generated Substrait schemas remain unchanged.

PR #21 established behavior first. `test/api-types.ts` is compiled by `npm run check` and includes positive inferred-type assertions and negative `@ts-expect-error` cases. Existing runtime and cross-backend tests retain their independent expected results. The union-name finding was reproduced with failing type tests before restricting those names.

Validation commands: `npm run check`, `npm run check:docs`, `npm test`, `npm run test:integration`, `npm run test:duckdb`, `npm run docs:examples -- --execute`, and the documented driver commands. See [API docs](api/README.md) and [coverage](API-TEST-COVERAGE.md).

## Deferred

Schema discovery/code generation, semantic metrics, federation, DataFusion/Rust, general optimization, advanced filter nullability refinement, broad capability/auth/error frameworks, dynamic output-name inference, and tuple filter shortcuts remain future work. None requires removing Substrait or replacing the existing compiler for this change.
