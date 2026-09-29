# Submission preparation and five-minute walkthrough

AI-maintained supporting notes, not the candidate-authored README or a script to attribute to the candidate. The candidate writes the README, explains the design in their own words, records the video and submits. Follow [the delivery plan](PLAN.md): first complete video/code freeze September 30, submit October 1, October 2 buffer.

## Prepare the walkthrough

Use the rendered [API tutorial](api/tutorial.md), the existing [Playground](DEMO-PAGE.md) and the [architecture image](diagrams/architecture.png) as the main screens. Keep [queries.ts](../src/queries.ts) and [client.ts](../src/client.ts) available. Increase the font size and rehearse with a timer. Playground displays actual TypeScript source, generated SQL and live results for fixed queries; it is not an editable code runner.

PR #22 implemented the unified callback-free API: typed column expressions, predicate/projection objects, staged joins and inferred result rows. Use each new relation's columns; relation identity still needs runtime checks. Types describe existing driver values rather than normalizing them. Show the current tutorial, not historical callback examples or unimplemented proposal syntax.

At main `5fc0b64`, Playground supports PostgreSQL/MySQL only. The separate `feat/demo-walkthrough` follow-up plans DuckDB selection, API/Architecture tabs and `npm run demo:ui`; these remain pending until its PR is merged and verified. Until then, use browser tabs for docs/image and driver output for DuckDB. Recording preparation need not wait for that follow-up.

| Time | Screen / example | Point to explain in your own words |
| --- | --- | --- |
| 0:00-0:35 | API tutorial and task context | One relational query API, supplied PostgreSQL/MySQL, Northwind data. |
| 0:35-1:30 | Tutorial and Playground city-count source | Typed `customers.columns.city`, a predicate object, named count measure and inferred string count. Construction does not fetch data; values become parameters. |
| 1:30-2:15 | Playground average-units source | Sum details per order, left join all orders, include no-detail orders as zero, then average. Staged join fields distinguish input from nullable output. Nested composition requires subqueries. |
| 2:15-3:00 | Playground Compile/Run, switch PostgreSQL/MySQL | `client.compile(query)` previews SQL; `client.execute(query)` runs it. Same query definitions, backend-specific SQL. The client owns resource cleanup. |
| 3:00-3:35 | DuckDB city-count output: driver now, Playground after follow-up merges | Main extension: third backend against a separately seeded snapshot, not federation or remote-query fallback. Row-number ranking is additional functionality. |
| 3:35-4:15 | Architecture image and client.ts | Table/Expr -> supported Substrait -> validation/lowering -> Kysely -> DB. Standard IR offers a future frontend boundary; costs include compiler/profile complexity. Semantic modeling is not implemented. |
| 4:15-5:00 | Test source, actual verification summary, future-work notes | Independent expected results plus cross-backend checks; NULL/decimal/grain boundaries. Mention an AI redirection and two prioritized improvements, then point to the candidate README. |

The full driver prints more than the video needs. Rehearse first and show selected output sections; label recorded output as such. [Runnable documentation examples](api/examples.ts) offer smaller previews. Avoid installing packages, starting Docker or reading every SQL line on camera.

## Rehearsal commands

From the intended revision, install with `npm ci` and follow [database setup](RUNNING.md). Use `npm.cmd` if PowerShell blocks npm.ps1. Both supplied databases must be running; PostgreSQL is also needed for initial DuckDB seeding. Avoid port conflicts with other worktrees.

```powershell
npm run seed:duckdb
npm run demo:duckdb
node --import tsx src/playground/server.ts
# Open http://127.0.0.1:4317; stop with Ctrl+C.
# Optional compact execution preview for all three backends:
npm run docs:examples -- --execute
```

After the UI follow-up merges, use its documented `npm run demo:ui` script instead of the direct server command. Do not assume a pending branch's script exists on main.

Seeding replaces four destination tables: use a dedicated DuckDB file and do not refresh it while another process owns it. See [DuckDB setup/precision limits](DUCKDB.md). Keep connection strings and terminal secrets out of recordings.

## Final submission checklist

These are actions to complete, not claims of final verification. [Fresh-clone GitHub Actions](CI.md) is merged in #23. Record a successful run for the exact selected revision plus local video rehearsal. Older [checkpoint evidence](CHECKPOINT.md) or an earlier successful workflow does not prove a newer revision.

- [ ] Select the final revision after approved fixes; record its full hash and actual environment versions.
- [ ] Confirm that revision's fresh-clone workflow passed; retain its run link. For local reproduction or a failed hosted run, install with `npm ci`, start the provided image per [setup](RUNNING.md), then use the checks below. Record actual results.

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

  `test:duckdb` needs both remote databases and builds its own memory snapshot, not the demo file. Serialize checks against shared services; do not refresh a snapshot alongside a demo using it.

- [ ] Candidate README covers setup/driver/tests, design/tradeoffs, major prompts/human redirects, limitations and what more time would enable. Use [AI log](AI-LOG.md), [API design](api/design.md), [semantics](api/semantics.md) and [future work](FUTURE-WORK.md) as evidence, not replacement authorship. Record actual time honestly if provided.
- [ ] Video shows the actual API, remote execution and DuckDB extension. Watch it fully for sound, readability, duration and revision consistency.
- [ ] Review the final diff for secrets/local artifacts; match commands to package.json. Reverify relevant checks after subsequent code changes.
- [ ] Identify the revision with `submission-v1` per [Git workflow](GIT-WORKFLOW.md); never silently move an existing tag. Include its full hash in the handoff.
- [ ] Confirm intended reviewers can access the private repository/video through actual sharing/invitations, not just the candidate's logged-in session. Preserve privacy.
- [ ] Candidate submits repository, exact commit/tag and video links through the requested channel on October 1 and checks they work. October 2 is contingency time.

The typed API and fresh-clone CI are already implemented. Do not block submission on further API redesign, UI polish, federation or generalized capabilities/authentication. Defer these unless a concrete submission failure requires a bounded fix.
