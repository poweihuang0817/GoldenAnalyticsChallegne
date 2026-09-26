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
