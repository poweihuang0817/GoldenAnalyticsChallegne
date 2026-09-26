import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sql } from 'kysely';
import { connect } from '../src/backend.js';
import { seedDuckDB } from '../src/duckdb-seed.js';
import { challengeCatalog } from '../src/challenge.js';
import { compilePlan } from '../src/compiler.js';
import { queryExamples } from '../src/queries.js';

test('same six query families conform across PostgreSQL, MySQL and real DuckDB snapshot', async () => {
  const pg = connect('postgres'), my = connect('mysql'), duck = connect('duckdb', { duckdbPath: ':memory:' });
  try {
    const snapshot = await seedDuckDB(pg, duck);
    assert.deepEqual(snapshot.rows, { orders: 830, customers: 91, employees: 9, order_details: 2155 });
    for (const example of queryExamples) {
      const results = await Promise.all([pg, my, duck].map(async db =>
        (await db.executeQuery(compilePlan(db, example.query.toSubstrait(), challengeCatalog))).rows));
      for (const actual of results.slice(1)) {
        if (example.name === 'Average units per order') assert.ok(Math.abs(Number(actual[0].average_units) - Number(results[0][0].average_units)) < 1e-12);
        else assert.deepEqual(actual, results[0], example.name);
      }
    }
    // Independent fixed facts check the loaded source and driver representation.
    assert.deepEqual((await sql`select count(*)::varchar as count from orders`.execute(duck)).rows, [{ count: '830' }]);
  } finally { await Promise.all([pg.destroy(), my.destroy(), duck.destroy()]); }
});
