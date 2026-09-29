import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSource, count, literal, integer, caseWhen, type Expr } from '../src/api.js';
import { challengeCatalog } from '../src/challenge.js';
import { connect } from '../src/backend.js';
import { compilePlan } from '../src/compiler.js';
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
  const catalog = structuredClone(challengeCatalog), isolated = createSource(catalog);
  catalog.orders = [{ name: 'changed', type: 'bool', nullable: true }];
  assert.equal(isolated.table('orders').toSubstrait().relations[0].root.names[0], 'order_id');
  assert.throws(() => source.table('missing'), /Unknown table/);
  const orders = source.table('orders');
  assert.throws(() => orders.select(t => ({ x: t.col('missing') })), /Unknown column/);
  let captured!: Expr;
  orders.select(t => ({ id: captured = t.col('order_id') }));
  assert.throws(() => orders.limit(1).select(() => ({ id: captured })), /scope/);
  assert.throws(() => orders.filter(t => t.col('order_id')), /bool/);
  assert.throws(() => orders.groupBy('order_id', 'order_id'), /Duplicate/);
  assert.throws(() => orders.aggregate(() => ({})), /measure/);
  assert.throws(() => orders.groupBy('order_id').aggregate(() => ({ order_id: count() })), /unique/);
  for (const value of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) assert.throws(() => orders.limit(value), /Limit/);
  assert.throws(() => orders.join(createSource(challengeCatalog).table('orders'), {
    how: 'inner', on: (l,r) => l.col('order_id').eq(r.col('order_id')), select: l => ({ id: l.col('order_id') }),
  }), /Cross-source/);
});
test('expression typing preserves nullability and rejects unsupported coercions', () => {
  assert.equal(integer(1).mul(integer(2)).kind, 'fp64');
  assert.equal(literal(1).div(0).nullable, true);
  assert.equal(literal('ABC').lower().kind, 'string');
  assert.throws(() => literal('x').sum(), /Numeric/);
  assert.throws(() => literal(1).lower(), /string/);
  assert.throws(() => integer(1).eq(literal(1)), /matching/);
  assert.throws(() => literal(true).and(literal(1)), /bool/);
  assert.throws(() => caseWhen(literal(true), integer(1), literal('x')), /CASE/);
  assert.throws(() => integer(2147483648), /i32/);
  assert.throws(() => literal(Infinity), /Finite/);
  source.table('orders').select(t => {
    assert.equal(t.col('freight').coalesce(0).nullable, false);
    assert.throws(() => t.col('freight').mul(0.5), /i32/);
    assert.throws(() => t.col('freight').mul(literal(0.5)), /mix/);
    assert.throws(() => t.col('freight').percentile(0.12345678901), /10 decimal/);
    return { freight: t.col('freight') };
  });
  for (const p of [-1, 2, NaN]) assert.throws(() => literal(1).percentile(p), /fraction/);
});
test('left join widens right nullability and self-join uses separate occurrences', async () => {
  const employees = source.table('employees');
  const query = employees.join(employees, {
    how: 'left', on: (l,r) => l.col('employee_id').eq(r.col('employee_id')),
    select: (l,r) => {
      assert.equal(l.col('employee_id').nullable, false);
      assert.equal(r.col('employee_id').nullable, true);
      return { left: l.col('employee_id'), right: r.col('employee_id') };
    },
  });
  for (const backend of ['postgres', 'mysql'] as const) {
    const db = connect(backend);
    try { assert.match(compilePlan(db, query.toSubstrait(), challengeCatalog).sql, /left join/); }
    finally { await db.destroy(); }
  }
});
test('both dialects bind literals and preserve nested aggregate boundaries offline', async () => {
  const city = "london' OR 1=1 --";
  const filtered = source.table('customers').filter(t => t.col('city').lower().eq(literal(city).lower())).aggregate(() => ({ n: count() }));
  const nested = source.table('order_details').groupBy('order_id').aggregate(t => ({ units: t.col('quantity').sum() }))
    .aggregate(t => ({ average: t.col('units').avg() }));
  for (const backend of ['postgres', 'mysql'] as const) {
    const db = connect(backend);
    try {
      const compiled = compilePlan(db, filtered.toSubstrait(), challengeCatalog);
      assert.ok(compiled.parameters.includes(city)); assert.ok(!compiled.sql.includes(city));
      const sql = compilePlan(db, nested.toSubstrait(), challengeCatalog).sql;
      assert.match(sql, /avg\(/); assert.match(sql, /sum\(/); assert.match(sql, /from \(select/);
    } finally { await db.destroy(); }
  }
});

test('join predicate columns cannot escape into output with pre-join nullability', () => {
  const employees = source.table('employees');
  let predicateColumn!: Expr;
  assert.throws(() => employees.join(employees, {
    how: 'left',
    on: (l,r) => { predicateColumn = r.col('employee_id'); return l.col('employee_id').eq(predicateColumn); },
    select: () => ({ employee_id: predicateColumn }),
  }), /scope/);
});

test('function-free API plans currently require scoped compiler dispatch for composition (#7)', async () => {
  const query = source.table('orders').select(t => ({ id: t.col('order_id') }))
    .orderBy({ column: 'id' }).limit(5);
  const plan = query.toSubstrait();
  // Minimal read/project/sort/fetch example: there are no function references.
  assert.ok(!JSON.stringify(plan.relations).includes('functionReference'));
  assert.ok(plan.extensions?.length);
  const { compileAnalytics } = await import('../src/relational.js');
  for (const backend of ['postgres', 'mysql'] as const) {
    const db = connect(backend);
    try {
      const actual = compilePlan(db, plan, challengeCatalog);
      const scoped = compileAnalytics(db, plan, challengeCatalog);
      assert.equal(actual.sql, scoped.sql);
      assert.deepEqual(actual.parameters, scoped.parameters);
      // Removing unused declarations alone would break valid, function-free nested limits.
      const nested = query.limit(2).toSubstrait();
      assert.doesNotThrow(() => compilePlan(db, nested, challengeCatalog));
      delete nested.extensions;
      delete nested.extensionUris;
      assert.throws(() => compilePlan(db, nested, challengeCatalog), /Nested fetch/);
    } finally { await db.destroy(); }
  }
});

test('projection and aggregate outputs replace the available field schema', () => {
  const orders = source.table('orders');
  const projected = orders.select(c => ({ renamed: c.col('order_id') }));
  assert.deepEqual(projected.toSubstrait().relations[0].root.names, ['renamed']);
  assert.throws(() => projected.select(c => ({ old: c.col('order_id') })), /Unknown column/);
  assert.throws(() => projected.groupBy('customer_id'), /Unknown column/);
  const grouped = orders.groupBy('customer_id').aggregate(() => ({ n: count() }));
  assert.deepEqual(grouped.toSubstrait().relations[0].root.names, ['customer_id', 'n']);
  assert.throws(() => grouped.filter(c => c.col('order_id').eq(1)), /Unknown column/);
  assert.throws(() => grouped.orderBy({ column: 'order_id' }), /Unknown column/);
});
