# Execution controls

`createClient(...).execute(query, { signal, timeoutMs })` supports asynchronous execution cancellation on PostgreSQL, MySQL and DuckDB. Existing calls without options and inferred result types are unchanged.

```ts
const controller = new AbortController();
const pending = client.execute(query, {
  signal: controller.signal,
  timeoutMs: 5_000,
});
// A UI cancel action can call controller.abort().
try {
  const { rows } = await pending;
} catch (error) {
  // ExecutionError exposes code, backend, stage; cause is for trusted debugging.
} finally {
  await client.destroy();
}
```

## Contract and limitations

- `timeoutMs` is a positive integer at most 2147483647. It measures the running query, starting after connection acquisition and session preparation. It excludes synchronous compilation and pool waiting. It is not an end-to-end response deadline.
- An already aborted signal rejects before compilation or database acquisition. Aborting while waiting for a connection is checked before submitting SQL, but rejection can wait for acquisition to finish. A cancellable pool queue / acquisition budget remains future work.
- The first timeout or signal wins. Abort reasons are not copied into public errors, as callers may put secrets in them.
- Cancellation is a request to the engine. Execution does not reject until the native query AND control request settle. The borrowed connection stays held throughout, preventing a late cancellation from affecting another borrower. Timers and listeners are removed before returning.
- PostgreSQL uses Kysely's native `pg_cancel_backend` control client; MySQL uses `KILL QUERY` with a dedicated mysql2 control connection, avoiding a saturated query-pool deadlock. DuckDB calls its native connection's `interrupt()`.
- Permissions and control connectivity still matter. PostgreSQL connection establishment has a five-second timeout; MySQL uses the driver's finite connection timeout. These are not guaranteed overall network-operation deadlines. If cancellation fails, we still drain the original query before releasing its connection and then report `CANCELLATION_FAILED`. A hung server/network can therefore exceed the requested timeout. We never claim a locally abandoned promise stopped server work.
- The pinned Kysely PostgreSQL cancellation hook can race natural query completion while connecting its control client and throw. This is reported as `CANCELLATION_FAILED` with its cause; we do not classify or suppress it by matching English error text.
- Await all executions before `destroy()`. No transaction, streaming, compilation worker, HTTP disconnect integration or automatic retries are added. Cancelling a query is not a transaction rollback guarantee.
- The internal execution helper directly uses a held Kysely connection. Golden installs no result-transform plugins; supporting such plugins would require preserving their executor lifecycle explicitly.

## Error boundary

`ExecutionError` has stable `code`, `backend` and `stage` (`connect` or `execute`). Codes: `CONNECTION_FAILED`, `EXECUTION_FAILED`, `QUERY_CANCELLED`, `QUERY_TIMEOUT`, `CANCELLATION_FAILED`. Messages do not embed SQL, parameters, credentials or vendor messages. Original vendor errors remain in the non-enumerable standard `Error.cause`; do not send causes/stacks to untrusted clients or logs. Compiler/profile errors are outside this execution boundary.

## Verification

`test/execution.test.ts` isolates lifecycle behavior: pre-abort, invalid budgets, holding connections through delayed cancellation, cancellation failure, safe errors, queued cancellation and first-reason behavior. `test/execution-integration.test.ts` runs bounded five-second PostgreSQL/MySQL sleeps and a finite DuckDB analytical query, cancels manually and by timeout, awaits native settlement, and then executes another query. The public client also queries a private DuckDB view and verifies the actual native interruption error, rather than relying only on elapsed time. No Northwind data is modified.

Run `npm test` and `npm run test:integration`. This partially addresses issue #31; streaming, end-to-end deadlines, pool wait budgets, observability and stronger network-failure recovery remain future work.
