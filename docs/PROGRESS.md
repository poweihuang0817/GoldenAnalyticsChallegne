# Development progress (AI-assisted notes)

## Image verification — September 25, 2026

- Pulled `goldenbeers/golden-query-challenge:1.0`.
- Image digest: `sha256:2b42448660486dfb7778e74854e5888064ae8a004bbf6895ca68f57a81d38e0e`.
- Started container `golden-query-challenge`, exposing ports only on localhost.
- Verified PostgreSQL 17.10 and MySQL 8.4.11 with successful TCP queries inside the container network.
- Both databases are named `northwind`; sample username and password are both `northwind`.
- Each database has 830 orders.
- PostgreSQL has 11 public tables; MySQL also lists `order_lines` (object type not yet checked).
- The image has no MySQL CLI; verification used a temporary official `mysql:8.4` client container.
- The built-in health check uses the wrong PostgreSQL socket path. The Compose file overrides it with `/tmp`.

## Running the databases

`docker compose up -d`

The manually started `golden-query-challenge` container currently occupies the same ports. Stop that container before starting Compose: `docker stop golden-query-challenge`. Existing container data is retained.

## Remaining work

- Design and implement the TypeScript query API and backend adapters.
- Implement demonstration queries and one extension.
- Add unit and database integration tests.
- Record major AI prompts, design redirections, and actual time spent.
- Candidate writes the README and records a five-minute walkthrough.

These are AI-generated working notes, not the candidate-authored README required by the challenge.

## First implementation - September 26, 2026

- Accepted Substrait subset + Kysely architecture; remote databases own execution.
- Implemented read/project/sort/fetch profile and recent-orders demo on both databases.
- Verified four compiler tests and three integration tests, including independent reference SQL, offset pagination, and identical cross-backend date values.
- Initial top-five order IDs: 11077, 11076, 11075, 11074, 11073.
- Remaining: filtering/functions, joins, aggregation, nested analytical queries, remaining samples, and one extension.
- Development commands and exact supported profile are in `SUBSTRAIT-PROFILE.md`.

## Official-schema revision of PR #2

- Replaced handwritten public plan types with generated declarations from pinned upstream Substrait v0.63.0 schemas.
- Added generated Protobuf codec, supported-plan binary round trips, and schema-derived rejection of unknown binary fields.
- Kept application capability validation separate, rejecting schema-valid but unimplemented operators.
- Example uses generated types and enum values. Both database tests now execute a plan after its binary round trip.
- Schema provenance, license, and regeneration commands are checked in.

## Analytical coverage after PR #2

- PR #2 is merged as `b26668d`; PR #3's agent workflow is also on main.
- New branch `feat/challenge-coverage` implements all six sample query families, including both example city inputs.
- Scoped compilation preserves aggregate grain. Freight is counted once per order; prices include line discounts.
- Decimal(38,10) monetary results and continuous percentiles are independently checked with BigInt arithmetic. Native PostgreSQL percentile and temporary edge fixtures provide additional verification.
- High-level API, a separate advanced extension, candidate README, and video remain outstanding. See `CHALLENGE-COVERAGE.md`.
