# Substrait-defined API versus PRQL-defined API

Research checkpoint, September 29, 2026. Related: #36, #38. **Proposal, not an accepted migration.** Production code and default semantics remain unchanged.

Update: the [follow-up experiment](FOLLOWUP.md) now verifies PRQL percentile composition on bounded fixtures and identifies Isthmus/DataFusion SQL consumers. The A pipeline below is Golden's current lowering option, not the only possible way to consume Substrait. Full Northwind/exact-decimal percentile and consumer integration remain unverified.

User priority clarified afterward: favor TypeScript/Node and the typed frontend. Compare the current TS implementation with in-process PRQL npm/WASM first; JVM/Python services and custom Rust bridges remain future references. Source-only PRQL is a tradeoff example, not an accepted replacement for schema-aware TypeScript.

The user explicitly permits reconsidering Golden's API semantics. This comparison therefore does not require preserving every prototype behavior. The question is which existing contract to adopt, and how much compiler and integration work Golden would still own.

## Evidence and versions

- Existing [probe and results](README.md): prqlc 0.13.14, Node 24.19.0 on Windows; 59 observations, not 59 passing conformance tests. This research update does not rerun database tests.
- Substrait v0.63.0, matching [vendored provenance](../../vendor/substrait/PROVENANCE.md). Official function definitions below are pinned to that version, not inferred from the latest website.
- PRQL release 0.13.14 was published July 24, 2026; source and bindings inspected at that tag. Current documentation is linked separately for status, not substituted for the pinned implementation.
- Golden [function identities](../../src/functions.ts), [declarations](../../spec/golden-functions.yaml), [lowering](../../src/relational.ts), [API](../../src/api.ts) and [challenge assumptions](../../docs/CHALLENGE-COVERAGE.md) were inspected.

## The important distinction

| Question | A: Substrait-defined API | B: PRQL-defined API |
| --- | --- | --- |
| Contract adopted | Pinned official relation/type/function definitions, with a supported subset | Pinned language/compiler/stdlib behavior, with tested backend scope |
| Application interface | Thin typed Table/Expr builder, or raw plans if explicitly desired | PRQL source directly, or a new typed builder that produces PRQL |
| Internal boundary | Standard Substrait plan, with explicit types and function identities | PRQL source or version-pinned PL/RQ; these are different integration choices |
| SQL generation | Golden relational lowering remains, followed by Kysely | PRQL handles query-block construction and dialect rendering |
| Work saved | Less invention of function contracts; standard plan representation | Potentially removes much relational-to-SQL lowering as well as SQL rendering |
| Work retained | Type/schema propagation, validation, function mapping, rewrites, all execution adapters | Binding/identifier safety, typed frontend if retained, unsupported-feature policy, all execution adapters |
| Main risk | Calling functions standard while lowering does not actually implement their contracts | Assuming generated SQL guarantees identical numeric behavior or that a TS binding gives schema-aware TS queries |
| What neither supplies | Business metric definitions, DAX context/calendar rules, ready-made federation, all connectors, auth, result representation, deadlines | Same |

The deciding tradeoff is **standard plan interoperability versus compiler reuse**. Both can reduce custom semantics; only the evaluated PRQL path supplies the relational-to-SQL compiler itself. Neither makes the remaining backend contract disappear.

## A. Adopt official Substrait semantics

Proposed pipeline:

```text
typed Table/Expr API with explicit types/casts
  -> official Substrait function identities + selected options
  -> supported-profile validation
  -> Golden relational/function lowering
  -> Kysely -> SQL and bound parameters -> backend
```

Currently every supported function uses the custom golden-functions.yaml URI. The analytical compiler accepts only that URI. A subset does **not** require custom functions: supporting a few official functions is a separate, valid design. However, changing just the URI would falsely label several current behaviors as standard.

| Operation | Official v0.63 contract inspected | Current Golden difference / consequence |
| --- | --- | --- |
| Integer AVG | Truncates fractional values, returns the input integer width | Golden casts integer input to fp64 first. Under the proposed API, integer AVG could follow the official rule; callers explicitly cast when they want fractional averages. This is a deliberate API/result-type change. |
| Integer SUM | Integer overloads return nullable i64 | Golden returns fp64. Adopting i64 requires result types, overflow decisions and driver representation checks, not only changing generated SQL. |
| SUM / SUM0 | Arithmetic SUM has NULL empty result; SUM0 has zero empty result | These are distinct standard choices. PRQL's zero-empty SUM resembles this aspect of SUM0; the names alone are not equivalent signatures. |
| Decimal SUM / AVG | Decimal SUM and AVG use precision 38 and input scale S in the inspected definitions | Golden fixes scale to 10. Official definitions have their own constraints; adopting them does not automatically produce arbitrary precision. |
| Integer division | Truncates toward zero, with zero-division options | Golden non-decimal division is floating point with NULL on zero. Explicit cast or a changed API contract is needed. |
| Decimal division | Precision/scale derived from input types | Golden fixed (38,10) and DuckDB-specific exact division cannot simply be relabelled. |
| COUNT | Generic library has argument and no-argument overloads returning i64, with overflow options | Golden has one-argument COUNT; public row count becomes COUNT(1). Verify NULL behavior and options before adopting. The pinned YAML's argument-count description is terse; do not replace it with newer website wording as proof. |
| Percentile | This bounded audit has not established a matching official identity | Keep the custom identity until a matching definition and backend implementation are verified. This does not assert all Substrait extensions lack percentile. |

