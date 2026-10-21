# Forecast, incremental filters and query controls

This is a demonstration of composing a query and consuming its results in an analytics application. It does not add a forecast operator to Substrait or a production governance service.

## Run

```powershell
npm ci
# Use the existing sample setup from docs/RUNNING.md.
# For DuckDB, seed a snapshot first or point to an existing one:
$env:DUCKDB_PATH = 'C:\path\to\northwind.duckdb'
npm run demo:ui
```

Open http://127.0.0.1:4317. The combined **Golden Interview** UI includes Architecture, Live driver, API design and Dashboard lab. `GOLDEN_DEMO_PORT` overrides the port; this working session uses 4319 to avoid other running servers. `npm run demo:explore` is an alias for the same server, not a separate UI. PostgreSQL and MySQL use the existing sample connection configuration. BigQuery remains in its separate PR and is not included in this branch.

Open **Dashboard lab** for the following walkthrough. The implementation and query examples are Golden's demo, not a claim about Claude's internal implementation.

## Two-minute walkthrough

1. Select a backend and **Run selected stage**. Show historical monthly sales and the dashed baseline forecast. Dates refer to the Northwind observation period, not today's business.
2. Click **Add country = UK**, then **Add city = London**. Each step reruns the query and recomputes the forecast. The original unfiltered relation remains reusable.
3. Open **New query** (the initial lab tab). Show the customer-count SQL and separate parameters, updated for the current selection. The count query has one SELECT block in the tested DuckDB case. Required casts preserve our result and comparison semantics. Full sales SQL remains available separately and has not been disguised or rewritten for display.
4. Open **Decimal vs Float**. The recorded BigQuery evidence reproduces USA P75 rounding as 2477.57 with FLOAT64 versus 2477.58 with NUMERIC. The fraction 0.75 itself is exactly representable. `src/playground/p75-evidence.json` contains the read-only reproduction SQL, capture timestamp and results. The UI does not query BigQuery when this tab opens.
5. Open **Dashboard Flow** to discuss the user-described Python/SQL/HTML authoring workflow, changes to query logic, and token/correctness/semantics questions. Ordinary bound-value changes can reuse SQL without an LLM call. No token benchmark or LLM integration is claimed.

Dashboard lab retains only New query, Forecast, Decimal vs Float and Dashboard Flow. The separate Incremental filters and Governance pages were removed at the user's request. Filter-stage buttons and server-side query controls remain active. Live driver and Dashboard lab share one active-request slot.

This is incremental **query construction**, not incremental execution, caching or materialized-view maintenance. SQL AST builders can also support composition; the demonstration does not establish that Substrait is the only way to do it. No LLM runs on filter clicks.

## Computation boundary and metric

- The database performs customer filtering, inner joins, discounted-line arithmetic and aggregation by order date.
- Net merchandise sales = `unit_price * quantity * (1 - discount)`. Freight is excluded. Customers join by customer ID. Country/city refer to the customer, not the shipping address. Lowercase matching is explicit.
- Orders with missing dates or no matching customer/detail line contribute no revenue. Customer count counts matching customers, including those without sales, so it need not equal the number of purchasing customers.
- Node explicitly groups the returned daily aggregates into months and runs the forecast. This is application processing, not automatic folding or hidden local execution of the relational plan. Adding a portable month-bucketing expression is future compiler work.
- The unfiltered daily query establishes one shared period for all segments. Both boundary months are conservatively excluded. We assume the interior sample is complete and fill no-sales months with zero; the demo cannot detect missing source data. The most recent excluded month becomes the first forecast month, even if some partial observations exist there.
- The baseline predicts three months, each equal to the mean of the last three training months. It does not recursively feed predictions back into training, model seasonality or provide prediction intervals. An empty segment or fewer than three interior months yields no forecast.
- Rolling one-month backtests use only the preceding three months. MAE measures this baseline on available history; it is not a promise of future accuracy or a comparison against a tuned model.
- Decimal strings are parsed into scale-10 BigInts. Display and forecast outputs round to cents, half away from zero. Chart coordinates alone use JavaScript numbers. The statistical baseline remains a modeling choice, not an accounting guarantee.
- Multiple database reads are sequential, without a transaction snapshot. The static sample supports the demo. Production use needs explicit snapshot/refresh semantics and data quality checks.

## Implemented controls versus future governance

Implemented here: fixed query stages, backend allowlist, strict request keys and size, loopback/host/origin checks, one active request, bound values, existing profile/catalog validation, a 5,000-daily-row cap that fails instead of accepting truncated history, and a requested 10-second running-query timeout per execution.

The timeout excludes compilation and pool waits, and cancellation cleanup may exceed it. The row cap bounds returned data, not scanned bytes or database cost. Loopback/origin checks are not authentication. Request rejection does not establish tenant authorization.

Future: identity and authorization, row/column policies, persistent audit trails, policy versioning, end-to-end deadlines, cost budgets and workload scheduling. No claims of those capabilities appear in this demo.

## Relation to DAX / Power BI

Power BI offers a built-in line-chart forecast through its [Analytics pane](https://learn.microsoft.com/en-us/power-bi/transform-model/desktop-analytics-pane). A custom DAX model can use [LINESTX](https://learn.microsoft.com/en-us/dax/linestx-function-dax) to fit regression coefficients, then evaluate a prediction formula. Those are distinct approaches; this demo implements neither Power BI forecasting nor DAX evaluation.

Our analogous boundary is filtered historical data, followed by an explicit forecasting function. Replacing the simple baseline with a stronger model should preserve that boundary and add held-out evaluation.

## Verification

- `npm test`: query immutability, profile shape, request policy, concurrency, exact decimals, sparse/empty history, invalid inputs, calendar boundaries, rolling evaluation, and independent DuckDB fixture totals.
- `npm run test:duckdb`: existing conformance plus all three forecast segments on provided PostgreSQL/MySQL and a temporary DuckDB snapshot. A separate handwritten PostgreSQL monthly query checks Golden's daily-plus-application-monthly totals.
- `npm run check` and `npm run check:docs`: TypeScript checks.
- Local browser smoke: all/UK/London, chart, code, SQL binding display and HTTP 400 rejection. The temporary browser tooling is not a project dependency or a CI browser test.

Implementation: `src/forecast-demo.ts`, `src/playground/explore-query.ts`, shared `src/playground/server.ts` and `index.html`, plus `explore.js`/`explore.css`. The existing compiler, public API and candidate README remain unchanged. The prior Playground and new lab share navigation and a server; separate DOM IDs, scoped styles and navigation selectors keep their controls isolated.
