# Executable query walkthrough

This local page supports the five-minute video: choose an existing example and
backend, inspect actual TypeScript source, compile, and display real database
results. It is supporting documentation, not a production web application.

With Node 22+, dependencies installed using `npm ci`, and the supplied databases
running, start from the repository root:

```powershell
npm run demo:ui
```

Open **http://127.0.0.1:4317** (use this exact host), then stop with Ctrl+C.
`POSTGRES_URL` and `MYSQL_URL` configure the remote adapters. For DuckDB, run `npm run seed:duckdb` before launching, using the same `DUCKDB_PATH` (default: northwind.duckdb). Seeding replaces the four demo tables in that local file; use a dedicated demo file. DuckDB is a separate snapshot, not federation. Compile only does
not execute SQL; Run executes on the selected backend. Source snippets
are extracted from `src/queries.ts`, including the percentile price helper.
The page omits shared imports and source/catalog initialization, as labeled.

Suggested walkthrough: London count for binding, average units for nested
aggregation, and country percentile for decimal semantics. Switch databases and
run the same example. Expand SQL and Substrait when explaining the boundaries.
Timings measure compilation/execution, not browser/network overhead. Results are
real and uncached; at most 100 rows are displayed, with full row count reported.

Only eight fixed examples, three backends and Compile/Run are accepted. There is no
arbitrary SQL, plan submission, code evaluation or editable query. Server binds
loopback, checks Host/Origin, limits JSON to 1024 bytes and concurrent work to one
request. Returned failures omit driver errors/credentials. UI renders data using
`textContent`. Host/Origin checks are defense in depth, not authentication. The
local-only design depends on loopback binding and the fixed request allowlist;
do not expose it through a public proxy.

The server's five-second `requestTimeout` and `headersTimeout` concern receiving
HTTP requests/headers. They do **not** bound or cancel an already-running database
query. Database execution cancellation/timeouts remain future work; only fixed
small demonstration queries are accepted. A slow database query can keep the
single execution slot busy beyond five seconds.

Focused tests cover routing with an injected executor, plus real DuckDB HTTP execution against isolated temporary files (no PostgreSQL/MySQL connection required):

```powershell
node --import tsx --test test/playground.test.ts
```

Use the Live driver, API guide and Architecture buttons to structure the video. The full API reference remains in docs/api. The SVG source lives at src/playground/architecture.svg.

## Verification checkpoint

The Driver, API guide and Architecture pages are ready for review. Code/docs type checks and 37 local tests pass, including real DuckDB HTTP compile/run and unseeded-file guidance. Compile-only with an absent DuckDB file does not create it.

A one-off headless Edge check ran three compile-only paths and all three examples against PostgreSQL/MySQL/seeded DuckDB (nine executions); London count was 6 on each. It also checked the unseeded DuckDB error in the browser, navigation, successful SVG decoding, no JavaScript errors, and no horizontal page overflow at 1440px and 900px. Screenshots of all three pages were visually inspected at 1440px. This is local visual QA, not a browser test included in CI; temporary Playwright used installed Edge outside repository dependencies.

An initial Windows text-encoding defect prevented SVG rendering. It was reproduced with a failing strict UTF-8 decoding test, repaired, and checked in the browser. Static assets now have a regression check. The diagram uses presentation attributes compatible with the page's Content Security Policy.

Before recording, start a fresh server from the selected revision and verify its port. The default port is 4317; verification used separate ephemeral ports without stopping an existing user server. The final selected revision still requires green hosted fresh-clone CI and human review before merging.

## Readable inspection views

Generated SQL is formatted for the selected dialect for display only; the original compiled SQL is still executed and available under Original SQL. Formatting failure falls back to the original text. The formatter never receives bound parameter values.

Substrait operator tree summarizes the actual plan, with output at the top and inputs below. Function anchors are shown by name; field# references remain positional within each input relation. This is a navigation aid, not a full semantic explanation: types, emit mappings and some expressions are omitted. Raw Substrait JSON remains the authoritative plan view. Architecture now flows top-to-bottom and uses the same green for all three backend boxes.

## Complete example menu

The menu covers recent orders (N=5), London and Mexico D.F. customer counts, average units per order, employee shipping status, customer freight ratio, country P75, and the window extension: latest three orders per customer. All use existing functions in src/queries.ts on each of the three backends. N is fixed for this demo. The window uses ROW_NUMBER with a date/ID tie-breaker; results show at most 100 rows with the complete row count reported. Freight and percentile source previews include their shared price helper.

Navigation is Architecture, Live driver, API design; Architecture is selected on first load. The API design tab retains the step-by-step API guide.

## API design presentation

The API design page is split into eight topic views: Flow, Usage, Types, Composition, Execution, Boundaries, Precision, and Semantics. Flow opens first; native buttons support keyboard activation and expose their selected state. Switching topics preserves the main Architecture/Live driver/API design selection.

Body and code text use 18px presentation sizing. The city and average-units helpers are loaded from the existing examples endpoint; explanatory snippets are labeled separately. Precision explains string transport, decimal(38,10) limits and caller arithmetic responsibilities. Boundaries explains both the reason for retaining Substrait and the cost of owning lowering. No new query behavior is introduced.
