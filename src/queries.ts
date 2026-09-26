import { createSource, count, literal, integer, caseWhen } from './api.js';
import { challengeCatalog } from './challenge.js';
const source = createSource(challengeCatalog);
export const recentOrdersQuery = (n = 5) => source.table('orders')
  .select(t => ({ order_id: t.col('order_id'), order_date: t.col('order_date') }))
  .orderBy({ column: 'order_date', direction: 'desc' }, { column: 'order_id', direction: 'desc' }).limit(n);
export const cityQuery = (city: string) => source.table('customers')
  .filter(t => t.col('city').lower().eq(literal(city).lower())).aggregate(() => ({ customer_count: count() }));
export function averageUnitsQuery() {
  const units = source.table('order_details').groupBy('order_id').aggregate(t => ({ units: t.col('quantity').sum() }));
  return source.table('orders').join(units, { how: 'left',
    on: (o,u) => o.col('order_id').eq(u.col('order_id')),
    select: (_o,u) => ({ units: u.col('units').coalesce(0) }),
  }).aggregate(t => ({ average_units: t.col('units').avg() }));
}
export function shippingQuery() {
  return source.table('employees').join(source.table('orders'), { how: 'left',
    on: (e,o) => e.col('employee_id').eq(o.col('employee_id')),
    select: (e,o) => ({ employee_id: e.col('employee_id'),
      shipped: caseWhen(o.col('order_id').isNotNull().and(o.col('shipped_date').isNotNull()), literal(1), literal(0)),
      unshipped: caseWhen(o.col('order_id').isNotNull().and(o.col('shipped_date').isNull()), literal(1), literal(0)),
    }),
  }).groupBy('employee_id').aggregate(t => ({ shipped: t.col('shipped').sum(), unshipped: t.col('unshipped').sum() }))
    .orderBy({ column: 'employee_id' });
}
function pricedOrders() {
  const totals = source.table('order_details').groupBy('order_id').aggregate(t => ({
    price: t.col('unit_price').mul(t.col('quantity')).mul(integer(1).sub(t.col('discount'))).sum(),
  }));
  return source.table('orders').join(totals, { how: 'left', on: (o,t) => o.col('order_id').eq(t.col('order_id')),
    select: (o,t) => ({ customer_id: o.col('customer_id'), price: t.col('price').coalesce(0), freight: o.col('freight').coalesce(0) }),
  });
}
export function freightQuery() {
  return source.table('customers').join(pricedOrders(), { how: 'left', on: (c,o) => c.col('customer_id').eq(o.col('customer_id')),
    select: (c,o) => ({ customer_id: c.col('customer_id'), freight: o.col('freight'), price: o.col('price') }),
  }).groupBy('customer_id').aggregate(t => ({ freight: t.col('freight').sum(), price: t.col('price').sum() }))
    .select(t => ({ customer_id: t.col('customer_id'), freight_ratio: t.col('freight').div(t.col('price')) }))
    .orderBy({ column: 'customer_id' });
}
export function percentileQuery(fraction = 0.75) {
  return source.table('customers').join(pricedOrders(), { how: 'inner', on: (c,o) => c.col('customer_id').eq(o.col('customer_id')),
    select: (c,o) => ({ country: c.col('country'), price: o.col('price') }),
  }).groupBy('country').aggregate(t => ({ order_price_p75: t.col('price').percentile(fraction) }))
    .orderBy({ column: 'country' });
}
export const queryExamples = [
  { name: 'Most recent orders', query: recentOrdersQuery() },
  { name: 'Customers in London', query: cityQuery('london') },
  { name: 'Customers in Mexico D.F.', query: cityQuery('mexico d.f.') },
  { name: 'Average units per order', query: averageUnitsQuery() },
  { name: 'Employee shipped/unshipped orders', query: shippingQuery() },
  { name: 'Customer freight/order-price ratio', query: freightQuery() },
  { name: '75th percentile of order price by customer country', query: percentileQuery() },
];

/** Challenge extension: deterministic top-N within each customer's orders. */
export function recentOrdersPerCustomer(n = 3) {
  if (!Number.isInteger(n) || n < 0 || n > 2147483647) throw new Error('N must be a nonnegative i32');
  return source.table('orders')
    .select(t => ({ customer_id: t.col('customer_id'), order_id: t.col('order_id'), order_date: t.col('order_date') }))
    .withRowNumber('position', { partitionBy: ['customer_id'], orderBy: [
      { column: 'order_date', direction: 'desc', nulls: 'last' },
      { column: 'order_id', direction: 'desc' },
    ] })
    .filter(t => t.col('position').lte(n))
    .orderBy({ column: 'customer_id' }, { column: 'position' });
}
