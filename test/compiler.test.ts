import { test } from 'node:test';
import assert from 'node:assert/strict';
import { connect } from '../src/backend.js';
import { compilePlan } from '../src/compiler.js';
import { catalog, recentOrders } from '../src/example.js';
import { ref } from '../src/plan.js';

test('both compilers bind pagination and explicitly order nulls', async () => {
  for (const backend of ['postgres', 'mysql'] as const) {
    const db = connect(backend);
    try {
      const query = compilePlan(db, recentOrders(7), catalog);
      assert.deepEqual(query.parameters, [7, 0]);
      assert.match(query.sql, /case when .* is null then 1 else 0 end asc/);
      assert.match(query.sql, backend === 'postgres' ? /limit \$1 offset \$2/ : /limit \? offset \?/);
    } finally { await db.destroy(); }
  }
});
test('reject unsupported fields, relations, schema errors and invalid limits', async () => {
  const db = connect('postgres');
  try {
    const bad = recentOrders();
    bad.relations[0].root.names = ['wrong'];
    assert.throws(() => compilePlan(db, bad, catalog), /width/);
    assert.throws(() => compilePlan(db, { ...recentOrders(), advancedExtensions: {} }, catalog));
    assert.throws(() => compilePlan(db, recentOrders(-1), catalog));
    assert.throws(() => compilePlan(db, recentOrders(), {}), /Unknown table/);
    const plan = recentOrders();
    plan.relations[0].root.input = { project: { input: plan.relations[0].root.input, expressions: [ref(99)] } };
    assert.throws(() => compilePlan(db, plan, catalog), /out of range/);
    assert.throws(() => compilePlan(db, { ...recentOrders(), relations: [{ root: { names: ['x'], input: { filter: {} } } }] }, catalog));
  } finally { await db.destroy(); }
});
test('project appends fields before emit, rather than replacing input', async () => {
  const db = connect('postgres');
  try {
    const plan = recentOrders();
    const original = plan.relations[0].root.input;
    plan.relations[0].root = { names: ['date', 'id'], input: { project: {
      input: original, expressions: [ref(0)], common: { emit: { outputMapping: [1, 2] } },
    } } };
    const query = compilePlan(db, plan, catalog);
    assert.match(query.sql, /select "orders"\."order_date" as "date", "orders"\."order_id" as "id"/);
  } finally { await db.destroy(); }
});

test('reject unsafe limits, schema mismatch, reordered fetch and cyclic input', async () => {
  const db = connect('postgres');
  try {
    assert.throws(() => compilePlan(db, recentOrders(Number.MAX_SAFE_INTEGER + 1), catalog));
    assert.throws(() => compilePlan(db, recentOrders(), { orders: [{ name: 'other', type: 'i32', nullable: false }] }), /schema/);
    const plan = recentOrders();
    plan.relations[0].root.input = { sort: { input: plan.relations[0].root.input, sorts: [{ expr: ref(0), direction: 'SORT_DIRECTION_ASC_NULLS_FIRST' }] } };
    assert.throws(() => compilePlan(db, plan, catalog), /sort before fetch/);
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    assert.throws(() => compilePlan(db, cyclic, catalog), /depth limit/);
  } finally { await db.destroy(); }
});
