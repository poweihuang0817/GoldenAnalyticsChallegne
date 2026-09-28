/** Runnable Northwind documentation examples; compilation is offline by default. */
import { createSource, count, literal } from '../../src/api.js';
import { challengeCatalog } from '../../src/challenge.js';
import { compilePlan } from '../../src/compiler.js';
import { connect, type Backend } from '../../src/backend.js';
import { shippingQuery, freightQuery, percentileQuery } from '../../src/queries.js';
import { encodePlan, decodePlan } from '../../src/plan.js';

const source = createSource(challengeCatalog);
const city = source.table('customers')
  .filter(t => t.col('city').lower().eq(literal('london').lower()))
  .aggregate(() => ({ customer_count: count() }));

const recent = source.table('orders')
  .select(t => ({ order_id: t.col('order_id'), order_date: t.col('order_date') }))
  .orderBy(
    { column: 'order_date', direction: 'desc', nulls: 'last' },
    { column: 'order_id', direction: 'desc' },
  ).limit(5);

const units = source.table('order_details').groupBy('order_id')
  .aggregate(t => ({ units: t.col('quantity').sum() }));
const averageUnits = source.table('orders').join(units, {
  how: 'left',
  on: (o, u) => o.col('order_id').eq(u.col('order_id')),
  select: (_o, u) => ({ units: u.col('units').coalesce(0) }),
}).aggregate(t => ({ average_units: t.col('units').avg() }));

const ranked = source.table('orders')
  .select(t => ({
    customer_id: t.col('customer_id'), order_id: t.col('order_id'), order_date: t.col('order_date'),
  }))
  .withRowNumber('position', {
    partitionBy: ['customer_id'],
    orderBy: [
      { column: 'order_date', direction: 'desc', nulls: 'last' },
      { column: 'order_id', direction: 'desc' },
    ],
  })
  .filter(t => t.col('position').lte(3))
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
  const db = connect(backend, execute ? undefined : { duckdbPath: ':memory:' });
  try {
    for (const { name, query } of examples) {
      const plan = decodePlan(encodePlan(query.toSubstrait()));
      const compiled = compilePlan(db, plan, challengeCatalog);
      if (execute) {
        const { rows } = await db.executeQuery(compiled);
        console.log({ backend, name, rowCount: rows.length, preview: rows.slice(0, 2) });
      } else {
        console.log({ backend, name, parameterCount: compiled.parameters.length });
      }
    }
  } finally {
    await db.destroy();
  }
}
