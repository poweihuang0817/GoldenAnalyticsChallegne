# Research closeout: PRQL, Ossie and Malloy

September 30, 2026. Submission decision: **retain the typed TypeScript API -> constrained Substrait -> Golden lowering -> Kysely path**. PRQL and semantic-model adoption are deferred. This closes the current research round with a decision, not a claim that all feasibility tests are complete. No runtime or dependency changes accompany this document.

## Different problems, different tools

| Candidate | Useful reusable part | Work that would remain for Golden |
| --- | --- | --- |
| Substrait (current) | Standard relational plan/types and referenced function contracts | Supported profile, SQL lowering, backend conformance; current custom Golden function identities are not automatically official function semantics |
| PRQL | Pipeline language and SQL compiler available to Node through npm/WASM | Typed frontend, parameter/execution integration, semantic and numeric conformance |
| Ossie | Semantic-model interchange: datasets, relationships, named metrics and expressions | A consumer that resolves queries, grain and joins and produces executable plans; no verified Golden consumer exists |
| Malloy | Semantic modeling/query language with compiler, Node runtime and connectors | Adoption of its model/query/result semantics, compatibility checks and integration with our application |

Do not assemble all four merely because each is relevant. A future direct Malloy evaluation should first test its own SQL/runtime route. A Malloy-to-Substrait or Ossie-to-Malloy bridge is not established by this research. Neither is necessary for the submission.

## PRQL: promising compiler reuse, deferred integration

