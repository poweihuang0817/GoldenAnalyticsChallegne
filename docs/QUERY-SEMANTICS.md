# Six challenge queries: chosen definitions and measured alternatives

Submission supporting notes, September 30, 2026 (#38). These are AI-assisted evidence for the candidate's own README, not the final README. No application semantics change in this work.

## Submission contract

| Query | Definition used by the current driver | Important boundary |
| --- | --- | --- |
| Most recent N orders | order_date descending, NULL last, order_id descending to break ties; at most N rows | An ID is a tie-breaker, not an independent guarantee of chronology. N=0 returns none. |
| Customers in a city | Count customer rows; lowercase both strings, preserve accents and whitespace; NULL city does not match a non-NULL input | `mexico d.f.` differs from `México D.F.`. Arbitrary Unicode normalization is not promised. |
| Average units per order | Sum quantity per order, then average over every order; no-detail orders contribute zero | The observation is an order, not a detail line. Approximate fp64 output. |
| Shipped/unshipped per employee | shipped_date non-NULL means shipped; NULL means unshipped; include employees with no orders as 0/0 | Missing rows introduced by a left join are not orders. NULL/unmatched employee IDs are outside employee groups. No delivered/cancelled status is inferred. |
| Freight / total order price per customer | Ratio of totals, freight counted once per order; price is discounted merchandise excluding freight; NULL freight and no-detail order price are zero | Include customers without orders; zero denominator returns NULL. It is not mean(per-order ratio). |
| Order-price P75 by customer country | Each customer-associated order contributes its discounted merchandise total; no details means zero. Use continuous interpolation at `1 + .75*(n-1)` | Customer country, not shipping country. Missing customer excluded; matched NULL country forms its own group. Duplicates remain observations. |

Money follows the current decimal(38,10) profile, with scale rounding and bounded intermediate precision. Decimal/count representations are not evidence of infinite precision; driver types remain documented in the API. This audit does not change custom Golden function identities into official Substrait identities. Statistical function choice, business population and numeric representation are separate decisions.

These submission choices prioritize deterministic top-N results, explicit string matching, order-level units, complete employee/customer populations, and discounted sales value without counting freight twice. The email's "fright" is interpreted as freight. Continuous P75 is one conventional statistical definition, not a requirement inferred from the prompt. These are documented choices rather than uniquely correct interpretations.

## Reproduce and evidence

From a fresh checkout with Node >=22, `npm ci` and the supplied PostgreSQL/MySQL Docker databases running:

```sh
npx tsc --project scripts/semantics/tsconfig.json
npx tsx --test test/semantic-definitions.test.ts
npx tsx scripts/semantics/audit.ts
```

The audit reads Northwind without changing it; DuckDB uses a private in-memory snapshot seeded from PostgreSQL. It executes all seven existing driver examples (six families, two city inputs) through Golden on each backend and compares them with an independent raw-row reference. All 21 executions matched. It also calculates the finite alternative matrix independently from each backend's raw rows and requires identical reference results across the three datasets.

**Alternative definitions are reference calculations, not claims that every variant is implemented by the public API.** The current baseline runs remotely on PostgreSQL/MySQL as required; the audit does not replace application query execution with local evaluation. Adding API variants such as accent folding, WITH TIES or discrete percentile is outside this task.

Full outputs, formulas as exact numerator/denominator pairs, SQL for the baseline, dataset hashes and row counts are in [semantic-results.json](semantic-results.json). The inspected application base is `5737fe26f5d398a9c25c91293a29274cdc578d5f`; audit code is committed alongside the artifact. Execution used Node 24.19.0 Windows, PostgreSQL/MySQL from `goldenbeers/golden-query-challenge:1.0`, and the installed DuckDB dependency. This is local audit evidence, not a new hosted CI claim.

The reference requires price/freight to fit exact cents and discount to fit hundredths, and rejects additional nonzero precision rather than truncating it. It uses BigInt rational arithmetic for money, ratios and percentile; decimal10 is a rounded display. Average API comparison alone uses a 1e-12 numeric tolerance. No claim of arbitrary-data rational conformance by the SQL compiler is made.

## Measured differences on Northwind

Dataset: 91 customers, 830 orders, 2,155 detail rows, 9 employees; 21 country groups.

### Recent orders

For N=5, the driver returns IDs **11077, 11076, 11075, 11074, 11073**. Including every order tied on the cutoff date also includes **11072, 11071, 11070**, producing eight rows. Excluding NULL dates and sorting by IDs happen to give the same five rows here; synthetic fixtures demonstrate why ID recency and date recency are not equivalent.

### City counts

| Input | Exact case/accent match | Current lowercase match | Illustrative accent-fold match | Trim + lowercase |
| --- | ---: | ---: | ---: | ---: |
| London | 6 | 6 | 6 | 6 |
| london | 0 | 6 | 6 | 6 |
| LONDON | 0 | 6 | 6 | 6 |
| mexico d.f. | 0 | 0 | 5 | 0 |
| México D.F. | 5 | 5 | 5 | 5 |
| ` London ` | 0 | 0 | 0 | 6 |

The reference accent policy is explicitly NFD decomposition, removal of Unicode combining marks, and lowercase. It demonstrates this data's distinction; it is not advertised as universal linguistic collation or a supported Golden function. The email's unaccented example is accepted as an input but does not match accented stored names under the chosen rule.

### Average units

| Calculation | Numerator / denominator | Rounded display |
| --- | --- | ---: |
| Units across all orders (current) | 51,317 / 830 | 61.8277108434 |
| Units across only orders with details | 51,317 / 830 | 61.8277108434 |
| Mean line quantity (different metric) | 51,317 / 2,155 | 23.8129930394 |
| Mean detail-line count per order (different metric) | 2,155 / 830 | 2.5963855422 |

Northwind has no zero-detail orders, so the first two definitions coincide. A fixture with three orders and only one detailed order produces 2/3 units per all orders versus 2 units per detailed order. Equality on the supplied data cannot establish equivalence of definitions.

### Employee shipping

All nine employees have orders, so including zero-order employees makes no difference on this snapshot. There are no NULL/unmatched employee assignments. For example, employee 1 has 120 shipped and 3 unshipped orders. The fixture adds a zero-order employee and an unassigned order: the employee stays 0/0; the unassigned order is reported separately. Shipment status is based on date presence, not comparison with today's date.

### Freight ratio

For customer ALFKI:

| Price denominator | Ratio of totals | Mean of valid per-order ratios |
| --- | ---: | ---: |
| Gross merchandise, before discount | 0.0490796745 | 0.0557373259 |
| Discounted merchandise (current) | 0.0527919495 | 0.0579161870 |
| Discounted merchandise + freight | 0.0501447123 | 0.0539647057 |

The two customer populations differ: **FISSA and PARIS have no orders**. Current output includes them with NULL ratios; omitting no-order customers removes those rows. Each matrix entry records IDs with orders, numerator/denominator, mean valid-order ratio and its denominator, plus alternate NULL-freight policies (drop unknown-freight orders or mark the whole ratio unknown). NULL freight as zero is a chosen policy, not proof freight was free.

### Country percentile

For Germany:

| Order price definition | Continuous p75 | Discrete p75 |
| --- | ---: | ---: |
| Gross merchandise | 2250.0000000000 | 2273.6000000000 |
| Discounted merchandise (current) | 2026.5600000000 | 2037.2800000000 |
| Discounted merchandise + freight | 2154.7875000000 | 2168.6000000000 |

For `[10,20,30,40]`, continuous is 32.5; discrete inverse-CDF (ceil(.75*n)) is 30. Both are legitimate statistical definitions. Continuous interpolation uses all values; it is not a sampling approximation. Exact algorithm choice does not eliminate decimal rounding limits.

## Finite variant matrix and limits

The audit calculates recent-N/null/tie/ID contrasts; seven city inputs under four matching policies; four average metrics; all/active employee populations and unassigned orders; and six money branches (three price definitions times all-orders/with-details populations). Every money branch includes customer ratios and both country-percentile definitions. Customer exclusion is represented by the accompanying customerIdsWithOrders list. Full Cartesian combinations of unrelated changes are deliberately not enumerated.

The synthetic tests cover NULL city/country/freight, zero-detail orders, zero-order employees/customers, unmatched IDs, duplicate detail rows, exact rational division, cutoff ties, N=0, empty input, singleton/tied percentile and invalid extra precision. Existing [percentile integration tests](../test/percentile.test.ts) separately cover NULL/all-NULL groups and large exact decimals through the actual compiler. This audit's synthetic variant checks run in the reference evaluator, not a new remote alternative-query engine.

Not computed: shipping-country or shipped-date alternatives (they answer different questions than the prompt), arbitrary N values, every possible percentile convention, every Unicode collation, every joint combination of population/NULL policies, or tax/currency/cancellation rules absent from this schema. Raw detail/price inputs here are non-NULL; generalized NULL-price arithmetic relies on the existing profile tests and remains outside this dataset calculator. No claim that Ossie/Malloy resolves these choices automatically.

## Candidate README prompts

Use your own words to explain the chosen interpretation, one or two measured contrasts, the independent-oracle approach and limits. Useful examples are: city accents; eight versus five recent orders when including ties; order versus line average; or continuous versus discrete P75. Link this document for full detail rather than copying the entire matrix into the README. Future work can explore configurable semantic models; a new semantic engine is not required to explain today's behavior.
