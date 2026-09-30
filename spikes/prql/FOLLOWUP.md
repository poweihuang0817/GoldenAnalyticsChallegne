# Follow-up: executable composition and compiler reuse

September 29, 2026; research only, continuing #36 / PR #37. No production migration. This supplements rather than replaces the original [59-observation probe](README.md) and [design comparison](DESIGN-COMPARISON.md).

**User priority:** TypeScript/Node integration comes first. The primary comparison is the current TypeScript/Substrait/Kysely implementation versus a typed TypeScript frontend using PRQL's npm/WASM compiler in-process. JVM/Python services or new Rust bindings are lower-priority future options, not prerequisites. PRQL source-only remains a reference point for potential savings, not a substitute for the requested typed API without explicit agreement.

## New executed evidence

Run from the worktree root after installing the existing spike dependencies:

```sh
npx tsc --project spikes/prql/tsconfig.json
npm run followup --prefix spikes/prql
```

[followup.ts](followup.ts) uses fixed inline data, SELECTs only, the provided remote PostgreSQL/MySQL servers and a private in-memory DuckDB connection. No table creation, Northwind changes or persistent DuckDB file. [followup-results.json](followup-results.json) records sources, generated SQL and raw rows. Version: prqlc 0.13.14 / Node 24.19.0 Windows. An initial sandbox invocation failed in tsx's Windows user-info lookup; the unsandboxed run succeeded.

### Continuous percentile is expressible without raw SQL

A single PRQL pipeline counts non-null values over each partition, sorts NULLs last, assigns row numbers, selects the two neighbors of `1 + 0.75*(n-1)` and interpolates. An explicit non-null indicator is necessary because PRQL count(column) includes NULLs. All-null groups are retained and return NULL.

| Fixed fixture | Expected p75 | PG / MySQL / DuckDB |
| --- | --- | --- |
| 10, 20, 30, 40 | 32.5 | All pass |
| NULL, 10, 20 | 17.5 | All pass |
| NULL, NULL | NULL | All pass |
| 7 | 7 | All pass |
| 4, 4, 8 | 6 | All pass |
| No input rows, grouped aggregation | No rows | All pass |

These are six database executions: two queries on each backend, with five expected groups in the first query. Expected values are hand-calculated independently. Bounded results are compared numerically; **this is not an exact-decimal test**. No SQL escape hatch, built-in percentile, production compiler change or custom PRQL function implementation was needed. PRQL supplied window/subquery/aggregation SQL composition.

This updates the feasibility conclusion: absence of a built-in percentile does not block expressing a continuous percentile pipeline. It does not finish Northwind country-percentile verification, arbitrary probabilities, empty global aggregation, exact decimal scale/overflow, or the typed frontend bridge. The earlier large-decimal two-point probe remains separate evidence, not proof of this pipeline's exactness.

### Schema knowledge changes compiler checking

Two compile-only cases were checked:

- `from orders | select definitely_missing_column` compiles without a supplied schema.
- `from [{x=1}] | select definitely_missing_column` is rejected because the inline relation has a known shape.

This is neither 'PRQL has no type checking' nor proof that PRQL validates a real database's schema. It demonstrates why passing raw query strings to a compiler is not equivalent to our schema-aware TypeScript API. A typed frontend or explicit schema binding remains a separate deliverable; fabricated source-column names were not executed against the database.

### PL/RQ is accessible but does not solve MySQL parameters

The binding successfully ran PRQL -> PL JSON -> RQ JSON -> SQL for a MySQL-targeted query containing `$2` then `$1`. The recorded RQ contains parameter identities and table/column IDs; the output still contains `$2` and `$1`.

