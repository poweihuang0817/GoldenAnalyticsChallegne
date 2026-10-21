import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { request as httpRequest } from 'node:http';
import { createDemoServer, executeExample } from '../src/playground/server.js';

test('playground exposes value-free lowering decisions with SQL preview', async () => {
  const preview = await executeExample({ query: 'city', backend: 'duckdb', action: 'compile' }, { duckdbPath: ':memory:' });
  assert.ok(preview.loweringTrace.some(e => e.operation === 'aggregate' && e.decision === 'merged'));
  assert.ok(!JSON.stringify(preview.loweringTrace).includes('london'));
});

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
    assert.deepEqual(examples.map(e => e.id), ['recent','city','city-mexico','units','shipping','freight','percentile','window']);
    assert.match(examples.find(e => e.id === 'city').code, /export function cityQuery/);
    assert.match(examples.find(e => e.id === 'city-mexico').code, /cityQuery\('mexico d.f.'\)/);
    for (const id of ['freight','percentile']) assert.match(examples.find(e => e.id === id).code, /function pricedOrders/);
    assert.match(examples.find(e => e.id === 'window').code, /withRowNumber/);
    for (const example of examples) assert.equal((await post({ ...valid, query: example.id })).status, 200);
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
    assert.equal(calls, 8);
    assert.equal((await post(valid)).status, 200); assert.equal(calls, 9);
    assert.equal((await post({ ...valid, backend: 'duckdb' })).status, 200);
    assert.equal(calls, 10);
    assert.equal((await post({ ...valid, backend: 'bigquery' })).status, 200);
    assert.equal(calls, 11);
    const html = await home.text();
    assert.match(html, /value="bigquery"/);
    assert.match(html, /One API\. Four databases\./);
    assert.match(html, /data-page="architecture" aria-pressed="true"/);
    assert.ok(html.indexOf('data-page="architecture"') < html.indexOf('data-page="driver"'));
    assert.ok(html.indexOf('data-page="driver"') < html.indexOf('data-page="api"'));
    assert.match(html, /<section id="driver-page" hidden>/);
    assert.match(html, /<section id="architecture-page" aria-labelledby/);
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

