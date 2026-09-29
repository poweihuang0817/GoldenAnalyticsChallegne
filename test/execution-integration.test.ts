import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CompiledQuery } from 'kysely';
import { connect } from '../src/backend.js';
import { executeControlled, ExecutionError } from '../src/execution.js';

for (const backend of ['postgres', 'mysql', 'duckdb'] as const) {
  test(`${backend}: actual execution cancellation, timeout and reusable connection`, { timeout: 30000 }, async () => {
    const db = connect(backend, { duckdbPath: ':memory:' });
    const long = CompiledQuery.raw(backend === 'postgres' ? 'select pg_sleep(5)' : backend === 'mysql' ? 'select sleep(5)' : 'select sum(sin(i)) from range(100000000) t(i)');
    try {
      const pre = new AbortController(); pre.abort();
      await assert.rejects(executeControlled(db, backend, long, { signal: pre.signal }), (e: unknown) => e instanceof ExecutionError && e.code === 'QUERY_CANCELLED');
      for (const mode of ['manual', 'timeout'] as const) {
        const controller = new AbortController();
        const start = performance.now();
        const timer = mode === 'manual' ? setTimeout(() => controller.abort(), 200) : undefined;
        try {
          await assert.rejects(executeControlled(db, backend, long, mode === 'manual' ? { signal: controller.signal } : { timeoutMs: 200 }), (e: unknown) => e instanceof ExecutionError && e.code === (mode === 'manual' ? 'QUERY_CANCELLED' : 'QUERY_TIMEOUT') && (backend !== 'duckdb' || (e.cause instanceof Error && /interrupt/i.test(e.cause.message))));
          // executeControlled only returns after native query and control request settle.
          assert.ok(performance.now() - start < 4000, 'server work must stop before the five-second query finishes');
          assert.deepEqual((await executeControlled(db, backend, CompiledQuery.raw('select 42 as answer'))).rows, [{ answer: backend === 'mysql' ? '42' : 42 }]);
        } finally { clearTimeout(timer); }
      }
      const late = new AbortController();
      await executeControlled(db, backend, CompiledQuery.raw('select 1 as answer'), { signal: late.signal, timeoutMs: 1000 });
      late.abort();
      assert.deepEqual((await executeControlled(db, backend, CompiledQuery.raw('select 42 as answer'))).rows, [{ answer: backend === 'mysql' ? '42' : 42 }]);
    } finally { await db.destroy(); }
  });
}

// Public API end-to-end: the catalog points at our private slow view, never sample data.
import { createClient } from '../src/client.js';
import { createSource } from '../src/api.js';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('public client forwards timeout and preserves native interruption cause', {timeout:30000}, async()=>{
  const directory=await mkdtemp(join(tmpdir(),'golden-execution-'));
  const options={duckdbPath:join(directory,'fixture.duckdb')};
  const setup=connect('duckdb',options);
  try{
    await setup.executeQuery(CompiledQuery.raw('create view slow_query as select sum(sin(i)) as value from range(100000000) t(i)'));
  }finally{await setup.destroy();}
  const catalog={slow_query:[{name:'value',type:'fp64' as const,nullable:true}]};
  const client=createClient('duckdb',catalog,options);
  try{
    await assert.rejects(client.execute(createSource(catalog).table('slow_query'),{timeoutMs:20}),e=> e instanceof ExecutionError && e.code==='QUERY_TIMEOUT' && e.cause instanceof Error && /interrupt/i.test(e.cause.message));
  }finally{await client.destroy();await rm(directory,{recursive:true});}
});
