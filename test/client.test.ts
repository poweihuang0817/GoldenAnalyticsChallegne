import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from '../src/client.js';
import { createSource, count, type Expr } from '../src/api.js';
import type { Catalog } from '../src/compiler.js';
import { challengeCatalog } from '../src/challenge.js';
import { cityQuery } from '../src/queries.js';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sql } from 'kysely';
import { connect } from '../src/backend.js';

for (const backend of ['postgres', 'mysql', 'duckdb'] as const) {
  test(`${backend}: preview binds values, snapshots catalog, and validates without database access`, async () => {
    const catalog: Catalog = structuredClone(challengeCatalog);
    const client = createClient(backend, catalog, { duckdbPath: ':memory:' });
    try {
      delete catalog.customers;
      const input = "London' OR 1=1 --";
      const preview = await client.compile(cityQuery(input));
      assert.ok(!preview.sql.includes(input));
      assert.ok(preview.parameters.includes(input));
      assert.match(preview.sql, backend === 'mysql' ? /\?/ : /\$1/);
      const bad = createSource({ missing: challengeCatalog.customers }).table('missing');
      await assert.rejects(client.compile(bad), /table/i);
      await assert.rejects(client.execute(bad), /table/i);
    } finally { await client.destroy(); }
    await assert.rejects(client.compile(cityQuery('London')), /closed/);
    await assert.rejects(client.execute(cityQuery('London')), /closed/);
  });
}

test('predicate helpers run at construction and are not rerun by compile or execute', async () => {
  let calls = 0;
  const source = createSource({ missing: challengeCatalog.customers });
  const matches = (column: Expr<'string', boolean>, city: string) => {
    calls++;
    return column.eq(city);
  };
  const missing = source.table('missing');
  const query = missing.filter(matches(missing.columns.city, 'London')).aggregate({ n: count() });
  assert.equal(calls, 1);
  const client = createClient('duckdb', { missing: challengeCatalog.customers }, { duckdbPath: ':memory:' });
  try {
    await client.compile(query); // No physical table exists; compilation still succeeds.
    assert.equal(calls, 1);
    await assert.rejects(client.execute(query), (error: unknown) => error instanceof Error && 'code' in error && error.code === 'EXECUTION_FAILED' && error.cause instanceof Error && /missing/i.test(error.cause.message)); // Actual database execution fails.
    assert.equal(calls, 1);
  } finally { await client.destroy(); }
});

test('execute returns real DuckDB results and preview mutation cannot change execution', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'golden-client-'));
  const options = { duckdbPath: join(directory, 'fixture.duckdb') };
  const setup = connect('duckdb', options);
  try {
    try {
      await sql`create table customers(customer_id varchar, city varchar, country varchar)`.execute(setup);
      await sql`insert into customers values ('a','London','UK'),('b','LONDON','UK'),('c','Paris','France')`.execute(setup);
    } finally { await setup.destroy(); }
    const client = createClient('duckdb', challengeCatalog, options);
    try {
      const query = cityQuery('London');
      const preview = await client.compile(query);
      (preview.parameters as unknown[]).fill('Paris');
      assert.deepEqual(await client.execute(query), { rows: [{ customer_count: '2' }] });
      assert.deepEqual(await client.execute(cityQuery("' OR 1=1 --")), { rows: [{ customer_count: '0' }] });
    } finally { await client.destroy(); }
  } finally { await rm(directory, { recursive: true }); }
});

test('destroy rejects in-flight compilation, is idempotent, and prevents execution', async () => {
  const client = createClient('duckdb', challengeCatalog, { duckdbPath: ':memory:' });
  const compiling = assert.rejects(client.compile(cityQuery('London')), /closed/);
  const executing = assert.rejects(client.execute(cityQuery('London')), /closed/);
  const closing = client.destroy();
  assert.equal(client.destroy(), closing);
  await Promise.all([compiling, executing, closing]);
});

test('abort during compilation prevents database execution after the worker responds', async () => {
  const client = createClient('duckdb', challengeCatalog, { duckdbPath: ':memory:' });
  const controller = new AbortController();
  try {
    const result = client.execute(cityQuery('London'), { signal: controller.signal });
    controller.abort();
    await assert.rejects(result, (error: any) => error.code === 'QUERY_CANCELLED');
    assert.ok((await client.compile(cityQuery('London'))).sql);
  } finally { await client.destroy(); }
});
