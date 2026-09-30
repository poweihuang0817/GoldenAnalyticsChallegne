import { test } from 'node:test';
import assert from 'node:assert/strict';
import { connect } from '../src/backend.js';
import { compilePlan, type LoweringDecision } from '../src/compiler.js';
import { challengeCatalog, customersInCity } from '../src/challenge.js';
import { FUNCTIONS } from '../src/relational.js';
import { readFileSync } from 'node:fs';
import { createSource, count } from '../src/api.js';
import { cityQuery, recentOrdersPerCustomer } from '../src/queries.js';

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
        const compiled = compilePlan(db, query.toSubstrait(), challengeCatalog);
        assert.match(compiled.sql, /from \(select/);
      }
      const nestedSql = compilePlan(db, nested.toSubstrait(), challengeCatalog).sql;
      const trace: LoweringDecision[] = [];
      const window = compilePlan(db, recentOrdersPerCustomer(2).toSubstrait(), challengeCatalog, { trace });
      assert.equal(window.sql.match(/\bselect\b/gi)?.length, 2);
      assert.ok(trace.some(e => e.operation === 'window' && e.decision === 'merged'));
      assert.ok(trace.some(e => e.operation === 'filter' && e.decision === 'boundary' && e.reason.includes('window')));
      const withoutTrace = compilePlan(db, recentOrdersPerCustomer(2).toSubstrait(), challengeCatalog);
      assert.equal(window.sql, withoutTrace.sql);
      assert.deepEqual(window.parameters, withoutTrace.parameters);
      assert.equal(nestedSql.match(/\bselect\b/gi)?.length, 2);
      const filteredSql = compilePlan(db, limited.filter(limited.columns.order_id.eq(10250)).toSubstrait(), challengeCatalog).sql;
      assert.match(filteredSql, /limit .*\).*where/s);
    } finally { await db.destroy(); }
  }
});

test('simple analytical pipelines use one SQL query block without losing bindings', async () => {
  for (const backend of ['postgres', 'mysql', 'duckdb'] as const) {
    const db = connect(backend, { duckdbPath: ':memory:' });
    try {
      const city = "London' OR 1=1 --";
      const compiled = compilePlan(db, cityQuery(city).toSubstrait(), challengeCatalog);
      assert.equal(compiled.sql.match(/\bselect\b/gi)?.length, 1);
      assert.ok(compiled.parameters.includes(city));
      assert.ok(!compiled.sql.includes(city));
      const trace: LoweringDecision[] = [];
      compilePlan(db, cityQuery(city).toSubstrait(), challengeCatalog, { trace });
      assert.ok(!JSON.stringify(trace).includes(city));
      const customers = createSource(challengeCatalog).table('customers');
      const renamed = customers.select({ place: customers.columns.city });
      const filtered = renamed.filter(renamed.columns.place.isNotNull());
      const grouped = filtered.groupBy('place').aggregate({ n: count() }).orderBy({ column: 'place' });
      const query = compilePlan(db, grouped.toSubstrait(), challengeCatalog);
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
    assert.throws(() => compilePlan(db, uri, challengeCatalog), /URI/);
    const fn = customersInCity('london');
    fn.extensions![0].extensionFunction.name = 'execute_arbitrary_sql';
    assert.throws(() => compilePlan(db, fn, challengeCatalog), /declaration/);
    const duplicate = customersInCity('london');
    duplicate.extensions!.push(duplicate.extensions![0]);
    assert.throws(() => compilePlan(db, duplicate, challengeCatalog), /duplicate/);
    const output = customersInCity('london');
    const relation = output.relations[0].root.input;
    if (!('aggregate' in relation)) throw new Error('Expected aggregate');
    relation.aggregate.measures[0].measure.outputType = { bool: { nullability: 'NULLABILITY_REQUIRED' } };
    assert.throws(() => compilePlan(db, output, challengeCatalog), /output type/);
    const overflow = customersInCity('london');
    const aggregate = overflow.relations[0].root.input;
    if (!('aggregate' in aggregate)) throw new Error('Expected aggregate');
    aggregate.aggregate.measures[0].measure.arguments[0].value = { literal: { i32: 2147483648 } };
    assert.throws(() => compilePlan(db, overflow, challengeCatalog));
  } finally { await db.destroy(); }
});
