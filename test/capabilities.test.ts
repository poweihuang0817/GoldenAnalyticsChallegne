import { test } from 'node:test';
import assert from 'node:assert/strict';
import { connect, type Backend } from '../src/backend.js';
import { capabilitySupport, compilerBackend } from '../src/capabilities.js';
import { CompileQueryError } from '../src/errors.js';
import { compilePlan, type Catalog } from '../src/compiler.js';
import { createSource } from '../src/api.js';
import { challengeCatalog, customersInCity } from '../src/challenge.js';
import { catalog, recentOrders } from '../src/example.js';

const backends: Backend[] = ['postgres', 'mysql', 'duckdb'];
const amountsCatalog = { amounts: [{ name: 'amount', type: 'decimal', nullable: true }] } as const satisfies Catalog;
const amounts = createSource(amountsCatalog).table('amounts');

function errorWith(code: CompileQueryError['code'], backend: Backend, stage: CompileQueryError['stage'] = 'compile') {
  return (error: unknown) => {
    assert.ok(error instanceof CompileQueryError);
    assert.equal(error.code, code);
    assert.equal(error.backend, backend);
    assert.equal(error.stage, stage);
    return true;
  };
}

test('capabilities describe implemented native/rewrite/unsupported paths and contextual rejection', async () => {
  for (const backend of backends) {
    const db = connect(backend, { duckdbPath: ':memory:' });
    try {
      assert.equal(compilerBackend(db), backend);
      assert.equal(capabilitySupport(backend, 'rowNumber').kind, 'native');
      assert.equal(capabilitySupport(backend, 'continuousPercentile').kind, 'rewrite');
      assert.equal(capabilitySupport(backend, 'exactDecimalDivision').kind, backend === 'duckdb' ? 'rewrite' : 'native');
      const average = () => compilePlan(db, amounts.aggregate({ mean: amounts.columns.amount.avg() }).toSubstrait(), amountsCatalog);
      if (backend === 'duckdb') {
        assert.equal(capabilitySupport(backend, 'exactDecimalAverage').kind, 'unsupported');
        assert.throws(average, error => {
          errorWith('UNSUPPORTED_CAPABILITY', backend)(error);
          assert.equal((error as CompileQueryError).capability, 'exactDecimalAverage');
          return true;
        });
      } else {
        assert.equal(capabilitySupport(backend, 'exactDecimalAverage').kind, 'native');
        assert.match(average().sql, /avg\(/);
      }
      const percentile = compilePlan(db, amounts.aggregate({ p: amounts.columns.amount.percentile(0.75) }).toSubstrait(), amountsCatalog);
      assert.match(percentile.sql, /row_number\(\) over/);
      assert.doesNotMatch(percentile.sql, /percentile_cont\(/);
      // Support is not a promise that every argument is accepted.
      const rejected = amounts.aggregate({ p: amounts.columns.amount.percentile(0.75) }).toSubstrait();
      const aggregate = rejected.relations[0].root.input;
      assert.ok('aggregate' in aggregate);
      aggregate.aggregate.measures[0].measure.arguments[1].value = { literal: { fp64: 0.12345678901 } };
      assert.throws(() => compilePlan(db, rejected, amountsCatalog), errorWith('UNSUPPORTED_CAPABILITY', backend));
    } finally { await db.destroy(); }
  }
});

test('malformed profile and invalid catalog receive different stages, with validation cause preserved', async () => {
  const db = connect('postgres');
  try {
    assert.throws(() => compilePlan(db, {}, catalog), error => {
      errorWith('INVALID_QUERY', 'postgres', 'validation')(error);
      assert.ok((error as CompileQueryError).cause instanceof Error);
      return true;
    });
    assert.throws(() => compilePlan(db, recentOrders(), {}), errorWith('INVALID_QUERY', 'postgres'));
    assert.throws(() => compilePlan(db, { cycle: (() => { const a: { next?: unknown } = {}; a.next = a; return a; })() }, catalog), errorWith('INVALID_QUERY', 'postgres', 'validation'));
  } finally { await db.destroy(); }
});

test('unsupported declarations differ from duplicates and unresolved anchors', async () => {
  const db = connect('mysql');
  try {
    const unknown = customersInCity('london');
    unknown.extensions![0].extensionFunction.name = 'unimplemented_function';
    assert.throws(() => compilePlan(db, unknown, challengeCatalog), errorWith('UNSUPPORTED_CAPABILITY', 'mysql'));
    const reference = customersInCity('london');
    const relation = reference.relations[0].root.input;
    assert.ok('aggregate' in relation);
    relation.aggregate.measures[0].measure.functionReference = 999;
    assert.throws(() => compilePlan(db, reference, challengeCatalog), errorWith('INVALID_QUERY', 'mysql'));
    const duplicate = customersInCity('london');
    duplicate.extensions!.push(duplicate.extensions![0]);
    assert.throws(() => compilePlan(db, duplicate, challengeCatalog), errorWith('INVALID_QUERY', 'mysql'));
    const unresolved = customersInCity('london');
    unresolved.extensions![0].extensionFunction.extensionUriReference = 999;
    assert.throws(() => compilePlan(db, unresolved, challengeCatalog), errorWith('INVALID_QUERY', 'mysql'));
  } finally { await db.destroy(); }
});

test('unexpected compiler errors propagate unchanged instead of receiving misleading codes', async () => {
  const db = connect('postgres');
  try {
    const sentinel = new Error('unexpected catalog accessor failure');
    const broken = new Proxy(catalog, { get() { throw sentinel; } });
    assert.throws(() => compilePlan(db, recentOrders(), broken), error => error === sentinel);
  } finally { await db.destroy(); }
});
