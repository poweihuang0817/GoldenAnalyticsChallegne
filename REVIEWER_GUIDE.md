# Reviewer guide

This guide maps the requested deliverables to their locations. It is AI-assisted navigation material; the candidate's design narrative is in the [README](README.md).

## Deliverables at a glance

| Requested deliverable | Where to look | How to review |
| --- | --- | --- |
| Five-minute API/design video | **Pending: candidate will add the video link here or in the README before submission.** | API usage, design decisions, real query results and DuckDB extension |
| Driver application showing sample queries | [CLI driver](src/demo.ts), [query definitions](src/queries.ts) | `npm run demo` executes eight examples on each of PostgreSQL and MySQL; these include all six sample-query families (two city inputs) and a ranking example |
| One extension | [DuckDB extension](docs/DUCKDB.md) | `npm run seed:duckdb`, then `npm run demo:duckdb`; the same queries execute on a local snapshot |
| Additional advanced SQL feature | [Window extension](docs/WINDOW-EXTENSION.md), `recentOrdersPerCustomer()` in [queries](src/queries.ts) | `withRowNumber()` partitions by customer, orders by date/ID, then filters to each customer's most recent N orders; included in the CLI driver on all three backends. Support is bounded to row-number ranking, not arbitrary window functions. |
| Test suite using the provided databases | [Test methodology](docs/TEST-METHODOLOGY.md), [challenge tests](test/challenge.test.ts), [three-backend conformance](test/duckdb-integration.test.ts) | Run the commands below; integration uses the supplied PostgreSQL/MySQL image |
| Candidate README: API design | [README architecture and API usage](README.md), [detailed design rationale](docs/api/design.md) | Typed Table/Expr -> constrained Substrait -> Golden lowering -> Kysely -> backend |
| Major AI prompts and candidate redirects | [AI usage record](Manual_Record_AI_Usage.md), [detailed AI log](docs/AI-LOG.md) | Candidate notes and recorded architecture/API/testing decisions; later AI-assisted edits are disclosed in history |
| What more time would enable | [README future work](README.md#future-work), [future-work notes](docs/FUTURE-WORK.md) | Additional verification, metadata/semantic tooling and production concerns; research is not claimed as implemented |

## Start here

Requires repository access, Node.js 22+, Docker Engine and Docker Compose. From the repository root:

```sh
npm ci
docker compose up -d --wait --wait-timeout 180
npm run demo
npm run seed:duckdb
npm run demo:duckdb
```

The Compose image is `goldenbeers/golden-query-challenge:1.0`, with PostgreSQL 17, MySQL 8 and preloaded Northwind. Built-in sample connection defaults match it. Full cloning, configuration, port and shutdown instructions: [Setup, driver, UI and tests](docs/RUNNING.md).

DuckDB seeding replaces four demo tables in the dedicated local snapshot. Stop processes using that file before refreshing it. PostgreSQL/MySQL analytical work runs remotely; DuckDB is a separate snapshot, not federation.

## Optional visual walkthrough

After setup and seeding:

```sh
npm run demo:ui
```

Open **http://127.0.0.1:4317**. Live driver offers eight fixed examples and all three backends. Compile previews SQL/plan; Run displays real database results. API guide and Architecture pages support the walkthrough. This is a local demonstration, not an arbitrary-query editor. See [UI details](docs/DEMO-PAGE.md).

## Verification

With the supplied databases running, stop the UI and run:

```sh
npm run check
npm run check:docs
npm test
npm run test:integration
npm run test:duckdb
```

The suite combines compile-time negative cases, component tests, real-engine integration, independent reference calculations, cross-backend comparison and a small deterministic metamorphic corpus. Agreement across backends alone is not treated as proof. See [CI workflow](.github/workflows/fresh-clone.yml) and [CI notes](docs/CI.md); inspect the Actions run for the exact submitted commit rather than relying on older checkpoints.

## Query definitions and limits

[Challenge coverage](docs/CHALLENGE-COVERAGE.md) maps the six query families to features. [Query semantics](docs/QUERY-SEMANTICS.md) explains ambiguous interpretations, chosen defaults and measured contrasts. Alternative calculations in that document do not imply every variant is supported by the public API.

The implementation supports a [constrained Substrait profile](docs/SUBSTRAIT-PROFILE.md), not arbitrary Substrait. It uses Golden-specific function semantics. Malloy, PRQL, Ossie integration and federation are not implemented. [Execution controls](docs/EXECUTION-CONTROLS.md) describe running-query timeout/cancellation and their limits, if needed for deeper review.

## Final handoff

- Video URL: **pending candidate recording/upload**.
- Submitted commit/version: **pending final selection**.
- Private repository and video reviewer access: **pending candidate confirmation**.

These are explicit outstanding handoff items, not claims of completed delivery. The working [submission checklist](docs/SUBMISSION-CHECKLIST.md) tracks them.
