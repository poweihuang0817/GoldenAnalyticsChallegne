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
    const catalog: Catalog = { [name]: [
      { name: 'id', type: 'i32', nullable: false },
      { name: 'grp', type: 'string', nullable: true },
      { name: 'qty', type: 'i32', nullable: true },
      { name: 'flag', type: 'i32', nullable: true },
    ] };
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

          await t.test('compound predicate follows three-valued logic; filter retains only TRUE', async () => {
            // Encode TRUE/FALSE/UNKNOWN as 1/0/-1, avoiding vendor bool encodings.
            const truth = base.select(c => {
              const predicate = c.col('flag').eq(1).and(c.col('qty').lte(10));
              return { id: c.col('id'), truth: caseWhen(predicate.isNull(), integer(-1),
                caseWhen(predicate, integer(1), integer(0))) };
            }).orderBy({ column: 'id' });
            assert.deepEqual(await run(truth), [
              { id: 1, truth: signed(1) }, { id: 2, truth: signed(-1) }, { id: 3, truth: signed(0) },
              { id: 4, truth: signed(0) }, { id: 5, truth: signed(-1) }, { id: 6, truth: signed(0) }, { id: 7, truth: signed(-1) },
            ]);
            const filtered = base.filter(c => c.col('flag').eq(1).and(c.col('qty').lte(10)))
              .select(c => ({ id: c.col('id') }));
            assert.deepEqual(await run(filtered), [{ id: 1 }]);
            // FALSE AND UNKNOWN is FALSE; TRUE AND UNKNOWN is UNKNOWN.
            const falseAndNull = base.filter(c => c.col('id').eq(2)).select(c => ({
              result: caseWhen(c.col('flag').eq(1).and(c.col('id').eq(99)).isNull(), integer(1), integer(0)),
            }));
            assert.deepEqual(await run(falseAndNull), [{ result: signed(0) }]);
          });

          await t.test('reordered/renamed projection binds later filters and preserves duplicates', async () => {
            const renamed = base.select(c => ({ amount: c.col('qty'), category: c.col('grp') }));
            assert.deepEqual(await run(base.filter(c => c.col('id').eq(1)).select(c => ({
              second: c.col('qty'), first: c.col('id'), copy: c.col('qty'),
            }))), [{ second: 10, first: 1, copy: 10 }]);
            assert.deepEqual(await run(renamed.filter(c => c.col('category').eq('B'))), [
              { amount: 20, category: 'B' }, { amount: 20, category: 'B' },
            ]);
            assert.deepEqual(await run(renamed.filter(c => c.col('amount').lte(10))
              .orderBy({ column: 'amount' })), [
              { amount: 5, category: null }, { amount: 10, category: 'A' },
            ]);
          });

          await t.test('filter after limit applies to the limited relation', async () => {
            const ordered = base.orderBy({ column: 'id' });
            const ids = (q: Table) => q.select(c => ({ id: c.col('id') }));
            assert.deepEqual(await run(ids(ordered.limit(2).filter(c => c.col('id').eq(4)))), []);
            assert.deepEqual(await run(ids(ordered.filter(c => c.col('id').eq(4)).limit(2))), [{ id: 4 }]);
          });

          await t.test('aggregate aliases compose; null grouping and all-null groups survive', async () => {
            assert.deepEqual(await run(base.filter(c => c.col('grp').eq('C')).aggregate(c => ({
              total: c.col('qty').sum(), average: c.col('qty').avg(), rows: count(), valued: c.col('qty').count(),
            }))), [{ total: null, average: null, rows: '1', valued: '0' }]);
            const totals = base.groupBy('grp').aggregate(c => ({ total: c.col('qty').sum(), n: count() }));
            assert.deepEqual(await run(totals.orderBy({ column: 'grp', nulls: 'last' })), [
              { grp: 'A', total: 10, n: '2' }, { grp: 'B', total: 40, n: '2' },
              { grp: 'C', total: null, n: '1' }, { grp: null, total: 5, n: '2' },
            ]);
            assert.deepEqual(await run(totals.filter(c => c.col('total').lte(15))
              .orderBy({ column: 'grp', nulls: 'last' })), [
              { grp: 'A', total: 10, n: '2' }, { grp: null, total: 5, n: '2' },
            ]);
            assert.deepEqual(await run(totals.aggregate(c => ({
              total: c.col('total').sum(), groups: count(), valued: c.col('total').count(),
            }))), [{ total: 55, groups: '4', valued: '3' }]);
          });

          await t.test('asymmetric self join preserves multiplicity and does not match null keys', async () => {
            const joined = base.join(base.filter(c => c.col('id').lte(6)), {
              how: 'left', on: (l, r) => l.col('grp').eq(r.col('grp')),
              select: (l, r) => ({ left_id: l.col('id'), right_id: r.col('id'), value: r.col('qty').coalesce(-1) }),
            }).orderBy({ column: 'left_id' }, { column: 'right_id' });
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
