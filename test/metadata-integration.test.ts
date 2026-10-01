import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, resolve, basename } from 'node:path';
import { sql } from 'kysely';
import { connect } from '../src/backend.js';
import { createSource } from '../src/api.js';
import { createClient } from '../src/client.js';
import { discoverMetadata, discoverCatalog, metadataToCatalog, MetadataError } from '../src/metadata.js';
for (const backend of ['postgres', 'mysql', 'duckdb'] as const) {
  test(`${backend}: scoped physical metadata, strict types, and discovered catalog execution`, async () => {
    const folder = await mkdtemp(join(tmpdir(), 'golden-metadata-'));
    const options = { duckdbPath: join(folder, 'metadata.duckdb') };
    let db = connect(backend, options);
    const name = `metadata_${randomUUID().replaceAll('-', '')}`;
    let table = sql.table(name);
    try {
      const schema = backend === 'postgres' ? 'public' : backend === 'mysql'
        ? String((await sql<{ name: string }>`select database() as name`.execute(db)).rows[0].name) : 'main';
      const scope = { ...options, schema, tables: [name] };
      table = sql.table(`${schema}.${name}`);
      await sql`create table ${table} (id integer not null, label varchar(20), amount decimal(38,10), day date, large bigint)`.execute(db);
      await sql`insert into ${table} values (7, 'northwind', 12.25, '2026-09-29', 9007199254740993)`.execute(db);
      await db.destroy();
      const metadata = await discoverMetadata(backend, scope);
      assert.deepEqual(metadata.tables.map(t => t.name), [name]);
      assert.deepEqual(metadata.tables[0].columns.map(c => [c.name, c.ordinal, c.nullable]),
        [['id', 1, false], ['label', 2, true], ['amount', 3, true], ['day', 4, true], ['large', 5, true]]);
      assert.equal(metadata.tables[0].columns[2].precision, 38);
      assert.equal(metadata.tables[0].columns[2].scale, 10);
      const catalog = await discoverCatalog(backend, scope);
      const source = createSource(catalog).table(name);
      const client = createClient(backend, catalog, options);
      try {
        const query = source.select({ id: source.columns.id, label: source.columns.label, amount: source.columns.amount, large: source.columns.large });
        const preview = await client.compile(query);
        assert.ok(preview.sql.includes(name));
        const rows = (await client.execute(query)).rows;
        assert.equal(rows[0].id, 7); assert.equal(rows[0].label, 'northwind');
        assert.equal(rows[0].amount, '12.2500000000'); assert.equal(rows[0].large, '9007199254740993');
      } finally { await client.destroy(); }
      db = connect(backend, options);
      await sql`alter table ${table} add column unsupported decimal(12,2)`.execute(db);
      await db.destroy();
      const physical = await discoverMetadata(backend, scope);
      assert.equal(physical.tables[0].columns.at(-1)?.scale, 2);
      assert.throws(() => metadataToCatalog(physical), (e: unknown) => e instanceof MetadataError && e.code === 'UNSUPPORTED_TYPE');
      if (backend === 'mysql') {
        db = connect(backend, options);
        await sql`alter table ${table} add column unsigned_large bigint unsigned`.execute(db);
        await db.destroy();
        assert.equal((await discoverMetadata(backend, scope)).tables[0].columns.at(-1)?.unsigned, true);
      }
      await assert.rejects(discoverMetadata(backend, { ...scope, tables: [name + '_missing'] }),
        (e: unknown) => e instanceof MetadataError && e.code === 'INVALID_METADATA');
    } finally {
      await db.destroy();
      db = connect(backend, options);
      try { await sql`drop table if exists ${table}`.execute(db); }
      finally {
        await db.destroy();
        assert.equal(dirname(resolve(folder)), resolve(tmpdir()));
        assert.ok(basename(folder).startsWith('golden-metadata-'));
        await rm(folder, { recursive: true, force: true });
      }
    }
  });
}
