# Delivery plan

Deadline: Friday, October 2, 2026. Target submission: Thursday, October 1.

These are checkpoints, not a commitment to spend a week implementing. The challenge requests approximately 45 minutes of work and accepts incomplete polish. Record actual time honestly; prioritize a working demonstration and document deferred work.

## Submission schedule refreshed September 28 (America/Los_Angeles)

| Date | Focus | Exit condition |
| --- | --- | --- |
| Mon Sep 28 ? today | Finish API philosophy/design research and review #19 | Retained IR decision, preferred syntax, type/scope guarantees and deferred work are written; no more broad architecture survey |
| Tue Sep 29 | Inventory behavioral test gaps; optionally implement one approved, small typed API increment. Candidate starts README and walkthrough outline | Any included code change has type/runtime tests and matching docs. By evening choose the submission scope; incomplete API redesign stays future work |
| Wed Sep 30 | Freeze code; verify exact candidate revision from a fresh clone with provided databases and seeded DuckDB; candidate finishes README and records first complete video | Reproducible commands and commit recorded, five-minute video exists, review access/link checks started. Only submission-blocking fixes after this point |
| Thu Oct 1 | Final review, playback/link/access checks, release identification and submission | Candidate submits repository/version/video links; no new features |
| Fri Oct 2 | Contingency buffer only | Resolve access or delivery failures if needed; no planned coding, first recording or first submission |

These are proposed checkpoints, not measured work durations or scheduled autonomous execution. Candidate availability can reduce optional API work; it must not move README/video to the deadline.

## Current evidence and remaining work

- #17 API docs and #18 createClient are merged. Six challenge families, row-number extension and DuckDB backend exist.
- Latest local evidence on #18 reconciliation 6901985: 33 local tests, 16 PG/MySQL integration tests, one three-backend conformance test; 21 documentation examples compiled and executed. This is not hosted CI or final release fresh-clone proof.
- Existing fresh-clone evidence in CHECKPOINT.md is for older revisions. Verify the final chosen revision again after code freeze.
- #19 is a plan-only review. Compile-time schema inference and callback-free predicates are not implemented or required to claim the current runtime MVP works.
- #16 is an open AI README draft for reference; it does not satisfy the candidate-authored README requirement. The candidate writes the final README and records the video.
- #11 compiler investigation is open and not a submission prerequisite. No consolidation or broad test-corpus project before submission.
- Final README, video, reviewer access and submission version are not confirmed complete. Treat them as remaining until actual evidence is recorded.

## Scope cutoff and fallback

The remaining API improvement is optional for submission. If the Sep 29 type work requires compiler rewrites, new join scopes or a broad schema framework, stop expansion and submit the verified existing callback API with the reviewed design as future work. Do not mix a half-migrated public API into the release. A design document must label proposed syntax clearly.

Use DuckDB as the requested third-backend extension in the walkthrough; row-number ranking is additional existing functionality. Show one compact Northwind query, its SQL preview/results, and reuse across backends. A five-minute walkthrough need not demonstrate every test/query.

Candidate README checklist: setup/run commands; design and tradeoffs; major AI prompts/human redirects; actual limitations; what more time would enable. AI may supply notes, but not present its draft as candidate-authored text.

## Implementation order

September 26 update: PR #4 merged the lower-layer implementation of all six query families. The user-approved next order is (1) a small Ibis-inspired TypeScript API and driver, (2) component tests and query coverage, (3) further correctness verification, then (4) capabilities, normalized errors, and related backend concerns. The public API branch covers the first two and adds finite equivalence cases; broader verification remains a separate checkpoint. Do not expand backend architecture before reviewing that checkpoint.

1. Accept an architecture decision in `ARCHITECTURE.md` before implementation.
2. Establish Node/TypeScript tooling and reproducible database startup.
3. Build a vertical slice: most recent N orders on both databases, with deterministic ordering and bound values.
4. Add filtering, aggregation, joins, calculations, and the remaining sample queries as time permits.
5. Implement one explicitly identified extension after the basic API works. A sample query by itself is not automatically an extra feature.
6. Run shared integration cases against both databases and document limitations.

## Submission checklist

- Driver demonstrates the API on both provided databases and the selected extension.
- Tests exercise the provided databases through a backend-extensible harness.
- Fresh-clone setup, driver, and tests have been verified.
- Candidate-authored README explains design, major prompts/redirections, and future work.
- AI log and actual time record are accurate; no invented timings.
- Five-minute video explains architecture, demonstrates behavior, and discusses tradeoffs.
- Review staged files for credentials and generated/local artifacts.
- Tag the verified final commit `submission-v1`; include its hash with the submission.
- Verify reviewer access to the private repository and video. Do not make the repository public by default.

## Proposed API evolution (awaiting review)

The latest user direction retains Substrait and keeps Kysely as internal SQL machinery. The earlier Kysely-only migration proposal is superseded. See [the typed relational API proposal](TYPED-RELATIONAL-API-PLAN.md).

Use Kysely as a type-experience reference; prefer typed predicate/projection objects for readability, with callback compatibility. See [API philosophy](API-PHILOSOPHY.md). Infer output schemas and keep runtime validation for dynamic plans and relation scopes. A future semantic frontend is a possible producer of relational plans, not a feature to implement now.

Required order after design review:

1. Merge the plan-only PR.
2. Inventory and strengthen behavior-characterization tests on the current implementation.
3. Add schema/type propagation with positive and negative compile-time tests.
4. Add typed filter/select conveniences and typed execution, then reconcile API examples.

No Substrait removal or compiler rewrite is planned. PR #17/#18 are merged; use their API documentation and createClient surface as the baseline. Do not begin implementation until the revised plan is reviewed.

## Time record

Not yet recorded. Candidate should enter actual session durations; calendar checkpoints do not imply time spent.
