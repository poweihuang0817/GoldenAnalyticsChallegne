import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sql } from 'kysely';
import { createSource, literal, count, type Table } from '../src/api.js';
import { connect } from '../src/backend.js';
import { createClient } from '../src/client.js';
import { compilePlan } from '../src/compiler.js';
import { challengeCatalog } from '../src/challenge.js';
import { queryExamples, recentOrdersQuery, cityQuery } from '../src/queries.js';

test('every public API example produces equivalent results on PostgreSQL and MySQL', async () => {
  const pg = createClient('postgres', challengeCatalog), my = createClient('mysql', challengeCatalog);
  try {
    for (const { name, query } of queryExamples) {
      const a = (await pg.execute(query)).rows;
      const b = (await my.execute(query)).rows;
      if (name === 'Average units per order') {
        assert.ok('average_units' in a[0] && 'average_units' in b[0]);
        assert.ok(Math.abs(Number(a[0].average_units) - Number(b[0].average_units)) < 1e-12);
      }
      else assert.deepEqual(a, b, name);
    }
  } finally { await Promise.all([pg.destroy(), my.destroy()]); }
});
for (const backend of ['postgres', 'mysql'] as const) {
  test(`${backend}: API composition, empty aggregates, pagination and deterministic equivalence cases`, async () => {
    const db = connect(backend), source = createSource(challengeCatalog);
    const execute = async (query: Table) => (await db.executeQuery(compilePlan(db, query.toSubstrait(), challengeCatalog))).rows;
    try {
      const reference = (await sql`select order_id, order_date from orders order by case when order_date is null then 1 else 0 end, order_date desc, order_id desc limit 5`.execute(db)).rows;
      assert.deepEqual(await execute(recentOrdersQuery()), reference);
      assert.deepEqual(await execute(recentOrdersQuery().limit(2, 1)), reference.slice(1, 3));
      assert.deepEqual(await execute(recentOrdersQuery(0)), []);
      const orders = source.table('orders');
      const base = orders.select({ order_id: orders.columns.order_id }).orderBy({ column: 'order_id' });
      assert.deepEqual(await execute(base.filter(literal(true))), await execute(base));
      assert.deepEqual(await execute(base.select({ order_id: base.columns.order_id })), await execute(base));
      for (const n of [0, 1, 5, 900]) for (const m of [0, 3, 7]) {
        assert.deepEqual(await execute(base.limit(n).limit(m)), await execute(base.limit(Math.min(n, m))));
      }
      const customers = source.table('customers');
      const combined = customers.filter(customers.columns.city.isNotNull().and(customers.columns.country.eq('UK'))).orderBy({ column: 'customer_id' });
      const nonNullCity = customers.filter(customers.columns.city.isNotNull());
      const split = nonNullCity.filter(nonNullCity.columns.country.eq('UK')).orderBy({ column: 'customer_id' });
      assert.deepEqual(await execute(combined), await execute(split));
      const empty = customers.filter(literal(false));
      assert.deepEqual(await execute(empty.aggregate({ n: count() })), [{ n: '0' }]);
      assert.deepEqual(await execute(empty.groupBy('country').aggregate({ n: count() })), []);
      assert.deepEqual(await execute(cityQuery("london' OR 1=1 --")), [{ customer_count: '0' }]);
      const employee = source.table('employees');
      const join = employee.join(employee.filter(literal(false)), { how: 'left' });
      const matched = join.on(join.left.employee_id.eq(join.right.employee_id));
      const joined = matched.select({ employee_id: matched.left.employee_id, right_id: matched.right.employee_id });
      const unmatched = joined.aggregate({ rows: count(), matched: joined.columns.right_id.count() });
      const total = await execute(employee.aggregate({ n: count() }));
      assert.deepEqual(await execute(unmatched), [{ rows: total[0].n, matched: '0' }]);
    } finally { await db.destroy(); }
  });
}
