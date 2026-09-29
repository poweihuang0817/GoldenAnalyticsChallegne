# Submission finish plan — September 28 checkpoint

Deadline: Friday October 2, 2026. Target submission: Thursday October 1. These are proposed human work sessions, not scheduled autonomous jobs or measured effort.

## Tuesday September 29: finish the walkthrough, then stop feature work

1. Resume draft DuckDB/UI PR: repair SVG rendering and visually inspect Driver / API guide / Architecture at the actual recording resolution. Test three-backend switching, compile-only, run and missing DuckDB seed guidance. Use a dedicated seeded snapshot.
2. Review the updated AI README reference (#16) and recording guide (#20), plus the small seeded/metamorphic test PR. They are supporting work; do not add a new compiler, backend or broad verification framework.
3. Run CI on the final candidate PR heads; merge only after review and explicit approval. Reconcile shared documentation conflicts without discarding notes.
4. Candidate writes the actual README in their own words using the AI draft/log as reference. Explain API design, major prompts/human redirects, limitations and what more time would enable.

Exit: stable runnable demo, current API docs, reviewed tests and a real candidate README draft. If UI polish remains, use the working driver page plus a separately opened architecture document; do not delay the submission for animations or styling.

## Wednesday September 30: code freeze and rehearsal

- Freeze features. Verify the chosen revision with green fresh-clone CI and record the exact commit.
- Rehearse one five-minute walkthrough: problem/API, one Northwind query, SQL/results on PG/MySQL, DuckDB extension, architecture, testing and limitations.
- Record the first complete video. Check font size, sound, legibility and that the repository matches the shown behavior.
- Finish candidate README; begin repository/video reviewer-access checks.

Exit: watchable complete video and a verified submission candidate. Only delivery-blocking fixes after this checkpoint.

## Thursday October 1: deliver

- Play the final video end to end; test all submission links and reviewer permissions.
- Select/tag the final revision only after verification and explicit authorization.
- Candidate sends repository/version/video links through the requested channel.

## Friday October 2: contingency only

Resolve access, upload or delivery problems. Do not schedule first recording, new features or the initial submission for this day.

## Current handoff

- Typed API #22 and fresh-clone CI #23 are merged; hosted CI passed. Latest code still needs its own checks after new changes.
- DuckDB UI draft is intentionally incomplete: SVG rendering and final visual QA remain. See [demo checkpoint](DEMO-PAGE.md#september-28-draft-checkpoint).
- #16 is AI-authored reference material, never the candidate-authored final README.
- #20 is the recording guide; its pending UI notes need reconciliation after the UI PR merges.
- Compiler investigation #11 is nonblocking and can remain deferred. No consolidation before submission.
- Candidate README, video, final access and submission are not confirmed complete.
