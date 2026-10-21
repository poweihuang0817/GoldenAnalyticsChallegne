import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CompiledQuery } from 'kysely';
import { connect } from '../src/backend.js';
import { createClient } from '../src/client.js';
import { createSource } from '../src/api.js';
import { compilePlanSync } from '../src/compiler.js';
import { challengeCatalog } from '../src/challenge.js';
import { queryExamples, recentOrdersPerCustomer } from '../src/queries.js';
import { once } from 'node:events';
import { createDemoServer } from '../src/playground/server.js';

const enabled = Boolean(process.env.BIGQUERY_PROJECT_ID && process.env.BIGQUERY_DATASET);
const examples = [...queryExamples, { name: 'window', query: recentOrdersPerCustomer() }];

test('BigQuery live Playground: all eight fixed examples execute through HTTP', { skip: !enabled }, async () => {
  const server = createDemoServer();
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('address');
  try {
    const expectedCounts = [5, 1, 1, 1, 9, 91, 21, 263];
    for (const [i, query] of ['recent', 'city', 'city-mexico', 'units', 'shipping', 'freight', 'percentile', 'window'].entries()) {
      const response: Response = await fetch(`http://127.0.0.1:${address.port}/query`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, backend: 'bigquery', action: 'run' }) });
      assert.equal(response.status, 200, query);
      const result = await response.json() as { rowCount: number; rows: unknown[]; sqlPreview: { formatted: boolean }; parameters: unknown[] };
      assert.equal(result.rowCount, expectedCounts[i], query);
      assert.equal(result.sqlPreview.formatted, true, query);
      assert.equal(result.rows.length, Math.min(100, result.rowCount));
      if (query === 'city') {
        assert.deepEqual(result.rows, [{ customer_count: '6' }]);
        assert.deepEqual(result.parameters, ['london']);
      }
    }
  } finally { server.close(); server.closeAllConnections(); await once(server, 'close'); }
});
// Read-only CTEs shadow the dataset tables. Nothing is created, inserted or deleted.
const fixture = `with
customers as (select 'A' customer_id, 'London' city, 'X' country union all select 'B','New York','Y' union all select 'C','London','Z'),
employees as (select 1 employee_id union all select 2),
orders as (
 select 1 order_id, date '2026-09-26' order_date, 'A' customer_id, 1 employee_id, date '2026-09-27' shipped_date, bignumeric '1' freight
 union all select 2,date '2026-09-25','A',1,null,2
 union all select 3,date '2026-09-24','B',1,date '2026-09-28',0
 union all select 4,null,'A',1,null,1),
order_details as (select 1 order_id,bignumeric '10' unit_price,2 quantity,bignumeric '0.1' discount union all select 2,5,4,0)
`;
test('BigQuery live: all challenge families and ranking match hand-calculated read-only fixtures', { skip: !enabled }, async () => {
  const db = connect('bigquery');
  const expected = [
    [{ order_id: 1, order_date: '2026-09-26' }, { order_id: 2, order_date: '2026-09-25' }, { order_id: 3, order_date: '2026-09-24' }, { order_id: 4, order_date: null }],
    [{ customer_count: '2' }], [{ customer_count: '0' }], [{ average_units: 1.5 }],
    [{ employee_id: 1, shipped: 2, unshipped: 2 }, { employee_id: 2, shipped: 0, unshipped: 0 }],
    [{ customer_id: 'A', freight_ratio: '0.1052631579' }, { customer_id: 'B', freight_ratio: null }, { customer_id: 'C', freight_ratio: null }],
    [{ country: 'X', order_price_p75: '19.0000000000' }, { country: 'Y', order_price_p75: '0.0000000000' }],
    [{ customer_id: 'A', order_id: 1, order_date: '2026-09-26', position: '1' },
      { customer_id: 'A', order_id: 2, order_date: '2026-09-25', position: '2' },
      { customer_id: 'A', order_id: 4, order_date: null, position: '3' },
      { customer_id: 'B', order_id: 3, order_date: '2026-09-24', position: '1' }],
  ];
  try {
    for (const [i, example] of examples.entries()) {
      const query = compilePlanSync(db, example.query.toSubstrait(), challengeCatalog);
      const result = await db.executeQuery(CompiledQuery.raw(fixture + query.sql, [...query.parameters]));
      assert.deepEqual(result.rows, expected[i], example.name);
    }
  } finally { await db.destroy(); }
});

test('BigQuery live: exact decimal division, nulls, half ties, precision and overflow', { skip: !enabled }, async () => {
  const db = connect('bigquery');
  const catalog = { amounts: [{ name: 'id', type: 'i32', nullable: false }, { name: 'a', type: 'decimal', nullable: true }, { name: 'b', type: 'decimal', nullable: true }] } as const;
  const amounts = createSource(catalog).table('amounts');
  const query = amounts.select({ id: amounts.columns.id, ratio: amounts.columns.a.div(amounts.columns.b) }).orderBy({ column: 'id' });
  const compiled = compilePlanSync(db, query.toSubstrait(), catalog);
  const run = (rows: string) => db.executeQuery(CompiledQuery.raw(`with amounts as (${rows}) ${compiled.sql}`, [...compiled.parameters]));
  try {
    assert.deepEqual((await run(`select 1 id, bignumeric '9007199254740993' a, bignumeric '3' b
      union all select 2,1,3 union all select 3,bignumeric '-0.0000000001',2 union all select 4,null,1
      union all select 5,1,0 union all select 6,1,null union all select 7,bignumeric '0.0000000001',2`)).rows,
      [{ id: 1, ratio: '3002399751580331.0000000000' }, { id: 2, ratio: '0.3333333333' }, { id: 3, ratio: '-0.0000000001' },
        { id: 4, ratio: null }, { id: 5, ratio: null }, { id: 6, ratio: null }, { id: 7, ratio: '0.0000000001' }]);
    await assert.rejects(run("select 1 id, bignumeric '10000000000000000000000000000' a, bignumeric '1' b"), /overflow/i);
  } finally { await db.destroy(); }
});

