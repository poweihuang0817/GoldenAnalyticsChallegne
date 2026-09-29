# Delivery plan

Deadline: Friday, October 2, 2026. Target submission: Thursday, October 1.

These are checkpoints, not a commitment to spend a week implementing. The challenge requests approximately 45 minutes of work and accepts incomplete polish. Record actual time honestly; prioritize a working demonstration and document deferred work.

| Date | Checkpoint |
| --- | --- |
| September 25 | Settle the architecture and record its tradeoffs |
| September 26-27 | One query working end to end on PostgreSQL and MySQL |
| September 28 | Core demonstration queries and database integration tests |
| September 29 | One extension with validation |
| September 30 | Freeze features and verify setup from a fresh clone |
| October 1 | Candidate writes README, records five-minute video, and submits |
| October 2 | Buffer for submission or access issues |

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

Learn from Kysely's schema-aware column/operator/value filter API. Preserve typed expression objects and callback compatibility, infer output schemas, and keep runtime validation for dynamic plans and relation scopes. A future semantic frontend is a possible producer of relational plans, not a feature to implement now.

Required order after design review:

1. Merge the plan-only PR.
2. Inventory and strengthen behavior-characterization tests on the current implementation.
3. Add schema/type propagation with positive and negative compile-time tests.
4. Add typed filter/select conveniences and typed execution, then reconcile API examples.

No Substrait removal or compiler rewrite is planned. PR #17/#18 are merged; use their API documentation and createClient surface as the baseline. Do not begin implementation until the revised plan is reviewed.

## Time record

Not yet recorded. Candidate should enter actual session durations; calendar checkpoints do not imply time spent.
