# Submission preparation and five-minute walkthrough

AI-maintained supporting notes, not the candidate-authored README or a script to attribute to the candidate. The candidate writes the README, explains the design in their own words, records the video and submits. Follow the dates and scope cutoff in [the delivery plan](PLAN.md): first complete video/code freeze September 30, submit October 1, October 2 buffer.

## Prepare the walkthrough

Use the editor and rendered [API tutorial](api/tutorial.md) as the main screen, with a short terminal demonstration. No new UI is needed. Before recording, open [queries.ts](../src/queries.ts), [demo.ts](../src/demo.ts), [client.ts](../src/client.ts) and the [architecture explanation](ARCHITECTURE.md). Increase the font size and rehearse once with a timer.

Show the API in the chosen submission revision. Today it uses callback-scoped columns; callbacks construct expressions, not per-row execution. Typed predicate/projection objects and compile-time schema/result inference in [the API proposal](TYPED-RELATIONAL-API-PLAN.md) remain future work unless separately implemented and verified. Do not present proposal snippets as runnable functionality.

| Time | Screen / example | Point to explain in your own words |
| --- | --- | --- |
| 0:00-0:35 | API tutorial and task context | One relational query API, supplied PostgreSQL/MySQL databases, Northwind data. |
| 0:35-1:30 | `cityQuery('london')`, then `recentOrdersQuery(5)` in queries.ts | Named columns, filter/count, projection/sort/limit; constructing a query does not fetch data. Values become bound parameters. |
| 1:30-2:15 | `averageUnitsQuery()` | Aggregate detail quantities per order, left join all orders, include no-detail orders as zero, then average. Nested relational composition requires subqueries. |
| 2:15-3:00 | demo.ts and a prepared driver output section | `client.compile(query)` previews SQL; `client.execute(query)` runs it. Same query definitions on PostgreSQL and MySQL, backend-specific SQL. `finally` releases the client. |
| 3:00-3:35 | DuckDB output for the same recent-orders or city query | Main extension: a third backend. DuckDB uses a separately seeded Northwind snapshot, not federation or a fallback for remote queries. Row-number ranking is additional existing functionality. |
| 3:35-4:15 | Architecture text flow / client.ts | Table/Expr -> supported Substrait IR -> validation/lowering -> Kysely -> database. Standard IR preserves a possible future frontend boundary; it adds compiler/profile complexity and does not implement semantic modeling. |
| 4:15-5:00 | Test files, actual verification summary, future-work notes | Independent expected results plus cross-backend checks; NULL/decimal/grain boundaries. Mention one AI redirection and two prioritized improvements, then point to the candidate README. |

The full driver prints more than a five-minute walkthrough needs. Execute it during rehearsal and show selected output sections; identify recorded output as such. [The runnable documentation companion](api/examples.ts) offers smaller result previews. Avoid spending recording time installing packages, starting Docker or reading every generated SQL line.

## Rehearsal commands

From a checkout of the intended revision, install with `npm ci` and follow [database setup](RUNNING.md). Use `npm.cmd` if PowerShell blocks npm.ps1. The supplied image must be running for PostgreSQL/MySQL and initial DuckDB seeding. Keep existing database ports/worktrees isolated as described in those setup notes.

```powershell
npm run demo
npm run seed:duckdb
npm run demo:duckdb
# Optional compact execution preview for all three backends:
npm run docs:examples -- --execute
```

Seeding replaces four tables in the destination: use a dedicated DuckDB demo file and do not refresh it while another process owns it. See [DuckDB setup and precision limits](DUCKDB.md). Driver output logs SQL and parameter counts; keep connection strings and other terminal secrets out of the recording.

## Final submission checklist

These are actions to complete, not claims that verification has already happened. Record results for the exact final commit; older [checkpoint evidence](CHECKPOINT.md) is not proof for a newer revision.

- [ ] Choose a final revision after approved fixes; record its full commit hash and actual environment versions.
- [ ] From a fresh clone, run `npm ci`, start the provided image using [the setup instructions](RUNNING.md), and run the checks below. Record pass/fail and actual counts, with no claim of hosted CI unless it exists.

  ```powershell
  npm run check
  npm run check:docs
  npm test
  npm run test:integration
  npm run test:duckdb
  npm run docs:examples
  npm run demo
  npm run seed:duckdb
  npm run demo:duckdb
  npm run docs:examples -- --execute
  ```

  `test:duckdb` requires both remote databases and builds its own in-memory snapshot; it does not require the seeded demo file. Serialize checks against shared services; do not run snapshot refresh alongside a demo using that file.

- [ ] Candidate README covers setup/driver/tests, design and tradeoffs, major prompts and human redirects, limitations and what more time would enable. Use [AI log](AI-LOG.md), [API design](api/design.md), [semantics](api/semantics.md) and [future work](FUTURE-WORK.md) as evidence, not as a substitute for the candidate's writing. Record actual time honestly if provided.
- [ ] Five-minute video shows the actual API, remote execution evidence and DuckDB extension; play it back fully to check sound, text readability, duration and consistency with the chosen revision.
- [ ] Review the final diff for local artifacts and secrets; ensure the documented commands match package.json. If executable code changes after verification, rerun the relevant checks before declaring that revision verified.
- [ ] Identify the final revision using `submission-v1` per [the Git workflow](GIT-WORKFLOW.md); do not move an existing release tag silently. Record the full hash with the handoff.
- [ ] Verify intended reviewers can access the private repository and video; preserve privacy. Confirm access through the actual sharing/invitation mechanism, not merely the candidate's logged-in session.
- [ ] Candidate submits repository link, exact commit/tag and video link through the requested channel on October 1, then confirms the links still work. October 2 is contingency time.

Do not block submission on the optional typed API, a new UI, federation, generalized capabilities/authentication or CI infrastructure. Keep those in future work unless a concrete submission failure requires a bounded fix.
