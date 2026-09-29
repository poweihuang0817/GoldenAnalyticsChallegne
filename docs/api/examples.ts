/** Runnable Northwind documentation examples; compilation is offline by default. */
import { createSource, count, literal } from '../../src/api.js';
import { challengeCatalog } from '../../src/challenge.js';
import { createClient } from '../../src/client.js';
import { type Backend } from '../../src/backend.js';
import { shippingQuery, freightQuery, percentileQuery } from '../../src/queries.js';

const source = createSource(challengeCatalog);
const customers = source.table('customers');
const city = customers.filter(customers.columns.city.lower().eq(literal('london').lower()))
  .aggregate({ customer_count: count() });
const orders = source.table('orders');
const recent = orders.select({ order_id: orders.columns.order_id, order_date: orders.columns.order_date })
  .orderBy({ column: 'order_date', direction: 'desc', nulls: 'last' }, { column: 'order_id', direction: 'desc' }).limit(5);
const details = source.table('order_details');
const units = details.groupBy('order_id').aggregate({ units: details.columns.quantity.sum() });
const join = orders.join(units, { how: 'left' });
const matched = join.on(join.left.order_id.eq(join.right.order_id));
const perOrder = matched.select({ units: matched.right.units.coalesce(0) });
const averageUnits = perOrder.aggregate({ average_units: perOrder.columns.units.avg() });
const rankedOrders = orders.select({ customer_id: orders.columns.customer_id, order_id: orders.columns.order_id, order_date: orders.columns.order_date })
  .withRowNumber('position', { partitionBy: ['customer_id'], orderBy: [
    { column: 'order_date', direction: 'desc', nulls: 'last' }, { column: 'order_id', direction: 'desc' },
  ] });
const ranked = rankedOrders.filter(rankedOrders.columns.position.lte(3))
  .orderBy({ column: 'customer_id' }, { column: 'position' });

const examples = [
  { name: 'London customers', query: city },
  { name: 'Recent orders', query: recent },
  { name: 'Average units per order', query: averageUnits },
  { name: 'Shipped and unshipped orders', query: shippingQuery() },
  { name: 'Freight ratio', query: freightQuery() },
  { name: 'Country percentile', query: percentileQuery() },
  { name: 'Recent orders per customer', query: ranked },
];
const args = process.argv.slice(2);
if (args.some(arg => arg !== '--execute')) throw new Error('Usage: npm run docs:examples -- [--execute]');
const execute = args.includes('--execute');
const backends: Backend[] = ['postgres', 'mysql', 'duckdb'];
for (const backend of backends) {
  const client = createClient(backend, challengeCatalog, execute ? undefined : { duckdbPath: ':memory:' });
  try {
    for (const { name, query } of examples) {
      const compiled = client.compile(query);
      if (execute) {
        const { rows } = await client.execute(query);
        console.log({ backend, name, rowCount: rows.length, preview: rows.slice(0, 2) });
      } else {
        console.log({ backend, name, parameterCount: compiled.parameters.length });
      }
    }
  } finally {
    await client.destroy();
  }
}
