import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runExplore } from '../src/playground/explore-query.js';

const enabled = Boolean(process.env.BIGQUERY_PROJECT_ID && process.env.BIGQUERY_DATASET);
test('BigQuery forecast segments match the seeded DuckDB snapshot', { skip: !enabled }, async () => {
  for (const stage of ['all', 'uk', 'london'] as const) {
    const actual = await runExplore({ stage, backend: 'bigquery', action: 'run' });
    const expected = await runExplore({ stage, backend: 'duckdb', action: 'run' });
    assert.ok('history' in actual && 'history' in expected);
    assert.equal(actual.customers, expected.customers);
    assert.deepEqual(actual.history, expected.history);
    assert.deepEqual(actual.predictions, expected.predictions);
    assert.deepEqual(actual.backtest, expected.backtest);
  }
});
