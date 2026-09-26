import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sql } from 'kysely';
import { connect } from '../src/backend.js';
import { compilePlan } from '../src/compiler.js';
import { catalog, recentOrders } from '../src/example.js';

for (const backend of ['postgres', 'mysql'] as const) {
  test(`${backend}: Substrait top-N matches independent reference SQL`, async () => {
    const db = connect(backend);
    try {
      const reference = await sql`select order_id, order_date from orders order by case when order_date is null then 1 else 0 end, order_date desc, order_id desc limit 5`.execute(db);
      const actual = await db.executeQuery(compilePlan(db, recentOrders(5), catalog));
      assert.equal(actual.rows.length, 5);
      assert.deepEqual(actual.rows, reference.rows);
      const empty = await db.executeQuery(compilePlan(db, recentOrders(0), catalog));
      assert.deepEqual(empty.rows, []);
      const offsetPlan = recentOrders(3);
      if ('fetch' in offsetPlan.relations[0].root.input) offsetPlan.relations[0].root.input.fetch.offset = '2';
      const page = await db.executeQuery(compilePlan(db, offsetPlan, catalog));
      assert.deepEqual(page.rows, reference.rows.slice(2, 5));
    } finally { await db.destroy(); }
  });
}

test('both backends return identical values and DATE representations', async () => {
  const postgres = connect('postgres');
  const mysql = connect('mysql');
  try {
    const plan = recentOrders();
    const pg = await postgres.executeQuery(compilePlan(postgres, plan, catalog));
    const my = await mysql.executeQuery(compilePlan(mysql, plan, catalog));
    assert.deepEqual(pg.rows, my.rows);
  } finally { await Promise.all([postgres.destroy(), mysql.destroy()]); }
});
