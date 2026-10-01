# Five-minute video script

AI-assisted rehearsal draft for Po-wei to edit. Not the candidate-authored submission README. Screen cues are not spoken; timing must be checked in rehearsal.

## Before recording

Follow [setup commands](../docs/RUNNING.md). Prepare the supplied databases and a dedicated seeded DuckDB snapshot. Start a fresh server from the selected revision with `npm run demo:ui` and open http://127.0.0.1:4317. Check the three examples on all three backends before recording. Open the API guide, test methodology and successful CI run in separate tabs. Use readable zoom and keep credentials off screen.

## 0:00–0:30 — Introduction

[Show Live driver.]

Hi, I'm Po-wei. This project is a TypeScript query API for a business intelligence application. The application describes an analytical query once, and a backend translates and executes it against a database.

The required backends are PostgreSQL and MySQL, using the supplied Northwind data. My extension is DuckDB, running the same queries against a separately seeded local snapshot.

## 0:30–1:25 — Architecture and design decisions

[Click Architecture. Point down the diagram.]

There are three main layers. The typed Table and Expression API is the application interface. It builds a constrained Substrait relational plan. Golden validates that plan and lowers it into SQL using Kysely, then the selected database executes the query.

I chose Substrait to keep a standard relational boundary separate from the TypeScript interface and SQL generation. A future semantic frontend could target this boundary, but that integration is not implemented. The public API describes what to compute; the database remains responsible for the physical execution plan.

This adds compiler work compared with using Kysely directly. Kysely handles SQL construction and parameter binding; Golden still owns relational lowering and the supported semantics. This is a small supported profile, not a complete Substrait implementation.

## 1:25–2:45 — API usage and interface choices

[Click API guide. Point to table, filter and aggregate, then execute.]

First, the catalog declares available tables, columns, types and nullability. That gives TypeScript enough information to check column names and expression types. Runtime validation remains necessary as well.

Here, I select the customers table, compare lowercase city names, and aggregate a customer count. Predicates are typed expressions, and projections use named objects. I preferred this style over callbacks for readability. Each stage exposes its own output columns, so later expressions describe the current relation. I took inspiration from relational APIs such as Ibis and schema-aware TypeScript builders such as Kysely, without exposing Kysely as the public contract.

Building the query does not read data. Each transformation describes another relation. The asynchronous execute method compiles and runs the query, so normal callers need only one execution call.

For debugging, compile is available separately. It returns SQL and bound parameters without running the data query. Finally, destroying the client releases its resources.

## 2:45–3:45 — Driver and extension

[Click Live driver. Choose Customers in London, PostgreSQL, Run query. Expand Generated SQL.]

This is the actual application query and its database result. The city is passed as a bound parameter. The count is returned as a string to preserve the integer result contract.

[Switch to MySQL and run, then DuckDB and run.]

I can change the backend without rewriting the application query. DuckDB demonstrates extending the adapter and shared test harness to another database. It uses a local snapshot; this is not federation or a fallback for the remote servers.

[Choose Average units per order and run on DuckDB.]

This example composes aggregations: sum quantities per order, then average those totals. The chosen interpretation includes orders without details as zero. Those business choices are documented because the challenge leaves some definitions open.

## 3:45–4:20 — Verification

[Show test methodology, then the selected revision's successful CI run.]

Tests cover the API, compiler and execution on the supplied databases. Three-backend comparison checks portability, but agreement alone could miss a shared compiler bug. Independent calculations therefore check expected results as well.

Metamorphic tests compare equivalent forms, such as one filter with A and B versus two sequential filters. SQL snapshots track SQL, parameter order and lowering decisions. CI runs the tests and driver from a fresh checkout.

## 4:20–5:00 — Tradeoffs and future work

[Show README AI usage and Future work links.]

AI helped with implementation, tests and research. I directed the architecture, chose the typed expression interface, and asked for independent correctness checks. One later correction was reducing unnecessary SQL nesting while preserving semantic boundaries.

The repository records major prompts and redirects, and I wrote the submission README myself.

With more time, I would broaden the conformance corpus and add compiler instrumentation to explain lowering decisions and find bottlenecks. Semantic frontends and federation remain future work. The current result is a working, tested query API across three backends, with SQL inspection available when debugging is needed.

## Rehearsal and delivery notes

- Replace wording you would not naturally use. Time a rehearsal; shorten future work if needed, preserving API usage and the DuckDB demonstration.
- The UI has three fixed examples. The CLI covers all six challenge query families and row-number ranking; the window example is not in the UI.
- Do not claim full Substrait compatibility, formal correctness or a universal speedup.
- If execution fails, fix setup before recording; do not present stale output as a successful live run.
- Play back the uploaded video, verify text/audio and sharing, and identify the exact final commit.
- Use the employer's provided online Google Drive upload link, not a local Drive folder. Confirm that the link permits uploads before delivery. A submission folder can contain `START-HERE.md`, the video, and a clean source ZIP if requested. START-HERE should link the repository, selected commit, README, setup/test instructions and video.
- Exclude this rehearsal folder, credentials, node_modules, .git, worktrees, local database snapshots and raw diagnostic outputs from any separately prepared source bundle. Retain the lockfile, compose configuration, source, tests and required documentation.
- Verify private GitHub access separately: Drive permission does not grant repository access.
