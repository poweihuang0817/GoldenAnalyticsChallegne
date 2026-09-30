# PRQL feasibility spike (#36)

Recommendation: **DEFER transparent replacement**, not rejection of PRQL. The compiler works for useful relational compositions, but adopting it requires explicit semantic and driver adaptation. No production architecture or dependencies changed.

The [Substrait-defined versus PRQL-defined API comparison](DESIGN-COMPARISON.md) evaluates deliberately changing Golden's API contract, rather than requiring compatibility with every old choice. It audits five operation families, distinguishes PRQL source from PL/RQ, and gives separate migration gates. Business-definition ambiguity is tracked in #38.

The [executed follow-up](FOLLOWUP.md) demonstrates a complete continuous-percentile pipeline on bounded fixtures across three backends, checks schema/PL/RQ behavior, traces MySQL parameters to compiler source, and identifies existing Substrait-to-SQL consumers. These are additional observations; the original matrix below is unchanged historical evidence.

The [Node-first typed frontend experiment](TYPED-FRONTEND.md) now checks callback-free schema-aware filter/projection generation, type-negative cases, relation scope checks and real PG/DuckDB binding. MySQL remains an explicitly tested rejection; joins/aggregate typing are not implemented in this slice. Upstream PRQL #5699 and Tybis provide closely related prior art.

## Reproduce

From the worktree root, with the supplied PostgreSQL/MySQL Docker databases running:

```sh
npm ci
npm ci --prefix spikes/prql --ignore-scripts
npx tsc --project spikes/prql/tsconfig.json
npm run probe --prefix spikes/prql
```

Evaluated PRQL **0.13.14**, Node **v24.19.0**, Windows, existing Golden database drivers. Node 22/browser/bundler deployment was not tested. The npm package bundles WASM and TypeScript declarations; no Rust toolchain was needed. It declares Apache-2.0, has no runtime npm dependencies in this lockfile and reports 16,648,599 unpacked bytes across binding targets. Production redistribution still requires applicable license/notices and bundled-dependency review; this is not patent clearance.

Compilation is synchronous. The binding consumes CompileOptions: create one per call, do not reuse/free afterward. An interruptible compilation deadline would require isolation.

PG/MySQL use existing environment URLs/defaults. DuckDB uses a private in-memory snapshot seeded from PostgreSQL. Only unique test-owned decimal tables are created and dropped in `finally`; Northwind is read-only. CREATE/DROP permission is required; abrupt termination may leave the randomly named fixture behind.

`results.json` records SQL, errors, expectations and up to three sample rows, after comparing full result sets. The probe exits 0 when observations complete, **not** when the adoption gate passes; infrastructure failures exit 1. This is an opt-in diagnostic experiment, not a green conformance suite hiding failing assertions.

## Result matrix

| Case | PostgreSQL | MySQL | DuckDB |
| --- | --- | --- | --- |
| Recent five orders; literal N; explicit null-last key | pass | pass | pass |
| `take $1` | compile rejection | compile rejection | compile rejection |
| Bound city count (including hostile string) | pass | `$1` execution rejection | pass |
| Repeated/out-of-order `$2`, `$1`, `$2` | pass | `$2` execution rejection | pass |
| Nested aggregate: average units across all orders | value pass | default AVG scale differs | value pass |
| Same average, explicit float input | pass | pass | pass |
| Employee shipped/unshipped counts | value pass | value pass | value pass |
| Freight/order-price ratio | compile only | compile only | compile only |
| Country percentile via `percentile` | function unresolved | function unresolved | function unresolved |
| Window calculation then filter | pass | pass | pass |
| SUM all-null / empty | returns 0 instead of Golden NULL | same | same |
| `count amount` on null rows | counts rows, unlike Golden COUNT(column) | same | same |
| Exact decimal divided by 1 above JS safe integer range | exact value, different scale | exact value, different scale | precision loss |
| Two-point p75 interpolation | exact value, different scale | exact value, different scale | exact value, different scale |

59 observations: 33 pass, 6 compile-rejected, 5 execution-rejected, 12 contract-mismatch, 3 compile-only. These include independent controls and repeated cases; they are not 59 independent features or passing tests.

## Attribution: which behavior is correct?

Differences from Golden are **not automatically PRQL bugs**. Separate language semantics, driver integration and our product contract.

