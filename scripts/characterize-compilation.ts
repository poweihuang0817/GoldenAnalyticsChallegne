// Reproducible observations, not a speed benchmark or CI timing assertion.
import assert from 'node:assert/strict';
import { createSource } from '../src/api.js';
import { compilePlan, type Catalog } from '../src/compiler.js';
import { CompileService } from '../src/compile-service.js';
import { connect } from '../src/backend.js';
import { ref, type Rel } from '../src/plan.js';

const catalog = { items: [{ name: 'id', type: 'i32', nullable: false }] } as const satisfies Catalog;
const source = createSource(catalog);
const items = source.table('items');
const join = items.join(items, { how: 'inner' });
const matched = join.on(join.left.id.eq(join.right.id));
const template = matched.select({ left: matched.left.id, right: matched.right.id }).toSubstrait();
const read = items.toSubstrait().relations[0].root.input;
function joinPlan(joins: number) {
  const plan = structuredClone(template);
  const project = plan.relations[0].root.input;
  assert.ok('project' in project && 'join' in project.project.input);
  const prototype = project.project.input.join;
  assert.ok('scalarFunction' in prototype.expression);
  let input: Rel = structuredClone(read);
  for (let i = 1; i <= joins; i++) {
    input = { join: { ...prototype, left: input, right: structuredClone(read), expression: {
      scalarFunction: { ...prototype.expression.scalarFunction, arguments: [{ value: ref(0) }, { value: ref(i) }] },
    } } };
  }
  plan.relations[0].root = { names: Array.from({ length: joins + 1 }, (_, i) => `id_${i}`), input };
  return plan;
}
console.log(JSON.stringify({ node: process.version, platform: process.platform, shape: 'left-deep inner joins, one i32 field per read, all outputs retained', note: 'worker warm roundtrip includes cloning/queue/lowering; no speedup claim' }));
for (const backend of ['postgres', 'mysql', 'duckdb'] as const) {
  const db = connect(backend, { duckdbPath: ':memory:' });
  const service = new CompileService(backend, catalog);
  try {
    const start = performance.now();
    await service.compile(joinPlan(1));
    console.log(JSON.stringify({ backend, workerStartupAndFirstCompileMs: +(performance.now() - start).toFixed(2) }));
    for (const joins of [10, 20, 31]) {
      const plan = joinPlan(joins);
      let start = performance.now();
      const direct = compilePlan(db, plan, catalog);
      const directMs = performance.now() - start;
      start = performance.now();
      const worker = await service.compile(plan);
      const workerRoundtripMs = performance.now() - start;
      assert.deepEqual(worker, { sql: direct.sql, parameters: [...direct.parameters] });
      console.log(JSON.stringify({ backend, joins, directMs: +directMs.toFixed(2), workerRoundtripMs: +workerRoundtripMs.toFixed(2), sqlBytes: Buffer.byteLength(worker.sql), parameters: worker.parameters.length }));
    }
  } finally { await service.destroy(); await db.destroy(); }
}
