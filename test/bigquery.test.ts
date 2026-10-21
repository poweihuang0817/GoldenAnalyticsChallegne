import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BigQuery } from '@google-cloud/bigquery';
import { CompiledQuery, sql } from 'kysely';
import { connect } from '../src/backend.js';
import { createClient } from '../src/client.js';
import { createSource } from '../src/api.js';
import { compilePlanSync } from '../src/compiler.js';
import { challengeCatalog } from '../src/challenge.js';
import { queryExamples, recentOrdersPerCustomer, cityQuery } from '../src/queries.js';
import { compilerBackend, capabilitySupport } from '../src/capabilities.js';
import { discoverMetadata } from '../src/metadata.js';
import { executeControlled } from '../src/execution.js';
import { BigQueryConnection, BigQueryDriver, bigQueryParameters, normalizeBigQueryValue, resolveBigQueryOptions, type BigQueryJob, type BigQueryTransport } from '../src/bigquery/driver.js';

const config = resolveBigQueryOptions({ projectId: 'golden-test-project', dataset: 'northwind', location: 'US' }, {});
const examples = [...queryExamples, { name: 'window', query: recentOrdersPerCustomer() }];

test('BigQuery compiles all sample families and window without credentials; worker matches sync', async () => {
  const db = connect('bigquery');
  const client = createClient('bigquery', challengeCatalog);
  try {
    assert.equal(compilerBackend(db), 'bigquery');
    assert.equal(capabilitySupport('bigquery', 'continuousPercentile').kind, 'rewrite');
    for (const { name, query } of examples) {
      const compiled = compilePlanSync(db, query.toSubstrait(), challengeCatalog);
      assert.deepEqual(await client.compile(query), { sql: compiled.sql, parameters: [...compiled.parameters] }, name);
      assert.doesNotMatch(compiled.sql, /double precision|as text|as char|as signed|cast\([^)]* as decimal|\$[0-9]/i, name);
      assert.equal((compiled.sql.match(/\?/g) ?? []).length, compiled.parameters.length, name);
      bigQueryParameters(compiled.parameters);
    }
    assert.equal((await client.compile(cityQuery('london'))).sql,
      'select cast(count(*) as string) as `customer_count` from `customers` where (lower(`customers`.`city`) = lower(cast(? as string)))');
    const freight = compilePlanSync(db, queryExamples[5].query.toSubstrait(), challengeCatalog);
    assert.match(freight.sql, /bignumeric/);
    assert.match(freight.sql, /Golden decimal\(38,10\) overflow/);
    assert.match(freight.sql, /format\('%.10f'/);
    assert.match(freight.sql, /nullif\(/);
  } finally { await client.destroy(); await db.destroy(); }
});

test('BigQuery identifiers and values use different escaping paths', async () => {
  const db = connect('bigquery');
  try {
    const attack = "London'); SELECT secret FROM credentials; --";
    const compiled = compilePlanSync(db, cityQuery(attack).toSubstrait(), challengeCatalog);
    assert.ok(!compiled.sql.includes(attack));
    assert.deepEqual(compiled.parameters, [attack]);
    assert.equal(sql`select ${sql.id('a`b\\c')}`.compile(db).sql, 'select `a\\`b\\\\c`');
  } finally { await db.destroy(); }
});

test('BigQuery config and primitive binding reject unsupported inputs before submission', () => {
  assert.equal(config.maximumBytesBilled, '1073741824');
  assert.throws(() => resolveBigQueryOptions({}, {}), /PROJECT_ID/);
  assert.throws(() => resolveBigQueryOptions({ projectId: config.projectId }, {}), /DATASET/);
  assert.throws(() => resolveBigQueryOptions({ ...config, maximumBytesBilled: '0' }, {}), /BYTES/);
  assert.throws(() => resolveBigQueryOptions({ ...config, dataset: 'a; drop table' }, {}), /DATASET/);
  assert.deepEqual(bigQueryParameters(['a', 5, 0.75, true, null]), { params: ['a', 5, 0.75, true, null], types: ['STRING', 'INT64', 'FLOAT64', 'BOOL', 'STRING'] });
  for (const value of [NaN, Infinity, {}, [], new Date(), 1n]) assert.throws(() => bigQueryParameters([value]));
});

test('BigQuery accepts large finite fp64 parameters without mislabeling them INT64', () => {
  assert.deepEqual(bigQueryParameters([1e20]), { params: [1e20], types: ['FLOAT64'] });
});

test('BigQuery explicitly rejects FLOAT64 window partition keys', async () => {
  const catalog = { values: [{ name: 'id', type: 'i32', nullable: false }, { name: 'x', type: 'fp64', nullable: true }] } as const;
  const table = createSource(catalog).table('values');
  const db = connect('bigquery');
  try {
    const rank = table.withRowNumber('position', { partitionBy: ['x'], orderBy: [{ column: 'id' }] });
    const percentile = table.groupBy('x').aggregate({ p: table.columns.id.percentile(0.75) });
    for (const query of [rank, percentile]) assert.throws(() => compilePlanSync(db, query.toSubstrait(), catalog), { code: 'UNSUPPORTED_CAPABILITY' });
  } finally { await db.destroy(); }
});

test('BigQuery SDK result wrappers retain dates and reject unsafe uncast integers', () => {
  assert.equal(normalizeBigQueryValue(BigQuery.date('2026-10-20')), '2026-10-20');
  assert.equal(normalizeBigQueryValue(BigQuery.int('42')), 42);
  assert.equal(normalizeBigQueryValue('9007199254740993.1234567890'), '9007199254740993.1234567890');
  assert.throws(() => normalizeBigQueryValue(BigQuery.int('9007199254740993')), /Unsafe/);
  assert.throws(() => normalizeBigQueryValue({ nested: true }), /Unsupported/);
});

test('BigQuery driver submits bound values, scoped dataset, billing limit and waits for all results', async () => {
  let submitted: unknown;
  const transport: BigQueryTransport = { async createQueryJob(options) {
    submitted = options;
    return [{ async getQueryResults(options) {
      assert.deepEqual(options, { wrapIntegers: true });
      return [[{ order_id: BigQuery.int('42'), day: BigQuery.date('2026-10-20'), amount: '1.0000000000', missing: null }]];
    }, async cancel() {} }];
  } };
  const driver = new BigQueryDriver(config, async () => transport);
  await driver.init();
  const connection = await driver.acquireConnection();
  assert.deepEqual((await connection.executeQuery(CompiledQuery.raw('select ? as v', ['London']))).rows,
    [{ order_id: 42, day: '2026-10-20', amount: '1.0000000000', missing: null }]);
  assert.deepEqual(submitted, { query: 'select ? as v', params: ['London'], types: ['STRING'], useLegacySql: false,
    defaultDataset: { projectId: config.projectId, datasetId: config.dataset }, location: 'US', maximumBytesBilled: '1073741824' });
  await assert.rejects(driver.beginTransaction(), /outside/);
  await driver.releaseConnection(connection); await driver.destroy();
  await assert.rejects(driver.acquireConnection(), /not initialized/);
  await assert.rejects(discoverMetadata('bigquery', { schema: 'northwind', tables: ['orders'] }), /not implemented/);
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
test('BigQuery cancellation during job submission waits for the resulting job', async () => {
  const submission = deferred<[BigQueryJob]>();
  const results = deferred<[Record<string, unknown>[]]>();
  let cancelled = 0;
  const connection = new BigQueryConnection({ createQueryJob: () => submission.promise }, config);
  const execution = connection.executeQuery(CompiledQuery.raw('select 1'));
  const cancel = connection.cancelQuery();
  submission.resolve([{ getQueryResults: () => results.promise, async cancel() { cancelled++; results.resolve([[]]); } }]);
  await cancel; await execution;
  assert.equal(cancelled, 1);
});

test('BigQuery controlled execution reports cancellation failure only after job cleanup', async () => {
  const results = deferred<[Record<string, unknown>[]]>();
  const started = deferred<void>();
  const connection = new BigQueryConnection({ async createQueryJob() {
    return [{ getQueryResults() { started.resolve(); return results.promise; }, async cancel() { throw new Error('permission denied'); } }];
  } }, config);
  const fakeDb = { getExecutor: () => ({ provideConnection: (fn: (c: BigQueryConnection) => unknown) => fn(connection) }) };
  const abort = new AbortController();
  const execution = executeControlled(fakeDb as never, 'bigquery', CompiledQuery.raw('select 1'), { signal: abort.signal });
  await started.promise; abort.abort();
  await new Promise(resolve => setImmediate(resolve));
  results.resolve([[]]);
  await assert.rejects(execution, { code: 'CANCELLATION_FAILED', backend: 'bigquery' });
});

test('BigQuery submission errors propagate and the connection remains reusable', async () => {
  let calls = 0;
  const connection = new BigQueryConnection({ async createQueryJob() {
    if (++calls === 1) throw new Error('submission failed');
    return [{ async getQueryResults() { return [[{ answer: 42 }]]; }, async cancel() {} }];
  } }, config);
  await assert.rejects(connection.executeQuery(CompiledQuery.raw('select 1')), /submission failed/);
  assert.deepEqual((await connection.executeQuery(CompiledQuery.raw('select 42'))).rows, [{ answer: 42 }]);
});
