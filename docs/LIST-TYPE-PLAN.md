# Proposal: list columns for PostgreSQL and CSV

Status: PROPOSAL, not an accepted decision and not implemented. Written October 21, 2026.

## Goal

Let a query filter and count on the individual items of a multi-valued column, for example a product's tags. Two sources:

- PostgreSQL, which has a native array type.
- A CSV file where the items are packed into one text field, such as `"A,B,C"`.

The first operations are: keep rows whose list contains a value, count a row's items, and filter on that count. Grouping by individual item ("orders per tag") is a later phase because it needs row expansion.

## Findings

PostgreSQL has native arrays of any element type (`text[]`, `integer[]`). Behavior verified on the challenge image (PostgreSQL 17.10):

| Expression | Result |
|---|---|
| `string_to_array('', ',')` | `{}` (empty list) |
| `string_to_array(NULL, ',')` | `NULL` |
| `string_to_array('A,,B', ',')` | `{A,"",B}` |
| `string_to_array('A, B', ',')` | `{A," B"}`, no trimming |
| `cardinality('{}'::text[])` | `0` |
| `array_length('{}'::text[], 1)` | `NULL`, a trap for item counts |
| `ARRAY['A',NULL] @> ARRAY['A']` | `true` |
| `ARRAY[NULL]::text[] @> ARRAY[NULL]::text[]` | `false` |
| `NULL = ANY(ARRAY['A'])` | `NULL` |
| `cardinality(ARRAY['A','A'])` | `2`, duplicates count |

