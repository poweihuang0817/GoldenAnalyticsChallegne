# Beyond the challenge MVP

AI-maintained research and planning notes for the candidate's own README. These are not additional MVP acceptance criteria. The user explicitly prioritizes capabilities, authentication/authorization and useful errors for a real cross-database product, while deferring them beyond the working take-home.

## Essential production boundaries

| Priority | Concern | Why a cross-database product needs it | Smallest useful next step |
| --- | --- | --- | --- |
| 1 | Capability resolution | A dialect may parse an operation without providing the same types, null behavior or precision. Availability can depend on version, input types and arguments. | Represent native/rewrite/unsupported for a small set of actual features. Report selected paths. Keep decimal-preserving percentile semantics; do not substitute native floating-point output silently. |
| 1 | Authentication and connection configuration | PostgreSQL/MySQL passwords, DuckDB file access and future cloud credentials have different lifecycles. Query intent should not contain credentials. | Explicit per-backend configuration outside Substrait; validate required settings, avoid secret serialization/logging, document local sample defaults separately. Add TLS/cloud identity only when the backend requires it. |
| 1 | Authorization and source binding | Successful authentication does not grant permission to query every table/source. A logical catalog is not an access-control mechanism. | Bind a request to an authorized connection/catalog; use least-privilege read access and prevent cross-tenant/source substitution. Keep user identity and policies outside the logical plan. |
| 1 | Useful, normalized errors | Vendor-only errors make application behavior inconsistent and often hide which logical operation failed. | Distinguish invalid query, unsupported operation, connection/authentication, permission, missing object, timeout and execution failures. Include backend/operation context, retain vendor cause for controlled diagnostics, redact credentials and sensitive values. Never imply unsupported means a correct approximation is available. |

Capabilities answer whether semantics can be provided; lowering implements the selected path. Authentication establishes identity; authorization controls permitted data. Error messages explain failures at those boundaries. Do not collapse them into one generic backend abstraction or claim that the current compiler supplies them all.

## Other researched improvements

| Area | Existing evidence / limitation | Future work |
| --- | --- | --- |
| One relational compiler | Issue #7 comparison found shared-query agreement but differences in dropped sort keys, nested limits, read nullability and numeric normalization. PR #11 contains a bounded comparison corpus. | Decide compatibility policies, add regressions, then consolidate. Function declarations must stop selecting the relational compiler; emit only referenced declarations afterward. |
| Schema and types | Issue #6 concluded catalog is authoritative, baseSchema is a plan assertion, and API/compiler checks protect different boundaries. Runtime typing currently lacks inferred TypeScript result types. | Keep useful validation; share duplicated rules only when justified. Add schema-derived developer types and explicit decimal/timezone/unsigned/JSON policies as real backend needs arise. |
| Function semantics | Numeric precision, NULLs, collation, coercion and date behavior are not made portable by quoting SQL. | Document canonical function semantics and supported type signatures; add backend-specific conformance cases for every new mapping. |
| Metadata | A trusted hand-authored Northwind catalog is adequate for the take-home. | list/describe catalogs, schemas, tables and columns; map native types carefully; handle schema drift and authorization. |
| Execution lifecycle | Current async execution and cleanup cover a small demo. | Timeouts, cancellation, bounded results, streaming, pooling, resource limits and appropriately scoped retries. Avoid retrying arbitrary operations blindly. |
| Observability | Driver logs SQL/parameter counts; no general telemetry layer. | Injectable structured logger with query ID, backend, chosen rewrite, duration and normalized failure. Parameter values and secrets excluded by default; OpenTelemetry later. |
| Configuration tests | Environment overrides and local sample defaults exist; no complete configuration model. | Test missing/invalid config, backend selection, secret redaction and lifecycle failures using small focused boundaries. |
| Correctness | Real DB tests, independent raw-row/BigInt oracles, finite equivalence cases and binary round trips exist. | Small property generators with shrinking, selected compatible Substrait consumer cases, extra Northwind and a narrow TPC-H corpus. Preserve independent oracles; backend agreement alone is insufficient. |
| Compiler rewrite verification | Calcite/Spark rewrite corpora, SQLSolver, QED and VeriEQL were identified as research directions, not validated integrations. | Investigate supported semantics before adoption; use counterexamples as regression fixtures. Solver success does not prove PostgreSQL/MySQL vendor equivalence. Mutation testing and differential fuzzing are later investments. |
| Serialization | Issue #8 recommends KEEP/FREEZE. Strict unknown-field rejection trades away normal Protobuf forward compatibility; limits are application policy. | Revisit only for a concrete external consumer, schema upgrade, trust boundary or measured overhead. No extra hardening just to expand scope. |
| Reproducibility / CI | Fresh-clone checks run locally; GitHub Actions remains a separate task. | Automated clean setup and DB tests, reproducible dependency/code generation, sensible execution budgets and artifact retention. |
| More execution targets | DuckDB is an explicitly requested separate submission backend task (#12). DataFusion, Spark, Trino and additional SQL systems were explored conceptually. | Add one tested adapter at a time; do not claim interoperability from the shared IR alone. DataFusion is a potential executor, not the application API. |
| Lakehouse / federation | Iceberg/Delta/Parquet and multi-source joins are outside current execution support. | Introduce explicit source identities, transfer/cost decisions and an execution planner only when required. Preserve remote execution and make movement of data visible. |

## Scope and delivery

- Current checkpoint: working public API, sample queries, separate extension, real database verification and reproducible local setup.
- Candidate README, five-minute video, reviewer access and final submission packaging remain later delivery work by explicit user direction.
- Executable demo documentation and DuckDB are independently requested additions; neither justifies building production authentication, a generic capability engine or federation for this challenge.
- The original email asks what would be done with more time. Use these researched tradeoffs as material, then select a few priorities in the candidate's own words rather than listing an unbounded implementation promise.

Related notes: [architecture](ARCHITECTURE.md), [public API](PUBLIC-API.md), [supported profile](SUBSTRAIT-PROFILE.md), [issue #6 conclusion](https://github.com/poweihuang0817/GoldenAnalytics/issues/6), [issue #7](https://github.com/poweihuang0817/GoldenAnalytics/issues/7), [issue #8 conclusion](https://github.com/poweihuang0817/GoldenAnalytics/issues/8).
