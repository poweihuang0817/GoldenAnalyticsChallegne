# Submission checklist

Supporting checklist refreshed September 30, 2026 (America/Los_Angeles).
Checked items below have repository or CI evidence. Video completion, uploads,
reviewer access and actual submission are not inferred from code or CI.

## Verified repository checkpoint

- Inspected revision: `b563e5aa91060ad693aca4fe3d3ab2a6f75b04ee` (candidate README update, after merged #61 and #62).
- [Fresh clone CI 36815228059](https://github.com/poweihuang0817/GoldenAnalytics/actions/runs/36815228059) passed for that exact revision.
- Passed steps: lockfile install, code/docs type checks, unit tests, documentation compilation, supplied PostgreSQL/MySQL integration, three-backend conformance, and driver/documentation execution smoke.
- This checklist update is documentation-only and will have a different commit. Confirm CI for whichever revision is actually packaged; do not label the checkpoint above as proof for a later revision.

## 1. Driver application — required

- [x] [CLI driver](../src/demo.ts) uses the public API and [Northwind queries](../src/queries.ts).
- [x] Eight examples cover all six challenge families (including two city inputs), plus per-customer row-number ranking.
- [x] `npm run demo` runs PostgreSQL/MySQL; `npm run seed:duckdb` then `npm run demo:duckdb` runs the separately seeded DuckDB snapshot.
- [x] The verified CI checkpoint passed driver/documentation execution smoke.
- [x] UI: `npm run demo:ui`, then http://127.0.0.1:4317. Eight fixed examples and PostgreSQL/MySQL/DuckDB; SQL and bound parameters, results, architecture and API design pages.
- [x] Extensions are documented: [row-number window ranking](WINDOW-EXTENSION.md) and [third backend DuckDB](DUCKDB.md). The video can demonstrate either or both; no federation or arbitrary window support is claimed.

## 2. Test suite — required

- [x] Type checks and API type-negative cases.
- [x] Component tests for API, profile/compiler, worker lifecycle and backend boundaries.
- [x] Supplied PostgreSQL/MySQL integration and real DuckDB conformance.
- [x] Independent raw-data / BigInt reference calculations and bounded metamorphic tests.
- [x] NULL, empty-input, duplicate, join, nested-aggregate, decimal and percentile coverage.
- [x] Exact generated SQL, ordered parameters and lowering-trace regression snapshots.
- [x] Latest inspected main checkpoint has green fresh-clone CI (linked above).
- [x] README describes test methodology and links [the detailed methodology](TEST-METHODOLOGY.md).

Commands and scope are in [RUNNING.md](RUNNING.md) and [CI.md](CI.md).
Metamorphic checks exercise selected valid equivalences; they are not arbitrary SQL
proofs. TPC-H, broader fuzzing, mutation testing and formal solvers remain future work.

## 3. Candidate-authored README — required

- [x] [README](../README.md) contains architecture/design, API usage, testing, setup links and future work.
- [x] Design rationale links to [API design](api/design.md) and [API documentation](api/README.md).
- [x] Major prompts and human redirects are linked through [AI usage record](../Manual_Record_AI_Usage.md); its AI-assisted organization is disclosed. [AI-LOG.md](AI-LOG.md) preserves development history.
- [x] Future work is explicitly listed; researched tools are not installed integrations.
- [x] Public example uses `await client.compile(query)` and closes the client in `finally`.
- [x] [Reviewer guide](../REVIEWER_GUIDE.md) maps each requested deliverable to its location, including [query semantics](QUERY-SEMANTICS.md).
- [ ] Candidate gives the final README a last read and confirms the wording represents their decisions.

Current API: public compile/execute are asynchronous; low-level `compilePlanSync`
is synchronous. The Playground trace path still uses that low-level synchronous
compiler. Worker isolation is not a compilation speedup or an end-to-end deadline.
Substrait support is constrained and uses Golden function definitions; future
Malloy/PRQL/Ossie integration is not implemented.

## 4. Approximately five-minute video — required

Candidate reports the recording is nearly finished; final playback/upload has not
been independently confirmed.

- [ ] Final video walks through API usage and why it was designed this way.
- [ ] Shows an actual query, SQL/bindings and results, plus an extension.
- [ ] Briefly explains testing and relevant limitations/future work.
- [ ] Playback confirms readable text, understandable audio, complete ending and roughly five-minute duration.
- [ ] Upload completes; the uploaded video can be played or downloaded by reviewers.

Video filename / link: **to be filled in**.

## 5. Package and submit

- [x] README and implemented submission work are committed on the verified checkpoint above.
- [ ] Select the final submission commit and confirm its CI run is green.
- [ ] Create a clean source ZIP from that commit; inspect its README, source, tests, docs and lockfile.
- [ ] Upload the source ZIP and final video to the recipient's Google Drive folder.
- [ ] Confirm upload completion and reviewer access. If also sharing the private GitHub repository, confirm repository access separately.
- [ ] Record the source commit alongside the delivered files or in the handoff message.
- [ ] Send the handoff and record completion; preparing files is not submitting them.

From a clean, up-to-date main checkout, the following packages tracked contents:

```powershell
git status --short
git rev-parse HEAD
git archive --format=zip --output=..\GoldenAnalytics-submission.zip HEAD
```

`git archive` includes committed files only. Inspect archive contents; do not assume
an ignored/untracked README edit or local recording is included. Upload the video
separately. A tracked rehearsal folder, if later merged, would also be included
unless explicitly excluded during packaging.

Final source commit: **to be selected**.

Final CI URL: **to be confirmed for the selected commit**.

Recipient Drive folder / uploaded files: **to be filled in**.

Submission date / confirmation: **not yet confirmed**.

No new feature, compiler optimization or architecture research is required to
finish this checklist. Keep remaining research/production issues deferred.
