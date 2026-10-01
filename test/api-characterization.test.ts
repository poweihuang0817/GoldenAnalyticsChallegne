import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { sql } from 'kysely';
import { connect } from '../src/backend.js';
import { compilePlan, type Catalog } from '../src/compiler.js';
import { createSource, caseWhen, count, integer, type Table } from '../src/api.js';

// Same public-API corpus and hand-written expected rows on all engines.
// MySQL cannot self-join a temporary table, so use a random ordinary table
// dropped in finally. The supplied Northwind tables are never modified.
for (const backend of ['postgres', 'mysql', 'duckdb'] as const) {
  test(`${backend}: API characterization on isolated nullable/duplicate fixtures`, async t => {
    const db = connect(backend, { duckdbPath: ':memory:' });
    const name = `api_fixture_${randomBytes(6).toString('hex')}`;
    // Existing MySQL CAST AS SIGNED expressions report BIGINT via mysql2.
    // Characterize this driver difference explicitly; do not normalize results.
    const signed = (value: number) => backend === 'mysql' ? String(value) : value;
    const catalog = { [name]: [
      { name: 'id', type: 'i32', nullable: false },
      { name: 'grp', type: 'string', nullable: true },
      { name: 'qty', type: 'i32', nullable: true },
      { name: 'flag', type: 'i32', nullable: true },
    ] } as const satisfies Catalog;
    try {
      await db.connection().execute(async connection => {
        await sql`create table ${sql.id(name)} (id integer not null, grp varchar(10), qty integer, flag integer)`.execute(connection);
        try {
          await sql`insert into ${sql.id(name)} values
            (1, 'A', 10, 1), (2, 'A', null, null),
            (3, 'B', 20, 0), (4, 'B', 20, 1),
            (5, null, null, null), (6, null, 5, 0), (7, 'C', null, 1)`.execute(connection);
          const base = createSource(catalog).table(name);
          const run = async (q: Table) => (await connection.executeQuery(compilePlan(connection, q.toSubstrait(), catalog))).rows;

          await t.test('terminal fetch preserves null placement, tied values, aliases and zero offset', async () => {
            const projected = base.select({ key: base.columns.id, amount: base.columns.qty });
            for (const nulls of ['first', 'last'] as const) {
              const page = projected.orderBy({ column: 'amount', direction: 'desc', nulls }, { column: 'key', direction: 'desc' });
              const expected = nulls === 'first'
                ? [{ key: 7, amount: null }, { key: 5, amount: null }, { key: 2, amount: null }, { key: 4, amount: 20 }]
                : [{ key: 4, amount: 20 }, { key: 3, amount: 20 }, { key: 1, amount: 10 }, { key: 6, amount: 5 }];
              assert.deepEqual(await run(page.limit(4, 0)), expected);
              assert.deepEqual(await run(page.limit(2, 1)), expected.slice(1, 3));
              assert.deepEqual(await run(page.limit(0, 0)), []);
            }
          });

          await t.test('outer join widens non-null keys before null sorting and terminal fetch', async () => {
            const join = base.join(base.filter(base.columns.id.lte(4)), { how: 'left' });
            const matched = join.on(join.left.id.eq(join.right.id));
            const projected = matched.select({ id: matched.left.id, matched_id: matched.right.id });
            for (const nulls of ['first', 'last'] as const) {
              const page = projected.orderBy({ column: 'matched_id', nulls }, { column: 'id' }).limit(3);
              assert.deepEqual(await run(page), nulls === 'first'
                ? [{ id: 5, matched_id: null }, { id: 6, matched_id: null }, { id: 7, matched_id: null }]
                : [{ id: 1, matched_id: 1 }, { id: 2, matched_id: 2 }, { id: 3, matched_id: 3 }]);
            }
          });

          await t.test('CASE projection aggregated over a left join retains duplicates and unmatched rows', async () => {
            const join = base.join(base.filter(base.columns.id.lte(6)), { how: 'left' });
            const matched = join.on(join.left.grp.eq(join.right.grp));
            const projected = matched.select({
              id: matched.left.id,
              present: caseWhen(matched.right.id.isNotNull(), integer(1), integer(0)),
              shipped: caseWhen(matched.right.id.isNotNull().and(matched.right.flag.eq(1)), integer(1), integer(0)),
              units: matched.right.qty.coalesce(0),
            });
            const totals = projected.groupBy('id').aggregate({
              present: projected.columns.present.sum(), shipped: projected.columns.shipped.sum(), units: projected.columns.units.sum(),
            }).orderBy({ column: 'id' });
            assert.deepEqual(await run(totals), [
              { id: 1, present: 2, shipped: 1, units: 10 }, { id: 2, present: 2, shipped: 1, units: 10 },
              { id: 3, present: 2, shipped: 1, units: 40 }, { id: 4, present: 2, shipped: 1, units: 40 },
              { id: 5, present: 0, shipped: 0, units: 0 }, { id: 6, present: 0, shipped: 0, units: 0 },
              { id: 7, present: 0, shipped: 0, units: 0 },
            ]);
          });

          await t.test('computed grouping keys with bound literals retain their expression scope', async () => {
            const groupedCounts = (input: typeof base) => {
              const projected = input.select({ bucket: caseWhen(input.columns.qty.lte(10), integer(1), integer(0)) });
              return projected.groupBy('bucket').aggregate({ n: count() }).orderBy({ column: 'bucket' });
            };
            assert.deepEqual(await run(groupedCounts(base)), [
              { bucket: signed(0), n: '5' }, { bucket: signed(1), n: '2' },
            ]);
            assert.deepEqual(await run(groupedCounts(base.filter(base.columns.id.eq(99)))), []);
          });

          await t.test('literal-only projected grouping key retains its bound value', async () => {
            const groupedCounts = (input: typeof base) => {
              const projected = input.select({ bucket: integer(7) });
              return projected.groupBy('bucket').aggregate({ n: count() });
            };
            assert.deepEqual(await run(groupedCounts(base)), [{ bucket: signed(7), n: '7' }]);
            assert.deepEqual(await run(groupedCounts(base.filter(base.columns.id.eq(99)))), []);
          });

          await t.test('window dependencies survive when output drops partition and ordering columns', async () => {
            const ranked = base.withRowNumber('position', {
              partitionBy: ['grp'], orderBy: [{ column: 'qty', direction: 'desc', nulls: 'last' }, { column: 'id' }],
            });
            const rankOnly = ranked.select({ position: ranked.columns.position }).orderBy({ column: 'position' });
            assert.deepEqual(await run(rankOnly), [1, 1, 1, 1, 2, 2, 2].map(position => ({ position: String(position) })));
          });

          await t.test('nested join retains grandchild keys referenced only by ON predicates', async () => {
            const first = base.filter(base.columns.id.eq(1));
            const innerJoin = first.join(base, { how: 'inner' });
            const innerMatch = innerJoin.on(innerJoin.left.grp.eq(innerJoin.right.grp));
            const intermediate = innerMatch.select({ outer_key: innerMatch.right.id, customer: innerMatch.left.id });
            const outerJoin = intermediate.join(base, { how: 'inner' });
            const outerMatch = outerJoin.on(outerJoin.left.outer_key.eq(outerJoin.right.id));
            const result = outerMatch.select({ customer: outerMatch.left.customer, quantity: outerMatch.right.qty })
              .orderBy({ column: 'quantity', nulls: 'last' });
            assert.deepEqual(await run(result), [{ customer: 1, quantity: 10 }, { customer: 1, quantity: null }]);
          });

          await t.test('filtered derived join input keeps WHERE dependencies absent from output', async () => {
            const filtered = base.filter(base.columns.flag.eq(1));
            const derived = filtered.select({ key: filtered.columns.id });
            const join = base.join(derived, { how: 'inner' });
            const matched = join.on(join.left.id.eq(join.right.key));
            const result = matched.select({ id: matched.left.id }).orderBy({ column: 'id' });
            assert.deepEqual(await run(result), [{ id: 1 }, { id: 4 }, { id: 7 }]);
          });

          await t.test('window input filters and output filters remain different computations', async () => {
            const rank = (q: typeof base) => q.withRowNumber('position', { partitionBy: ['grp'], orderBy: [{ column: 'id' }] });
            const ranked = rank(base);
            const after = ranked.filter(ranked.columns.id.eq(4));
            const before = rank(base.filter(base.columns.id.eq(4)));
            assert.deepEqual(await run(after.select({ id: after.columns.id, position: after.columns.position })), [{ id: 4, position: '2' }]);
            assert.deepEqual(await run(before.select({ id: before.columns.id, position: before.columns.position })), [{ id: 4, position: '1' }]);
          });

          await t.test('renamed window inputs preserve null partitions, ties and explicit null ordering', async () => {
            const renamed = base.select({ key: base.columns.id, category: base.columns.grp, amount: base.columns.qty });
            for (const nulls of ['first', 'last'] as const) {
              const ranked = renamed.withRowNumber('position', { partitionBy: ['category'], orderBy: [
                { column: 'amount', nulls }, { column: 'key' },
              ] });
              const top = ranked.filter(ranked.columns.position.lte(1));
              const expected = nulls === 'first' ? [2, 3, 5, 7] : [1, 3, 6, 7];
              assert.deepEqual(await run(top.select({ id: top.columns.key, position: top.columns.position }).orderBy({ column: 'id' })),
                expected.map(id => ({ id, position: '1' })));
            }
          });

          await t.test('offset, nested limits and replacement sort preserve the selected population', async () => {
            const page = base.orderBy({ column: 'id' }).limit(4, 1);
            const reversed = page.orderBy({ column: 'id', direction: 'desc' }).limit(2, 1);
            assert.deepEqual(await run(reversed.select({ id: reversed.columns.id })), [{ id: 4 }, { id: 3 }]);
            const empty = page.limit(0);
            const none = empty.aggregate({ n: count(), total: empty.columns.qty.sum() });
            assert.deepEqual(await run(none), [{ n: '0', total: null }]);
          });

          await t.test('ranking aggregate outputs and aggregate over filtered ranks retain separate levels', async () => {
            const totals = base.groupBy('grp').aggregate({ total: base.columns.qty.sum() });
            const ranked = totals.withRowNumber('position', { partitionBy: [], orderBy: [{ column: 'total', direction: 'desc', nulls: 'last' }] });
            const top = ranked.filter(ranked.columns.position.lte(2));
            assert.deepEqual(await run(top.select({ grp: top.columns.grp, total: top.columns.total, position: top.columns.position }).orderBy({ column: 'position' })),
              [{ grp: 'B', total: 40, position: '1' }, { grp: 'A', total: 10, position: '2' }]);
            assert.deepEqual(await run(top.aggregate({ total: top.columns.total.sum(), n: count() })), [{ total: 50, n: '2' }]);
          });

          await t.test('compound predicate follows three-valued logic; filter retains only TRUE', async () => {
            // Encode TRUE/FALSE/UNKNOWN as 1/0/-1, avoiding vendor bool encodings.
            const predicate = base.col('flag').eq(1).and(base.col('qty').lte(10));
            const truth = base.select({ id: base.col('id'), truth: caseWhen(predicate.isNull(), integer(-1),
              caseWhen(predicate, integer(1), integer(0))) }).orderBy({ column: 'id' });
            assert.deepEqual(await run(truth), [
              { id: 1, truth: signed(1) }, { id: 2, truth: signed(-1) }, { id: 3, truth: signed(0) },
              { id: 4, truth: signed(0) }, { id: 5, truth: signed(-1) }, { id: 6, truth: signed(0) }, { id: 7, truth: signed(-1) },
            ]);
            const filtered = base.filter(predicate);
            assert.deepEqual(await run(filtered.select({ id: filtered.col('id') })), [{ id: 1 }]);
            // FALSE AND UNKNOWN is FALSE; TRUE AND UNKNOWN is UNKNOWN.
            const rowTwo = base.filter(base.col('id').eq(2));
            const falseAndNull = rowTwo.select({
              result: caseWhen(rowTwo.col('flag').eq(1).and(rowTwo.col('id').eq(99)).isNull(), integer(1), integer(0)),
            });
            assert.deepEqual(await run(falseAndNull), [{ result: signed(0) }]);
          });

          await t.test('reordered/renamed projection binds later filters and preserves duplicates', async () => {
            const renamed = base.select({ amount: base.col('qty'), category: base.col('grp') });
            const rowOne = base.filter(base.col('id').eq(1));
            assert.deepEqual(await run(rowOne.select({
              second: rowOne.col('qty'), first: rowOne.col('id'), copy: rowOne.col('qty'),
            })), [{ second: 10, first: 1, copy: 10 }]);
            assert.deepEqual(await run(renamed.filter(renamed.columns.category.eq('B'))), [
              { amount: 20, category: 'B' }, { amount: 20, category: 'B' },
            ]);
            assert.deepEqual(await run(renamed.filter(renamed.columns.amount.lte(10))
              .orderBy({ column: 'amount' })), [
              { amount: 5, category: null }, { amount: 10, category: 'A' },
            ]);
          });

          await t.test('filter after limit applies to the limited relation', async () => {
            const ordered = base.orderBy({ column: 'id' });
            const ids = (q: Table) => q.select({ id: q.col('id') });
            const limited = ordered.limit(2);
            assert.deepEqual(await run(ids(limited.filter(limited.col('id').eq(4)))), []);
            assert.deepEqual(await run(ids(ordered.filter(ordered.col('id').eq(4)).limit(2))), [{ id: 4 }]);
          });

          await t.test('aggregate aliases compose; null grouping and all-null groups survive', async () => {
            const allNull = base.filter(base.col('grp').eq('C'));
            assert.deepEqual(await run(allNull.aggregate({
              total: allNull.col('qty').sum(), average: allNull.col('qty').avg(), rows: count(), valued: allNull.col('qty').count(),
            })), [{ total: null, average: null, rows: '1', valued: '0' }]);
            const totals = base.groupBy('grp').aggregate({ total: base.col('qty').sum(), n: count() });
            assert.deepEqual(await run(totals.orderBy({ column: 'grp', nulls: 'last' })), [
              { grp: 'A', total: 10, n: '2' }, { grp: 'B', total: 40, n: '2' },
              { grp: 'C', total: null, n: '1' }, { grp: null, total: 5, n: '2' },
            ]);
            assert.deepEqual(await run(totals.filter(totals.columns.total.lte(15))
              .orderBy({ column: 'grp', nulls: 'last' })), [
              { grp: 'A', total: 10, n: '2' }, { grp: null, total: 5, n: '2' },
            ]);
            assert.deepEqual(await run(totals.aggregate({
              total: totals.columns.total.sum(), groups: count(), valued: totals.columns.total.count(),
            })), [{ total: 55, groups: '4', valued: '3' }]);
          });

          await t.test('asymmetric self join preserves multiplicity and does not match null keys', async () => {
            const join = base.join(base.filter(base.col('id').lte(6)), { how: 'left' });
            const matched = join.on(join.left.grp.eq(join.right.grp));
            const joined = matched.select({ left_id: matched.left.id, right_id: matched.right.id,
              value: matched.right.qty.coalesce(-1) }).orderBy({ column: 'left_id' }, { column: 'right_id' });
            assert.deepEqual(await run(joined), [
              { left_id: 1, right_id: 1, value: signed(10) }, { left_id: 1, right_id: 2, value: signed(-1) },
              { left_id: 2, right_id: 1, value: signed(10) }, { left_id: 2, right_id: 2, value: signed(-1) },
              { left_id: 3, right_id: 3, value: signed(20) }, { left_id: 3, right_id: 4, value: signed(20) },
              { left_id: 4, right_id: 3, value: signed(20) }, { left_id: 4, right_id: 4, value: signed(20) },
              { left_id: 5, right_id: null, value: signed(-1) }, { left_id: 6, right_id: null, value: signed(-1) },
              { left_id: 7, right_id: null, value: signed(-1) },
            ]);
          });
        } finally { await sql`drop table ${sql.id(name)}`.execute(connection); }
      });
    } finally { await db.destroy(); }
  });
}

