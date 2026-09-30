# Setup, driver, UI and tests

These are AI-maintained execution notes that the candidate-authored README can reference. Run commands from the repository root after cloning.

## Prerequisites

- Access to this private GitHub repository and Git installed.
- Node.js 22+ with npm.
- Docker Engine running with Docker Compose available.
- Local ports 3306 and 5432 available for the databases; port 4317 available for the UI.

Commands work in PowerShell. If PowerShell blocks `npm.ps1`, use `npm.cmd` in place of `npm`.

## Setup

```sh
git clone https://github.com/poweihuang0817/GoldenAnalytics.git
cd GoldenAnalytics
npm ci
docker compose up -d --wait --wait-timeout 180
```

Compose starts the supplied `goldenbeers/golden-query-challenge:1.0` image with PostgreSQL 17, MySQL 8 and preloaded Northwind data. It includes a correction for the image's PostgreSQL socket healthcheck.

The built-in local connection defaults match this image: database/user/password `northwind`, PostgreSQL on `127.0.0.1:5432` and MySQL on `127.0.0.1:3306`. These are sample-image credentials. No `.env` file is needed. To use another instance, set `POSTGRES_URL` and `MYSQL_URL` in the process environment; do not commit real credentials or print them in logs.

If a challenge container already occupies these ports, use that instance or configure an isolated instance as described below instead of starting a conflicting container.

## Run the CLI driver

Execute the challenge examples and the additional per-customer ranking example on PostgreSQL and MySQL:

```sh
npm run demo
```

The driver prints SQL, parameter counts and query results. PostgreSQL/MySQL perform the analytical work remotely.

For the DuckDB third-backend extension:

```sh
npm run seed:duckdb
npm run demo:duckdb
```

Seeding reads PostgreSQL and copies the four demo tables into the local `northwind.duckdb` snapshot without changing the source. Override the destination with `DUCKDB_PATH` if needed; use the same value when seeding and running. Once seeded, the DuckDB driver does not require PostgreSQL/MySQL.

Seeding again replaces those four tables in the destination file. Use a dedicated demo file and stop any UI/driver using it before refreshing. This is a separate snapshot, not federation. See [DuckDB setup and limits](DUCKDB.md).

## Run the demo UI

After database setup and DuckDB seeding:

```sh
npm run demo:ui
```

Open **http://127.0.0.1:4317** using this exact host. Stop the server with Ctrl+C.

- **Live driver:** choose one of three fixed Northwind examples and PostgreSQL, MySQL or DuckDB.
- **Compile:** inspect generated SQL and the Substrait plan without executing the data query.
- **Run:** execute on the selected backend and display real results. At most 100 rows are displayed; the full row count is reported.
- **API guide:** walk through API usage.
- **Architecture:** view the architecture diagram.

The UI is a local walkthrough of fixed examples, not an editable query or SQL editor. Use the CLI driver for the complete challenge examples. It binds to loopback and is not a production web service. See [UI walkthrough details](DEMO-PAGE.md) and the [API documentation](api/README.md).

## Run tests

Keep PostgreSQL/MySQL running. Stop the UI before running the verification sequence:

```sh
npm run check
npm run check:docs
npm test
npm run test:integration
npm run test:duckdb
```

| Command | Purpose |
| --- | --- |
| `npm run check` | TypeScript checks, including API type-negative cases |
| `npm run check:docs` | Typecheck the executable documentation examples |
| `npm test` | Component tests; some use isolated local DuckDB instances, but no remote databases are required |
| `npm run test:integration` | Real PostgreSQL/MySQL integration and edge-case checks |
| `npm run test:duckdb` | Three-backend conformance using an isolated DuckDB snapshot |

The database suites fail when required databases are unavailable; they do not silently skip. Fixtures are isolated and do not change supplied Northwind rows. See [test methodology](TEST-METHODOLOGY.md) for independent oracles and bounded metamorphic checks.

The [fresh-clone CI workflow](CI.md) also executes driver and documentation examples on a disposable runner. Check the run for the exact commit being reviewed; this guide does not claim a new successful run.

## Stop

Stop the UI with Ctrl+C, then stop this checkout's Compose databases:

```sh
docker compose down
```

## Optional: isolated database ports

For a separate verification instance, a current Compose version accepts a temporary override file:

```yaml
services:
  databases:
    ports: !override
      - "127.0.0.1:13306:3306"
      - "127.0.0.1:15432:5432"
```

Pass `-p golden-check -f compose.yaml -f <override-file>` to `docker compose` for both startup and shutdown. Point `POSTGRES_URL` at port 15432 and `MYSQL_URL` at port 13306. Use the same project name and override when stopping that instance so other development containers are unaffected.
