# Architecture decision: portable analytical query API

Status: PROPOSED. No implementation choice has been accepted yet.

## Requirements

- Prefer Node.js/TypeScript.
- Express selection/projection, filtering, joins, aggregation, and calculations independently of the target database.
- Execute against the supplied PostgreSQL and MySQL databases.
- Extend the implementation and shared test harness to additional backends.
- Demonstrate one extension after the basic API works.
- Reuse established compiler machinery where practical.

The challenge does not explicitly require an HTTP service, serialized query format, SQL text input, optimizer, or execution engine. Those are separate scope decisions.

## Distinguish the representations

- SQL AST: clauses and expressions representing a SQL query.
- Logical relational algebra: reads, filters, joins, projections, aggregates, and sorts describing query semantics. This does not require prescribing physical execution algorithms.
- Physical plan: implementation choices such as join algorithms and execution scheduling, which remain the database's responsibility here.
- A library AST that can be serialized is not automatically an independent cross-language standard.

## Options researched

| Option | Strength | Cost or limitation here |
| --- | --- | --- |
| Kysely | TypeScript query builder with SQL operation nodes and PostgreSQL/MySQL dialect compilers | Library API, not a cross-language IR standard; semantic differences still need handling |
| Substrait | Open Protobuf interchange specification for relational algebra | Requires a supported conversion path to target SQL, schema/function handling, and a defined supported subset |
| DataFusion | SQL AST ecosystem, logical plans, native Protobuf serialization, Substrait conversion, and SQL unparser | Rust/Python integration adds scope; operator and function coverage must be tested |
| Malloy | BI semantic modeling/query language that compiles to backend SQL; query-builder package | Adopts Malloy's model and semantics; interface stability and required feature coverage need evaluation |
| Trino | SQL parser/AST and federated query engine | Java/engine integration; its client SQL interface is not a generic portable SQL AST contract |
| SQLGlot | SQL expression AST and dialect translation | Python dependency; serialized AST is library-specific |
| Apache Calcite | SQL AST, relational algebra, validation and compiler framework | JVM integration and substantial scope for this challenge |

Sources:

- https://kysely-org.github.io/kysely-apidoc/interfaces/Dialect.html
- https://substrait.io/spec/specification/
- https://github.com/apache/datafusion-sqlparser-rs
- https://datafusion.apache.org/python/autoapi/datafusion/substrait/index.html
- https://datafusion.apache.org/python/autoapi/datafusion/unparser/index.html
- https://github.com/malloydata/malloy
- https://github.com/malloydata/malloy/tree/main/packages/malloy-query-builder
- https://trino.io/docs/current/develop/client-protocol.html
- https://sqlglot.com/
- https://calcite.apache.org/javadocAggregate/org/apache/calcite/sql2rel/SqlToRelConverter.html

These are candidate capabilities, not verified compatibility with every challenge query. In particular, DataFusion's SQL unparser means a Substrait-to-SQL path is worth investigating rather than assuming an entire compiler must be written from scratch.

## Recommended challenge architecture

Use a TypeScript library built on Kysely's public query-builder API. Keep query definitions separate from backend connection/execution adapters. Add a narrow layer for portable analytical operations only where dialects require different SQL. Avoid inventing a general SQL AST or exposing library internals as a persisted wire contract.

```text
Driver / application
    -> shared query definitions and analytical helpers
    -> selected backend adapter + Kysely dialect compiler
    -> SQL with bound parameters
    -> PostgreSQL or MySQL
    -> documented result normalization
```

Each backend supplies connection configuration, compiler/dialect, capabilities, execution, and shutdown. Unsupported operations fail explicitly. Query values are bound; identifiers come from typed/validated query structure. Raw SQL, if needed inside an adapter, uses trusted templates with bound values.

For a production requirement to exchange queries across languages or independent systems, reassess Substrait plus an existing compiler bridge. For a BI semantic modeling product, evaluate Malloy before building equivalent modeling behavior. These are architecture choices, not automatic later upgrades.

## Semantics to define before implementing samples

- Recent orders: deterministic date ordering, tie-breaking by order ID, and explicit null ordering.
- City filter: define case matching explicitly; backend default collations differ.
- Units per order: average per-order quantity totals, not average line-item quantities; decide how empty orders count.
- Shipped versus unshipped: shipped-date nullness; include employees with zero orders.
- Freight ratio: aggregate freight once per order to avoid join multiplication; define whether price includes discount, and define zero-denominator behavior.
- Percentile: specify continuous or discrete, exact or approximate, and treatment of nulls. Verify backend support before choosing an implementation.
- Results: document decimal precision, count representation, dates, nulls, and comparison tolerances. Do not silently coerce all decimals to JavaScript numbers.

## Validation strategy

- Run shared integration cases against both provided databases through backend factories.
- Check independently calculated expected results or reference queries, not only backend agreement.
- Cover parameter binding, deterministic limits, null handling, aggregate grain, and zero denominators where fixtures allow.
- Use focused compiler checks for dialect-specific helpers; avoid tests that merely duplicate implementation.
- Close connections reliably; report unsupported capabilities clearly.

## Decisions pending

1. Is a cross-language serialized IR required now, or is a TypeScript query API sufficient?
2. Accept Kysely, or perform a focused Malloy/Substrait compiler feasibility spike first?
3. Choose one extension. Candidate: portable window ranking (top products per category), separately demonstrated and tested. This remains a proposal.

Acceptance should record the selected option, rejected alternatives, and the user's rationale before implementation begins.
