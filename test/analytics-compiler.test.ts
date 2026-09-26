import { test } from 'node:test';
import assert from 'node:assert/strict';
import { connect } from '../src/backend.js';
import { compilePlan } from '../src/compiler.js';
import { challengeCatalog, customersInCity } from '../src/challenge.js';
import { FUNCTIONS } from '../src/relational.js';
import { readFileSync } from 'node:fs';

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
