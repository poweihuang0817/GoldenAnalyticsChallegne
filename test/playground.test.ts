import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { request as httpRequest } from 'node:http';
import { createDemoServer } from '../src/playground/server.js';

test('demo serves actual examples and validates every request before execution', async () => {
  let calls = 0;
  const server = createDemoServer(async input => { calls++; return { selected: input.query }; });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('address');
  const base = `http://127.0.0.1:${address.port}`;
  const valid = { query: 'city', backend: 'postgres', action: 'compile' };
  const post = (value: unknown, headers = {}) => fetch(`${base}/query`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(value) });
  try {
    const home = await fetch(base); assert.equal(home.status, 200); assert.match(home.headers.get('content-security-policy')!, /frame-ancestors 'none'/);
    const examples = await (await fetch(`${base}/examples`)).json() as any[];
    assert.equal(examples.length, 3); assert.match(examples[0].code, /export function cityQuery/); assert.match(examples[2].code, /function pricedOrders/);
    assert.equal((await fetch(`${base}/query`)).status, 405);
    assert.equal((await fetch(`${base}/other`)).status, 404);
    assert.equal((await fetch(`${base}/query`, { method: 'POST', body: '{}' })).status, 415);
    for (const value of [null, [], {}, { ...valid, backend: 'sqlite' }, { ...valid, query: 'delete' }, { ...valid, sql: 'select 1' }, { ...valid, action: 'eval' }, { ...valid, query: 'x'.repeat(1100) }]) assert.equal((await post(value)).status, 400);
    assert.equal((await post(valid, { Origin: 'https://example.com' })).status, 403);
    const wrongHost = await new Promise<number | undefined>((resolve, reject) => {
      const req = httpRequest(base, { headers: { Host: 'example.com' } }, response => { response.resume(); resolve(response.statusCode); });
      req.on('error', reject); req.end();
    });
    assert.equal(wrongHost, 403);
    assert.equal(calls, 0);
    assert.equal((await post(valid)).status, 200); assert.equal(calls, 1);
  } finally { server.close(); server.closeAllConnections(); await once(server, 'close'); }
});
test('demo bounds concurrent execution and hides internal errors', async () => {
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  let started!: () => void; const ready = new Promise<void>(resolve => { started = resolve; });
  const server = createDemoServer(async () => { started(); await pending; throw new Error('password=secret'); });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('address');
  const post = () => fetch(`http://127.0.0.1:${address.port}/query`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query: 'units', backend: 'mysql', action: 'run' }) });
  try {
    const first = post(); await ready; assert.equal((await post()).status, 429); release();
    const result = await first; assert.equal(result.status, 500); assert.doesNotMatch(await result.text(), /password|secret|stack/);
  } finally { release(); server.close(); server.closeAllConnections(); await once(server, 'close'); }
});
