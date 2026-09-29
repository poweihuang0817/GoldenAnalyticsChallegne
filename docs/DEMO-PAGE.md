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

Only three fixed examples, three backends and Compile/Run are accepted. There is no
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

Focused routing tests use an injected executor and do not connect to databases:

```powershell
node --import tsx --test test/playground.test.ts
```

Use the Live driver, API guide and Architecture buttons to structure the video. The full API reference remains in docs/api. The SVG source lives at src/playground/architecture.svg.

## September 28 draft checkpoint

The UI work is saved for continuation, not merge-ready. Typecheck and 36 local tests pass, including real DuckDB HTTP compile/run against an isolated fixture. A one-off headless Edge check ran all three examples against PostgreSQL/MySQL/seeded DuckDB successfully (nine executions); city count was 6 on each. The API guide tab works. The Architecture tab exists and its SVG route returns 200, but the browser currently reports image naturalWidth=0. Diagnose and visually verify that image before recording or merging. The browser connector was unavailable; temporary Playwright with installed Edge was used outside repository dependencies.

Remaining: fix SVG rendering; inspect all three pages at recording resolution; verify compile-only and missing-DuckDB-data/error flows in browser; reconcile docs after review; run inherited CI on the final head. The default port 4317 was already in use during verification, so an isolated server was started on 4318 without stopping the existing process. Start the next session by checking processes/ports rather than assuming either server is still running.
