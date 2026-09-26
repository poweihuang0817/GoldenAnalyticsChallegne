import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSource, integer, literal } from '../src/api.js';
import { challengeCatalog } from '../src/challenge.js';
import { recentOrdersPerCustomer } from '../src/queries.js';
import { connect } from '../src/backend.js';
import { compilePlan } from '../src/compiler.js';
import { encodePlan, decodePlan, type Rel } from '../src/plan.js';

const source = createSource(challengeCatalog);
const ranked = () => source.table('orders').withRowNumber('position', {
  partitionBy: ['customer_id'], orderBy: [{ column: 'order_date', direction: 'desc' }, { column: 'order_id', direction: 'desc' }],
});
test('row_number is a standard window relation with appended required i64 output', () => {
  const plan = ranked().toSubstrait();
  assert.ok('window' in plan.relations[0].root.input);
  assert.equal(plan.relations[0].root.names.at(-1), 'position');
  assert.deepEqual(decodePlan(encodePlan(plan)), plan);
  ranked().select(t => {
    assert.equal(t.col('position').kind, 'i64');
    assert.equal(t.col('position').nullable, false);
    assert.equal(t.col('position').lte(3).nullable, false);
    return { position: t.col('position') };
  });
});
test('window API rejects invalid names, partitions, sorting and top-N arguments', () => {
  const orders = source.table('orders'), sort = [{ column: 'order_id' }];
  assert.throws(() => orders.withRowNumber('order_id', { partitionBy: [], orderBy: sort }), /unique/);
  assert.throws(() => orders.withRowNumber('', { partitionBy: [], orderBy: sort }), /nonempty/);
  assert.throws(() => orders.withRowNumber('n', { partitionBy: ['missing'], orderBy: sort }), /Unknown column/);
  assert.throws(() => orders.withRowNumber('n', { partitionBy: ['customer_id','customer_id'], orderBy: sort }), /Duplicate/);
  assert.throws(() => orders.withRowNumber('n', { partitionBy: [], orderBy: [] }), /sort/);
  assert.throws(() => orders.withRowNumber('n', { partitionBy: [], orderBy: [{ column: 'missing' }] }), /Unknown column/);
  for (const n of [-1, 0.5, NaN, Infinity, 2147483648]) assert.throws(() => recentOrdersPerCustomer(n), /nonnegative i32/);
  assert.throws(() => literal('x').lte(literal('y') as never), /Numeric/);
  assert.throws(() => integer(1).lte(literal(1)), /matching/);
});
test('both dialects lower ranking in a subquery before filtering and reject unsupported windows', async () => {
  for (const backend of ['postgres', 'mysql'] as const) {
    const db = connect(backend);
    try {
      const query = compilePlan(db, recentOrdersPerCustomer(3).toSubstrait(), challengeCatalog);
      assert.match(query.sql, /row_number\(\) over \(partition by/);
      assert.match(query.sql, /case when/);
      assert.match(query.sql, /from \(select/);
      assert.ok(query.parameters.includes(3));
      const plan = ranked().toSubstrait();
      const rel = plan.relations[0].root.input;
      if (!('window' in rel)) throw new Error('window fixture');
      const edits = [
        (w: any) => { w.windowFunctions[0].functionReference = 1; },
        (w: any) => { w.windowFunctions[0].arguments = [{ value: { literal: { i32: 1 } } }]; },
        (w: any) => { w.windowFunctions[0].outputType = { i32: { nullability: 'NULLABILITY_REQUIRED' } }; },
        (w: any) => { w.windowFunctions[0].lowerBound = { currentRow: {} }; },
        (w: any) => { w.windowFunctions[0].invocation = 'AGGREGATION_INVOCATION_DISTINCT'; },
        (w: any) => { w.windowFunctions.push(w.windowFunctions[0]); },
        (w: any) => { w.sorts = []; },
        (w: any) => { w.partitionExpressions[0].selection.directReference.structField.field = 999; },
      ];
      for (const edit of edits) {
        const invalid = structuredClone(plan);
        edit((invalid.relations[0].root.input as Extract<Rel, { window: unknown }>).window);
        assert.throws(() => compilePlan(db, invalid, challengeCatalog));
      }
    } finally { await db.destroy(); }
  }
});
