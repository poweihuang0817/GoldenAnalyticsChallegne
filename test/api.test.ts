import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSource, count, literal, integer, caseWhen, type Expr, eq, and } from '../src/api.js';
import { challengeCatalog } from '../src/challenge.js';
import { connect } from '../src/backend.js';
import { compilePlanSync, type Catalog } from '../src/compiler.js';
import { encodePlan, decodePlan } from '../src/plan.js';
const source = createSource(challengeCatalog);
test('table construction is lazy, branches immutable, exported plans independent', () => {
  const orders = source.table('orders');
  const first = orders.limit(1).toSubstrait(), second = orders.limit(2).toSubstrait();
  assert.ok('read' in orders.toSubstrait().relations[0].root.input);
  assert.equal((first.relations[0].root.input as any).fetch.count, '1');
  assert.equal((second.relations[0].root.input as any).fetch.count, '2');
  first.relations[0].root.names[0] = 'changed';
  assert.equal(orders.toSubstrait().relations[0].root.names[0], 'order_id');
  assert.deepEqual(decodePlan(encodePlan(second)), second);
});
test('catalog snapshot, unknown names, stale scopes and invalid composition', () => {
  const catalog: Catalog = structuredClone(challengeCatalog), isolated = createSource(catalog);
  catalog.orders = [{ name: 'changed', type: 'bool', nullable: true }];
  assert.equal(isolated.table('orders').toSubstrait().relations[0].root.names[0], 'order_id');
  // @ts-expect-error Unknown table names are rejected statically and at runtime.
  assert.throws(() => source.table('missing'), /Unknown table/);
  const orders = source.table('orders');
  // @ts-expect-error Unknown columns are rejected statically and at runtime.
  assert.throws(() => orders.select({ x: orders.col('missing') }), /Unknown column/);
  const captured: Expr = orders.columns.order_id;
  orders.select({ id: captured });
  assert.throws(() => orders.limit(1).select({ id: captured }), /scope/);
  // @ts-expect-error A filter requires a boolean expression.
  assert.throws(() => orders.filter(orders.columns.order_id), /bool/);
  assert.throws(() => orders.groupBy('order_id', 'order_id'), /Duplicate/);
  assert.throws(() => orders.aggregate({}), /measure/);
  // @ts-expect-error A measure cannot shadow a grouping key.
  assert.throws(() => orders.groupBy('order_id').aggregate({ order_id: count() }), /unique/);
  for (const value of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) assert.throws(() => orders.limit(value), /Limit/);
  assert.throws(() => orders.join(createSource(challengeCatalog).table('orders'), {
    how: 'inner',
  }), /Cross-source/);
});
test('expression typing preserves nullability and rejects unsupported coercions', () => {
  assert.equal(integer(1).mul(integer(2)).kind, 'fp64');
  assert.equal(literal(1).div(0).nullable, true);
  assert.equal(literal('ABC').lower().kind, 'string');
  // @ts-expect-error SUM requires numeric input.
  assert.throws(() => literal('x').sum(), /Numeric/);
  // @ts-expect-error Lowercase requires string input.
  assert.throws(() => literal(1).lower(), /string/);
  // @ts-expect-error Equality does not implicitly coerce i32 and fp64.
  assert.throws(() => integer(1).eq(literal(1)), /matching/);
  // @ts-expect-error AND requires boolean input.
  assert.throws(() => literal(true).and(literal(1)), /bool/);
  // @ts-expect-error CASE branches require matching logical kinds.
  assert.throws(() => caseWhen(literal(true), integer(1), literal('x')), /CASE/);
  assert.throws(() => integer(2147483648), /i32/);
  assert.throws(() => literal(Infinity), /Finite/);
  const orders = source.table('orders');
  assert.equal(orders.columns.freight.coalesce(0).nullable, false);
  assert.throws(() => orders.columns.freight.mul(0.5), /i32/);
  // @ts-expect-error Exact decimal arithmetic rejects fp64 expressions.
  assert.throws(() => orders.columns.freight.mul(literal(0.5)), /mix/);
  assert.throws(() => orders.columns.freight.percentile(0.12345678901), /10 decimal/);
  orders.select({ freight: orders.columns.freight });
  for (const p of [-1, 2, NaN]) assert.throws(() => literal(1).percentile(p), /fraction/);
});
test('left join widens right nullability and self-join uses separate occurrences', async () => {
  const employees = source.table('employees');
  const join = employees.join(employees, { how: 'left' });
  const matched = join.on(join.left.employee_id.eq(join.right.employee_id));
  assert.equal(matched.left.employee_id.nullable, false);
  assert.equal(matched.right.employee_id.nullable, true);
  const query = matched.select({ left: matched.left.employee_id, right: matched.right.employee_id });
  for (const backend of ['postgres', 'mysql'] as const) {
    const db = connect(backend);
    try { assert.match(compilePlanSync(db, query.toSubstrait(), challengeCatalog).sql, /left join/); }
    finally { await db.destroy(); }
  }
});
test('both dialects bind literals and preserve nested aggregate boundaries offline', async () => {
  const city = "london' OR 1=1 --";
  const customers = source.table('customers');
  const filtered = customers.filter(customers.columns.city.lower().eq(literal(city).lower())).aggregate({ n: count() });
  const details = source.table('order_details');
  const units = details.groupBy('order_id').aggregate({ units: details.columns.quantity.sum() });
  const nested = units.aggregate({ average: units.columns.units.avg() });
  for (const backend of ['postgres', 'mysql'] as const) {
    const db = connect(backend);
    try {
      const compiled = compilePlanSync(db, filtered.toSubstrait(), challengeCatalog);
      assert.ok(compiled.parameters.includes(city)); assert.ok(!compiled.sql.includes(city));
      const sql = compilePlanSync(db, nested.toSubstrait(), challengeCatalog).sql;
      assert.match(sql, /avg\(/); assert.match(sql, /sum\(/); assert.match(sql, /from \(select/);
    } finally { await db.destroy(); }
  }
});

test('join predicate columns cannot escape into output with pre-join nullability', () => {
  const employees = source.table('employees');
  const join = employees.join(employees, { how: 'left' });
  const predicateColumn = join.right.employee_id;
  const matched = join.on(join.left.employee_id.eq(predicateColumn));
  assert.throws(() => matched.select({ employee_id: predicateColumn }), /scope/);
});

test('function-free API plans currently require scoped compiler dispatch for composition (#7)', async () => {
  const orders = source.table('orders');
  const query = orders.select({ id: orders.columns.order_id })
    .orderBy({ column: 'id' }).limit(5);
  const plan = query.toSubstrait();
  // Minimal read/project/sort/fetch example: there are no function references.
  assert.ok(!JSON.stringify(plan.relations).includes('functionReference'));
  assert.ok(plan.extensions?.length);
  const { compileAnalytics } = await import('../src/relational.js');
  for (const backend of ['postgres', 'mysql'] as const) {
    const db = connect(backend);
    try {
      const actual = compilePlanSync(db, plan, challengeCatalog);
      const scoped = compileAnalytics(db, plan, challengeCatalog);
      assert.equal(actual.sql, scoped.sql);
      assert.deepEqual(actual.parameters, scoped.parameters);
      // Removing unused declarations alone would break valid, function-free nested limits.
      const nested = query.limit(2).toSubstrait();
      assert.doesNotThrow(() => compilePlanSync(db, nested, challengeCatalog));
      delete nested.extensions;
      delete nested.extensionUris;
      assert.throws(() => compilePlanSync(db, nested, challengeCatalog), /Nested fetch/);
    } finally { await db.destroy(); }
  }
});

test('projection and aggregate outputs replace the available field schema', () => {
  const orders = source.table('orders');
  const projected = orders.select({ renamed: orders.columns.order_id });
  assert.deepEqual(projected.toSubstrait().relations[0].root.names, ['renamed']);
  // @ts-expect-error Projection removes the original column name.
  assert.throws(() => projected.select({ old: projected.col('order_id') }), /Unknown column/);
  // @ts-expect-error Projection removes fields that were not selected.
  assert.throws(() => projected.groupBy('customer_id'), /Unknown column/);
  const grouped = orders.groupBy('customer_id').aggregate({ n: count() });
  assert.deepEqual(grouped.toSubstrait().relations[0].root.names, ['customer_id', 'n']);
  // @ts-expect-error Aggregation removes nongrouped input fields.
  assert.throws(() => grouped.filter(grouped.col('order_id').eq(1)), /Unknown column/);
  // @ts-expect-error Aggregation removes nongrouped input fields.
  assert.throws(() => grouped.orderBy({ column: 'order_id' }), /Unknown column/);
});


test('predicate objects compose and old callbacks are rejected', () => {
  const orders = source.table('orders');
  const predicate = and(eq(orders.columns.order_id, 1), orders.columns.shipped_date.isNotNull());
  assert.equal(predicate.kind, 'bool');
  assert.equal(predicate.nullable, false);
  assert.ok('filter' in orders.filter(predicate).toSubstrait().relations[0].root.input);
  // @ts-expect-error legacy callback overload intentionally removed
  assert.throws(() => orders.select(() => ({ id: orders.columns.order_id })), /Callbacks/);
  // @ts-expect-error legacy callback overload intentionally removed
  assert.throws(() => orders.aggregate(() => ({ n: count() })), /Callbacks/);
  // @ts-expect-error legacy callback overload intentionally removed
  assert.throws(() => orders.filter(() => literal(true)), /bool/);
});
