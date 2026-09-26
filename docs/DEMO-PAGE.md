# Executable query walkthrough

This local page supports the five-minute video: choose an existing example and
backend, inspect actual TypeScript source, compile, and display real database
results. It is supporting documentation, not a production web application.

With Node 22+, dependencies installed using `npm ci`, and the supplied databases
running, start from the repository root:

```powershell
node --import tsx src/playground/server.ts
```

Open **http://127.0.0.1:4317** (use this exact host), then stop with Ctrl+C.
`POSTGRES_URL` and `MYSQL_URL` configure the existing adapters. Compile only does
not execute SQL; Run executes on the selected remote database. Source snippets
are extracted from `src/queries.ts`, including the percentile price helper.
The page omits shared imports and source/catalog initialization, as labeled.

Suggested walkthrough: London count for binding, average units for nested
aggregation, and country percentile for decimal semantics. Switch databases and
run the same example. Expand SQL and Substrait when explaining the boundaries.
Timings measure compilation/execution, not browser/network overhead. Results are
real and uncached; at most 100 rows are displayed, with full row count reported.

Only three fixed examples, two backends and Compile/Run are accepted. There is no
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

The integration owner maintains package scripts for this parallel task; this
branch does not edit dependency manifests or compiler/API code.
