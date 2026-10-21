import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sql } from 'kysely';
import { connect } from '../src/backend.js';
import { runExplore } from '../src/playground/explore-query.js';

test('real DuckDB execution matches independent monthly totals and filter counts', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'golden-forecast-'));
  const options = { duckdbPath: join(directory, 'fixture.duckdb') };
  const db = connect('duckdb', options);
  try {
    await sql.raw('create table customers(customer_id varchar, city varchar, country varchar)').execute(db);
    await sql.raw('create table orders(order_id integer, order_date date, customer_id varchar, employee_id integer, shipped_date date, freight decimal(38,10))').execute(db);
    await sql.raw('create table order_details(order_id integer, unit_price decimal(38,10), quantity integer, discount decimal(38,10))').execute(db);
    await sql.raw("insert into customers values ('a','London','UK'),('b','Manchester','UK'),('c','Paris','France')").execute(db);
    for (let month = 1; month <= 6; month++) {
      for (let customer = 1; customer <= 3; customer++) {
        const id = month * 10 + customer, date = `1997-${String(month).padStart(2,'0')}-15`;
        await sql`insert into orders values (${id}, cast(${date} as date), ${['a','b','c'][customer-1]}, 1, null, 0)`.execute(db);
        if (!(month === 4 && customer === 1)) await sql`insert into order_details values (${id}, ${month * customer * 10}, 1, 0)`.execute(db);
      }
    }
  } finally { await db.destroy(); }
  try {
    for (const [stage, count, history, prediction] of [
      ['all','3',['120.00','180.00','200.00','300.00'],'226.67'],
      ['uk','2',['60.00','90.00','80.00','150.00'],'106.67'],
      ['london','1',['20.00','30.00','0.00','50.00'],'26.67'],
    ] as const) {
      const result = await runExplore({ stage, backend: 'duckdb', action: 'run' }, options);
      assert.ok('history' in result); assert.equal(result.customers, count);
      assert.deepEqual(result.history.map(r => r.sales), history); assert.equal(result.predictions[0].sales, prediction);
      assert.doesNotMatch(result.countSQL, /London|'UK'/);
      if (stage === 'london') { assert.ok(result.countParameters.includes('London')); assert.ok(result.countParameters.includes('UK')); }
      assert.equal((result.countSQL.match(/\bselect\b/gi) ?? []).length, 1);
    }
    for (const backend of ['postgres','mysql','duckdb'] as const) {
      const preview = await runExplore({ stage: 'london', backend, action: 'compile' }, options);
      assert.ok(preview.countParameters.includes('London'));
      assert.match(preview.salesSQL, /sum/i);
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});
