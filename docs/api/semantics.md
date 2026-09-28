# Query semantics and limitations

[API guide](README.md)

## NULLs, duplicates and aggregation

- Filters retain only true predicates; false and NULL both discard the row.
- Equality with NULL does not mean `IS NULL`. Use `isNull()` or `isNotNull()`.
- `and` follows SQL three-valued logic; `caseWhen` selects its else branch for false or NULL.
- A left join preserves unmatched left rows and makes right output fields nullable. An inner join drops unmatched rows.
- Projection and joins preserve duplicate rows according to ordinary SQL bag semantics. No implicit DISTINCT is added.
- `count()` counts rows and `expr.count()` counts non-null values. Counts return zero on an empty global input.
- `sum`, `avg` and percentile ignore NULL input values and yield NULL when there are no non-null inputs. An empty grouped input produces no groups; an empty global aggregate produces one row.
- Group keys are included in aggregate outputs. A NULL grouping key forms a group rather than being discarded.

## Numbers and result representations

| Kind | Contract |
| --- | --- |
| i32 | JavaScript number; integer literals have signed 32-bit bounds |
| i64 | Counts/ranks return strings to avoid JavaScript precision loss |
| fp64 | JavaScript number; approximate arithmetic, not exact monetary math |
| decimal | Fixed decimal(38,10), returned as a string; bounded precision and overflow behavior |
| date | Calendar-date string, not a JavaScript Date instant |
| string | String value; comparisons remain subject to supported backend behavior |
| bool | Boolean logical expression; a universal PG/MySQL driver-result conversion is not implemented |

Nullable output fields may return null. Numeric literals default to fp64; `integer()` explicitly selects i32. Decimal/fp64 mixing fails rather than silently dropping precision. Non-decimal sum/average/arithmetic return fp64. Division by zero returns NULL.

Decimal strings are not automatically converted to JavaScript numbers. Tests compare exact representations where promised and use tolerance only for declared fp64 results. DuckDB exact decimal division uses bounded HUGEINT intermediates, and exact decimal AVG is rejected. See [DuckDB precision limits](../DUCKDB.md).

## Continuous percentile

For sorted non-null values x[0] ... x[n-1] and fraction p, the position is `(n - 1) * p`. An integer position selects that value; otherwise the result linearly interpolates between the adjacent values. Ties remain in the input. This defines a continuous percentile, not a sampling/sketch approximation.

The implementation's fixed decimal scale and backend overflow limits still apply. Fractions must be finite in [0,1], with at most ten fractional places for decimal inputs. Percentile must be the sole measure in its aggregate. There is no distinct/discrete percentile option.

## Ordering and windows

There is no guaranteed result ordering without `orderBy`. Defaults are ascending with NULLs last. Specify tie-breakers for deterministic pagination or row numbering. For recent Northwind orders, use descending order date followed by descending order ID.

Window ordering determines ranks, not final output ordering. Apply `orderBy` afterward when ordering returned rows matters. NULL partition keys belong to the same partition. Rank filtering occurs after the window computation; moving that filter below ranking changes its meaning.

The analytical compiler currently requires projections after sorting to preserve sorting fields. Unsupported compositions fail explicitly instead of silently dropping the ordering.

## Scope of portability

The supported profile is not arbitrary SQL or arbitrary Substrait. There is no general cast, decimal/date/null literal API, timestamp support, union, distinct, correlated subquery API, general window frame/function API or cross-source join. Column references are flat fields. Collation/Unicode/timezone compatibility beyond tested behavior is not promised.

The public fluent API has no raw-SQL escape hatch. The exposed Kysely connection is lower-level infrastructure and should be kept behind trusted application code. Catalog validation and bound values do not enforce data access policy. See [failure boundaries](execution.md#failure-boundaries).