test('BigQuery native percentile: exact precision, ties, null groups and empty aggregates', { skip: !enabled }, async () => {
  const db = connect('bigquery');
  const catalog = { samples: [{ name: 'g', type: 'string', nullable: true }, { name: 'v', type: 'decimal', nullable: true }, { name: 'f', type: 'fp64', nullable: true }] } as const;
  const samples = createSource(catalog).table('samples');
  const data = `select 'a' g, bignumeric '9007199254740993' v, 1.0 f
    union all select 'a',bignumeric '9007199254740993.0000000002',3.0
    union all select 'a',null,null union all select 'nulls',null,null
    union all select cast(null as string),bignumeric '-0.0000000001',2.0
    union all select null,bignumeric '0',2.0`;
  try {
    for (const [p, a, n, f] of [
      [0, '9007199254740993.0000000000', '-0.0000000001', 1],
      [0.5, '9007199254740993.0000000001', '-0.0000000001', 2],
      [0.75, '9007199254740993.0000000002', '0.0000000000', 2.5],
      [1, '9007199254740993.0000000002', '0.0000000000', 3],
    ] as const) {
      for (const column of ['v', 'f'] as const) {
        const query = samples.groupBy('g').aggregate({ p: samples.columns[column].percentile(p) }).orderBy({ column: 'g' });
        const compiled = compilePlanSync(db, query.toSubstrait(), catalog);
        const result = await db.executeQuery(CompiledQuery.raw(`with samples as (${data}) ${compiled.sql}`, [...compiled.parameters]));
        assert.deepEqual(result.rows, [{ g: 'a', p: column === 'v' ? a : f }, { g: 'nulls', p: null }, { g: null, p: column === 'v' ? n : 2 }]);
      }
    }
    for (const grouped of [false, true]) {
      const query = grouped ? samples.groupBy('g').aggregate({ p: samples.columns.v.percentile(0.75) }) : samples.aggregate({ p: samples.columns.v.percentile(0.75) });
      const compiled = compilePlanSync(db, query.toSubstrait(), catalog);
      const result = await db.executeQuery(CompiledQuery.raw(`with samples as (select * from (${data}) where false) ${compiled.sql}`, [...compiled.parameters]));
      assert.deepEqual(result.rows, grouped ? [] : [{ p: null }]);
    }
  } finally { await db.destroy(); }
});

// Independently authored reference SQL plus hand-calculated fixtures above.
const prices = `with prices as (select order_id, sum(cast(unit_price as bignumeric)*quantity*(1-cast(discount as bignumeric))) price from order_details group by order_id),
 priced as (select o.*, coalesce(p.price,0) price from orders o left join prices p using(order_id)) `;
const references = [
  'select order_id, order_date from orders order by order_date desc nulls last, order_id desc limit 5',
  "select cast(count(*) as string) customer_count from customers where lower(city) = 'london'",
  "select cast(count(*) as string) customer_count from customers where lower(city) = 'mexico d.f.'",
  'with units as (select order_id,sum(quantity) n from order_details group by order_id) select cast(avg(coalesce(n,0)) as float64) average_units from orders left join units using(order_id)',
  'select e.employee_id, cast(countif(o.order_id is not null and o.shipped_date is not null) as float64) shipped, cast(countif(o.order_id is not null and o.shipped_date is null) as float64) unshipped from employees e left join orders o using(employee_id) group by e.employee_id order by e.employee_id',
  prices + "select c.customer_id, format('%.10f',sum(coalesce(cast(p.freight as bignumeric),0))/nullif(sum(p.price),0)) freight_ratio from customers c left join priced p using(customer_id) group by c.customer_id order by c.customer_id",
  prices + "select country, format('%.10f',any_value(p75)) order_price_p75 from (select c.country, percentile_cont(p.price,bignumeric '0.75') over(partition by c.country) p75 from customers c join priced p using(customer_id)) group by country order by country",
  'select customer_id,order_id,order_date,cast(row_number() over(partition by customer_id order by order_date desc nulls last,order_id desc) as string) position from orders qualify row_number() over(partition by customer_id order by order_date desc nulls last,order_id desc)<=3 order by customer_id nulls last,cast(position as int64)',
];
test('BigQuery live Northwind dataset: public worker/client agrees with native reference SQL', { skip: !enabled }, async () => {
  const client = createClient('bigquery', challengeCatalog);
  const db = connect('bigquery');
  try {
    for (const [i, example] of examples.entries()) {
      const actual = (await client.execute(example.query, { timeoutMs: 60000 })).rows;
      const expected = (await db.executeQuery(CompiledQuery.raw(references[i]))).rows;
      if (i === 3) assert.ok(Math.abs(Number((actual[0] as Record<string, unknown>).average_units) - Number((expected[0] as Record<string, unknown>).average_units)) < 1e-10);
      else assert.deepEqual(actual, expected, example.name);
    }
  } finally { await client.destroy(); await db.destroy(); }
});
