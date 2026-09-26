# Issue #6: schema validation boundaries

Reviewed against `8fe7d4a` (merged PR #5). This is an investigation, not a
validation refactor. [Issue #6](https://github.com/poweihuang0817/GoldenAnalytics/issues/6)
explicitly requests analysis without removing checks.

## Responsibilities and recommendations

| Layer/category | Current responsibility | Decision and removal risk |
| --- | --- | --- |
| `src/api.ts`: catalog and names | `createSource` snapshots the supplied catalog; `table` rejects unknown tables and invalid/duplicate column names. `Columns.col` resolves names to positions. Selection/aggregation reject empty or colliding output names. | **KEEP.** Early application diagnostics and stable positional binding; removing these checks can make names ambiguous or permit stale schema assumptions. |
| API expression and scope checks | Numeric/string/boolean compatibility, CASE branch types, decimal/fp64 separation, aggregate result kinds, nullability propagation, relation occurrence scopes and cross-source rejection. | **KEEP.** These construct correct output declarations and prevent captured columns from being rebound to a different relation or pre-join nullability. They are not merely protobuf shape checks. |
| `src/plan.ts`: supported profile | Strict object shapes, supported relations/types, integer bounds, literal restrictions, fixed decimal(38,10), explicit nullability, root shape and version. | **KEEP.** Generated protobuf types describe a much larger standard and cannot enforce the implemented subset. Dropping this allows unsupported fields to be discarded or unsupported semantics to reach lowering. |
| Generated codec and `src/wire.ts` | Official message validation/conversion; unknown object/wire fields and resource bounds. | **DEFER** hardening policy changes to [#8](https://github.com/poweihuang0817/GoldenAnalytics/issues/8). These do not verify catalog compatibility. Removing them is not schema simplification. |
| `src/compiler.ts`: extension-free reads | Known table, schema width, positional names, exact kind/nullability, field/emit bounds, root width/unique output names. | **KEEP** until compiler consolidation. Wrong names/order can silently select a different physical field; wrong kind can change arithmetic/result handling. |
| `src/relational.ts`: analytical reads and expressions | Read schema/catalog compatibility, field/emit bounds, function anchors/arity/types, declared output compatibility, join/aggregate nullability, root width/unique names. Read nullability permits conservative widening but forbids narrowing. | **KEEP.** Serialized/external plans bypass API construction. Their declarations cannot be trusted as proof of semantic validity. |
| Duplicate read/root checks across compilers | Two lowerers separately enforce almost the same contract. | **SIMPLIFY later**, with [#7](https://github.com/poweihuang0817/GoldenAnalytics/issues/7). Consolidate only after preserving behavior with characterization tests; do not add a third validator abstraction now. |
| New schema inference/introspection/type infrastructure | Not implemented or needed for the supplied logical catalogs. | **DEFER.** No new service, type algebra or physical schema discovery is justified for this issue. |

## Are there two schema authorities?

The trusted `Catalog` is the execution-side logical schema authority. It is not
the complete physical database schema: the challenge catalogs expose selected
columns and logical numeric views. In particular, analytical reads cast declared
decimal columns to decimal(38,10).

`ReadRel.baseSchema` is the plan's assertion about that schema, not a second
authority entitled to override it. The compiler compares the assertion with its
catalog before resolving positional fields. API `createSource` already generates
`baseSchema` mechanically from its private catalog snapshot; implementing this
idea again would add duplication.

The caller can supply a different catalog to `compilePlan` than the one used to
build the API query. Compatibility checks catch shape/name/type mismatches, but
do not authenticate a source or discover physical database drift. Neither this
catalog nor the plan is a production authorization system. Credentials, catalog
ownership and physical schema changes remain separate future concerns.

## Concrete duplication and one behavior difference

1. API `lower`, `eq`, arithmetic, CASE and aggregate methods infer/check types;
   analytical `expression`, `numeric` and `declared` repeat those semantic rules.
   This is intentional boundary validation: API checks improve construction and
   compiler checks protect direct plans. Share semantic helpers only when a real
   maintenance problem warrants it; do not bypass compiler checks for API output.
2. `compilePlan` calls `toPlanJson(fromPlanJson(input))`, so profile/codec work is
   repeated. That is conversion/validation overhead, not a second catalog. There
   is no measured performance problem justifying a fast path here.
3. Both lowerers check read widths/names/kinds and root output widths/uniqueness.
   Their nullability contracts differ: legacy read validation requires exact
   equality, while analytical `declared` accepts REQUIRED catalog fields declared
   NULLABLE. Both reject a nullable catalog field declared REQUIRED.

The third difference follows directly from `compiler.ts`'s equality comparison
and `relational.ts`'s `(!nullable && value.nullable)` condition. To characterize it
offline, use a one-column required-i32 catalog and a matching read plan declaring
that column nullable: no extensions selects the legacy rejection; attaching the
valid Golden function declarations selects analytical acceptance. This is a
source-inspected case, not a newly executed regression test. Conservative widening
does not invent non-null guarantees or change database values, so this review
does not classify it as a demonstrated incorrect-result bug. It does show why
removing declarations or unifying checks requires deliberate compatibility tests.

## Which exact checks matter?

- **Width, order and names:** keep exact logical compatibility. Positional
  references otherwise risk addressing the wrong field even when SQL is valid.
- **Kinds:** keep exact supported kinds. This controls arithmetic, casts and
  string-versus-number result behavior; vendor coercion is not a substitute.
- **Nullability:** keep rejection of narrowing and correct join propagation.
  Exact equality is stricter than necessary for safe widening; defer alignment
  of the existing lowerers rather than weakening either by accident.
- **Decimal shape:** keep the profile's exact 38/10 restriction. Catalog stores
  only `decimal`, not independent precision/scale metadata. Accepting arbitrary
  declared scales while lowering every decimal to 38/10 would misrepresent the
  plan's precision contract. This is a supported-semantics check, not redundant
  physical database introspection.
- **Unknown tables/fields and output names:** keep structural lookup/bounds and
  unambiguous outputs. Identifier quoting and value parameterization are separate
  injection defenses; schema checks alone do not make SQL construction safe.

## Evidence, gaps and smallest follow-up

Inspected `api.ts`, `compiler.ts`, `relational.ts`, `plan.ts`, the supported-profile
documentation and the existing tests. `test/api.test.ts` covers catalog snapshots,
unknown names, scope capture, invalid composition, expression typing and left-join
nullability, including the prior predicate-capture regression.
`test/compiler.test.ts` covers unknown catalogs, schema mismatch, output width and
field bounds. `test/analytics-compiler.test.ts` rejects a forged aggregate output
type. These do not constitute exhaustive coverage of every schema compatibility
combination.

No production-code change is warranted by this investigation. The smallest
follow-up is an offline read-schema compatibility table in #7 before consolidation:
vary width, reordered same-kind names, kind, required/nullable direction and
decimal shape, and run each case through both dispatch paths. Include the catalog
snapshot versus a changed compile-time catalog. Then select and document one
nullability policy. Preserve existing API scope and join regression tests.

Validation for this documentation-only change: source/test inspection, local link
inspection and `git diff --check`. No tests or database queries were run; existing
test coverage above describes inspected assertions, not fresh execution results.