DuckDB (the repository's local backend, and the natural CSV reader) differs on one key case:

| Expression | Result |
|---|---|
| `string_split('', ',')` | `['']`, one empty item, not an empty list |
| `string_split(NULL, ',')` | `NULL` |
| `string_split('A,,B', ',')` | `[A, '', B]` |
| `list_contains(['A', NULL], 'A')` | `true` |
| `list_contains(['A'], NULL)` | `NULL` |

Index use on PostgreSQL, checked with `EXPLAIN` on a 200,000-row table with a GIN index on the array column:

- `tags @> ARRAY['tag3']` uses the GIN index (bitmap index scan).
- `'tag3' = ANY(tags)` scans the whole table.

Substrait v0.63.0 (the pinned version) has a `List` type, `ListElement` references and list literals. It has no unnest relation. The current Golden profile accepts only scalar types: `src/plan.ts` rejects `list`, and `Catalog` in `src/compiler.ts` allows only scalar kinds.

MySQL has no array type. Its closest equivalent is a JSON array with `MEMBER OF` and multi-valued indexes, which is a different design and is out of scope here.

## Proposed design

### One logical type, several physical encodings

The API and the Substrait plan see one logical type, `list<T>`, whatever the storage. How a list is stored is a property of the source, not of the query:

| Source | Physical storage | How the compiler reads it as `list<string>` |
|---|---|---|
| PostgreSQL native | `text[]` | the column itself |
| PostgreSQL text column | `'A,B,C'` | `split(col, ',')` written in the query |
| CSV through DuckDB | `'A,B,C'` | `split(col, ',')` written in the query |

Phase 1 keeps parsing explicit. A delimited text column stays a `string` in the catalog, and the query calls `split` on it. This keeps the catalog scalar for CSV, makes the parsing visible in the plan, and avoids a hidden per-column parser that each backend must reproduce. Declaring the encoding in the catalog, so a delimited column reads as `list<string>` directly, is a later convenience.

### Typed API

```ts
// Catalog: native PostgreSQL array column.
{ name: 'tags', type: { list: 'string', elementNullable: false }, nullable: true }

// Queries.
products.filter(p => p.col('tags').contains('organic'));
products.filter(p => p.col('tags').length().greaterThan(2));
csvProducts.filter(p => p.col('tags_text').split(',').contains('organic'));
```

`Kind` is currently a string union. A list needs a structured kind with an element kind and element nullability. Methods are constrained by receiver type, as `lower` is today: `contains` and `length` exist only on `Expr<list<T>>`, and `split` only on `Expr<'string'>`. `contains` takes an argument of the element type, checked at compile time and validated again at run time.

### Substrait profile

- Types: allow `list` with one nested element type, restricted to the scalar kinds the profile already supports. No nested lists.
- Functions, added to `spec/golden-functions.yaml`:
  - `split(string, string) -> list<string>`
  - `list_contains(list<any1>, any1) -> boolean`
  - `list_length(list<any1>) -> i64`
- Literals: a list literal only where a function argument needs one. Phase 1 needs none.

These stay application-defined extension functions, as the existing ones are. The plan does not claim they match an upstream Substrait function library.

### Lowering

| Logical | PostgreSQL | DuckDB |
|---|---|---|
| `list_contains(col, $v)` | `col @> ARRAY[$v]::text[]` | `list_contains(col, $v)` |
| `list_length(col)` | `cardinality(col)` | `len(col)` |
| `split(s, ',')` | `string_to_array(s, ',')` | `string_split(s, ',')` with the empty-string rule below |

PostgreSQL uses `@>` rather than `= ANY`, so an existing GIN index applies. The parameter needs an explicit array cast so PostgreSQL can infer its type. MySQL rejects every list operation through the capability mechanism with `UNSUPPORTED_CAPABILITY`.

### Semantics contract

Each rule needs a test that runs on both backends against an independent expected result:

| Case | Rule |
|---|---|
| NULL list | `contains` and `length` return NULL. A filter drops the row. |
| Empty list | `length` is 0. `contains` is false. |
| Empty string through `split` | Empty list on every backend. DuckDB is normalized to match PostgreSQL (for example `CASE WHEN s = '' THEN [] ELSE string_split(s, ',') END`). |
| Consecutive separators `A,,B` | Three items, one of them the empty string. No silent dropping. |
| Whitespace `A, B` | Not trimmed. Trimming is a separate, explicit function if it is needed. |
| Duplicates `A,A` | `length` is 2. A distinct count is a separate function. |
| NULL item inside a list | `contains` of a non-null value ignores it. `contains(NULL)` is rejected at compile time rather than mapped to backend-specific behavior. |
| Case | Item comparison is exact and case-sensitive, like `equal` today. |
| Separator | One fixed literal character, bound as a parameter. No regular expressions, no quoting or escaping inside a field. |

### CSV source

The CSV path runs on DuckDB, which already exists in the repository. This adds no new engine and does not affect remote execution for PostgreSQL and MySQL.

- **Format.** A CSV field that contains the item separator must be quoted (`"A,B,C"`) or use a different item separator such as `|`. The plan recommends `|` for the example file so the field separator and the item separator never collide.
- **Read once.** Load the file into a DuckDB table with explicit column types, the same way `duckdb-seed.ts` loads the snapshot. A DuckDB view over `read_csv(...)` is possible but re-reads and re-parses the file on every query.
- **Typing.** Declare the column types explicitly rather than relying on type sniffing, so the catalog matches the data.

## Performance and size

| Concern | PostgreSQL native array | Delimited text, parsed per query | CSV in DuckDB |
|---|---|---|---|
| Parse cost | none at query time | `string_to_array` on every row, every query | `string_split` on every row, vectorized |
| Index for `contains` | GIN on the column, with `@>` | only an expression index on exactly `string_to_array(col, ',')` | none needed; columnar scan |
| `length` | reads the array header | parses the whole string | parses the whole string |
| Storage | about 24 bytes of header plus each item; values over about 2 KB are compressed or moved out of line (TOAST) | one string; smaller for short items | compressed columnar table |
| Row expansion (phase 2) | `unnest` multiplies rows by list length | same, after parsing | same, after parsing |

Consequences for the design:

- Item counts and filters run in the database. The API should not fetch raw lists to Node and process them there. That would also break the challenge rule that PostgreSQL and MySQL execute analytical work remotely.
- Result size: returning a list column sends every item. The PostgreSQL driver turns `text[]` into a JavaScript array, so a query that only needs a count should select `length`, not the list.
- Lists stored as text pay the parsing cost on every query. For repeated BI queries, converting them once into a native array (PostgreSQL) or a typed table (DuckDB) is the main speedup, more than any query-level tuning.
- Grouping by item expands rows. Ten million orders with an average of five tags become fifty million rows before aggregation. Phase 2 must aggregate in the database and should warn or require explicit opt-in for wide expansion.
- Compile time is unaffected: the new types and functions add constant work per expression.

## Phases

1. **Types and validation.** Add `list<T>` to `Catalog`, the typed API, `src/plan.ts` validation and the function YAML. Compile-time positive and negative tests. No lowering yet.
2. **PostgreSQL native.** `list_contains` and `list_length` on a native array column. Needs a fixture table with a `text[]` column, because Northwind has no array column.
3. **`split` and the CSV path.** `split` on PostgreSQL and DuckDB with the empty-string rule. A small CSV fixture loaded into DuckDB with explicit types.
4. **Cross-backend semantics tests.** Every row of the semantics contract on PostgreSQL native, PostgreSQL text and DuckDB CSV, compared with independently written expected results.
5. **Later: grouping by item.** Needs row expansion that Substrait v0.63.0 cannot express. Options are an `ExtensionSingleRel` defined by Golden or a newer Substrait version. Either needs an explicit architecture decision first.

## Compared with the earlier six-step outline

The six-step outline pasted from the Codex session is broadly compatible. This plan narrows it:

- Phase 1 does not need unnest. Containment, length and filtering are scalar functions. Item expansion is deferred, not built first.
- Parsing is an explicit `split` call, not something CSV import does implicitly. The empty-string difference between PostgreSQL and DuckDB is why the contract has to be explicit.
- CSV staging goes through the existing DuckDB backend, not a new importer into PostgreSQL.

## Out of scope

- MySQL JSON arrays, BigQuery `ARRAY<T>` (open PR #64 adds a BigQuery backend) and other backends. They are rejected until verified.
- Nested lists, lists of decimals or dates, structs and maps.
- Writing or updating list columns.
- Quoting or escaping inside a delimited field.

## Open questions

- Should the catalog eventually declare a delimited encoding, so a text column reads as `list<string>` without `split`? It is convenient for users but hides parsing in the catalog.
- Is the example CSV's item separator `,` (needs quoting) or `|`?
- Is a list of numbers needed in the first version, or are string items enough?
