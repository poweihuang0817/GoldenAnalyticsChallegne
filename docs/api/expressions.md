# Expression and aggregate reference

[API guide](README.md)

## Expressions and aggregation

`Columns.col(name: string): Expr` resolves a field in the current callback. Unless otherwise stated, the methods below return `Expr`.

An Expr exposes readonly `kind` and `nullable` metadata. A Measure exposes readonly `name`, `args`, `kind` and `nullable`; use these as descriptions rather than changing nested input structures. Construct values with the documented helpers/methods; the exported constructors and expression resolver are implementation plumbing.

| Method | Arguments / contract |
| --- | --- |
| `eq(value)` | `Expr` or string/number/boolean shorthand; resulting operand kinds must match. SQL NULL comparison semantics apply; use `isNull()` for NULL checks. |
| `lte(value)` | Numeric `Expr` or number; matching kinds or mixed i32/i64 widths. Useful for filtering row numbers. For an i64 receiver, number shorthand constructs an i32 literal. |
| `lower()` | String input; returns a lowercase string expression. |
| `isNull()`, `isNotNull()` | Any supported kind; return a non-null boolean expression. |
| `and(other)` | Another boolean `Expr`; follows SQL three-valued logic. |
| `coalesce(value)` | Same-kind expression or supported shorthand; also accepts i32 as fallback for decimal. Returns the first non-null operand. |
| `mul(value)`, `sub(value)`, `div(value)` | Numeric `Expr` or number. Decimal mixed with fp64 is rejected. Non-decimal result kind is fp64; decimal input produces decimal. Zero divisor yields NULL. |
| `sum()`, `avg()` | Numeric input; return `Measure`, ignoring NULL values. Result is decimal for decimal inputs, otherwise fp64. Empty/all-null inputs yield NULL. DuckDB rejects exact decimal AVG. |
| `count()` | Returns i64 `Measure` counting non-null input values; zero for empty input. |
| `percentile(fraction)` | Numeric input; returns continuous percentile `Measure`. Finite fraction in [0,1]; decimal inputs allow at most ten fractional places. It must be the only measure in its aggregate. NULL inputs are ignored; no non-null values yields NULL. |

| Helper export | Returns / contract |
| --- | --- |
| `literal(value)` | `Expr`; string, finite number or boolean. Numbers become fp64. No null/date/decimal literal overload exists. |
| `integer(value)` | Required i32 `Expr`; integer from -2147483648 through 2147483647. |
| `count()` | Row-count `Measure`, implemented as counting a non-null constant. Distinct from `column.count()`. |
| `caseWhen(condition, yes, no)` | `Expr`; boolean condition and same-kind Expr branches. A false or NULL condition selects `no`. |

For number shorthand on i32/decimal receivers, the API creates an i32 literal; other receivers generally use fp64, with the `lte` exception above. For example, `integer(1)` can participate in exact price arithmetic; `literal(1)` is fp64 and cannot be mixed with decimal columns.

## Types and limits

This MVP has runtime column-name/type validation, not schema-inferred TypeScript row types. Catalog kinds reuse the existing supported profile. Methods reject incompatible expressions before lowering where possible; compiler checks remain authoritative. Internal constructors and `resolve` are implementation plumbing, not a raw SQL API or security boundary.

Numeric `literal` defaults to fp64. `integer` explicitly constructs i32. Numeric shorthand in an i32 or decimal expression accepts i32 integers only; use existing decimal columns for exact monetary arithmetic. Decimal/fp64 mixing fails. Non-decimal sums/averages/arithmetic use fp64 under the existing profile. Counts and decimal results are strings, dates are calendar strings, and division by zero returns null.

Percentile is continuous, uses all non-null values, and is the sole measure in its aggregate. Decimal inputs use the existing decimal(38,10) rewrite with its documented precision limits, not a floating-point native substitution.

There is no general cast, decimal literal, timestamp, union, distinct, general window API beyond row_number, mutation API, raw SQL escape hatch, or full Ibis/Substrait implementation. Sorting is field-based; projecting away a sort field is rejected by the compiler. General function resolution, capability selection, normalized errors, and structured logging are deferred. See [DuckDB limits](../DUCKDB.md) for bounded exact division and decimal AVG rejection.

Result values follow the implemented type contract: i32/fp64 are numbers; i64 counts/ranks and decimals are strings; dates are calendar strings; nullable outputs may be null. PostgreSQL/MySQL boolean-shaped values are not given a new uniform driver-normalization layer in this API. Result rows use runtime column names with unknown TypeScript values, not inferred schema-specific row types.
