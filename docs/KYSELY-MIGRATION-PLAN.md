# Kysely-only migration proposal — superseded

The original proposal in PR #19 would have replaced the Table/Expr and Substrait path with direct Kysely. The user subsequently chose to retain Substrait as a relational contract, potentially reusable by a future semantic-query frontend.

The active proposal is [Typed relational API with Substrait retained](TYPED-RELATIONAL-API-PLAN.md): learn from Kysely's schema-aware filter API while preserving the current lowering boundary. Compile-time schema checking remains a requirement. The earlier migration proposal is preserved in this PR's commit history, not an active implementation instruction.

This is still a plan-only PR. No source changes, test additions, Substrait removal, or action on PR #17/#18 is authorized by this document.