Pinned [gen_expr.rs](https://github.com/PRQL/prql/blob/0.13.14/prqlc/prqlc/src/sql/gen_expr.rs) emits `rq::ExprKind::Param(id)` as a source expression formatted with a dollar prefix. That branch does not choose MySQL question-mark placeholders. The installed [JS declarations](node_modules/prqlc/dist/node/prqlc_js.d.ts) expose SQL as a string, not a `{sql, parameterOrder}` result. The declaration link is local after installation; upstream [binding docs](https://prql-lang.org/book/project/bindings/javascript.html) describe the same conversion entry points.

Implications:

1. Switching from source input to RQ input does not automatically repair binding.
2. An upstream change/fork should ideally expose a dialect-aware placeholder and **final emission-order binding map**. Repeated parameters may require repeated values with positional question marks.
3. A vetted SQL parser/AST adapter is another possibility, but adds a dependency and must preserve literal/comment/identifier contents and parameter order. It has not been implemented or selected here.
4. Renaming RQ parameters or walking them before SQL generation is not sufficient evidence of final placeholder order, because SQL compilation can transform the query. Regex replacement and literal interpolation remain inappropriate shortcuts.

Accepting PRQL aggregate semantics does not resolve this driver-boundary issue. No parameter adaptation was introduced in this experiment.

## Substrait need not imply a wholly handwritten SQL compiler

The previous comparison's A pipeline specifically used Golden's current lowering. There are alternative consumers worth evaluating, so 'Substrait requires us to write all SQL lowering' would be too strong.

| Candidate | Confirmed source/API | Golden integration work still unverified |
| --- | --- | --- |
| Isthmus / Apache Calcite | `SubstraitToSql.convert(Plan, SqlDialect)` converts through Calcite relations; official example reads protobuf and chooses MySQL dialect | JVM or service/native packaging, matching plan/function version, catalog mapping, parameter/result contract, all six queries and three-engine execution |
| DataFusion consumer + unparser | Consumer converts Substrait to LogicalPlan; unparser offers PostgreSQL, MySQL and DuckDB dialects | Rust/Python boundary from Node, table registration, supported functions/options/types, correct SQL/result semantics and parameters |
| Existing Golden lowering | Already exercised on the challenge profile and databases | Official-function adoption still needs signature/options/type and behavior changes |

Isthmus source inspected at commit `3a6c248b64f1d5b2529227d132a483f634aea60b`: [converter](https://github.com/substrait-io/substrait-java/blob/3a6c248b64f1d5b2529227d132a483f634aea60b/isthmus/src/main/java/io/substrait/isthmus/SubstraitToSql.java), [protobuf-to-MySQL example](https://github.com/substrait-io/substrait-java/blob/3a6c248b64f1d5b2529227d132a483f634aea60b/examples/isthmus-api/src/main/java/io/substrait/examples/ToSql.java). These APIs were read, not built or executed here. They accept Java plan representations after protobuf conversion, not a drop-in Node query object.

DataFusion official APIs: [Substrait consumer](https://datafusion.apache.org/python/autoapi/datafusion/substrait/index.html), [SQL unparser](https://datafusion.apache.org/python/autoapi/datafusion/unparser/index.html). This is a documented composition path, not a tested end-to-end bridge for Golden v0.63/custom functions. A compiler service could return SQL for remote execution without running the query in DataFusion; importing an engine library does not require adopting local execution or federation.

For verification reuse, [Substrait consumer-testing](https://github.com/substrait-io/consumer-testing) contains function and TPC-H producer/consumer cases. Those cases can inform a bounded profile test set; their existence is not certification of our consumer or the other candidates. Official identities plus independent conformance tests improve interoperability more than protobuf round trips alone.

## Updated decision

- **PRQL is more viable than the built-in-function probe alone suggested:** real compositional percentile works on bounded fixtures across three backends.
- **PRQL is still not a drop-in typed API or safe MySQL execution bridge:** those are concrete remaining work, not merely documentation differences.
- **Substrait can also reuse compiler machinery:** Isthmus or DataFusion could reduce handwritten lowering, at the cost of a runtime boundary and another compatibility surface.

Given the user's Node/TypeScript priority, the next useful experiment is the PRQL binding + Northwind + typed generation gate, compared against the existing TypeScript Substrait path. Keep Isthmus/DataFusion as future references; do not build services or new native bindings for this spike. The npm/WASM package fits in-process Node use, but Node 22 packaging, synchronous compilation behavior and typed schema/result guarantees still need validation. Neither research branch should silently replace the submission implementation.
