import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { Worker } from 'node:worker_threads';
import { tmpdir } from 'node:os';
import { CompileService, type CompileRequest } from '../src/compile-service.js';
import { compilePlanSync } from '../src/compiler.js';
import { connect } from '../src/backend.js';
import { createSource } from '../src/api.js';
import { CompileQueryError } from '../src/errors.js';
import { challengeCatalog } from '../src/challenge.js';
import { queryExamples, cityQuery } from '../src/queries.js';

class ControlledWorker extends EventEmitter {
  requests: CompileRequest[] = [];
  terminations = 0;
  postMessage(request: CompileRequest) { this.requests.push(request); }
  async terminate() { this.terminations++; this.emit('exit', 1); return 1; }
}
function fixture() {
  const worker = new ControlledWorker();
  let starts = 0;
  const service = new CompileService('postgres', challengeCatalog, () => { starts++; return worker as unknown as Worker; });
  return { service, worker, starts: () => starts };
}
const plan = () => cityQuery('London').toSubstrait();

test('bounded queue correlates responses and reuses one worker', async () => {
  const { service, worker, starts } = fixture();
  try {
    const jobs = Array.from({ length: 32 }, () => service.compile(plan()));
    await assert.rejects(service.compile(plan()), /queue is full/);
    for (const { id } of [...worker.requests].reverse()) worker.emit('message', { id, preview: { sql: String(id), parameters: [id] } });
    assert.deepEqual((await Promise.all(jobs)).map(x => x.sql), Array.from({ length: 32 }, (_, i) => String(i)));
    const next = service.compile(plan());
    worker.emit('message', { id: 32, preview: { sql: 'next', parameters: [] } });
    assert.equal((await next).sql, 'next');
    assert.equal(starts(), 1);
  } finally { await service.destroy(); }
});

for (const event of ['error', 'exit', 'destroy'] as const) test(`${event} rejects every outstanding job and later calls`, async () => {
  const { service, worker } = fixture();
  const jobs = [service.compile(plan()), service.compile(plan())];
  const failures = jobs.map(job => assert.rejects(job, event === 'destroy' ? /closed/ : /broken|exited/));
  if (event === 'destroy') await service.destroy();
  else worker.emit(event, event === 'error' ? new Error('broken') : 0);
  await Promise.all(failures);
  await assert.rejects(service.compile(plan()));
  await service.destroy(); await service.destroy();
  assert.equal(worker.terminations, 1);
});

test('startup and serialization failures settle without leaking queue slots', async () => {
  const failed = new CompileService('postgres', challengeCatalog, () => { throw new Error('startup'); });
  await assert.rejects(failed.compile(plan()), /startup/);
  await failed.destroy();
  const { service, worker } = fixture();
  worker.postMessage = () => { throw new Error('clone failed'); };
  for (let i = 0; i < 33; i++) await assert.rejects(service.compile(plan()), /clone failed/);
  await service.destroy();
});

for (const backend of ['postgres', 'mysql', 'duckdb'] as const) test(`${backend}: real worker preserves SQL, parameters and compiler errors`, async () => {
  const service = new CompileService(backend, challengeCatalog);
  const db = connect(backend, { duckdbPath: ':memory:' });
  try {
    for (const { query } of queryExamples) {
      const expected = compilePlanSync(db, query.toSubstrait(), challengeCatalog);
      assert.deepEqual(await service.compile(query.toSubstrait()), { sql: expected.sql, parameters: [...expected.parameters] });
    }
    const bad = plan(); bad.relations[0].root.names = [];
    let expected: CompileQueryError;
    try { compilePlanSync(db, bad, challengeCatalog); assert.fail('expected invalid query'); }
    catch (error) { assert.ok(error instanceof CompileQueryError); expected = error; }
    await assert.rejects(service.compile(bad), error => {
      assert.ok(error instanceof CompileQueryError);
      assert.deepEqual([error.name, error.message, error.code, error.stage, error.backend, error.capability],
        [expected.name, expected.message, expected.code, expected.stage, expected.backend, expected.capability]);
      return true;
    });
    if (backend === 'duckdb') {
      const orders = createSource(challengeCatalog).table('orders');
      await assert.rejects(service.compile(orders.aggregate({ average: orders.columns.freight.avg() }).toSubstrait()), (error: unknown) => {
        assert.ok(error instanceof CompileQueryError);
        assert.equal(error.code, 'UNSUPPORTED_CAPABILITY');
        assert.equal(error.capability, 'exactDecimalAverage');
        return true;
      });
    }
    assert.ok((await service.compile(plan())).sql);
  } finally { await service.destroy(); await db.destroy(); }
});

test('real compiler reports a worker thread', async () => {
  const worker = new Worker(new URL('../src/compile-worker.mjs', import.meta.url), {
    workerData: { entry: new URL('../src/compile-worker-run.ts', import.meta.url).href }, env: { TEMP: tmpdir(), TMP: tmpdir() }, execArgv: [],
  });
  try {
    const response = new Promise<any>((resolve, reject) => { worker.once('message', resolve); worker.once('error', reject); });
    worker.postMessage({ id: 7, backend: 'duckdb', catalog: challengeCatalog, plan: plan() });
    const result = await response;
    assert.equal(result.id, 7);
    assert.ok(result.threadId > 0);
    assert.ok(result.preview.sql);
  } finally { await worker.terminate(); }
});
