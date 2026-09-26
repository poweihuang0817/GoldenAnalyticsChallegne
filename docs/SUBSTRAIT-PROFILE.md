# Supported Substrait profile

This is the lower query translation layer, not the complete challenge. Official Substrait v0.63.0 schemas are vendored at a pinned revision. protobufjs generates the codec, TypeScript declarations, and reflection metadata; application rules separately restrict capabilities. See [schema provenance](../vendor/substrait/PROVENANCE.md) and [challenge coverage](CHALLENGE-COVERAGE.md).

## Representation and validation

- One root relation, explicit v0.63.0 version, unique output names.
- Generated IPlan and enums construct plans. toPlanJson verifies generated objects and applies the supported profile; fromPlanJson validates input before codec conversion can discard keys.
- encodePlan/decodePlan provide binary interchange for this structural profile. A schema-derived wire scanner rejects unknown fields, bad wire shapes, and excessive nesting/size before recursive decoding.
- JSON is the restricted Protobuf JSON representation, not Substrait's separate text format. Zero version components and field indices can be omitted. Not every valid spelling/default form is accepted.
- Compiler validation resolves catalog fields and function declarations, checks argument/output types, and rejects unsupported semantics before database execution. Codec/structural validation alone is not sufficient for execution.

## Relations and expressions

| Feature | Supported profile |
| --- | --- |
| Read | One-component logical table names; explicit flat schemas and trusted catalog binding |
| Project | Append expressions to input, then optional emit mapping |
| Filter | Boolean expressions |
| Join | Inner and left; boolean condition over concatenated left/right fields |
| Aggregate | One grouping set; initial-to-result; ALL invocation; no aggregate filters/options |
| Sort | Positional field references with explicit direction and null placement |
| Fetch | Nonnegative count/offset strings within safe integer range; older v0.63 fields |
| Expressions | Positional root fields, string/fp64/i32/boolean literals, registered scalar functions, CASE |
| Types | i32, i64, bool, date, string, fp64, fixed decimal(38,10) |

Read/project support direct/emit; common metadata on other relations is currently rejected. Nested/correlated field paths, arbitrary raw SQL, general windows beyond the row_number extension, other joins, grouping sets, distinct aggregates, distributed aggregate phases, and arbitrary extensions remain unsupported.

The example catalogs expose selected logical fields backed by physical Northwind columns. They are not complete physical schemas. The decimal catalog view widens money columns to decimal(38,10); fp64 entries explicitly expose approximate numeric values.

## Function extensions

The analytical examples declare functions through Substrait's standard extension URI and anchor mechanism. The allowlisted library is [golden-functions.yaml](../spec/golden-functions.yaml), an application-defined extension, not an upstream standard function library. Its generation source is [generate-function-spec.mjs](../scripts/generate-function-spec.mjs). The compiler never fetches arbitrary URIs.

Scalar functions: equal, lower, is_null, is_not_null, and, multiply, subtract, divide, coalesce. Aggregate functions: sum, avg, count, percentile_cont. The compiler enforces supported types/arity/output declarations. Decimal/fp64 arithmetic mixing is rejected. Division by zero returns null.

The original extension-free compiler supports the small field-only read/project/sort/fetch path with one sort before one fetch. Plans declaring the analytical function library use a scoped compiler that preserves nested relation boundaries. Percentile is the sole measure in its aggregate. Projects after a sort must retain the sorting fields or fail explicitly.

All SQL operators come from trusted compiler templates; Kysely quotes identifiers and binds literal values. PostgreSQL/MySQL execute the query remotely. DATE returns calendar-date strings; i64 counts and decimal outputs return strings to preserve precision. See the coverage document for decimal scale/overflow limits and exact percentile semantics.

## Commands

Requires Node.js 22+ and the sample databases (localhost or POSTGRES_URL/MYSQL_URL).

```powershell
npm ci
npm run check
npm test
npm run test:integration
npm run demo
npm run generate:substrait
node scripts/generate-function-spec.mjs
```

Use docker compose up -d for a fresh database setup; avoid conflicts with the previously started manual container on the same ports. Unit tests compile without connecting. Integration tests fail when databases are unavailable. Tests use unique connection-local temporary tables for edge cases, leaving Northwind rows intact.

Cross-language interoperability beyond the tested Protobuf round trips and broader type/function support remain future work. The high-level builder and separate row_number extension are implemented. This profile is not a complete Substrait implementation or a production authorization boundary.

## Window profile extension

`Rel.window` now supports exactly one zero-argument row_number function, appending required i64 output. Partition/sort expressions are field references; sorting is mandatory. Only INITIAL_TO_RESULT and ALL are accepted. Bounds, frames, options and other window functions remain unsupported. Numeric less_than_or_equal supports matching numeric kinds or mixed i32/i64 widths. See [window extension](WINDOW-EXTENSION.md).
