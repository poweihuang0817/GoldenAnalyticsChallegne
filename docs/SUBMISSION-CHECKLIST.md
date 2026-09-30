# Submission checklist

Supporting checklist for the candidate, inspected September 30, 2026. Checked implementation items mean the code exists; they do not certify the final submission revision or reviewer access. Fill in the notes and final evidence yourself. Target submission: October 1; deadline: October 2, 2026.

## 1. Driver application — required

- [x] CLI driver exists: [src/demo.ts](../src/demo.ts) builds on the public client API and the [Northwind queries](../src/queries.ts).
- [x] `npm run demo` executes on PostgreSQL and MySQL and prints SQL, parameter counts and results.
- [x] Driver includes all six challenge query families (two city examples), plus per-customer row-number ranking.
- [x] Third-backend extension exists: `npm run seed:duckdb`, then `npm run demo:duckdb` executes the same examples on the local snapshot.
- [x] Optional UI exists: `npm run demo:ui`, then http://127.0.0.1:4317. It offers three fixed examples, three backends, Compile/Run, API guide and architecture diagram.
- [ ] Run the driver on the final chosen revision and record the outcome below.
- [ ] Explain DuckDB as the selected extension: separately seeded snapshot, no federation or automatic local fallback.

Candidate notes / final run evidence:

> Checkpoint verified September 30, 2026 on f43e3708e75297da63b5e4d0162524be362d8ce1 (PR #44 before this evidence-only edit): fresh worktree npm ci; npm run demo passed all 8 examples on PostgreSQL and MySQL; a newly created isolated DuckDB snapshot was seeded, then npm run demo:duckdb passed all 8 examples (24 executions total). Snapshot counts: 830 orders, 91 customers, 9 employees, 2,155 details; SHA-256 83925750f4c70d986bd4efc86ae3e939a4e29efea4b20364a44ebdeabfe01803. This verifies the current candidate's driver; final submission revision remains to be selected.

## 2. Test suite — required

- [x] Type checks and API type-negative cases exist.
- [x] Component tests cover API, compiler/profile and backend-related boundaries.
- [x] Integration tests use the supplied PostgreSQL/MySQL databases, including challenge queries and edge fixtures.
- [x] Three-backend conformance includes DuckDB.
- [x] Independent raw-data / BigInt reference calculations and bounded seeded metamorphic checks exist.
- [x] Fresh-clone GitHub Actions workflow is configured.
- [ ] Run or confirm green CI for the exact final commit; record the URL and SHA, not only an older successful run.

```sh
npm run check
npm run check:docs
npm test
npm run test:integration
npm run test:duckdb
```

README already has a Test methodology section. Clarify these points in your own words:

- [ ] Replace or substantiate "total 50": test-runner counts are not the number of distinct SQL cases, and counts vary by suite/revision. Prefer named coverage unless a precise count and command are recorded.
- [ ] Explain "Independent test": expected answers are calculated separately from the compiler, including exact monetary reference arithmetic; backend agreement alone can miss shared bugs.
- [ ] Explain metamorphic checks: compound vs sequential filters, and bounded integer grouped results under reversed insertion order. These are selected properties, not arbitrary SQL equivalence proofs.
- [ ] Mention NULLs, empty inputs, duplicates, joins/nested aggregates and decimal/percentile boundaries.
- [ ] Link [test methodology](TEST-METHODOLOGY.md) and [CI instructions](CI.md). Keep large fuzzing, shrinking, mutation tests, TPC-H and formal solvers marked future work.

Candidate notes / final CI URL and SHA:

> Current candidate checkpoint: [Fresh clone run 36741924009](https://github.com/poweihuang0817/GoldenAnalytics/actions/runs/36741924009) passed for PR #44 head f43e3708e75297da63b5e4d0162524be362d8ce1. The workflow includes code/docs typechecks, unit tests, PostgreSQL/MySQL integration, three-backend conformance, drivers and executed documentation examples. This is not evidence for later commits; check the final submitted revision separately.

## 3. Candidate-authored README — required

- [x] Candidate-authored README exists with architecture, API usage, testing and future-work sections.
- [ ] Finalize the API design explanation in your own words: typed Table/Expr -> constrained Substrait -> Golden lowering -> Kysely -> backend.
- [ ] Add major AI prompts and where you redirected the AI. The current README does not yet have this account. Use [AI-LOG.md](AI-LOG.md) as supporting evidence; choose the decisions you personally want to explain.
- [ ] Confirm future work reflects your priorities and distinguishes researched options from selected dependencies.
- [ ] Replace "check doc folder" with a direct [setup, driver, UI and tests](RUNNING.md) link. The refreshed guide was merged in PR #43.
- [ ] Make the API example coherent: include imports or a complete-example link; label the partial catalog as illustrative; preview SQL before destroying the client; put source/preview snippets inside TypeScript code fences.
- [ ] State the chosen query interpretations and link the [semantic notes](QUERY-SEMANTICS.md), merged in PR #42. Continuous P75, discounted merchandise, accent-sensitive city matching and order population are choices, not uniquely mandated by the prompt.
- [ ] Keep claims bounded: no implemented Malloy/Parquet/Ossie bridge; current Golden function semantics are not automatic full official Substrait conformance; timeout/cancel is not an end-to-end hard deadline.
- [ ] Add the final video link.

Candidate account of major prompts / redirects:

> TODO — describe the original request, what the AI proposed, your correction, and the resulting decision. Do not invent elapsed time.

## 4. Five-minute video — required

- [ ] Record a walkthrough of the API and why you designed it this way.
- [ ] Show an actual API query, SQL preview and real results.
- [ ] Show the extension, preferably by switching the same query to DuckDB.
- [ ] Briefly explain testing, current limits and what more time would enable.
- [ ] Play back the uploaded video: readable text, understandable audio, roughly five minutes, correct share permissions.

Suggested outline (adjust in your own words):

| Time | Topic |
| --- | --- |
| 0:00–0:40 | Problem and supported backends |
| 0:40–2:00 | Catalog, typed expressions and execute |
| 2:00–3:00 | UI: SQL/results and DuckDB extension |
| 3:00–4:00 | Architecture and design tradeoffs |
| 4:00–5:00 | Correctness evidence, limitations and future work |

Video URL / candidate notes:

> TODO

## 5. Final delivery checks

- [x] Submission-relevant documentation merged: #42 semantics and #43 setup reference. Final-version verification remains below.
- [ ] Commit and push the final candidate README and any approved submission files.
- [ ] Record the final commit SHA (a tag is optional); verify that CI and demo evidence apply to it.
- [ ] Verify README/doc links against the final tree.
- [ ] Confirm reviewers have access to the private repository and video.
- [ ] Submit repository/version/video links through the location specified in the invitation.
- [ ] Record that submission completed; do not equate preparing links with sending them.

No new feature or broad architecture research is required to complete this checklist. PRQL/Ossie/Malloy research and production reliability work can remain deferred.

Final repository/version link:

> TODO

Submission date / confirmation:

> TODO
