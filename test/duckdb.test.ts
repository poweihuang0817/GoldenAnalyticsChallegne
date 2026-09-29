import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sql } from 'kysely';
import { connect } from '../src/backend.js';
import { createSource } from '../src/api.js';
import { compilePlan, type Catalog } from '../src/compiler.js';
import { queryExamples } from '../src/queries.js';
import { challengeCatalog } from '../src/challenge.js';

test('DuckDB binds values and preserves decimal, i64, date and null results', async () => {
  const db = connect('duckdb', { duckdbPath: ':memory:' });
  try {
    const input = "x'); drop table orders; --";
    const rows = (await sql`select ${input} as text, cast('9007199254740993.1234567890' as decimal(38,10)) as amount,
      cast('9007199254740993' as bigint) as count, date '2026-09-26' as day, null as missing`.execute(db)).rows;
    assert.deepEqual(rows, [{ text: input, amount: '9007199254740993.1234567890', count: '9007199254740993', day: '2026-09-26', missing: null }]);
    await assert.rejects(sql`select ${new Date()}`.execute(db), /Unsupported DuckDB parameter/);
  } finally { await db.destroy(); }
});

test('DuckDB decimal division retains digits beyond JavaScript precision', async () => {
  const db = connect('duckdb', { duckdbPath: ':memory:' });
  const catalog = { amounts: [
    { name: 'a', type: 'decimal', nullable: true }, { name: 'b', type: 'decimal', nullable: true },
  ] } as const satisfies Catalog;
  try {
    await sql`create table amounts(a decimal(38,10), b decimal(38,10))`.execute(db);
    await sql`insert into amounts values ('9007199254740993.0000000000', 3)`.execute(db);
    const amounts = createSource(catalog).table('amounts');
    const query = amounts.select({ ratio: amounts.col('a').div(amounts.col('b')) });
    assert.deepEqual((await db.executeQuery(compilePlan(db, query.toSubstrait(), catalog))).rows, [{ ratio: '3002399751580331.0000000000' }]);
  } finally { await db.destroy(); }
});

test('DuckDB decimal division rounds signs and ties, preserves nulls, rejects overflow and exact average', async () => {
  const db = connect('duckdb', { duckdbPath: ':memory:' });
  const catalog = { amounts: [
    { name: 'id', type: 'i32', nullable: false },
    { name: 'a', type: 'decimal', nullable: true }, { name: 'b', type: 'decimal', nullable: true },
  ] } as const satisfies Catalog;
  try {
    await sql`create table amounts(id integer, a decimal(38,10), b decimal(38,10))`.execute(db);
    await sql`insert into amounts values (1, 1, 3), (2, -1, 3), (3, 1, -3), (4, -1, -3),
      (5, 0.0000000001, 2), (6, -0.0000000001, 2), (7, null, 1), (8, 1, null), (9, 1, 0), (10, 0, 2),
      (11,'100000000000000000000.0000000000',0), (12,'100000000000000000000.0000000000',null)`.execute(db);
    const source = createSource(catalog);
    const amounts = source.table('amounts');
    const query = amounts.select({ id: amounts.col('id'), ratio: amounts.col('a').div(amounts.col('b')) }).orderBy({ column: 'id' });
    assert.deepEqual((await db.executeQuery(compilePlan(db, query.toSubstrait(), catalog))).rows.map(r => r.ratio), [
      '0.3333333333', '-0.3333333333', '-0.3333333333', '0.3333333333', '0.0000000001', '-0.0000000001', null, null, null, '0.0000000000', null, null,
    ]);
    await sql`insert into amounts values (11, '100000000000000000000.0000000000', 1)`.execute(db);
    await assert.rejects(db.executeQuery(compilePlan(db, query.toSubstrait(), catalog)), /overflow/i);
    const avg = amounts.aggregate({ average: amounts.col('a').avg() });
    assert.throws(() => compilePlan(db, avg.toSubstrait(), catalog), /exact decimal average is unsupported/);
  } finally { await db.destroy(); }
});

