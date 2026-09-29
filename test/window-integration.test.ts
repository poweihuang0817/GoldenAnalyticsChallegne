import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { sql } from 'kysely';
import { connect } from '../src/backend.js';
import { compilePlan, type Catalog } from '../src/compiler.js';
import { createSource, literal } from '../src/api.js';
import { challengeCatalog } from '../src/challenge.js';
import { recentOrdersPerCustomer } from '../src/queries.js';
import { encodePlan, decodePlan } from '../src/plan.js';

type Order = { customer_id: string | null; order_id: number; order_date: string | null };
function oracle(rows: Order[], n: number) {
  const groups = new Map<string | null, Order[]>();
  for (const row of rows) groups.set(row.customer_id, [...(groups.get(row.customer_id) ?? []), row]);
  return [...groups].sort(([a],[b]) => a === null ? 1 : b === null ? -1 : a < b ? -1 : a > b ? 1 : 0)
    .flatMap(([, group]) => group.sort((a,b) => {
      if (a.order_date !== b.order_date) {
        if (a.order_date === null) return 1;
        if (b.order_date === null) return -1;
        return a.order_date > b.order_date ? -1 : 1;
      }
      return b.order_id - a.order_id;
    }).slice(0,n).map((row,i) => ({ ...row, position: String(i+1) })));
}
for (const backend of ['postgres','mysql'] as const) {
  test(`${backend}: extension matches independent per-customer sorting of Northwind rows`, async () => {
    const db = connect(backend);
    try {
      const rows = (await sql<Order>`select customer_id, order_id, order_date from orders`.execute(db)).rows;
      for (const n of [0,1,3,1000]) {
        const plan = decodePlan(encodePlan(recentOrdersPerCustomer(n).toSubstrait()));
        assert.deepEqual((await db.executeQuery(compilePlan(db, plan, challengeCatalog))).rows, oracle(rows,n));
      }
    } finally { await db.destroy(); }
  });
  test(`${backend}: window ties, nulls, small partitions, global rank and empty input`, async () => {
    const db = connect(backend), table = `window_test_${randomBytes(6).toString('hex')}`;
    const catalog = { [table]: [
      { name: 'customer_id', type: 'string', nullable: true }, { name: 'order_id', type: 'i32', nullable: false },
      { name: 'order_date', type: 'date', nullable: true },
    ] } as const satisfies Catalog;
    const rows: Order[] = [
      { customer_id: 'a', order_id: 1, order_date: null },
      { customer_id: 'a', order_id: 2, order_date: '2020-01-01' },
      { customer_id: 'a', order_id: 3, order_date: '2020-01-01' },
      { customer_id: 'a', order_id: 4, order_date: '2019-01-01' },
      { customer_id: 'b', order_id: 5, order_date: null },
      { customer_id: null, order_id: 6, order_date: '2021-01-01' },
      { customer_id: null, order_id: 7, order_date: null },
    ];
    try {
      await db.connection().execute(async connection => {
        await sql`create temporary table ${sql.id(table)} (customer_id varchar(20), order_id integer not null, order_date date)`.execute(connection);
        try {
          for (const r of rows) await sql`insert into ${sql.id(table)} values (${r.customer_id}, ${r.order_id}, ${r.order_date})`.execute(connection);
          const base = createSource(catalog).table(table);
          const ranked = base.withRowNumber('position', { partitionBy: ['customer_id'], orderBy: [
            { column: 'order_date', direction: 'desc' }, { column: 'order_id', direction: 'desc' },
          ] });
          const run = async (query: typeof base) => (await connection.executeQuery(compilePlan(connection, decodePlan(encodePlan(query.toSubstrait())), catalog))).rows;
          for (const n of [0,1,3,9]) assert.deepEqual(await run(ranked.filter(ranked.columns.position.lte(n)).orderBy({ column: 'customer_id' }, { column: 'position' })), oracle(rows,n));
          const global = base.withRowNumber('position', { partitionBy: [], orderBy: [{ column: 'order_id' }] }).orderBy({ column: 'order_id' });
          assert.deepEqual((await run(global)).map(r => r.position), ['1','2','3','4','5','6','7']);
          const nullFirstRanked = base.withRowNumber('position', { partitionBy: ['customer_id'], orderBy: [
            { column: 'order_date', direction: 'asc', nulls: 'first' }, { column: 'order_id' },
          ] });
          const nullFirst = nullFirstRanked.filter(nullFirstRanked.columns.position.lte(1)).orderBy({ column: 'customer_id' });
          assert.deepEqual((await run(nullFirst)).map(r => r.order_id), [1,5,7]);
          assert.deepEqual(await run(base.filter(literal(false)).withRowNumber('position', { partitionBy: [], orderBy: [{ column: 'order_id' }] })), []);
        } finally { await sql`drop table ${sql.id(table)}`.execute(connection); }
      });
    } finally { await db.destroy(); }
  });
}
test('extension returns identical values and rank strings across backends', async () => {
  const pg = connect('postgres'), my = connect('mysql'), plan = recentOrdersPerCustomer().toSubstrait();
  try {
    assert.deepEqual((await pg.executeQuery(compilePlan(pg,plan,challengeCatalog))).rows,
      (await my.executeQuery(compilePlan(my,plan,challengeCatalog))).rows);
  } finally { await Promise.all([pg.destroy(),my.destroy()]); }
});