1. **Parameters:** MySQL SQL target emits `$1`, which fails in the current execution path. A direct native `mysql2.execute` control, bypassing Kysely, also rejects `$1`; `?` succeeds. PG/DuckDB preserve repeated/out-of-order parameter identities. No regex SQL replacement or user-value interpolation was used. A production bridge needs structurally correct placeholder adaptation and a binding contract.
2. **NULL aggregates:** PRQL generates `COALESCE(SUM(...), 0)` and its `count column` includes NULL rows. Independent SQL controls on all three engines return NULL for all-null SUM and zero for COUNT(column). This is a language-contract difference, not evidence that PRQL arithmetic is broken. Preserving Golden requires adaptation; deliberately adopting PRQL's contract instead is also a valid proposal. Do not map names blindly in either mode.
3. **Decimal division:** DuckDB returns the number `9007199254740992` from decimal `9007199254740993.0000000000 / 1`. Independent SQL reproduces this without either compiler. Thus it is backend floating-point division behavior; Golden's existing exact-decimal lowering compensates for it. PRQL is not inherently wrong to expose that behavior, but an exact-decimal contract cannot accept it silently.
4. **Decimal representation:** PG/MySQL division and all three two-point interpolations preserve the exact value, with extra trailing zeros. The comparator only strips insignificant trailing zeros from strings, never converts exact decimals to Number. Raw rows remain visible. Exact interpolation is `9007199254740993.0000000075`; this two-point case is not a complete percentile implementation.
5. **Average:** unadapted MySQL AVG returns `61.8277` against independent `61.827710843373495`. Explicit `as float` input passes all three, illustrating a small viable adaptation rather than a fundamental compiler failure. PG initially returns a numeric string and DuckDB a number; value agreement does not establish the whole typed result contract.
6. **Percentile:** no built-in function resolved for the tested source. Ranking/count/interpolation may be expressible in PRQL, or controlled SQL extensions may help. That rewrite and its conformance remain work, not proof of impossibility. Stop rather than invent a second compiler inside the spike.
7. **Dynamic N:** `take $1` rejection matches upstream [#2981](https://github.com/PRQL/prql/issues/2981). Validated literals or another relational form may be alternatives but do not simply preserve the current parameterized contract.

The nested aggregate, left join and window cases demonstrate real value: PRQL automatically creates SQL query blocks/CTEs. Oracles use raw Northwind rows and bounded JS arithmetic, not generated SQL from Golden. NULL and decimal fixtures have hand-specified answers. Count/shipping results are compared numerically only for bounded integer values, with raw representations recorded. Explicit NULL sorting avoids dialect defaults.

## Dialect ownership and possible routing

The user correctly noted PRQL and Kysely overlap in SQL rendering. With PRQL, use:

```text
typed / future semantic frontend
  -> verified PRQL lowering
  -> PRQL SQL compiler
  -> SQL + verified bindings
  -> driver / execution controls
```

Do not translate generated SQL back into Kysely merely to render it again. This probe uses Kysely only as the existing connection/execution harness (`CompiledQuery.raw` over compiler output and separate parameters). Metadata, pooling, authentication, cancellation, normalized results and semantic capability policy remain Golden concerns. Public-client cancellation with PRQL has not been integrated/tested.

Keeping Substrait and adding a PRQL SQL target is conceptually possible, but **no Substrait-to-PRQL bridge was implemented or verified**. An additional emitter needs full-plan semantic certification, not a list of supported database names. Avoid catch-any-error fallback: it could hide invalid queries, integration errors, or change semantics. For a future prototype choose the compiler for the whole query before execution using explicit capabilities; do not mix arbitrary Kysely/PRQL SQL fragments or silently retry execution via another path.

Other research candidates: SQLGlot (Python SQL AST/transpiler), Calcite (JVM relational-to-SQL), jOOQ (JVM SQL builder/translator; verify dialect-specific edition/license), DataFusion unparser (Rust plan-to-SQL). These are not equivalent drop-in Node dependencies and were not tested. Parser dialect acceptance is not SQL-output or semantic conformance.

## Typed API and semantic frontend boundary

A TypeScript binding does not schema-check PRQL source strings. Existing callback-free typed expressions currently construct Substrait; preserving them requires a translation bridge or frontend refactor. The spike removed **zero production lines** and measured no completed adapter cost. PL/RQ JSON APIs exist but require version-stability assessment; serializable internal structures are not automatically standard interchange contracts.

A future measure can lower to aggregation; previous-year comparison first needs calendar, missing-period, filter-context and grain decisions. Neither PRQL nor Substrait automatically handles DAX semantics. Actual Malloy already has a SQL compiler and nested-result metadata. No DAX/Malloy bridge or M-compatible execution system was built.

## Decision and remaining scope

Defer replacement pending safe MySQL binding, deliberate NULL/decimal adaptation, complete freight/percentile testing, preserved TypeScript guarantees and measured maintenance benefit. A bounded PG/DuckDB PRQL frontend remains a plausible separate experiment. The conclusion is based on reproduced behavior, not the mere presence of upstream bugs.

Untested: full freight execution, complete percentile rewrite, wider empty-order/duplicate/join corpora, arbitrary collations/overflow, identifier-input validation for a future bridge, public-client lifecycle integration, Node 22 packaging and semantic frontend mapping. Existing core tests are separate; no general compatibility claim is made. No upstream report was posted because several findings are intentional semantics or need narrower diagnosis.

## Sources

- https://github.com/PRQL/prql (status and Apache-2.0 license)
- https://prql-lang.org/book/project/bindings/javascript.html
- https://prql-lang.org/book/reference/syntax/parameters.html
- https://prql-lang.org/book/reference/stdlib/
- https://github.com/PRQL/prql/blob/main/prqlc/prqlc/ARCHITECTURE.md
- https://github.com/PRQL/prql/issues/2981
- https://db.cs.cmu.edu/events/sql-death-prql-pipelined-relational-query-language/
- https://db.cs.cmu.edu/events/sql-death-malloy-a-modern-open-source-language-for-analyzing-transforming-and-modeling-data/
- https://sqlglot.com/
- https://calcite.apache.org/javadocAggregate/org/apache/calcite/rel/rel2sql/RelToSqlConverter.html
- https://www.jooq.org/doc/latest/manual/sql-building/sql-parser/sql-parser-translator/
- https://datafusion.apache.org/python/autoapi/datafusion/unparser/index.html

CMU abstracts were reviewed, not full recordings.
