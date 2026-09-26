# Issue #8: protobuf wire hardening assessment

Recommendation: **KEEP/FREEZE**. Keep the existing scanner and tests unchanged for submission; add no further parser hardening. The challenge does not require a hostile binary-input service. These checks are a defensive policy for the optional interchange helper, not a demonstrated production security requirement.

Reviewed against main `8fe7d4a`; tracks [issue #8](https://github.com/poweihuang0817/GoldenAnalytics/issues/8). This investigation changes documentation only.

## Actual boundary

The application-facing API is `Table.toSubstrait()` in [api.ts](../../src/api.ts). The [driver](../../src/demo.ts) passes its JSON plan directly to `compilePlan`; it does not receive or decode binary input. There is no HTTP server or authenticated remote plan-submission boundary in this repository.

[plan.ts](../../src/plan.ts) exports `encodePlan` and `decodePlan` as optional binary interchange helpers. Challenge integration tests exercise this round trip before compilation. Binary interchange demonstrates use of the standard schema, but is not necessary to execute the public API or a separate original challenge requirement. Authorization, query cost controls, and database permissions are outside these helpers.

## What the scanner adds

[wire.ts](../../src/wire.ts) walks fields using generated reflection metadata before constructing a decoded plan. It rejects unknown numeric tags at every visited message, rejects unexpected wire types, and counts message depth and wire fields. This prevents unknown input from being silently absent from the JSON object that later profile validation sees.

There is overlap with the generated decoder: [substrait.cjs](../../src/generated/substrait.cjs) already checks recursion and message bounds. Its `Plan.decode` skips unrecognized fields (optionally preserving raw unknown bytes internally), whereas the scanner rejects them. Thus the distinctive guarantee is **explicit rejection of unknown wire content plus application-specific limits**, not that protobuf decoding would otherwise accept every malformed input or have no recursion protection.

The scanner does not establish execution semantics. Known schema fields can still describe unsupported plans; the strict profile and compiler must reject those. Nor is the scanner a complete protobuf canonicality validator: it permits repeated occurrences of singular fields and leaves normal decoder merge/overwrite behavior intact. Do not describe it as rejecting every ambiguous encoding or proving that input is safe to execute.

## Forward compatibility and limits

Rejecting unknown tags deliberately gives up protobuf's normal tolerance of added fields. Even an otherwise harmless field from a newer producer will fail before profile validation. This is consistent with the current pinned v0.63.0, fail-closed profile, but not a generally forward-compatible Substrait consumer. Future interoperability work must decide explicitly which unknown metadata can be tolerated; relaxing this during submission would change the contract.

The limits are local policy, not Substrait or challenge requirements:

| Check | Current limit | Interpretation |
| --- | --- | --- |
| Binary bytes | 1,000,000 | Decimal byte ceiling before scanning |
| Wire nesting | 100 | Nested protobuf messages, not relational operator count |
| Wire fields | 10,000 | Visited tags, not logical plan nodes |
| Object traversal | Depth 100; 10,000 values | Includes containers and scalar values |

These are reasonable conservative defaults for small sample plans, but have not been tuned against a workload or benchmark. Equivalent JSON and binary representations do not consume the same budget. They also do not limit database execution cost, SQL complexity, or result size. Preserve them as documented defensive defaults, without claiming a security guarantee or production resource budget.

## Test value and limitations

[substrait.test.ts](../../test/substrait.test.ts) separates two kinds of value:

- Challenge/interchange value: supported plan round trips, reflection loaded from the vendored schema reading/writing the format, and rejection of schema-valid unsupported plans. Reflection uses the same protobufjs implementation, so this is not independent-language interoperability evidence.
- Defensive parser value: unknown fields/tags, malformed message wire input, conflicting object oneofs, and oversized binary rejection. The current cases are useful regression protection, not comprehensive malformed-wire coverage or a fuzzing campaign.

[challenge.test.ts](../../test/challenge.test.ts) executes serialized challenge plans on the real databases and checks independent expected results. Those tests establish practical translation behavior; the malformed-wire tests alone cannot do so. No new tests are needed for this documentation-only decision, and no runtime test rerun is claimed here.

## Maintenance and next decision

[generate-substrait.mjs](../../scripts/generate-substrait.mjs) produces both the codec and reflection metadata from the same pinned schema. There is no second handwritten field-number registry to synchronize. Schema upgrades still require regenerating all artifacts together, reviewing new field kinds and scanner assumptions (including packed fields, maps, and groups if relevant), checking runtime decoder changes, updating the supported profile, and rerunning codec/compiler/database tests. Reflection loading and the second traversal also add startup/work overhead; no performance measurements justify optimizing them now.

Keep the scanner frozen through submission. Revisit it only when a concrete external binary consumer, schema upgrade, measured performance problem, or hostile-input service appears. At that point compare strict rejection against compatibility requirements and the current protobuf runtime's own defenses. Do not expand this review into a serialization framework, remove working protection for cosmetic simplicity, or treat parser hardening as the project's separate analytical extension.
