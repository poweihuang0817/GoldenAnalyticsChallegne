import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sql } from 'kysely';
import { connect } from '../src/backend.js';
import { compilePlan } from '../src/compiler.js';
import { encodePlan, decodePlan } from '../src/plan.js';
import { analyticalExamples, challengeCatalog, customersInCity, countryPercentile } from '../src/challenge.js';

type Row = Record<string, any>;
const fixed = (value: unknown, places: number): bigint => {
  const [whole, fraction = ''] = String(value ?? 0).split('.');
  return BigInt(whole) * 10n ** BigInt(places) + BigInt(fraction.padEnd(places, '0').slice(0, places));
};
const text10 = (value: bigint) => `${value / 10000000000n}.${String(value % 10000000000n).padStart(10, '0')}`;
function expected(customers: Row[], orders: Row[], details: Row[], employees: Row[]): Row[][] {
  // Independent oracle: raw rows + integer decimal arithmetic, no generated SQL formulas.
  const totals = new Map<number, bigint>(), units = new Map<number, number>();
  for (const d of details) {
    const total = fixed(d.unit_price, 2) * BigInt(d.quantity) * (100n - fixed(d.discount, 2));
    totals.set(d.order_id, (totals.get(d.order_id) ?? 0n) + total); // Scale 4.
    units.set(d.order_id, (units.get(d.order_id) ?? 0) + Number(d.quantity));
  }
  const countryValues = new Map<string, bigint[]>();
  const ratios = customers.map(c => {
    let price = 0n, freight = 0n;
    for (const o of orders.filter(o => o.customer_id === c.customer_id)) {
      const total = totals.get(o.order_id) ?? 0n;
      price += total;
      freight += fixed(o.freight, 2) * 100n;
      const values = countryValues.get(c.country) ?? [];
      values.push(total);
      countryValues.set(c.country, values);
    }
    return { customer_id: c.customer_id, freight_ratio: price === 0n ? null : text10((freight * 10000000000n + price/2n) / price) };
  }).sort((a,b) => a.customer_id.localeCompare(b.customer_id));
  const percentiles = [...countryValues].map(([country, values]) => {
    values.sort((a,b) => a < b ? -1 : a > b ? 1 : 0);
    const rankNumerator = (values.length - 1) * 3;
    const lo = Math.floor(rankNumerator / 4), remainder = BigInt(rankNumerator % 4);
    const high = values[Math.min(lo+1, values.length-1)];
    const result = values[lo] * 1000000n + (high - values[lo]) * 1000000n * remainder / 4n;
    return { country, order_price_p75: text10(result) };
  }).sort((a,b) => a.country.localeCompare(b.country));
  const shipped = employees.map(e => {
    const own = orders.filter(o => o.employee_id === e.employee_id);
    return { employee_id: e.employee_id, shipped: own.filter(o => o.shipped_date !== null).length, unshipped: own.filter(o => o.shipped_date === null).length };
  }).sort((a,b) => a.employee_id-b.employee_id);
  const count = (city: string) => [{ customer_count: String(customers.filter(c => c.city?.toLowerCase() === city.toLowerCase()).length) }];
  return [count('london'), count('mexico d.f.'), [{ average_units: orders.reduce((sum,o) => sum + (units.get(o.order_id) ?? 0), 0) / orders.length }], shipped, ratios, percentiles];
}

for (const backend of ['postgres', 'mysql'] as const) {
  test(`${backend}: every analytical sample matches an independent raw-data oracle`, async () => {
    const db = connect(backend);
    try {
      const customers = (await sql<Row>`select customer_id, city, country from customers`.execute(db)).rows;
      const orders = (await sql<Row>`select order_id, customer_id, employee_id, shipped_date, freight from orders`.execute(db)).rows;
      const details = (await sql<Row>`select order_id, unit_price, quantity, discount from order_details`.execute(db)).rows;
      const employees = (await sql<Row>`select employee_id from employees`.execute(db)).rows;
      const oracle = expected(customers, orders, details, employees);
      for (const [i, example] of analyticalExamples.entries()) {
        const plan = decodePlan(encodePlan(example.plan));
        const result = (await db.executeQuery(compilePlan(db, plan, challengeCatalog))).rows;
        if (i === 2) assert.ok(Math.abs(Number((result[0] as Row).average_units) - oracle[i][0].average_units) < 1e-12);
        else assert.deepEqual(result, oracle[i], example.name);
      }
      for (const city of ['LONDON', 'México D.F.', "london' OR 1=1 --"]) {
        const query = compilePlan(db, customersInCity(city), challengeCatalog);
        assert.ok(query.parameters.includes(city));
        assert.ok(!query.sql.includes(city));
        const rows = (await db.executeQuery(query)).rows;
        assert.deepEqual(rows, [{ customer_count: String(customers.filter(c => c.city?.toLowerCase() === city.toLowerCase()).length) }]);
      }
    } finally { await db.destroy(); }
  });
}

test('PostgreSQL: portable percentile agrees with native percentile_cont', async () => {
  const db = connect('postgres');
  try {
    const native = (await sql<Row>`select c.country, percentile_cont(0.75) within group (order by coalesce(t.price,0)::double precision) as p75 from customers c join orders o on o.customer_id=c.customer_id left join (select order_id, sum(unit_price*quantity*(1-discount)) as price from order_details group by order_id) t on t.order_id=o.order_id group by c.country order by c.country`.execute(db)).rows;
    const portable = (await db.executeQuery(compilePlan(db, countryPercentile(), challengeCatalog))).rows as Row[];
    assert.equal(portable.length, native.length);
    for (let i=0; i<native.length; i++) {
      assert.equal(portable[i].country, native[i].country);
      // Native percentile_cont returns double precision; decimal oracle above is exact.
      assert.ok(Math.abs(Number(portable[i].order_price_p75) - Number(native[i].p75)) < 1e-8);
    }
  } finally { await db.destroy(); }
});
