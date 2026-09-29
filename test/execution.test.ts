import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CompiledQuery, type Kysely, type DatabaseConnection } from 'kysely';
import { executeControlled, ExecutionError } from '../src/execution.js';
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (error: unknown) => void; const promise = new Promise<T>((a,b) => { resolve=a; reject=b; }); return {promise,resolve,reject}; }
const query = CompiledQuery.raw('select 1');
function fake(connection: Partial<DatabaseConnection>, released: () => void = () => {}) {
  return { getExecutor: () => ({ provideConnection: async (consumer: (c: Partial<DatabaseConnection>) => Promise<unknown>) => { try { return await consumer(connection); } finally { released(); } } }) } as unknown as Kysely<any>;
}
const code = (expected: string) => (error: unknown) => error instanceof ExecutionError && error.code === expected;

test('pre-abort and invalid budgets never acquire; secret abort reason is not serialized', async () => {
  let calls=0;
  const db = { getExecutor() { calls++; throw new Error('unexpected'); } } as unknown as Kysely<any>;
  const controller=new AbortController(); controller.abort('secret-token');
  await assert.rejects(executeControlled(db,'postgres',query,{signal:controller.signal}), e => code('QUERY_CANCELLED')(e) && !JSON.stringify(e).includes('secret-token'));
  for (const timeoutMs of [0,-1,NaN,Infinity,0.5,2147483648]) await assert.rejects(executeControlled(db,'postgres',query,{timeoutMs}),RangeError);
  assert.equal(calls,0);
});
test('connection stays held until cancellation AND query settle; late abort is inert', async () => {
  const running=deferred<any>(), stopping=deferred<void>(), started=deferred<void>();
  let released=false, cancelCalls=0;
  const controller=new AbortController();
  const db=fake({executeQuery: async () => {started.resolve(); return running.promise;},cancelQuery: async () => {cancelCalls++; await stopping.promise;}},()=>{released=true;});
  const result=executeControlled(db,'postgres',query,{signal:controller.signal});
  const rejection=assert.rejects(result,code('QUERY_CANCELLED'));
  await started.promise; controller.abort(); running.resolve({rows:[]});
  await new Promise(resolve=>setImmediate(resolve)); assert.equal(released,false);
  stopping.resolve(); await rejection; assert.equal(released,true);
  controller.abort(); assert.equal(cancelCalls,1);
});
test('cancellation failure is explicit and query is still drained before release', async () => {
  const running=deferred<any>(), started=deferred<void>(); let released=false;
  const controller=new AbortController();
  const db=fake({executeQuery: async()=>{started.resolve();return running.promise;},cancelQuery:async()=>{throw new Error('private connection details');}},()=>{released=true;});
  const result=executeControlled(db,'mysql',query,{signal:controller.signal});
  const rejected=assert.rejects(result,e=>code('CANCELLATION_FAILED')(e)&&!JSON.stringify(e).includes('private'));
  await started.promise;controller.abort();await new Promise(resolve=>setImmediate(resolve));assert.equal(released,false);
  running.resolve({rows:[]});await rejected;assert.equal(released,true);
});
test('ordinary errors retain cause without exposing vendor text in serialized error',async()=>{
  const vendor=new Error('password=private');
  await assert.rejects(executeControlled(fake({executeQuery:async()=>{throw vendor;}}),'duckdb',query), e=>code('EXECUTION_FAILED')(e)&&e instanceof Error&&e.cause===vendor&&!JSON.stringify(e).includes('private'));
  const db={getExecutor:()=>({provideConnection:async()=>{throw vendor;}})} as unknown as Kysely<any>;
  await assert.rejects(executeControlled(db,'postgres',query),code('CONNECTION_FAILED'));
});
test('abort while acquiring prevents send after acquisition; timeout only covers running query',async()=>{
  const acquire=deferred<void>();let sent=false,released=false;
  const db={getExecutor:()=>({provideConnection:async(consumer:any)=>{await acquire.promise;try{return await consumer({executeQuery:async()=>{sent=true;return{rows:[]};}});}finally{released=true;}}})}as unknown as Kysely<any>;
  const controller=new AbortController();const result=executeControlled(db,'postgres',query,{signal:controller.signal,timeoutMs:10});
  const rejected=assert.rejects(result,code('QUERY_CANCELLED'));controller.abort();acquire.resolve();await rejected;assert.equal(sent,false);assert.equal(released,true);
});

test('first abort reason wins and successful completion removes the signal listener', async () => {
  const running=deferred<any>(), started=deferred<void>();const controller=new AbortController();let cancellations=0;
  const db=fake({executeQuery:async()=>{started.resolve();return running.promise;},cancelQuery:async()=>{cancellations++;running.reject(new Error('interrupted'));}});
  const result=executeControlled(db,'duckdb',query,{signal:controller.signal,timeoutMs:1000});
  const rejected=assert.rejects(result,code('QUERY_CANCELLED'));await started.promise;controller.abort();await rejected;assert.equal(cancellations,1);
  let calls=0;const success=new AbortController();
  await executeControlled(fake({executeQuery:async()=>({rows:[]}),cancelQuery:async()=>{calls++;}}),'duckdb',query,{signal:success.signal});success.abort();assert.equal(calls,0);
});
