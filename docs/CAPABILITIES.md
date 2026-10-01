# Compiler capabilities and errors

This is a bounded description of the existing PostgreSQL 17, MySQL 8 and DuckDB lowering. It is not database feature discovery or a second planner. Compilation still validates the complete query and its types/arguments in context.

## Implemented paths

| Capability key | PostgreSQL | MySQL | DuckDB | Evidence |
| --- | --- | --- | --- | --- |
| `rowNumber` | native | native | native | `window.test.ts`, `window-integration.test.ts`, `duckdb-integration.test.ts` |
| `continuousPercentile` | rewrite | rewrite | rewrite | `percentile.test.ts`, `duckdb.test.ts`, `capabilities.test.ts` |
| `exactDecimalAverage` | native | native | unsupported | `capabilities.test.ts` (compilation), `duckdb.test.ts` (rejection) |
| `exactDecimalDivision` | native | native | rewrite | `percentile.test.ts`, `duckdb.test.ts` |

`capabilitySupport(backend, key)` returns `{ kind: 'native' }`, `{ kind: 'rewrite' }`, or `{ kind: 'unsupported', reason }`. These labels describe the compiler's selected implementation, not everything the server could theoretically support. Native means the core operation uses the database operator/function; casts and null handling can still be emitted.

In particular, PostgreSQL also uses the existing rank/count/interpolation rewrite for continuous percentile. This change does not switch it to `percentile_cont`. The rewrite is continuous interpolation, not an approximate percentile algorithm; fp64 inputs still have floating-point precision. Decimal inputs use the profile's fixed `decimal(38,10)` arithmetic and require fractions with at most ten decimal places. Percentile must be the sole measure in its aggregate. Overflow remains possible and is not hidden.

Exact decimal AVG is rejected on DuckDB because its native AVG returns floating-point values. The check now consults the same capability function that callers can inspect. It never silently coerces an exact decimal query to fp64. A caller may explicitly choose approximate fp64 inputs.

Only these four capability keys are modeled. No promise is made about arbitrary Substrait operators, server versions, other adapters, or complete SQL support.

## Compiler error contract

`compilePlanSync` throws `CompileQueryError` for recognized profile-validation and compiler rejection paths:

- `code`: `INVALID_QUERY` or `UNSUPPORTED_CAPABILITY`.
- `stage`: `validation` (JSON/profile or size/depth rejection) or `compile` (catalog, semantic checks, or lowering limitations).
- `backend`: `postgres`, `mysql`, or `duckdb` when the adapter is recognized.
- `capability`: an optional specific capability key; currently set for unsupported exact decimal AVG.
- `cause`: the original validation error when a profile error is wrapped.

Messages remain human-readable diagnostics; applications should not parse them. Unresolved/duplicate function anchors and invalid schema/type/arity are invalid queries. Unknown function declarations/URIs and explicit supported-profile lowering restrictions are unsupported capabilities.

A JSON shape rejected by the strict profile receives `INVALID_QUERY`, even if it might describe a valid operator in the full Substrait standard. The profile parser is not a full-standard validator, so it cannot reliably distinguish those cases. Unexpected programming/driver errors propagate unchanged rather than being mislabeled unsupported. API expression-construction errors and raw protobuf encode/decode failures are not comprehensively normalized by this change. Execution errors/timeouts/cancellation are a separate boundary.

## Tests and scope

`test/capabilities.test.ts` checks native, rewrite and unsupported paths against real compilation; distinguishes invalid versus unsupported declarations; verifies validation cause and backend/stage; and confirms unexpected errors propagate unchanged. Existing SQL/compiler, decimal, percentile and cross-backend tests remain the semantic oracles. No successful query SQL or result normalization is intentionally changed.

Future work: an evidence-backed full support inventory, version-dependent capabilities, cancellation/execution error integration, and a unified public error taxonomy if those interfaces stabilize. Do not infer support for an entire function family from a single key.