Evidence is preserved in [research PR #37](https://github.com/poweihuang0817/GoldenAnalytics/pull/37), pinned at [b91ea98](https://github.com/poweihuang0817/GoldenAnalytics/tree/b91ea98842559c566e4abb853ff47bdbc9137625/spikes/prql). These artifacts are on the research branch, not assumed to be merged into main. Evaluation used prqlc 0.13.14 and Node 24.19.0 on Windows.

- The original probe recorded 59 observations: 33 pass, 6 compile rejections, 5 execution rejections, 12 contract differences and 3 compile-only cases. Completion of the probe is not a passing conformance suite.
- A later continuous-percentile composition passed bounded inline fixtures on PostgreSQL, MySQL and DuckDB, including NULL, ties, singleton and empty grouped input. This is not complete Northwind or arbitrary exact-decimal validation.
- A typed callback-free filter/projection prototype passed type-negative and runtime scope checks; four PostgreSQL/DuckDB bound executions passed. Typed joins/aggregation and nullable result propagation remain unverified.
- MySQL rejects the generated dollar placeholders when executed through mysql2, independently of Kysely. Other PRQL-generated MySQL queries ran successfully. This is an integration blocker for safe dynamic parameters, not evidence that PRQL cannot target MySQL.
- PRQL aggregate semantics can intentionally differ from Golden. Accepting those semantics is a possible product decision; it does not fix driver binding or decimal precision. The native DuckDB decimal-division control also lost exactness, so that finding must not be attributed solely to PRQL.

See the pinned [typed experiment](https://github.com/poweihuang0817/GoldenAnalytics/blob/b91ea98842559c566e4abb853ff47bdbc9137625/spikes/prql/TYPED-FRONTEND.md) and [follow-up results](https://github.com/poweihuang0817/GoldenAnalytics/blob/b91ea98842559c566e4abb853ff47bdbc9137625/spikes/prql/FOLLOWUP.md). These are historical executed evidence, not tests rerun for this closeout. The official [JavaScript binding](https://prql-lang.org/book/project/bindings/javascript.html) supplies compilation/conversion APIs; it does not supply a MySQL execution driver or our TypeScript schema-aware frontend.

**Restart only with a bounded migration question** under [#36](https://github.com/poweihuang0817/GoldenAnalytics/issues/36):

1. Select the desired language semantics explicitly; old Golden defaults are revisable, not challenge requirements.
2. Prove safe MySQL binding with repeated/reordered parameters and untouched literals, comments and identifiers. Compare an upstream compiler change with a SQL-aware adapter; no interpolation or regex replacement. Neither solution is implemented in the saved experiment.
3. Execute all six Northwind families with independent expected results, including freight and country percentile; state precision and result representation.
4. Prove typed joins/aggregation, NULL propagation and relation scopes, plus Node 22 packaging and execution lifecycle integration.
5. Measure compiler code removed against frontend, adapter and possible fork obligations before proposing adoption.

Stop if these require building another compiler. The current decision is DEFER, not REJECT, and no further parameter-adapter prototype is required for delivery.

## Ossie: useful metric definitions, not an adopted execution chain

Pinned source: [core specification at edbcf796](https://github.com/apache/ossie/blob/edbcf7962dc15b4f9ea716e9820280fbba070adc/core-spec/spec.md), version 0.2.0.dev0, explicitly DRAFT. It defines dataset relationships from many to one and named metrics with expressions and optional descriptions, logical types and AI context. Decimal precision/scale are unspecified in its logical Decimal vocabulary.

The [expression-language document](https://github.com/apache/ossie/blob/edbcf7962dc15b4f9ea716e9820280fbba070adc/core-spec/expression_language.md) contains aggregate, percentile, conditional, date/time and window definitions. This is a specification source, not proof that a consumer implements all expressions. [Upstream PR #395](https://github.com/apache/ossie/pull/395) was open when checked on September 30; it corrects a percentile syntax example, not a runtime algorithm.

Tooling is not absent: the repository includes schema validation assets and [Cube converter code](https://github.com/apache/ossie/tree/edbcf7962dc15b4f9ea716e9820280fbba070adc/converters/cube), with Python implementation files. We inspected sources, not an installed converter or an end-to-end execution path. Structural validation cannot establish correct aggregation grain or cross-database metric results.

For example, a named percentile metric over an existing order-grain dataset can centralize a definition. It does not by itself create that dataset from details, stop freight multiplication across joins, or determine country grouping. Those are consumer/planner responsibilities. No executable model or invented compatibility schema is delivered here.

**Restart gate for [#39](https://github.com/poweihuang0817/GoldenAnalytics/issues/39):** identify a real model exchange consumer; pin its schema; validate one canonical order-price definition, relationships and requested query; demonstrate a Node-compatible execution or lowering path on an adversarial fan-out fixture. Report schema validity, semantic correctness and runtime compatibility separately. If a new generic semantic engine is needed, seek a separate scope decision.

## Malloy: evaluate directly if semantic modeling becomes the product need

Malloy is materially different from a model schema alone. Its [official repository](https://github.com/malloydata/malloy) documents Node runtime use with a compiler and connections, producing SQL for existing database engines. Pinned [MySQL package source](https://github.com/malloydata/malloy/blob/537c18c91578b81f760ed18099ce092c2fe5e675/packages/malloy-db-mysql/package.json) declares version 0.0.435, Node >=20 and mysql2. Its [query-builder package](https://github.com/malloydata/malloy/tree/537c18c91578b81f760ed18099ce092c2fe5e675/packages/malloy-query-builder) is relevant programmatic-query prior art. Package/source availability is not proof of a stable drop-in API or Golden query conformance.

No Malloy runtime was installed or executed in this closeout. A direct adoption experiment would first model order price once, query it by country and customer, and verify fan-out protection, exact numeric behavior, safe user inputs and all required database connectors. Also test whether the desired TypeScript authoring/result types survive integration. Compare this direct route with maintaining a new semantic planner above Substrait before proposing a bridge.

## Submission boundary and verification

The current research is sufficient to explain why these tools were investigated and why none is adopted now. It is not a certification of their feature coverage. The remaining business interpretations are tracked separately in [#38](https://github.com/poweihuang0817/GoldenAnalytics/issues/38); no language can decide whether a business price includes freight or whether empty orders count without a chosen contract.

This closeout checked live issue/PR state, pinned upstream sources, research artifacts, document links and `git diff --check`. No database tests were rerun and no candidate-authored README was written. Future issues remain open as deferred work. Finish submission documentation, video, access and exact-version verification before restarting these experiments.
