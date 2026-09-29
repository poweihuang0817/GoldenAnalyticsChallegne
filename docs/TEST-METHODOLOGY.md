# Test methodology: small independent oracles and metamorphic checks

The submission combines component/type tests, hand-calculated examples, real-engine conformance, and a small deterministic metamorphic corpus. Backend agreement alone is insufficient: all backends could share the same compiler bug.

## Bounded seeded corpus

[test/api-characterization.test.ts](../test/api-characterization.test.ts) now runs six datasets on each of PostgreSQL, MySQL and DuckDB:

- Empty input, two all-NULL rows, and an explicit duplicate/negative/zero/signed-i32-boundary fixture.
- Three eight-row datasets from the fixed seed `0x474f4c44`, using the committed 32-bit LCG and finite value domain.

This is a reproducible bounded corpus, not an arbitrary-query fuzzer or exhaustive property suite. The dataset labels and seed appear in test output. Replay with:

```sh
npm ci
npm run check
npx tsx --test test/api-characterization.test.ts
```

Start the supplied databases first as described in [RUNNING.md](RUNNING.md). PostgreSQL/MySQL use the normal backend connection settings; DuckDB uses a private in-memory database. The file already participates in `npm run test:integration` and the fresh-clone CI workflow; no new dependency or CI entry point is required.

## Two complementary oracles

1. **Independent expected results.** Plain JavaScript computes selected row IDs, grouped/global row count, non-NULL count and sum directly from fixture arrays. It does not call the API, compiler or backend to derive answers. Every engine must match these values.
2. **Metamorphic relations.** A compound `A AND B` filter and two sequential filters must produce the same selected rows. The second filter uses the first relation's column scope. Grouped results must remain equal after reversing insertion order. Each form also matches the independent oracle, preventing equal-but-wrong results from passing.

The grouping check preserves bags: duplicate values count and contribute twice. SQL equality to NULL is never modeled as JavaScript equality; filtering explicitly rejects NULL operands. Grouping collects NULL keys together. COUNT(column) excludes NULLs, SUM of empty/all-NULL input is NULL, empty global aggregation yields one row, and empty grouped aggregation yields no rows.

Ordering is explicit for result comparison. There are at most eight i32 values in a generated dataset, so sums and intermediate sums are exactly representable in JavaScript and fp64. This deliberately avoids claiming insertion-order invariance for arbitrary floating-point sums. Counts are asserted as driver-returned strings. Actual rows are not coerced, sorted after execution or normalized to conceal differences; existing MySQL computed-i32 representation checks remain intact.

Each backend creates a randomly named test-owned ordinary table, reuses it serially across datasets, and drops it in `finally`. Northwind data is unchanged. As with existing fixtures, the connection needs CREATE/DROP privileges and abrupt process termination can leave the identified fixture behind.

## Coverage boundaries and future work

The six challenge query families, decimal/percentile/window cases, join multiplicity, runtime rejection and compile-time negative cases remain covered by their existing suites; this addition does not replace them. See [API-TEST-COVERAGE.md](API-TEST-COVERAGE.md).

Future work: selected TPC-H patterns and Substrait consumer cases, shrinking property-based generators, differential query fuzzing, mutation testing to assess assertion strength, and selected rewrite counterexample searches with formal tools. Those would need their own semantics/feature boundaries. This finite corpus proves neither arbitrary SQL equivalence nor full Substrait/vendor conformance; insertion reversal does not prescribe a database execution order.
