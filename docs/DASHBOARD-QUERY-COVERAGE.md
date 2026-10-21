# Dashboard query coverage and IR evaluation

Status: inspected requirements and proposed implementation sequence, October 20,
2026. Not a claim of complete dashboard support. Visualization belongs upstream;
Golden owns supported query operations, binding, compilation and remote execution.

## Evidence

Inspected main `f565851`: src/api.ts, src/functions.ts, src/plan.ts,
src/challenge.ts and src/queries.ts. BigQuery is in open PR #64 at `f05c732`,
not on main. It adds capability-selected native percentile without expanding the
public expression vocabulary.

Requirements source: the user's downloaded
`northwind-dashboard-handoff/handoff/queries.sql`, SHA-256
`47EA9532CC94CE3CDECEA912483062871FE8545D037C05F6C56778302A8CB0C0`.
The download and dashboard runtime are not repository dependencies. This analysis
does not execute its template substitutions.

## Nine-query matrix

All queries except bounds apply date bounds. Six also apply country equality;
by_country and p75_country deliberately ignore the country selection. None of the
eight filtered queries is fully expressible as exported using today's public API.

| Query | Existing core | Missing functionality or adaptation |
| --- | --- | --- |
| kpis | Per-order totals, joins, count, sum, conditional sum, division | DATE predicates; compatible count conversion for arithmetic; display rounding/result contract |
| monthly_cat | Joins, projection, multi-key grouping, sum, sort | DATE predicates; month truncation; products/categories and order_details.product_id catalog fields |
| by_country | Group, count, sum, sort | DATE predicates; agreed display rounding |
| top_customers | Aggregate by ID, sort, limit | DATE predicates; company_name; labels via grouping or post-aggregate join instead of ANY_VALUE; stable top-N tie-breaker |
| top_products | Joins, sums, sort, limit | DATE predicates; product/category fields; decide name grouping versus entity-ID grouping |
| emp_ship | Conditional aggregates, joins | DATE predicates; employee names; upstream name formatting; export includes only employees with matching orders |
| freight_share | Per-order totals, grouped freight/value, null-on-zero division | DATE predicates; labels; order-based population differs from challenge's all-customer population |
| p75_country | Continuous percentile by country | DATE predicates; count alongside percentile, which currently must be the sole measure |
| bounds | DATE projection and execution | DATE min/max aggregates with typed nullable output |

`filter` already exists. Missing expressions include DATE literals/comparisons,
month truncation, min/max, general casts and round. Not every SQL function needs
an API equivalent: optional country filters can be appended conditionally during
query construction, without OR; labels can be formatted upstream. Computed
grouping keys can be projected before grouping by their names.

## Semantic choices

- Exported DATE bounds are inclusive, with missing bounds replaced by 1900-01-01
  and 2999-12-31. This still excludes NULL dates and dates outside that interval.
  Proposed helper behavior: omit absent predicates. Document this intentional
  difference rather than claiming identical reproduction.
- Initial date support should use validated calendar dates without JS timezone
  conversion. Include inclusive comparisons and lt for half-open intervals;
  defer TIMESTAMP/timezone support.
- Exported orders without details have zero value; customer joins are inner joins.
  Test these populations separately from challenge left-join examples.
- Export groups products/employees by name, which can merge separate entities.
  Preserve that when reproducing it, or explicitly choose ID grouping and stable
  ID tie-breakers. Do not normalize this difference away in comparisons.
- Export rounds monetary output and casts it to FLOAT64. Compare analytical
  values separately from display rounding. Exploratory charts and settlement can
  legitimately have different precision requirements; one cent alone is not
  evidence that an IR is necessary.
- Define empty aggregates, zero denominators and NULL-country groups. Joining
  separate count and percentile aggregates is an option, but ordinary equality
  would drop the NULL group; do not introduce that silent regression.

## Implementation sequence

1. **DATE predicates:** validated date literal, typed gte/lte/lt, supported plan
   profile and function specification, runtime checks and backend lowering. Keep
   values bound. First demonstrate a date/country-filtered order count.
2. **Bounds and month grouping:** DATE min/max and month-start projection returning
   DATE. Group projected month and country; format labels upstream. Empty min/max
   returns NULL.
3. **Chart queries:** verify physical product/category/name fields on each backend;
   extend the explicit catalog and DuckDB seed if needed. Start with by_country and
   top_customers, then monthly categories/products, then KPIs and percentile/count.
4. **SQL quality, separate change:** deduplicate BigQuery decimal checks without
   changing evaluation, rounding or overflow behavior. Preserve SQL/binding/trace
   snapshots. Do not delete guards merely to imitate shorter SQL.

Each step should be a focused implementation PR. This plan does not authorize
merging #64 or stacking a branch on it. DATE work can independently start from main
for its three backends; add BigQuery validation after the prerequisite merges.

## Acceptance tests

- Type negatives and runtime checks: date/string/number mismatch, invalid calendar
  date, numeric date-truncation, and stale column scope after projection.
- Hand-calculated fixtures: leap day, inclusive endpoints, absent bounds, reversed
  range (explicit helper rejection), empty selection, NULL dates/countries,
  duplicate names, tied revenues, zero-value orders and absent details.
- Same Table/Expr query across supported backends. Exact rows/decimal strings;
  tolerances only for declared approximate fields. Native SQL is one oracle,
  complemented by independent expected results and matched population rules.
- Metamorphic count checks: an added filter cannot increase count; adjacent disjoint
  date intervals sum to the combined interval; monthly counts sum to the filtered
  count when NULL dates are explicitly excluded. Do not assume these properties
  hold for averages or negative revenue.
- Snapshot generated SQL, ordered bindings and lowering decisions. Measure bytes
  scanned, slot time and latency separately for equivalent queries. Shorter SQL
  does not by itself demonstrate faster execution or fewer LLM tokens.

## Value the IR must demonstrate

A stable relational boundary permits validated query composition and backend
capability choices. BigQuery native percentile versus MySQL's rewrite is a concrete
example in PR #64. Typed APIs, parameterization, validation and decimal policy are
not exclusive to Substrait.

Standard serialization and independent producers/consumers are potential additional
benefits. External engine interoperability and a semantic frontend have not been
demonstrated here; Golden-specific functions still need a receiving implementation.

A fixed BigQuery dashboard may be well served by parameterized SQL authored once
by a person or LLM. Golden should justify compiler maintenance with all nine query
families, compositional changes, consistent supported cross-backend behavior and
acceptable generated SQL. Reassess if the evidence fails to justify that cost.
No architecture replacement is accepted by this investigation.