Sources: pinned [arithmetic](https://github.com/substrait-io/substrait/blob/v0.63.0/extensions/functions_arithmetic.yaml), [decimal arithmetic](https://github.com/substrait-io/substrait/blob/v0.63.0/extensions/functions_arithmetic_decimal.yaml), [generic aggregates](https://github.com/substrait-io/substrait/blob/v0.63.0/extensions/functions_aggregate_generic.yaml).

Do not preserve old convenience implicitly merely to avoid changing tests. If the user chooses official integer AVG, update the API documentation, inferred output schema, query callers and expectations together. Explicit cast-to-fp64 plus AVG is an alternative expression of fractional-average intent, not permission to insert hidden casts everywhere. A public cast and its validated lowering are new work, not currently guaranteed by SQL casts used inside the compiler.

### Bounded implementation plan for A

1. Select one pinned official function library set and decide input/output/options for each supported signature. Keep business choices in #38 separate.
2. Start with one vertical slice, such as integer SUM and explicitly floating AVG. Add independent expected results, null/empty cases, overflow boundaries and positive/negative type tests before implementation.
3. Extend the allowlisted resolver to recognize official identities/signatures. Reject unsupported options instead of ignoring them. Keep URI/version migration separate from semantic migration.
4. Change typed expression output types and SQL lowering together. Preserve exact i64/decimal values through the result boundary; do not claim wire types prove JavaScript runtime representations.
5. Migrate callers and record intentional changed results. Remove obsolete custom definitions only after all producers/consumers are migrated. Do not keep dual behavior indefinitely without a compatibility need.

Expected maintenance reduction is mainly semantic invention and documentation, not SQL compiler code. The standard specifies contracts; someone must still implement them on each database. A future independent engine can consume plans only if its version, types, functions and options overlap. Standard protobuf serialization alone does not guarantee that overlap.

## B. Adopt PRQL semantics and compiler

### B1. PRQL source as the public query language

```text
PRQL source + separately bound values + catalog/backend selection
  -> pinned prqlc
  -> generated SQL + verified binding map
  -> existing execution adapter
```

This saves the most frontend/compiler work. The application accepts PRQL syntax, including its aggregate choices. The [Node binding](https://prql-lang.org/book/project/bindings/javascript.html) provides compile and intermediate conversion functions through WASM. A Rust compiler does not move database execution into Rust or prove end-to-end performance benefits; the databases still execute SQL remotely.

PRQL source strings do not provide the current TypeScript schema-aware column checks or inferred result types. Compiler type analysis is a different layer. Accepting B1 therefore means either accepting this change in developer experience or implementing a separate checked generation layer. Arbitrary source execution also needs a defined trust boundary: compiler support for raw SQL fragments is not the same as our current restricted typed API.

### B2. Preserve a typed TypeScript frontend, produce PRQL

This retains the preferred callback-free user experience but is a larger integration project. The frontend must preserve relation identity, scope, aliases, schema propagation, safe identifiers, literal/parameter separation and source locations. Do not describe this as a free consequence of installing prqlc.

There are two possible boundaries:

- **Generate PRQL source:** readable/debuggable and uses the language interface, but needs a tested structured source generator. Never concatenate untrusted fragments or values into source.
- **Generate PL or RQ:** the JS binding exposes JSON conversion APIs. This is real access, not an imaginary feature. However, PL and RQ are compiler-specific representations. RQ is already resolved; constructing it can move name/type/identity work back into Golden. We have not established a stable cross-version interchange guarantee or a schema-aware TypeScript builder for these structures.

Prefer source for a first bounded PRQL proof, unless direct PL/RQ generation demonstrates less code and equally strong validation. The [pinned compiler architecture](https://github.com/PRQL/prql/blob/0.13.14/prqlc/prqlc/ARCHITECTURE.md) shows PR -> PL -> RQ -> PQ -> SQL AST -> SQL. PRQL source is not itself RQ; replacing Substrait with 'PRQL IR' must name the actual boundary.

### What accepting PRQL semantics resolves, and what it does not

| Existing finding | If PRQL semantics are adopted |
| --- | --- |
| SUM empty/all-NULL gives 0 | Can be accepted and documented once; no obligation to restore Golden NULL. |
| count(column) includes NULL | Can be accepted. Public row-count and non-null-count intent must remain unambiguous. |
| MySQL average scale differs | Still choose result precision/tolerance or explicit casts; language adoption alone does not make results identical. |
| DuckDB decimal division loses tested exact value | May be allowed under an explicitly approximate contract; cannot claim exact decimal arithmetic. Independent direct SQL reproduces the behavior. |
| MySQL rejects generated $1 bindings | Still an integration blocker. A language-contract change cannot make the driver bind the placeholder correctly. |
| take $1 rejects | Still a feature gap for parameterized N. A validated integer literal is a possible contract change, not an already-tested production solution. |
| Built-in percentile unresolved | Still implement/verify a bounded PRQL expression or declare unsupported. The two-point interpolation probe is not full country-percentile conformance. |
| Freight query compiled only | Must execute and verify; no inference of correctness from successful compilation. |

The [pinned stdlib](https://github.com/PRQL/prql/blob/0.13.14/prqlc/prqlc/src/semantic/std.prql) documents count including NULL; [SQL stdlib](https://github.com/PRQL/prql/blob/0.13.14/prqlc/prqlc/src/sql/std.sql.prql) annotates SUM with zero coalescing and supplies dialect division implementations. See existing probe evidence for actual backend results. Parameterized take is also tracked in upstream [#2981](https://github.com/PRQL/prql/issues/2981), still open at this check.

### Bounded implementation plan for B

1. Choose source-first versus preserving the typed frontend. Do not begin by inventing a third proprietary IR.
2. Define the adopted contract, allowing intentional differences from old Golden tests. Retain security, backend consistency within stated tolerances, and truthful exactness guarantees.
3. Resolve MySQL placeholder binding structurally (upstream compiler change or a vetted SQL-aware adapter), including repeated/reordered parameters and hostile values. No regex replacement or value interpolation.
4. Finish all six queries, including real freight execution and complete percentile/edge fixtures. If a handwritten compiler reappears to fill gaps, count its cost against the proposed savings.
5. If preserving typed API, prove one join + aggregate + projection path and type-negative cases before committing to migration. Measure removed production compiler code versus added source/IR/binding adapters; the present spike removed zero production lines.
6. Integrate catalog validation, stable errors, result representation, timeout/cancellation and cleanup. The existing synchronous WASM compile call is not made interruptible by an AbortSignal alone.
7. Switch one production pipeline only after the gate passes; do not maintain an unbounded Substrait/PRQL fallback system.

## Long-term support and version risk

Current PRQL [target documentation](https://prql-lang.org/book/project/target.html) lists PostgreSQL, MySQL and DuckDB as supported. MSSQL, Snowflake and BigQuery are listed as unsupported targets with limited/no testing; Oracle is very early. Databricks is not a listed target there. This matters for Golden's wider BI connectivity goal: having a target name is not a connector or a conformance guarantee. Cloud offerings such as Fabric/AWS also require selecting the actual service/SQL engine.

Substrait is not a database-driver inventory at all. With A, each SQL backend needs Golden lowering/capability tests or a separately evaluated consumer. Neither option gives Power Query-style connector coverage or federation automatically.

Both require version pinning. Substrait's [version policy](https://substrait.io/spec/versioning/) is still pre-1.0 and permits breaking changes. Its [URI-to-URN migration](https://substrait.io/spec/breaking_change_policy/) illustrates why current docs cannot be blindly applied to Golden v0.63. PRQL's target/version documentation says compiling according to a query's major language version is not yet implemented. Exposed PL/RQ JSON should therefore be treated as version-coupled unless stronger compatibility evidence is obtained. Neither project should be called permanently stable merely because it is open source.

## Recommendation and decision gate

**For the current submission:** retain the working architecture, describe custom functions honestly, and resolve business ambiguity with #38. Do not claim a standard-function migration has happened. A broad change in either direction requires fresh cross-backend validation and should not displace the candidate README/video.

**For the next architecture decision:**

- Prefer **A** if schema-aware TypeScript and an independent cross-language plan boundary are firm requirements, and Golden is willing to own SQL lowering. Adopting official contracts is meaningful work, not a URI cleanup.
- Prefer **B1** if adopting a query language and reusing its SQL compiler matter more than preserving the current TS builder. This is the strongest PRQL maintenance-saving case.
- Consider **B2** only after a typed generation prototype and completed backend gate show a net reduction in code/obligations. It is not yet justified by the successful nested-aggregate examples alone.

Do not pick A just because it is already implemented, or B just because its source looks concise. Current evidence supports PRQL's query-block construction and exposes concrete adoption gaps; it does not yet prove a full replacement is cheaper. The next discriminating experiment is safe MySQL binding plus complete percentile, followed by a minimal typed frontend bridge if that remains required. No new production compiler is authorized by this report.

Documentation can remain short under either choice: cite a pinned upstream contract, list supported functions/options and deviations, then separately explain challenge-specific business assumptions. A standard reduces duplicated specification; it does not eliminate verification or the need to state what is unsupported.
