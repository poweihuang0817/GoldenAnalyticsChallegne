import { test } from 'node:test';
import assert from 'node:assert/strict';
import { connect } from '../src/backend.js';
import { compilePlan, type Catalog } from '../src/compiler.js';
import { catalog } from '../src/example.js';
import { FUNCTION_URI } from '../src/functions.js';
import { ref, type Rel, type SupportedPlanJson } from '../src/plan.js';

const read = (): Rel => ({ read: {
  namedTable: { names: ['orders'] },
  baseSchema: { names: ['order_id', 'order_date'], struct: {
    nullability: 'NULLABILITY_REQUIRED', types: [
      { i32: { nullability: 'NULLABILITY_REQUIRED' } },
      { date: { nullability: 'NULLABILITY_NULLABLE' } },
    ],
  } },
} });
const plan = (input: Rel, names = ['id', 'date']): SupportedPlanJson => ({
  version: { majorNumber: 0, minorNumber: 63, patchNumber: 0 }, relations: [{ root: { input, names } }],
});
// An unused, supported URI forces the existing analytics dispatch without adding a function.
const analytics = (p: SupportedPlanJson): SupportedPlanJson => ({ ...p,
  extensionUris: [{ extensionUriAnchor: 1, uri: FUNCTION_URI }],
});
const sorted = (input: Rel, direction: 'SORT_DIRECTION_ASC_NULLS_FIRST' | 'SORT_DIRECTION_ASC_NULLS_LAST' |
  'SORT_DIRECTION_DESC_NULLS_FIRST' | 'SORT_DIRECTION_DESC_NULLS_LAST' = 'SORT_DIRECTION_ASC_NULLS_FIRST'): Rel => ({ sort: {
  input, sorts: [{ expr: ref(1), direction }, { expr: ref(0), direction }],
} });

for (const backend of ['postgres', 'mysql'] as const) {
  test(`${backend}: issue 7 records dispatch differences without changing production behavior`, async () => {
    const db = connect(backend);
    try {
      const widened = read();
      if (!('read' in widened)) throw new Error('fixture');
      widened.read.baseSchema.struct.types[0] = { i32: { nullability: 'NULLABILITY_NULLABLE' } };
      assert.throws(() => compilePlan(db, plan(widened), catalog), /schema mismatch/);
      assert.doesNotThrow(() => compilePlan(db, analytics(plan(widened)), catalog));

      const discardSort = plan({ project: { input: sorted(read()), expressions: [ref(0)],
        common: { emit: { outputMapping: [2] } } } }, ['id']);
      assert.doesNotThrow(() => compilePlan(db, discardSort, catalog));
      assert.throws(() => compilePlan(db, analytics(discardSort), catalog), /discard a sort field/);

      const nested = plan({ fetch: { count: '2', input: { fetch: { count: '5', input: sorted(read()) } } } });
      assert.throws(() => compilePlan(db, nested, catalog), /Nested fetch/);
      assert.doesNotThrow(() => compilePlan(db, analytics(nested), catalog));

      for (const badInput of [
        { project: { input: read(), expressions: [ref(99)] } },
        { project: { input: read(), expressions: [ref(0)], common: { emit: { outputMapping: [99] } } } },
      ] satisfies Rel[]) {
        for (const p of [plan(badInput), analytics(plan(badInput))])
          assert.throws(() => compilePlan(db, p, catalog), /out of range/);
      }
      const moneyCatalog: Catalog = { orders: [{ name: 'freight', type: 'decimal', nullable: true }] };
      const money = plan({ read: { namedTable: { names: ['orders'] }, baseSchema: {
        names: ['freight'], struct: { nullability: 'NULLABILITY_REQUIRED', types: [
          { decimal: { nullability: 'NULLABILITY_NULLABLE', precision: 38, scale: 10 } },
        ] },
      } } }, ['freight']);
      assert.doesNotMatch(compilePlan(db, money, moneyCatalog).sql, /decimal\(38, 10\)/);
      assert.match(compilePlan(db, analytics(money), moneyCatalog).sql, /decimal\(38, 10\)/);
    } finally { await db.destroy(); }
  });

  test(`${backend}: both paths agree on deterministic shared read/project/emit/sort/fetch corpus`, {
    skip: process.env.RUN_COMPILER_EQUIVALENCE_DB !== '1',
  }, async () => {
    const db = connect(backend);
    try {
      for (const direction of ['SORT_DIRECTION_ASC_NULLS_FIRST', 'SORT_DIRECTION_ASC_NULLS_LAST',
        'SORT_DIRECTION_DESC_NULLS_FIRST', 'SORT_DIRECTION_DESC_NULLS_LAST'] as const) {
        const emitted = read();
        if (!('read' in emitted)) throw new Error('fixture');
        emitted.read.common = { emit: { outputMapping: [1, 0] } };
        const restored: Rel = { project: { input: emitted, expressions: [ref(1), ref(0)],
          common: { emit: { outputMapping: [2, 3] } } } };
        for (const count of ['0', '1', '7']) for (const offset of ['0', '2']) {
          const p = plan({ fetch: { input: sorted(restored, direction), count, offset } });
          const a = compilePlan(db, p, catalog), b = compilePlan(db, analytics(p), catalog);
          assert.deepEqual(a.parameters, b.parameters);
          assert.deepEqual((await db.executeQuery(a)).rows, (await db.executeQuery(b)).rows);
        }
      }
    } finally { await db.destroy(); }
  });
}
