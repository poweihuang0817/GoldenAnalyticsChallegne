# Issue #7: duplicate compiler investigation

Decision: **KEEP TEMPORARILY**. The analytics compiler is not a semantic superset of the legacy visitor. Consolidation is desirable, but deleting the legacy visitor changes accepted plans and result representations. Keep this separate from the take-home extension.

## Comparison

Both paths enter through `compilePlan`, which performs the same profile validation and official-schema round trip. Any nonempty function URI/declaration list selects analytics, even if unused. Empty lists select legacy. Neither branch accepts arbitrary Substrait.

| Area | Legacy visitor | Analytics visitor |
| --- | --- | --- |
| Relations | Read, Project, Sort, Fetch | Same plus Filter, inner/left Join, Aggregate |
| Expressions | Positional fields in Project/Sort | Fields, literals, CASE, registered scalar/aggregate functions |
| Read schema | Catalog table, width, ordered names, kinds, exact nullability | Same table/width/name/kind checks; allows required catalog column declared nullable, rejects opposite narrowing |
| Numeric reads/results | Physical values pass through | Casts fp64 and decimal(38,10); returns i64 as text |
| Project | Appends expressions, then applies emit; flattened field references | Same append/emit rule, separate derived-table scope |
| Emit | Read/Project allow repeated/reordered positions; bounds checked | Same; preserves sort metadata only if every sort field remains |
| Sort | One sort, before any fetch; CASE encodes explicit null order | Sort metadata, applied at fetch/root; outer sort replaces earlier ordering |
| Fetch | One bound limit/offset | Scoped bound limit/offset; nested fetch supported |
| Sort after fetch | Rejects | Supported: inner fetch retains its ordering and outer sort reorders selected rows |
| Project dropping sort field | Accepted: SQL can sort by unselected physical column | Rejected, including above a fetch |
| Root names | Width and uniqueness required | Same |
| Depth | Relation depth over 32 rejected | Same |

Aliases differ intentionally: legacy emits physical references directly, while analytics uses positional `cN` aliases within derived tables. Comparing SQL strings would confuse an implementation difference with a semantic difference.

The schema difference is safe widening, not evidence that analytics returns incorrect null values. The representation difference matters: decimal physical scale can differ from 10, and an i64 physical driver result can differ from the analytics text result. Canonicalization therefore needs a deliberate compatibility decision before switching all consumers.

## Evidence

`test/compiler-equivalence.test.ts` uses an unused supported URI to route the identical relation through analytics. It records the nullability, discarded-sort-column, nested-fetch, and decimal-cast differences; both paths reject invalid field and emit indices.

The database portion executes 24 plans per backend through both paths: all four explicit null-order directions, limits 0/1/7, offsets 0/2, Read emit reorder, Project append, and Project emit restoration. A unique order ID breaks date ties. Exact rows and pagination parameters agree for every case on PostgreSQL and MySQL. This is bounded regression evidence, not a general equivalence proof. Northwind may not contain NULL order dates, so direction coverage alone does not prove NULL placement on nullable fixtures.

Run without databases:

```powershell
node --import tsx --test test/compiler-equivalence.test.ts
```

Run including the provided databases (read-only):

```powershell
$env:RUN_COMPILER_EQUIVALENCE_DB = '1'
node --import tsx --test test/compiler-equivalence.test.ts
Remove-Item Env:RUN_COMPILER_EQUIVALENCE_DB
```

These focused tests are opt-in and are not added to the existing `npm test` scripts. Type checking includes the file. Local validation: `npm run check` passed; all four focused tests passed with database execution enabled. No CI result is claimed.

Existing `compiler.test.ts` covers legacy rejection and append/emit behavior; `api-integration.test.ts` covers scoped nested limits, filtering and projections; challenge/percentile integration files exercise joins, aggregates, decimal normalization and independent oracles. All existing tests remain relevant when dispatch changes.

## Required before removing the old path

1. Decide and document one read-schema nullability policy (coordinate issue #6).
2. Preserve sorted-field-dropping projections, or explicitly version/narrow the public supported profile. Add tests both before and after fetch, with ties and NULL fixture values.
3. Decide canonical i64/fp64/decimal output behavior and test actual rows against physical columns of differing types/scales. Do not infer representation equality from SQL compilation.
4. Add overlap cases for duplicate emits, nested projects, root aliases, invalid schema widths/names/types, duplicate root names, unknown tables, and depth limits. Retain current invalid-index checks.
5. Add fixture-backed NULL ordering, empty relations, offset beyond end, nested fetch and sort-after-fetch tests with independently calculated results.
6. Route both empty-declaration and declared-function plans through the single compiler, then test unresolved/duplicate/unsupported function declarations independently of relation choice.
7. Run the complete unit/integration suite and driver on both databases before deleting legacy code.

Function declarations can be independent of relation dispatch: analytics already creates an empty function map when declarations are absent, and resolves function references only when compiling expressions. That is the preferred eventual structure. Simply stripping unused declarations now changes which operations work (notably nested limits), so cleanup must follow consolidation, not precede it.

## Scope and AI record

The user requested delegated study and handling of the open issues before further MVP work. This task was limited to issue #7 evidence, comparison tests and this report. No compiler, public API, package script, or database data was changed. The integration owner maintains the shared AI log. No new optimizer, capability engine, federation dependency or production refactor is proposed here.

This report satisfies the investigation issue; it does not claim that duplication has been removed. Submission-time regression risk exceeds the benefit of deleting the smaller visitor now.
