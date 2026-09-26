# Lower-layer challenge coverage

The lower layer now compiles all six sample query families. The public fluent API remains a separate task. Plans use generated Substrait types and the standard function-extension mechanism; the extension URI is resolved only through an allowlisted local registry, never fetched or executed dynamically.

| Requirement | Implementation | Validation |
| --- | --- | --- |
| Recent N orders | Read, project, stable sort, fetch | Independent SQL, zero limit, offset, both backends |
| Customers in a city | Filter, lower, equality, count | Raw customer rows; London, Mexico D.F., accented spelling, injection-shaped value |
| Average units per order | Per-order quantity sum, left join, coalesce, outer average | Independent raw-row quantity totals / all orders |
| Employee shipped/unshipped counts | Left join, null predicates, CASE, grouped sum | Raw orders grouped per employee |
| Freight / order price per customer | Discounted per-order totals, left joins, customer sums, guarded division | Independent scaled-integer money calculation |
| Country 75th percentile | Customer-country join, per-order totals, continuous percentile | Exact scaled-integer oracle; PostgreSQL native function; edge fixtures on both backends |

## Explicit semantics

- Order price is `sum(unit_price * quantity * (1 - discount))`, excluding freight.
- Include orders with no detail rows as zero-unit/zero-price orders.
- Include employees with no orders, yielding zero shipped and unshipped counts.
- Include customers with no orders in freight ratios; zero total price produces null. Freight is counted once per order, never once per joined detail row. Null freight is treated as zero.
- Country is the customer's country, not the shipping country. Percentile includes only orders associated with a customer.
- City matching uses lowercase comparison, preserving accents. `london` and `LONDON` match; `mexico d.f.` does not match `México D.F.`. The sample has six London customers and five with the accented Mexico spelling. Both backends use the same case/accent policy for the tested data. Arbitrary Unicode normalization is not promised.
- fp64 is explicit for approximate numeric operations such as the average quantity. Money uses a fixed `decimal(38,10)` logical type and decimal SQL arithmetic, returned as strings. Count outputs are i64 strings. Dates remain calendar-date strings.
- Decimal operations are rounded to the declared scale of 10; they are not arbitrary-precision rationals. The provided price/discount data and 0.75 interpolation fit exactly at that scale. Ratio divisions generally round. Very large intermediate arithmetic remains bounded by each database's decimal precision; arbitrary overflow behavior is not standardized by this profile.

## Continuous percentile is not an approximation algorithm

For n non-null ordered values, the one-based position is `1 + p * (n - 1)`. Select its floor/ceiling neighbors and interpolate between them. All values participate; there is no sampling, sketch, or bucketing.

For `[10,20,30,40]` and p=0.75, the position is 3.25 and the result is 32.5. This is the continuous definition, rather than the discrete percentile that selects an observed value.

Both dialects use ROW_NUMBER and COUNT to calculate this definition remotely. Null values are excluded from the count and sorted last. Keeping their rows preserves all-null groups, whose result is null. Empty global aggregation returns null; empty grouped aggregation returns no rows. One-element and tied-value groups work normally.

Tests also interpolate values above JavaScript's safe-integer limit, preserving the exact decimal result `9007199254740993.0000000075`. An independent BigInt oracle checks every country result exactly at scale 10. PostgreSQL's native percentile_cont, which returns double precision for this input, is a separate cross-check with tolerance.

## Compiler boundaries

- The original simple compiler remains for the small extension-free read/project/sort/fetch profile.
- Analytical plans use a relation-scoped compiler. Each relation has its own derived-table scope, so grouping and joins do not collapse into the wrong aggregate grain.
- Kysely SQL fragments quote identifiers and bind literal values; SQL operators/functions come only from the compiler's fixed registry. Plans cannot supply raw SQL.
- The analytical profile supports inner/left joins, one grouping set, initial-to-result aggregates, CASE, typed literals, and declared function output types. Other join kinds, grouping sets, aggregate phases, function options, and arbitrary functions remain unsupported.
- Percentile is currently the sole measure in its aggregate relation. Decimal fractions support at most ten decimal places. Sorting fields must remain available through subsequent projection; otherwise compilation rejects the plan.
- This remains a strict Substrait profile. It is not a full validator, optimizer, or authorization system.

## Testing and remaining deliverables

`npm test` runs compiler/codec rejection tests. `npm run test:integration` runs the sample cases and edge fixtures on both supplied databases. Every analytical sample goes through a binary Protobuf round trip before compilation. Temporary fixtures use unique names and a dedicated connection, then are dropped; supplied Northwind rows are not changed.

The percentile sample is part of the requested baseline, not the separately requested extension. The high-level fluent API, one additional extension, final candidate-authored README, and walkthrough video remain outstanding.
