import { test } from 'node:test';
import assert from 'node:assert/strict';
import { discoverMetadata, metadataToCatalog, MetadataError, type PhysicalColumn } from '../src/metadata.js';
const column = (dataType: string, overrides: Partial<PhysicalColumn> = {}): PhysicalColumn => ({
  name: 'value', ordinal: 1, dataType, nativeType: dataType, nullable: true, precision: null, scale: null, unsigned: false, domainName: null, ...overrides,
});
const catalog = (c: PhysicalColumn) => metadataToCatalog({ backend: 'mysql', schema: 'northwind', defaultSchema: 'northwind', tables: [{ name: 'sample', columns: [c] }] });
test('physical metadata maps conservatively without losing unsigned and decimal boundaries', () => {
  for (const [physical, type] of [['int', 'i32'], ['bigint', 'i64'], ['text', 'string'], ['date', 'date'], ['double', 'fp64'], ['boolean', 'bool']]) {
    assert.deepEqual(catalog(column(physical))['sample'], [{ name: 'value', type, nullable: true }]);
  }
  assert.equal(catalog(column('int', { unsigned: true }))['sample'][0].type, 'i64');
  assert.equal(catalog(column('tinyint', { nativeType: 'tinyint(1)' }))['sample'][0].type, 'i32');
  assert.equal(catalog(column('decimal', { precision: 38, scale: 10 }))['sample'][0].type, 'decimal');
  for (const c of [column('bigint', { unsigned: true }), column('numeric', { precision: 12, scale: 2 }),
    column('decimal', { precision: 38, scale: 11 }), column('timestamp'), column('json'), column('ARRAY')]) {
    assert.throws(() => catalog(c), (error: unknown) => error instanceof MetadataError && error.code === 'UNSUPPORTED_TYPE' && error.stage === 'metadata');
  }
});
test('scope and catalog identifiers fail before opening a connection', async () => {
  for (const options of [{ schema: 'public', tables: [] }, { schema: 'public', tables: ['a', 'a'] },
    { schema: 'public', tables: ['orders;drop table orders'] }, { schema: 'a.b', tables: ['orders'] },
    { schema: 'public', tables: Array.from({ length: 101 }, (_, n) => `t${n}`) }]) {
    await assert.rejects(discoverMetadata('postgres', options), (e: unknown) => e instanceof MetadataError && e.code === 'INVALID_METADATA');
  }
  assert.throws(() => catalog(column('int', { name: 'bad.name' })), MetadataError);
});

test('conversion rejects nondefault schemas, domains, and malformed physical metadata', () => {
  assert.throws(() => metadataToCatalog({ backend: 'postgres', schema: 'other', defaultSchema: 'public',
    tables: [{ name: 'sample', columns: [column('integer')] }] }), (e: unknown) => e instanceof MetadataError && e.code === 'INVALID_METADATA');
  assert.throws(() => catalog(column('integer', { domainName: 'positive_int' })),
    (e: unknown) => e instanceof MetadataError && e.code === 'UNSUPPORTED_TYPE');
  for (const c of [column('int', { ordinal: 2 }), column('decimal', { precision: NaN }),
    column('int', { nullable: 'YES' as unknown as boolean }), column('numeric', { scale: -1 })]) {
    assert.throws(() => catalog(c), (e: unknown) => e instanceof MetadataError && e.code === 'INVALID_METADATA');
  }
});