type FixtureRow = { id: number; grp: number | null; qty: number | null };
const fixtureSeed = 0x474f4c44;
function seededFixtures() {
  // Fixed-width LCG: deterministic across JS platforms; this is a bounded corpus,
  // not a statistical/fuzzing claim. Explicit edge cases do not depend on luck.
  let state = fixtureSeed;
  const next = () => state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
  const values = [null, -2147483648, -7, 0, 1, 2147483647] as const;
  const cases: { label: string; rows: FixtureRow[] }[] = [
    { label: 'empty', rows: [] },
    { label: 'all-null', rows: [{ id: 1, grp: null, qty: null }, { id: 2, grp: null, qty: null }] },
    { label: 'duplicates-and-boundaries', rows: [
      { id: 1, grp: 0, qty: -2147483648 }, { id: 2, grp: 0, qty: 2147483647 },
      { id: 3, grp: 1, qty: -7 }, { id: 4, grp: 1, qty: -7 },
      { id: 5, grp: null, qty: 0 }, { id: 6, grp: 1, qty: null },
    ] },
  ];
  for (let sample = 0; sample < 3; sample++) {
    cases.push({ label: `generated-${sample}`, rows: Array.from({ length: 8 }, (_, i) => {
      const group = (next() >>> 16) % 3;
      return { id: i + 1, grp: group === 2 ? null : group, qty: values[(next() >>> 16) % values.length] };
    }) });
  }
  return cases;
}

