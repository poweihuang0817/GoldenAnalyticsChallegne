import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { request as httpRequest } from 'node:http';
import { createDemoServer, executeExample } from '../src/playground/server.js';

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
    assert.equal((await post({ ...valid, backend: 'duckdb' })).status, 200);
    assert.equal(calls, 2);
    const html = await home.text();
    assert.match(html, /value="duckdb"/); assert.match(html, /id="api-page"/); assert.match(html, /id="architecture-page"/);
    const diagram = await fetch(base + '/architecture.svg');
    assert.equal(diagram.status, 200); assert.equal(diagram.headers.get('content-type'), 'image/svg+xml');
    assert.match(new TextDecoder('utf-8', { fatal: true }).decode(await diagram.arrayBuffer()), /DuckDB/);
    for (const route of ['/', '/app.js', '/style.css']) {
      const asset = await fetch(base + route);
      new TextDecoder('utf-8', { fatal: true }).decode(await asset.arrayBuffer());
    }
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


test('DuckDB walkthrough runs through HTTP and preserves real count results', async () => {
  const { mkdtemp, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { connect } = await import('../src/backend.js');
  const { sql } = await import('kysely');
  const directory = await mkdtemp(join(tmpdir(), 'golden-playground-'));
  const options = { duckdbPath: join(directory, 'fixture.duckdb') };
  const setup = connect('duckdb', options);
  const server = createDemoServer(request => executeExample(request, options));
  try {
    try {
      await sql.raw('create table customers(customer_id varchar, city varchar, country varchar)').execute(setup);
      await sql.raw("insert into customers values ('a','London','UK'),('b','LONDON','UK'),('c','Paris','France')").execute(setup);
    } finally { await setup.destroy(); }
    server.listen(0, '127.0.0.1'); await once(server, 'listening');
    const address = server.address(); if (!address || typeof address === 'string') throw new Error('address');
    for (const action of ['compile', 'run']) {
      const response: Response = await fetch('http://127.0.0.1:' + address.port + '/query', { method: 'POST',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query: 'city', backend: 'duckdb', action }) });
      assert.equal(response.status, 200);
      const result = await response.json() as { rows?: unknown[]; rowCount?: number; sql: string; parameterCount: number };
      assert.match(result.sql, /count/); assert.equal(result.parameterCount, 2);
      if (action === 'run') { assert.deepEqual(result.rows, [{ customer_count: '2' }]); assert.equal(result.rowCount, 1); }
      else assert.equal(result.rows, undefined);
    }
  } finally {
    if (server.listening) { server.close(); server.closeAllConnections(); await once(server, 'close'); }
    await rm(directory, { recursive: true });
  }
});


test('unseeded DuckDB compiles without creating a file and run gives actionable guidance', async () => {
  const { mkdtemp, rm, access } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const directory = await mkdtemp(join(tmpdir(), 'golden-unseeded-'));
  const options = { duckdbPath: join(directory, 'empty.duckdb') };
  const server = createDemoServer(request => executeExample(request, options));
  try {
    server.listen(0, '127.0.0.1'); await once(server, 'listening');
    const address = server.address(); if (!address || typeof address === 'string') throw new Error('address');
    const post = (action: string) => fetch('http://127.0.0.1:' + address.port + '/query', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: 'city', backend: 'duckdb', action }),
    });
    assert.equal((await post('compile')).status, 200);
    await assert.rejects(access(options.duckdbPath));
    const response = await post('run');
    assert.equal(response.status, 500);
    const result = await response.json() as { error: string };
    assert.match(result.error, /npm run seed:duckdb/);
    assert.match(result.error, /DUCKDB_PATH/);
    assert.equal(result.error.includes(directory), false);
  } finally {
    if (server.listening) { server.close(); server.closeAllConnections(); await once(server, 'close'); }
    await rm(directory, { recursive: true });
  }
});
