import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createDemoServer } from '../src/playground/server.js';
import { coverage, forecast, salesStages, MAX_DAYS } from '../src/forecast-demo.js';
import { validateExploreRequest } from '../src/playground/explore-query.js';

test('filter stages preserve earlier relations and add one filter at a time', () => {
  const { all, uk, london } = salesStages();
  const a = JSON.stringify(all.toSubstrait()), u = JSON.stringify(uk.toSubstrait()), l = JSON.stringify(london.toSubstrait());
  assert.equal((a.match(/"filter":/g) ?? []).length, 0);
  assert.equal((u.match(/"filter":/g) ?? []).length, 1);
  assert.equal((l.match(/"filter":/g) ?? []).length, 2);
  assert.doesNotMatch(a, /"UK"|"London"/); assert.match(l, /"UK"/); assert.match(l, /"London"/);
  assert.equal(JSON.stringify(all.toSubstrait()), a);
});

test('forecast uses shared interior months, exact decimals and only past data in backtests', () => {
  const all = ['01','02','03','04','05','06'].map((m, i) => ({ day: `1997-${m}-15`, sales: `${(i + 1) * 100}.00` }));
  const range = coverage(all)!;
  const result = forecast(all, range);
  assert.deepEqual(result.history.map(r => r.month), ['1997-02','1997-03','1997-04','1997-05']);
  assert.deepEqual(result.predictions, ['06','07','08'].map(m => ({ month: `1997-${m}`, sales: '400.00' })));
  assert.deepEqual(result.backtest, { periods: 1, mae: '200.00' }); // May 500 vs average Feb-Apr 300.
  const sparse = forecast([all[1], all[4]], range);
  assert.deepEqual(sparse.history.map(r => r.sales), ['200.00','0.00','0.00','500.00']);
  assert.equal(sparse.predictions[0].sales, '166.67');
  const changedFuture = forecast(all.map(r => r.day.includes('-05-') ? { ...r, sales: '900.00' } : r), range);
  assert.equal(changedFuture.backtest?.mae, '600.00'); // Prior training stays 300, not contaminated by 900.
});

test('forecast rejects unsafe representations and bounds, and handles missing/short history', () => {
  assert.equal(coverage([]), undefined); assert.deepEqual(forecast([], undefined).predictions, []);
  assert.deepEqual(forecast([], { start: 24000, end: 24004 }).predictions, []);
  const rows = ['01','02','03'].map(m => ({ day: `2000-${m}-01`, sales: '0.0050000000' }));
  const range = { start: 24000, end: 24002 };
  assert.equal(forecast(rows, range).predictions[0].sales, '0.01');
  assert.equal(forecast(rows.map((r, i) => ({ ...r, sales: i === 0 ? '0.0049999999' : '0.005' })), range).predictions[0].sales, '0.00', 'round the exact mean once, not through scale-10 first');
  assert.equal(forecast(rows.map(r => ({ ...r, sales: '-0.005' })), range).predictions[0].sales, '-0.01');
  assert.equal(forecast(rows.map(r => ({ ...r, sales: '9007199254740993.01' })), range).predictions[0].sales, '9007199254740993.01');
  assert.equal(coverage([{ day: new Date('2000-01-15T00:00:00Z'), sales: '0' }])?.start, 24001);
  for (const sales of [0.1, null, '1e5', '1.12345678901']) assert.throws(() => forecast([{ day: '2000-01-01', sales }], range));
  assert.throws(() => coverage([{ day: '2000-02-31', sales: '1' }]));
  assert.throws(() => forecast(Array(MAX_DAYS + 1).fill(rows[0]), range), /limit/);
  assert.throws(() => coverage(Array(MAX_DAYS + 1).fill(rows[0])), /limit/);
});

test('demo governance rejects arbitrary SQL before executor and enforces origin and concurrency', async () => {
  const valid = { stage: 'all', backend: 'duckdb', action: 'run' } as const;
  for (const v of [null, [], {}, { ...valid, stage: 'admin' }, { ...valid, sql: 'select 1' }, { ...valid, backend: 'unknown' }]) assert.throws(() => validateExploreRequest(v));
  assert.deepEqual(validateExploreRequest({ ...valid, backend: 'bigquery' }), { ...valid, backend: 'bigquery' });
  let calls = 0, release!: () => void;
  const server = createDemoServer(undefined, async () => { calls++; await new Promise<void>(r => release = r); return { ok: true }; });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('No address');
  const url = `http://127.0.0.1:${address.port}`;
  const post = (value: unknown, headers = {}) => fetch(`${url}/explore/query`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(value) });
  try {
    assert.equal((await post({ ...valid, sql: 'select 1' })).status, 400); assert.equal(calls, 0);
    assert.equal((await post(valid, { Origin: 'https://evil.example' })).status, 403);
    assert.equal((await post({ ...valid, stage: 'x'.repeat(1100) })).status, 400);
    const pending = post(valid);
    while (!release) await new Promise(r => setTimeout(r, 5));
    assert.equal((await post(valid)).status, 429);
    assert.equal((await fetch(`${url}/query`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query: 'city', backend: 'duckdb', action: 'run' }) })).status, 429, 'one shared execution slot across driver and lab');
    release(); assert.equal((await pending).status, 200);
    for (const path of ['/', '/explore.js', '/explore.css', '/p75-evidence.json']) assert.equal((await fetch(url + path)).status, 200);
    const html = await (await fetch(url)).text();
    for (const id of ['backend', 'explore-backend']) {
      const options = html.match(new RegExp(`<select id="${id}">([\\s\\S]*?)</select>`))?.[1] ?? '';
      assert.match(options, /value="bigquery"/);
    }
    assert.doesNotMatch(html, /data-explore-page="(?:governance|refinement)"/);
    assert.match(html, /<title>Golden Interview<\/title>/);
    assert.match(html, /data-page="explore"/);
    assert.doesNotMatch(html, /Readable plan for the selected sales query/);
    const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]);
    assert.equal(new Set(ids).size, ids.length);
    for (const page of ['query','forecast','precision','flow']) {
      assert.equal((html.match(new RegExp(`data-explore-page="${page}"`, 'g')) ?? []).length, 1);
      assert.equal((html.match(new RegExp(`id="explore-${page}-page"`, 'g')) ?? []).length, 1);
    }
    const evidence = await (await fetch(url + '/p75-evidence.json')).json() as { rows: { country: string; float_display: string; decimal_display: string }[]; query: string };
    assert.match(evidence.query, /numeric '0.75'/);
    assert.deepEqual(evidence.rows.find(r => r.country === 'USA') && [evidence.rows.find(r => r.country === 'USA')!.float_display, evidence.rows.find(r => r.country === 'USA')!.decimal_display], ['2477.57','2477.58']);
  } finally { release?.(); server.close(); server.closeAllConnections(); await once(server, 'close'); }
});
