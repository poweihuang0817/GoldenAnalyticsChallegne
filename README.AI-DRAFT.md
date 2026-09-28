# Golden Analytics — AI README draft

> **AI-authored working draft, requested by the candidate on September 28, 2026.**
> This is supporting material, not the candidate-authored submission README required by the challenge. The candidate should check the claims, select the explanation they agree with, and write the final README in their own words. Actual time spent and the video link must be supplied by the candidate.

## What the project does

A small Node/TypeScript library expresses analytical queries independently of a relational database's SQL dialect. One logical query can execute on PostgreSQL, MySQL or DuckDB. It supports the six Northwind challenge query families, and demonstrates additional window ranking and a DuckDB backend.

PostgreSQL and MySQL execute queries remotely against the supplied `goldenbeers/golden-query-challenge:1.0` image. DuckDB executes the same query descriptions against a local snapshot copied from that image's PostgreSQL database. It is a separate execution target; no query is silently rerouted to DuckDB.

The working implementation baseline is [`d8a5fb0`](https://github.com/poweihuang0817/GoldenAnalytics/commit/d8a5fb024f89e2a15cf3ac5a537cf48f260af7b6). CI, directory reorganization and compiler consolidation are post-MVP work and are not prerequisites for this baseline.

## Quick start

Prerequisites: repository access, Node.js 22 or newer, npm, and Docker with Compose. Local verification used Node 24 on Windows. Use `npm.cmd` if PowerShell blocks `npm.ps1`.

```sh
git clone https://github.com/poweihuang0817/GoldenAnalytics.git
cd GoldenAnalytics
npm ci
docker compose up -d --wait
npm run check
npm test
npm run test:integration
npm run test:duckdb
npm run demo
```

Ports 5432 and 3306 must be available. If the challenge container is already running on those ports, reuse it instead of starting another container. Compose corrects a PostgreSQL socket-path error in the image's default healthcheck.

The image's sample database/user/password are all `northwind`; the adapters default to localhost. Set `POSTGRES_URL` and `MYSQL_URL` for another instance. These defaults are sample-image credentials; actual deployment credentials should stay outside Git and the logical plan.

For the DuckDB extension:

```sh
npm run seed:duckdb
npm run demo:duckdb
```

The seed reads a consistent snapshot of four source tables and replaces those tables in a dedicated local `northwind.duckdb` file. Set `DUCKDB_PATH` to use another destination. Use a dedicated demo file; do not refresh it while another process owns it. Seeding needs PostgreSQL, while the seeded DuckDB demo runs independently afterward. See [DuckDB provenance and limits](docs/DUCKDB.md).

An optional walkthrough page is available:

```sh
node --import tsx src/playground/server.ts
```

Open `http://127.0.0.1:4317`. It shows three fixed API examples, compiled SQL, Substrait and real results for PostgreSQL/MySQL. The driver demonstrates the wider query set, including DuckDB and window ranking. The page is localhost-only; its HTTP input timeouts do not cancel database queries. See [demo-page notes](docs/DEMO-PAGE.md).

## Northwind data used throughout the examples

All application examples use the Northwind data from the supplied challenge image. The logical catalog exposes the columns needed for these queries:

| Table | Role in the examples |
| --- | --- |
| `customers` | Customer ID, city and country for customer counts and grouping |
| `orders` | Order ID/date, customer, employee, shipped date and freight |
| `order_details` | Order ID, unit price, quantity and discount for order totals |
| `employees` | Employee ID for shipped/unshipped order counts |

An order belongs to a customer and an employee; its detail rows describe purchased products and quantities. The catalog is a selected view of Northwind, not the complete physical schema. All six challenge families are implemented in [src/queries.ts](src/queries.ts).

## Public API: count Northwind customers in London

For method signatures, defaults, expression rules, return types and failure boundaries, see the separate [API reference and Northwind recipes](docs/PUBLIC-API.md).

The API takes inspiration from Ibis's Table/Expression model, with no Ibis or Python runtime dependency. This example can be placed in a TypeScript file at the repository root:

```ts
import { createSource, count, literal } from './src/api.js';
import { challengeCatalog } from './src/challenge.js';
import { compilePlan } from './src/compiler.js';
import { connect } from './src/backend.js';

const source = createSource(challengeCatalog);
const query = source.table('customers')
  .filter(t => t.col('city').lower().eq(literal('london').lower()))
  .aggregate(() => ({ customer_count: count() }));

const plan = query.toSubstrait();
const db = connect('postgres'); // or 'mysql'; 'duckdb' after seeding
try {
  const compiled = compilePlan(db, plan, challengeCatalog);
  console.log((await db.executeQuery(compiled)).rows);
} finally {
  await db.destroy();
}
```

`source` captures a logical catalog, not a database connection. `Table` holds a relation description and output schema. `Expr` describes a column or calculation; `Measure` describes an aggregation. Transformations return new tables, allowing a base query to be reused without mutation.

The callback's `t` exposes columns from the current relation. It is not one row of fetched data. Callbacks run while constructing the query; filtering, joining and aggregation run in the selected database. Column scopes reject references captured from a different relation. This avoids silently reusing a positional field after a projection or aggregation changes its meaning.

Supported operations include projection, filters, inner/left joins, grouping and aggregation, ordering, pagination and a narrow `withRowNumber` window operation. Joins explicitly name their outputs and make the right side nullable for a left join. `count()` counts rows; `column.count()` counts non-null values. Runtime names/types are checked, but TypeScript result-row inference is not implemented.

## Query composition: average units per Northwind order

Average units per order requires two aggregation levels:

```ts
const units = source.table('order_details')
  .groupBy('order_id')
  .aggregate(t => ({ units: t.col('quantity').sum() }));

const query = source.table('orders').join(units, {
  how: 'left',
  on: (o, u) => o.col('order_id').eq(u.col('order_id')),
  select: (_o, u) => ({ units: u.col('units').coalesce(0) }),
}).aggregate(t => ({ average_units: t.col('units').avg() }));
```

For a concrete example, these three orders were read from the supplied Northwind PostgreSQL database:

| Northwind order ID | Detail quantities | Total units |
| --- | --- | ---: |
| 10248 | 12, 10, 5 | 27 |
| 10249 | 9, 40 | 49 |
| 10250 | 10, 35, 15 | 60 |

For this three-order subset, average units per order is `(27 + 49 + 60) / 3`, about 45.33. Averaging the eight detail quantities instead gives `136 / 8 = 17`, which answers a different question. These numbers illustrate the subset only; the API query above computes over all orders.

The compiler preserves the intermediate aggregation as a derived query. The left join also defines behavior for any order without details: it contributes zero units through `coalesce(0)`.

## Architecture and tradeoffs

```mermaid
flowchart TD
  API[TypeScript Table / Expr] --> IR[Supported Substrait plan]
  IR --> V[Profile and semantic validation]
  V --> L[Relational-to-SQL lowering]
  L --> K[Kysely SQL construction and parameters]
  K --> P[Remote PostgreSQL]
  K --> M[Remote MySQL]
  K --> D[Local DuckDB snapshot]
```

- **Substrait:** official v0.63.0 protobuf schemas and generated codecs/types provide a standard representation. The public API constructs relations directly; export adds root names and function declarations. JSON plans can also round-trip through protobuf binary. Standard schema support and the supported execution subset are separate concerns.
- **Validation:** structural/profile checks reject unsupported fields and relations. Compiler checks resolve fields against the catalog and verify function signatures/types. A valid protobuf message is not automatically executable by this project.
- **Lowering:** the project handles relational semantics, subquery boundaries, explicit NULL ordering and necessary backend differences. An operator cannot always be appended to a single SQL SELECT block.
- **Kysely:** supplies SQL construction, quoting, bound values and execution infrastructure. Database-specific behavior such as exact DuckDB decimal division still requires project code.
- **Execution:** the same logical query is compiled for a selected connection, then executed asynchronously. Compilation is separately testable. The current execution API exposes Kysely; a fully backend-neutral execution facade is future work.

The function registry uses Substrait's extension mechanism with an application-defined function library. It does not claim that those declarations are the upstream standard function library or that arbitrary Substrait plans are supported.

## Demonstration queries and semantics

See [src/queries.ts](src/queries.ts) for the application code and [src/demo.ts](src/demo.ts) for execution.

| Query | Important choice |
| --- | --- |
| Most recent N orders | Explicit NULL placement and order ID as a date tie-breaker |
| Customers in a city | Explicit lowercase comparison; no general Unicode/collation portability claim |
| Average units per order | Aggregate detail quantities per order first; empty orders count as zero |
| Shipped/unshipped per employee | Shipped-date nullness; include employees with no orders |
| Freight / order-price ratio per customer | Aggregate detail prices before joining freight; apply discounts; exclude freight from the price denominator |
| Country-level 75th percentile | Continuous linear interpolation, not an approximate percentile sketch |

The window extension ranks orders within each customer, then filters to the most recent N. It requires an outer relation after computing `row_number`; date ties are broken by order ID.

DuckDB demonstrates adding a third execution backend while retaining the public API and plan. Its Node adapter binds parameters and preserves result representations. Snapshot provenance, exact decimal behavior and limitations are documented in [docs/DUCKDB.md](docs/DUCKDB.md).

## Verification and known limits

The implementation baseline passed a fresh remote clone and `npm ci` on the existing Windows machine, with the running challenge databases:

- Type checking and 28 local/HTTP/embedded DuckDB tests.
- 16 PostgreSQL/MySQL integration tests.
- One three-backend conformance test covering the sample families and window top-N cases.
- Snapshot seeding and all three database driver demonstrations.

These **45 tests are local verification, not GitHub CI results**. An earlier window checkpoint also used a separately created challenge container. No clean-OS or general cross-platform guarantee is claimed. The optional demo page has HTTP tests, but its browser visual review remains pending.

Tests use hand-calculated fixtures, independent raw-row/BigInt oracles, PostgreSQL's native percentile as an additional check, binary round trips and direct backend comparisons. Agreement between databases is useful but does not independently establish correctness. Regression tests caught a join-scope/nullability leak and DuckDB decimal-division precision errors before fixes.

Important limits:

- Decimals use decimal(38,10) and string results; i64 counts/ranks are strings and DATE values are calendar strings. Non-decimal arithmetic/averages may use fp64. Division by zero returns NULL. Overflow and precision limits remain explicit.
- DuckDB exact decimal AVG is rejected; the challenge's average-units query uses fp64. Exact decimal division is bounded by its HUGEINT intermediate.
- No general casts, arbitrary windows, distinct/union, correlated queries, cross-source federation or complete type system. Percentile must be the sole measure in its aggregate.
- Two compiler paths remain. Public API function declarations currently select the analytical path. Consolidation and declaration cleanup require compatibility decisions and regression tests; see [issue #7](https://github.com/poweihuang0817/GoldenAnalytics/issues/7).
- Production capability resolution, authentication/authorization infrastructure, normalized errors, cancellation, streaming and observability are deferred. The logical catalog is not an authorization boundary.

## AI assistance and candidate direction

The following summarizes recorded prompts/redirections, rather than reconstructing an exact chat transcript. See [docs/AI-LOG.md](docs/AI-LOG.md) for the development history.

| Candidate direction | Effect on the work |
| --- | --- |
| Start by checking the supplied Docker image | Verified access and data; corrected the Compose PostgreSQL healthcheck |
| Use an established relational representation | Selected a constrained Substrait profile with Kysely lowering |
| Use official Substrait definitions and reject unsupported features | Replaced handwritten standard-shaped types with generated upstream-schema types/codecs and explicit validation |
| Prove lower-layer coverage before adding the friendly API | Implemented analytical query composition, then the Ibis-inspired facade |
| Explain whether percentile interpolation is approximate | Clarified continuous percentile semantics and added exact decimal checks/oracles |
| Add a separate extension and then DuckDB for submission | Implemented row-number ranking and the third backend |
| Review incrementally and fix concrete findings | Added regression coverage, preserved working behavior and deferred compiler consolidation |
| Freeze features and submit early | Selected the verified baseline; deferred CI/refactors and focused on delivery |

AI assisted with research, implementation, tests, reviews and supporting documentation. Candidate decisions and redirects are recorded above. The candidate should write their own assessment of what was useful, what they challenged and what they would change. Actual work duration has not been recorded here and must not be inferred from the dates or original time-box expectation.

## With more time

1. Broaden independent correctness cases: NULLs, duplicate preservation, outer-join predicates, nested aggregate boundaries and small generated queries with shrinking.
2. Introduce a small capability model with native/rewrite/unsupported outcomes that account for types and semantics.
3. Improve connection configuration, authentication/authorization boundaries and useful normalized errors, with secret redaction.
4. Consolidate compiler paths after defining compatibility, add inferred result types, and automate clean setup/database checks in CI.
5. Add cancellation, result limits, metadata discovery and structured diagnostics as real application requirements arise.

The broader [future-work notes](docs/FUTURE-WORK.md) preserve research into formal verification, additional engines and federation. Those are potential later directions, not completed work or submission commitments.

## Candidate completion checklist

- Write the final README in the candidate's own words; this file stays explicitly AI-authored.
- Record the five-minute walkthrough and add its accessible link.
- Enter actual time spent and check that the prompt/redirection account reflects the candidate's experience.
- Confirm reviewer access to the private repository and video.
- Select/tag the final delivery commit after submission documentation is complete.