test('BigQuery UI errors give setup guidance without exposing credentials', async () => {
  const server = createDemoServer(async () => { throw new Error('refresh_token=secret path=C:/private/adc.json'); });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('address');
  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/query`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: 'city', backend: 'bigquery', action: 'run' }) });
    assert.equal(response.status, 500);
    const body = await response.text();
    assert.match(body, /BIGQUERY_PROJECT_ID/);
    assert.match(body, /application-default login/);
    assert.doesNotMatch(body, /secret|refresh_token|private|adc.json/);
  } finally { server.close(); server.closeAllConnections(); await once(server, 'close'); }
});

test('BigQuery browser behavior labels positional bindings and explains cloud execution', async () => {
  const { readFileSync } = await import('node:fs');
  const { runInNewContext } = await import('node:vm');
  const elements = new Map<string, any>();
  const element = (id: string) => {
    if (!elements.has(id)) elements.set(id, { value: '', textContent: '', disabled: false, selectedOptions: [{ textContent: 'BigQuery' }],
      replaceChildren() {}, append() {} });
    return elements.get(id);
  };
  element('backend').value = 'bigquery'; element('example').value = 'city';
  const requests: any[] = [];
  runInNewContext(readFileSync(new URL('../src/playground/app.js', import.meta.url), 'utf8'), {
    document: { getElementById: element, querySelectorAll: () => [], createElement: () => ({ textContent: '', value: '' }) },
    fetch: async (url: string, options?: { body: string }) => {
      if (url === '/examples') return { ok: true, json: async () => [{ id: 'city', code: 'cityQuery()', title: 'City', description: '' }, { id: 'units', code: 'averageUnitsQuery()' }] };
      requests.push(JSON.parse(options!.body));
      return { ok: true, json: async () => ({ sql: 'select ?', sqlPreview: { text: 'select ?', formatted: true },
        parameters: ['london'], parameterCount: 1, loweringTrace: [], planOutline: 'Read', plan: {}, elapsedMs: 1 }) };
    },
  });
  await new Promise(resolve => setImmediate(resolve));
  assert.match(element('backend-note').textContent, /1 GiB per query/);
  await element('compile').onclick();
  assert.deepEqual(requests, [{ query: 'city', backend: 'bigquery', action: 'compile' }]);
  assert.equal(element('bound-parameters').textContent, '? (parameter 1) = "london"');
  assert.match(element('status').textContent, /No query executed/);
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
      const result = await response.json() as { rows?: unknown[]; rowCount?: number; sql: string; parameterCount: number; parameters: unknown[] };
      assert.match(result.sql, /count\(\*\)/); assert.equal(result.parameterCount, 1); assert.deepEqual(result.parameters, ['london']);
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

import {sqlPreview, planOutline} from '../src/playground/preview.js';
import {cityQuery, averageUnitsQuery} from '../src/queries.js';

test('SQL preview preserves quoted content/placeholders and falls back on unsupported syntax',()=>{
  for (const backend of ['postgres','mysql','duckdb'] as const) {
    const parameter=backend==='postgres'?'$1':'?';
    const input=`select 'from  x' as label from customers where city = ${parameter}`;
    const preview=sqlPreview(input,backend);
    assert.equal(preview.formatted,true);
    assert.match(preview.text,/\n/);
    assert.ok(preview.text.includes("'from  x'"));
    assert.ok(preview.text.includes(parameter));
  }
  const invalid="select 'unterminated";
  assert.deepEqual(sqlPreview(invalid,'postgres'),{text:invalid,formatted:false});
});

test('plan outline uses actual operators, function anchors and both join inputs without mutating plan',()=>{
  const plan=cityQuery('london').toSubstrait(), original=JSON.stringify(plan);
  const outline=planOutline(plan);
  assert.match(outline,/Output: customer_count\n  Aggregate: count/);
  assert.match(outline,/Filter: equal\(lower\(field#1\)/);
  assert.match(outline,/Read customers \(0: customer_id, 1: city/);
  assert.equal(JSON.stringify(plan),original);
  const nested=planOutline(averageUnitsQuery().toSubstrait());
  assert.match(nested,/Join/);assert.match(nested,/left: Read orders/);assert.match(nested,/right: Aggregate: sum/);
  assert.match(planOutline({relations:[{rel:{unknown:{}}}]}),/unrecognized relation/);
});

test('all fixed walkthrough queries have formatted previews on each backend',async()=>{
  for(const backend of ['postgres','mysql','duckdb','bigquery'] as const)for(const query of ['recent','city','city-mexico','units','shipping','freight','percentile','window']) {
    const preview=await executeExample({backend,query,action:'compile'},{duckdbPath:':memory:'});
    assert.equal(preview.sqlPreview.formatted,true,`${backend}/${query}`);
    assert.match(preview.sqlPreview.text,/\n/);
    assert.match(preview.planOutline,/Output:/);
    if (query === 'city') assert.ok(!preview.sql.includes('\n')); // Some compiler templates (DuckDB freight) already contain newlines.
    assert.equal(preview.rows,undefined);
  }
});

test('fixed demo returns ordered bindings separately from SQL on every backend', async () => {
  for (const backend of ['postgres', 'mysql', 'duckdb', 'bigquery'] as const) {
    const result = await executeExample({ query: 'city', backend, action: 'compile' }, { duckdbPath: ':memory:' });
    assert.deepEqual(result.parameters, ['london']);
    assert.equal(result.parameterCount, 1);
    assert.ok(!result.sql.includes('london'));
    assert.ok(!JSON.stringify(result.loweringTrace).includes('london'));
    assert.ok(result.sql.includes(['mysql', 'bigquery'].includes(backend) ? '?' : '$1'));
  }
});

test('design topic navigation is isolated from primary navigation and starts with catalog', async () => {
  const { readFileSync } = await import('node:fs');
  const { runInNewContext } = await import('node:vm');
  const html = readFileSync(new URL('../src/playground/index.html', import.meta.url), 'utf8');
  const script = readFileSync(new URL('../src/playground/app.js', import.meta.url), 'utf8');
  const topics = [...html.matchAll(/data-design="([^"]+)"/g)].map(m => m[1]);
  assert.deepEqual(topics, ['catalog','usage','types','projection','composition','execution','layers','precision','semantics']);
  const elements = new Map<string, any>();
  for (const match of html.matchAll(/<[^>]+\bid="([^"]+)"[^>]*>/g)) {
    assert.ok(!elements.has(match[1]), `duplicate id ${match[1]}`);
    elements.set(match[1], { hidden: /\bhidden\b/.test(match[0]), textContent: '', value: '', disabled: false });
  }
  const buttons = (key: string, names: string[]) => names.map(name => ({ dataset: { [key]: name }, pressed: '', onclick: undefined as any,
    setAttribute(attribute: string, value: string) { if (attribute === 'aria-pressed') this.pressed = value; } }));
  const design = buttons('design', topics), pages = buttons('page', ['architecture','driver','api']);
  runInNewContext(script, { document: {
    getElementById: (id: string) => { assert.ok(elements.has(id), id); return elements.get(id); },
    querySelectorAll: (selector: string) => selector === '[data-design]' ? design : pages,
  }, fetch: () => new Promise(() => {}) });
  assert.equal(elements.get('design-catalog').hidden, false);
  for (const button of design) {
    button.onclick();
    for (const other of design) {
      assert.equal(elements.get(`design-${other.dataset.design}`).hidden, other !== button);
      assert.equal(other.pressed, String(other === button));
    }
    assert.equal(elements.get('architecture-page').hidden, false);
    assert.equal(elements.get('driver-page').hidden, true);
  }
  pages[2].onclick();
  assert.equal(elements.get('api-page').hidden, false);
  assert.equal(elements.get('architecture-page').hidden, true);
  assert.equal(elements.get('design-semantics').hidden, false);
});

test('displayed API constraints match the actual public signatures', async () => {
  const { readFileSync } = await import('node:fs');
  const html = readFileSync(new URL('../src/playground/index.html', import.meta.url), 'utf8');
  const api = readFileSync(new URL('../src/api.ts', import.meta.url), 'utf8');
  for (const id of ['lower-constraint','select-constraint']) {
    const encoded = html.match(new RegExp(`<pre id="${id}">([^]*?)</pre>`))![1];
    const signature = encoded.replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&amp;', '&');
    assert.ok(api.includes(signature), `Update displayed ${id} when its API signature changes`);
  }
});