// Independent bag aggregate oracle. No API/compiler helper is used here.
// At most eight i32 values: every intermediate sum is exactly representable in JS.
function expectedMeasures(rows: readonly FixtureRow[]) {
  const valued = rows.filter(row => row.qty !== null);
  return { n: String(rows.length), valued: String(valued.length),
    total: valued.length === 0 ? null : valued.reduce((sum, row) => sum + row.qty!, 0) };
}
function expectedGroups(rows: readonly FixtureRow[]) {
  const groups = new Map<number | null, FixtureRow[]>();
  for (const row of rows) groups.set(row.grp, [...(groups.get(row.grp) ?? []), row]);
  return [...groups].sort(([a], [b]) => a === null ? 1 : b === null ? -1 : a - b)
    .map(([grp, members]) => ({ grp, ...expectedMeasures(members) }));
}

for (const backend of ['postgres', 'mysql', 'duckdb'] as const) {
  test(`${backend}: bounded metamorphic corpus seed=0x${fixtureSeed.toString(16)}`, async t => {
    const db = connect(backend, { duckdbPath: ':memory:' });
    const name = `api_property_${randomBytes(6).toString('hex')}`;
    const catalog = { [name]: [
      { name: 'id', type: 'i32', nullable: false },
      { name: 'grp', type: 'i32', nullable: true },
      { name: 'qty', type: 'i32', nullable: true },
    ] } as const satisfies Catalog;
    try {
      await db.connection().execute(async connection => {
        await sql`create table ${sql.id(name)} (id integer not null, grp integer, qty integer)`.execute(connection);
        try {
          const base = createSource(catalog).table(name);
          const run = async (q: Table) => (await connection.executeQuery(compilePlan(connection, q.toSubstrait(), catalog))).rows;
          const grouped = base.groupBy('grp').aggregate({
            n: count(), valued: base.columns.qty.count(), total: base.columns.qty.sum(),
          }).orderBy({ column: 'grp', nulls: 'last' });
          const global = base.aggregate({ n: count(), valued: base.columns.qty.count(), total: base.columns.qty.sum() });
          for (const { label, rows } of seededFixtures()) {
            await t.test(label, async () => {
              await sql`delete from ${sql.id(name)}`.execute(connection);
              const insert = async (input: readonly FixtureRow[]) => {
                if (input.length) await sql`insert into ${sql.id(name)} (id, grp, qty) values ${sql.join(
                  input.map(row => sql`(${row.id}, ${row.grp}, ${row.qty})`),
                )}`.execute(connection);
              };
              await insert(rows);
              // SQL WHERE keeps only TRUE. JS null <= 0 would incorrectly be true.
              const expectedIds = rows.filter(row => row.qty !== null && row.qty <= 0 && row.grp === 1)
                .map(row => ({ id: row.id })).sort((a, b) => a.id - b.id);
              const compound = base.filter(base.columns.qty.lte(0).and(base.columns.grp.eq(1)));
              const first = base.filter(base.columns.qty.lte(0));
              // Rebind the second predicate to the first filter's output scope.
              const sequential = first.filter(first.columns.grp.eq(1));
              const ids = (q: Table) => q.select({ id: q.col('id') }).orderBy({ column: 'id' });
              assert.deepEqual(await run(ids(compound)), expectedIds, 'compound filter oracle');
              assert.deepEqual(await run(ids(sequential)), expectedIds, 'sequential filter oracle');
              const expected = expectedGroups(rows);
              const before = await run(grouped);
              assert.deepEqual(before, expected, 'grouped bag oracle');
              assert.deepEqual(await run(global), [expectedMeasures(rows)], 'global aggregate oracle');
              await sql`delete from ${sql.id(name)}`.execute(connection);
              await insert([...rows].reverse());
              const after = await run(grouped);
              assert.deepEqual(after, expected, 'reversed insertion bag oracle');
              assert.deepEqual(after, before, 'grouping invariant under insertion order');
            });
          }
        } finally { await sql`drop table ${sql.id(name)}`.execute(connection); }
      });
    } finally { await db.destroy(); }
  });
}
