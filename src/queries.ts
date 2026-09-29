import { createSource, count, literal, integer, caseWhen } from './api.js';
import { challengeCatalog } from './challenge.js';
const source = createSource(challengeCatalog);
export function recentOrdersQuery(n = 5) {
  const orders = source.table('orders');
  return orders.select({ order_id: orders.columns.order_id, order_date: orders.columns.order_date })
    .orderBy({ column: 'order_date', direction: 'desc' }, { column: 'order_id', direction: 'desc' }).limit(n);
}
export function cityQuery(city: string) {
  const customers = source.table('customers');
  return customers.filter(customers.columns.city.lower().eq(literal(city).lower()))
    .aggregate({ customer_count: count() });
}
export function averageUnitsQuery() {
  const details = source.table('order_details');
  const units = details.groupBy('order_id').aggregate({ units: details.columns.quantity.sum() });
  const join = source.table('orders').join(units, { how: 'left' });
  const matched = join.on(join.left.order_id.eq(join.right.order_id));
  const perOrder = matched.select({ units: matched.right.units.coalesce(0) });
  return perOrder.aggregate({ average_units: perOrder.columns.units.avg() });
}
export function shippingQuery() {
  const join = source.table('employees').join(source.table('orders'), { how: 'left' });
  const matched = join.on(join.left.employee_id.eq(join.right.employee_id));
  const orders = matched.right;
  const status = matched.select({ employee_id: matched.left.employee_id,
    shipped: caseWhen(orders.order_id.isNotNull().and(orders.shipped_date.isNotNull()), literal(1), literal(0)),
    unshipped: caseWhen(orders.order_id.isNotNull().and(orders.shipped_date.isNull()), literal(1), literal(0)),
  });
  return status.groupBy('employee_id').aggregate({ shipped: status.columns.shipped.sum(), unshipped: status.columns.unshipped.sum() })
    .orderBy({ column: 'employee_id' });
}
function pricedOrders() {
  const details = source.table('order_details');
  const d = details.columns;
  const totals = details.groupBy('order_id').aggregate({ price: d.unit_price.mul(d.quantity).mul(integer(1).sub(d.discount)).sum() });
  const join = source.table('orders').join(totals, { how: 'left' });
  const matched = join.on(join.left.order_id.eq(join.right.order_id));
  return matched.select({ customer_id: matched.left.customer_id, price: matched.right.price.coalesce(0), freight: matched.left.freight.coalesce(0) });
}
export function freightQuery() {
  const join = source.table('customers').join(pricedOrders(), { how: 'left' });
  const matched = join.on(join.left.customer_id.eq(join.right.customer_id));
  const prices = matched.select({ customer_id: matched.left.customer_id, freight: matched.right.freight, price: matched.right.price });
  const totals = prices.groupBy('customer_id').aggregate({ freight: prices.columns.freight.sum(), price: prices.columns.price.sum() });
  return totals.select({ customer_id: totals.columns.customer_id, freight_ratio: totals.columns.freight.div(totals.columns.price) })
    .orderBy({ column: 'customer_id' });
}
export function percentileQuery(fraction = 0.75) {
  const join = source.table('customers').join(pricedOrders(), { how: 'inner' });
  const matched = join.on(join.left.customer_id.eq(join.right.customer_id));
  const prices = matched.select({ country: matched.left.country, price: matched.right.price });
  return prices.groupBy('country').aggregate({ order_price_p75: prices.columns.price.percentile(fraction) })
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
  const orders = source.table('orders');
  const ranked = orders.select({ customer_id: orders.columns.customer_id, order_id: orders.columns.order_id, order_date: orders.columns.order_date })
    .withRowNumber('position', { partitionBy: ['customer_id'], orderBy: [
      { column: 'order_date', direction: 'desc', nulls: 'last' },
      { column: 'order_id', direction: 'desc' },
    ] });
  return ranked.filter(ranked.columns.position.lte(n)).orderBy({ column: 'customer_id' }, { column: 'position' });
}