test('DuckDB percentile preserves null groups, ties and large decimal interpolation', async () => {
  const db = connect('duckdb', { duckdbPath: ':memory:' });
  const catalog = { amounts: [
    { name: 'category', type: 'string', nullable: false }, { name: 'amount', type: 'decimal', nullable: true },
  ] } as const satisfies Catalog;
  try {
    await sql`create table amounts(category varchar, amount decimal(38,10))`.execute(db);
    await sql`insert into amounts values ('a',10),('a',20),('a',30),('a',40),('a',null),('b',null),
      ('big','9007199254740993.0000000000'),('big','9007199254740993.0000000100'),('c',7),('d',1),('d',1)`.execute(db);
    const source = createSource(catalog);
    const amounts = source.table('amounts');
    const query = amounts.groupBy('category').aggregate({ p: amounts.col('amount').percentile(0.75) }).orderBy({ column: 'category' });
    assert.deepEqual((await db.executeQuery(compilePlan(db, query.toSubstrait(), catalog))).rows, [
      { category: 'a', p: '32.5000000000' }, { category: 'b', p: null },
      { category: 'big', p: '9007199254740993.0000000075' }, { category: 'c', p: '7.0000000000' }, { category: 'd', p: '1.0000000000' },
    ]);
    await sql`delete from amounts`.execute(db);
    assert.deepEqual((await db.executeQuery(compilePlan(db, query.toSubstrait(), catalog))).rows, []);
    const global = amounts.aggregate({ p: amounts.col('amount').percentile(0.75) });
    assert.deepEqual((await db.executeQuery(compilePlan(db, global.toSubstrait(), catalog))).rows, [{ p: null }]);
  } finally { await db.destroy(); }
});

test('DuckDB six sample families match hand-calculated fixture results', async () => {
  const db = connect('duckdb', { duckdbPath: ':memory:' });
  try {
    await sql`create table customers(customer_id varchar, city varchar, country varchar)`.execute(db);
    await sql`create table employees(employee_id integer)`.execute(db);
    await sql`create table orders(order_id integer, order_date date, customer_id varchar, employee_id integer, shipped_date date, freight decimal(38,10))`.execute(db);
    await sql`create table order_details(order_id integer, unit_price decimal(38,10), quantity integer, discount decimal(38,10))`.execute(db);
    await sql`insert into customers values ('A','London','X'),('B','New York','Y'),('C','London','Z')`.execute(db);
    await sql`insert into employees values (1),(2)`.execute(db);
    await sql`insert into orders values (1,'2026-09-26','A',1,'2026-09-27',1), (2,'2026-09-25','A',1,null,2),
      (3,'2026-09-24','B',1,'2026-09-28',0),(4,null,'A',1,null,1)`.execute(db);
    await sql`insert into order_details values (1,10,2,0.1),(2,5,4,0)`.execute(db);
    const expected = [
      [{ order_id: 1, order_date: '2026-09-26' }, { order_id: 2, order_date: '2026-09-25' }, { order_id: 3, order_date: '2026-09-24' }, { order_id: 4, order_date: null }],
      [{ customer_count: '2' }], [{ customer_count: '0' }], [{ average_units: 1.5 }],
      [{ employee_id: 1, shipped: 2, unshipped: 2 }, { employee_id: 2, shipped: 0, unshipped: 0 }],
      [{ customer_id: 'A', freight_ratio: '0.1052631579' }, { customer_id: 'B', freight_ratio: null }, { customer_id: 'C', freight_ratio: null }],
      [{ country: 'X', order_price_p75: '19.0000000000' }, { country: 'Y', order_price_p75: '0.0000000000' }],
    ];
    for (const [i, example] of queryExamples.entries()) {
      assert.deepEqual((await db.executeQuery(compilePlan(db, example.query.toSubstrait(), challengeCatalog))).rows, expected[i], example.name);
    }
  } finally { await db.destroy(); }
});

test('DuckDB rolls back failed transactions and remains usable', async () => {
  const db = connect('duckdb', { duckdbPath: ':memory:' });
  try {
    await sql`create table rollback_test(id integer)`.execute(db);
    await assert.rejects(db.transaction().execute(async tx => {
      await sql`insert into rollback_test values (1)`.execute(tx);
      throw new Error('fixture failure');
    }), /fixture failure/);
    assert.deepEqual((await sql`select * from rollback_test`.execute(db)).rows, []);
    assert.deepEqual(await Promise.all([1,2,3].map(async n => (await sql`select cast(${n} as integer) as n`.execute(db)).rows)), [[{n:1}],[{n:2}],[{n:3}]]);
  } finally { await db.destroy(); }
  await assert.rejects(sql`select 1`.execute(db), /destroyed/);
});
