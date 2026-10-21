import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sql } from 'kysely';
import { connect } from '../src/backend.js';
import { seedDuckDB } from '../src/duckdb-seed.js';
import { runExplore } from '../src/playground/explore-server.js';

test('forecast inputs and outputs agree on provided PostgreSQL/MySQL and seeded DuckDB', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'golden-forecast-conformance-'));
  const options = { duckdbPath: join(directory, 'northwind.duckdb') };
  const pg = connect('postgres'), duck = connect('duckdb', options);
  try {
    try { await seedDuckDB(pg, duck); } finally { await duck.destroy(); }
    for (const stage of ['all','uk','london'] as const) {
      let expected: unknown;
      for (const backend of ['postgres','mysql','duckdb'] as const) {
        const result = await runExplore({ stage, backend, action: 'run' }, options);
        assert.ok('history' in result);
        const comparable = { customers: result.customers, history: result.history, predictions: result.predictions, backtest: result.backtest };
        if (backend === 'postgres') expected = comparable; else assert.deepEqual(comparable, expected, `${stage}: ${backend}`);
        if (stage === 'all') assert.equal(result.customers, '91');
        if (stage === 'london') assert.equal(result.customers, '6');
        if (backend === 'postgres') {
          // Independent handwritten SQL aggregates monthly in the DB instead of Golden daily + JS monthly.
          const predicate = stage === 'all' ? sql`true` : stage === 'uk' ? sql`lower(c.country) = 'uk'` : sql`lower(c.country) = 'uk' and lower(c.city) = 'london'`;
          const oracle = await sql<{ month: string; sales: string }>`select to_char(o.order_date, 'YYYY-MM') as month,
            round(sum(cast(d.unit_price as numeric(38,10)) * d.quantity * (1 - cast(d.discount as numeric(38,10)))), 2)::text as sales
            from customers c join orders o on c.customer_id = o.customer_id join order_details d on o.order_id = d.order_id
            where o.order_date is not null and ${predicate} group by to_char(o.order_date, 'YYYY-MM')`.execute(pg);
          const totals = new Map(oracle.rows.map(r => [r.month, r.sales]));
          for (const row of result.history) assert.equal(row.sales, totals.get(row.month) ?? '0.00', `${stage}: independent monthly oracle ${row.month}`);
        }
      }
    }
  } finally { await pg.destroy(); await rm(directory, { recursive: true, force: true }); }
});
