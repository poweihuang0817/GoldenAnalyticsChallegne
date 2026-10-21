# Typed arrays: PostgreSQL and CSV

Status: **PROPOSAL — for review, not implemented or accepted.**

## Goal

Represent a homogeneous array in the typed API, expand its elements into rows,
and reuse existing filtering and aggregation. Start with PostgreSQL native arrays
and a CSV example whose array field contains `A,B,C`.

The initial delimiter is a fixed comma. Parsing and splitting are adapter details:
do not introduce a public `split()` method, parser options, or delimiter configuration.
Users declare the logical column type and query its elements.

## Logical type and physical representation

PostgreSQL 17 supports native arrays such as `text[]` and `integer[]`.
Use native arrays there; do not serialize them to strings as a fallback.

| Source | Physical value | Logical value |
| --- | --- | --- |
| PostgreSQL `text[]` | `ARRAY['A','B','C']` | Array of strings |
| CSV field | `"A,B,C"` | Array of strings after adapter decoding |

CSV is a storage format, not an execution engine. For this first implementation,
import it through a PostgreSQL staging table. PostgreSQL performs the item-level
analytical operations. A standalone file query engine is outside this proposal.

Proposed catalog syntax (illustrative):

```ts
{
  name: 'tags',
  type: {
    kind: 'array',
    element: { type: 'string', nullable: false },
  },
  nullable: true,
}
```

Array nullability and element nullability are separate. The type model should
support `Array<T>` for supported scalar T, while the first end-to-end checkpoint
only promises string elements. Other element types require verified conversion,
binding and result decoding; an annotation is not a runtime conversion.

Initially support one-dimensional arrays only. PostgreSQL declarations do not
enforce dimensions; reject unsupported dimensions at ingestion/read validation
rather than silently flattening them. Preserve duplicates and element values.
Arbitrary PostgreSQL lower bounds and multidimensional arrays are future work.

## Application-facing operations

Proposed API, not existing code:

```ts
const documents = source.table('documents');
const items = documents.unnest({
  column: documents.columns.tags,
  as: 'tag',
});

const matching = items.filter(items.columns.tag.eq('B'));
const query = matching.aggregate({ matching_items: count() });
```

`unnest` produces one row per element, retains parent fields, and adds the typed
element column. Reject an output name that conflicts with an existing field.
For a string array, `tag` is a string expression and supports existing string
operations. Invalid operations and comparisons must fail both type checks and
runtime validation. Parent rows with empty or NULL arrays produce no item rows.

`count()` counts expanded rows, including duplicates and NULL elements if they
have not been filtered out. Existing `Expr.count()` continues to count non-NULL
values across rows; it must not change meaning for array columns.

An optional later `tags.length()` would count elements within one array, including
NULL elements. It is not necessary for the initial filter-and-count checkpoint.
Reconstructing a filtered array and exposing element positions are also deferred.
No output row ordering is promised without an explicit sort.

## CSV example and adapter boundary

```csv
id,tags
1,"A,B,C"
2,"B,B"
3,""
```

The CSV reader first handles file-level quoting. It then provides `A,B,C` as the
field value. For a declared array column, the adapter splits on the fixed comma
and validates the element type. The application sees the same typed relation as
the native PostgreSQL table and uses the same query above. No parsing operation
appears in the public query.

For this PostgreSQL-backed CSV demo, load a staging text column, then populate a
typed array column with `string_to_array(tags, ',')`. Treat an empty CSV array field
as an empty array, not NULL. Configure the CSV importer accordingly; do not rely
on implicit COPY NULL defaults. A CSV spelling for NULL arrays is deferred.

This simple inner encoding does not support commas embedded in an element or
nested quoting/escaping. It is not a second full CSV grammar. Do not claim those
inputs are supported; document this restriction on the import format. CSV file
quoting itself still requires a proper CSV reader or PostgreSQL COPY CSV support.

Do not automatically trim whitespace, deduplicate, infer numeric types, or treat
the string `NULL` as a NULL element. Richer encodings are future adapter work.

## PostgreSQL lowering

The native-array query can lower to:

```sql
SELECT count(*) AS matching_items
FROM documents AS d
CROSS JOIN LATERAL unnest(d.tags) AS item(tag)
WHERE item.tag = $1;
```

Bind `B` as a parameter. Preserve Golden's existing i64 count result contract
(string representation); the SQL above illustrates the relational structure and
omits the final result conversion.

The compiler must understand the expanded relation's field scope and cardinality.
Kysely constructs SQL below that boundary; adding a TypeScript array type alone
does not implement these semantics.

Retain Substrait as the relational contract. Map arrays to its list type and
verify the pinned version's expansion representation before implementation.
Do not invent a second IR or promise unverified standard operator compatibility.
Add the chosen operations explicitly to the supported profile and capability
checks. Other backends fail closed until their array behavior is implemented.

## Required semantics and tests

| Input | Expected behavior |
| --- | --- |
| `A,B,C` | Three string elements |
| `B,B` | Two matching elements for predicate `B` |
| Empty CSV array field | Empty array, zero expanded rows |
| `A,,C` | Empty middle string preserved |
| ` A,B ` | Whitespace preserved |
| Native NULL array | Zero expanded rows |
| Native array with NULL element | Expansion preserves NULL; equality filter discards it |
| Incompatible element type | Explicit rejection, not silent coercion or dropped data |
| Multidimensional native array | Explicit rejection in initial profile |

Tests must cover type propagation and negative cases, runtime catalog/profile
validation, expansion scope and parent-field preservation, parameter ordering,
count result representation, NULLs, empties, duplicates and CSV quoting.

Use independently hand-calculated expected values, not only two implementations
agreeing. Both native-array and imported-CSV fixtures above must return **3** for
the number of items equal to `B`, and **5** for total expanded items. Counting
matching parent documents would return **2** and is a different query.

## Implementation order

1. Review and accept this contract and proposed public API.
2. Verify pinned Substrait list/expansion support; add profile and type tests.
3. Implement native PostgreSQL string-array reads and expansion, with filter/count.
4. Implement the fixed-comma CSV import adapter into PostgreSQL.
5. Run the same query and independent expected-result tests on both paths.
6. Extend element types/backends only with explicit semantics and conformance tests.

No implementation, dependency change, or database mutation is part of this plan PR.

## References

- [PostgreSQL 17 arrays and dimension constraints](https://www.postgresql.org/docs/17/arrays.html)
- [Array functions: unnest and cardinality](https://www.postgresql.org/docs/17/functions-array.html)
- [String functions: string_to_array](https://www.postgresql.org/docs/17/functions-string.html)
- [COPY CSV quoting and NULL handling](https://www.postgresql.org/docs/17/sql-copy.html)
