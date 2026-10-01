import { test } from 'node:test';
import assert from 'node:assert/strict';
import { connect } from '../src/backend.js';
import { compilePlanSync, type LoweringDecision } from '../src/compiler.js';
import { challengeCatalog, customersInCity } from '../src/challenge.js';
import { FUNCTIONS } from '../src/relational.js';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createSource, count } from '../src/api.js';
import { cityQuery, recentOrdersPerCustomer, queryExamples } from '../src/queries.js';

test('row count lowers to count star while nullable column count remains an expression', async () => {
  for (const backend of ['postgres', 'mysql', 'duckdb'] as const) {
    const db = connect(backend, { duckdbPath: ':memory:' });
    try {
      const compiled = compilePlanSync(db, cityQuery('london').toSubstrait(), challengeCatalog);
      assert.match(compiled.sql, /count\(\*\)/);
      assert.deepEqual(compiled.parameters, ['london']);
      const customers = createSource(challengeCatalog).table('customers');
      const nullableCount = compilePlanSync(db, customers.aggregate({ n: customers.columns.city.count() }).toSubstrait(), challengeCatalog);
      assert.doesNotMatch(nullableCount.sql, /count\(\*\)/);
      assert.match(nullableCount.sql, /count\(.*city/);
    } finally { await db.destroy(); }
  }
});

test('generated SQL, ordered bindings and lowering trace match reviewed snapshots', async () => {
  for (const backend of ['postgres', 'mysql', 'duckdb'] as const) {
    const db = connect(backend, { duckdbPath: ':memory:' });
    try {
      const snapshots = [...queryExamples, { name: 'Window top N', query: recentOrdersPerCustomer() }].map(({name, query}) => {
        const trace: LoweringDecision[] = [];
        const compiled = compilePlanSync(db, query.toSubstrait(), challengeCatalog, { trace });
        return { name, sql: compiled.sql, parameters: compiled.parameters, trace };
      });
      const directory = new URL('./fixtures/sql-query-blocks/', import.meta.url);
      const path = new URL(`${backend}.json`, directory);
      if (process.env.UPDATE_SQL_SNAPSHOTS === '1') {
        mkdirSync(directory, { recursive: true });
        writeFileSync(path, JSON.stringify(snapshots, null, 2) + '\n');
      }
      assert.deepEqual(snapshots, JSON.parse(readFileSync(path, 'utf8')), `${backend}: review SQL/trace changes; update snapshots explicitly`);
    } finally { await db.destroy(); }
  }
});

test('query blocks retain aggregate, computed projection, fetch and window boundaries', async () => {
  for (const backend of ['postgres', 'mysql', 'duckdb'] as const) {
    const db = connect(backend, { duckdbPath: ':memory:' });
    try {
      const orders = createSource(challengeCatalog).table('orders');
      const grouped = orders.groupBy('customer_id').aggregate({ n: count() });
      const nested = grouped.aggregate({ average: grouped.columns.n.avg() });
      const limited = orders.orderBy({ column: 'order_id' }).limit(2);
      const computed = orders.select({ value: orders.columns.freight.div(orders.columns.freight) });
      for (const query of [nested, limited.filter(limited.columns.order_id.eq(10250)),
        computed.filter(computed.columns.value.isNotNull()), recentOrdersPerCustomer(2)]) {
        const compiled = compilePlanSync(db, query.toSubstrait(), challengeCatalog);
        assert.match(compiled.sql, /from \(select/);
      }
      const nestedSql = compilePlanSync(db, nested.toSubstrait(), challengeCatalog).sql;
      const trace: LoweringDecision[] = [];
      const window = compilePlanSync(db, recentOrdersPerCustomer(2).toSubstrait(), challengeCatalog, { trace });
      assert.equal(window.sql.match(/\bselect\b/gi)?.length, 2);
      assert.ok(trace.some(e => e.operation === 'window' && e.decision === 'merged'));
      assert.ok(trace.some(e => e.operation === 'filter' && e.decision === 'boundary' && e.reason.includes('window')));
      const withoutTrace = compilePlanSync(db, recentOrdersPerCustomer(2).toSubstrait(), challengeCatalog);
      assert.equal(window.sql, withoutTrace.sql);
      assert.deepEqual(window.parameters, withoutTrace.parameters);
      assert.equal(nestedSql.match(/\bselect\b/gi)?.length, 2);
      const filteredSql = compilePlanSync(db, limited.filter(limited.columns.order_id.eq(10250)).toSubstrait(), challengeCatalog).sql;
      assert.match(filteredSql, /limit .*\).*where/s);
    } finally { await db.destroy(); }
  }
});

test('simple analytical pipelines use one SQL query block without losing bindings', async () => {
  for (const backend of ['postgres', 'mysql', 'duckdb'] as const) {
    const db = connect(backend, { duckdbPath: ':memory:' });
    try {
      const city = "London' OR 1=1 --";
      const compiled = compilePlanSync(db, cityQuery(city).toSubstrait(), challengeCatalog);
      assert.equal(compiled.sql.match(/\bselect\b/gi)?.length, 1);
      assert.ok(compiled.parameters.includes(city));
      assert.ok(!compiled.sql.includes(city));
      const trace: LoweringDecision[] = [];
      compilePlanSync(db, cityQuery(city).toSubstrait(), challengeCatalog, { trace });
      assert.ok(!JSON.stringify(trace).includes(city));
      const customers = createSource(challengeCatalog).table('customers');
      const renamed = customers.select({ place: customers.columns.city });
      const filtered = renamed.filter(renamed.columns.place.isNotNull());
      const grouped = filtered.groupBy('place').aggregate({ n: count() }).orderBy({ column: 'place' });
      const query = compilePlanSync(db, grouped.toSubstrait(), challengeCatalog);
      assert.equal(query.sql.match(/\bselect\b/gi)?.length, 1);
      assert.match(query.sql, /where .*is not null.*group by .*order by/);
    } finally { await db.destroy(); }
  }
});

test('extension specification declares exactly the registered function names', () => {
  const yaml = readFileSync('spec/golden-functions.yaml', 'utf8');
  const names = [...yaml.matchAll(/^  - name: (\w+)$/gm)].map(match => match[1]);
  assert.deepEqual(names, [...FUNCTIONS]);
});

test('analytical compiler rejects unregistered URIs, functions, duplicate anchors and wrong output types', async () => {
  const db = connect('postgres');
  try {
    const uri = customersInCity('london');
    uri.extensionUris![0].uri = 'https://example.invalid/functions.yaml';
    assert.throws(() => compilePlanSync(db, uri, challengeCatalog), /URI/);
    const fn = customersInCity('london');
    fn.extensions![0].extensionFunction.name = 'execute_arbitrary_sql';
    assert.throws(() => compilePlanSync(db, fn, challengeCatalog), /declaration/);
    const duplicate = customersInCity('london');
    duplicate.extensions!.push(duplicate.extensions![0]);
    assert.throws(() => compilePlanSync(db, duplicate, challengeCatalog), /duplicate/);
    const output = customersInCity('london');
    const relation = output.relations[0].root.input;
    if (!('aggregate' in relation)) throw new Error('Expected aggregate');
    relation.aggregate.measures[0].measure.outputType = { bool: { nullability: 'NULLABILITY_REQUIRED' } };
    assert.throws(() => compilePlanSync(db, output, challengeCatalog), /output type/);
    const overflow = customersInCity('london');
    const aggregate = overflow.relations[0].root.input;
    if (!('aggregate' in aggregate)) throw new Error('Expected aggregate');
    aggregate.aggregate.measures[0].measure.arguments[0].value = { literal: { i32: 2147483648 } };
    assert.throws(() => compilePlanSync(db, overflow, challengeCatalog));
  } finally { await db.destroy(); }
});

test('audit cleanup folds terminal pagination and only removes proven redundant SQL', async () => {
  const { recentOrdersQuery, averageUnitsQuery, shippingQuery, freightQuery } = await import('../src/queries.js');
  for (const backend of ['postgres','mysql','duckdb'] as const) {
    const db = connect(backend, { duckdbPath: ':memory:' });
    try {
      const compile = (q: import('../src/api.js').Query) => compilePlanSync(db, q.toSubstrait(), challengeCatalog);
      const recent = compile(recentOrdersQuery());
      assert.equal(recent.sql.match(/\bselect\b/gi)?.length, 1, 'terminal fetch should use one block');
      assert.equal(recent.sql.match(/case when/gi)?.length, 1, 'only nullable order_date needs null ranking');
      assert.deepEqual(recent.parameters, [5, 0]);
      for (const q of [averageUnitsQuery(), shippingQuery(), freightQuery()]) {
        const sql = compile(q).sql;
        const inspectCasts = (node: any): void => {
          if (!node || typeof node !== 'object') return;
          if (node.kind === 'RawNode' && node.sqlFragments?.[0] === 'cast(' && node.sqlFragments.length === 2) {
            const inner = node.parameters?.[0];
            assert.ok(!(inner?.kind === 'RawNode' && JSON.stringify(inner.sqlFragments) === JSON.stringify(node.sqlFragments)), 'adjacent casts to the same physical type');
          }
          for (const value of Object.values(node)) if (typeof value === 'object') {
            if (Array.isArray(value)) value.forEach(inspectCasts); else inspectCasts(value);
          }
        };
        inspectCasts(compile(q).query);
        assert.doesNotMatch(sql, /order_date/, 'unused scan columns should not be materialized');
      }
    } finally { await db.destroy(); }
  }
});

test('audit percentile position is bound once and unused freight is pruned', async () => {
  const { percentileQuery, shippingQuery, averageUnitsQuery } = await import('../src/queries.js');
  for (const backend of ['postgres','mysql','duckdb'] as const) {
    const db = connect(backend, { duckdbPath: ':memory:' });
    try {
      const compiled = compilePlanSync(db, percentileQuery().toSubstrait(), challengeCatalog);
      assert.equal(compiled.parameters.filter(p => p === 0.75).length, 1);
      assert.doesNotMatch(compiled.sql, /freight/);
      assert.equal(compiled.sql.match(/\bselect\b/gi)?.length, 5);
      assert.equal(compilePlanSync(db, shippingQuery().toSubstrait(), challengeCatalog).sql.match(/\bselect\b/gi)?.length, 1);
      assert.equal(compilePlanSync(db, averageUnitsQuery().toSubstrait(), challengeCatalog).sql.match(/\bselect\b/gi)?.length, 2);
      const window = compilePlanSync(db, recentOrdersPerCustomer().toSubstrait(), challengeCatalog);
      // Nullable date within ROW_NUMBER and nullable customer in final order remain.
      assert.equal(window.sql.match(/case when/gi)?.length, 2);
    } finally { await db.destroy(); }
  }
});
