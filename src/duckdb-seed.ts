import { createHash } from 'node:crypto';
import { Kysely, sql } from 'kysely';
import { challengeCatalog } from './challenge.js';
import type { Database, Catalog } from './compiler.js';

const types = { i32: 'integer', i64: 'bigint', date: 'date', string: 'varchar', fp64: 'double', bool: 'boolean', decimal: 'decimal(38,10)' };

/** Read a consistent PG snapshot; replace only the four documented local demo tables.
 * Both connections belong to the caller. No source writes or runtime federation.
 */
export async function seedDuckDB(source: Kysely<Database>, target: Kysely<Database>) {
  const tables = await source.transaction().setIsolationLevel('repeatable read').setAccessMode('read only').execute(async tx => {
    const result: { name: string; rows: Record<string, unknown>[] }[] = [];
    for (const [name, columns] of Object.entries(challengeCatalog)) {
      const selected = columns.map(c => c.type === 'decimal'
        ? sql`cast(${sql.id(c.name)} as decimal(38,10)) as ${sql.id(c.name)}` : sql.id(c.name));
      const rows = (await sql<Record<string, unknown>>`select ${sql.join(selected)} from ${sql.id(name)} order by ${sql.join(columns.map(c => sql.id(c.name)))}`.execute(tx)).rows;
      result.push({ name, rows });
    }
    return result;
  });
  await target.transaction().execute(async tx => {
    for (const { name, rows } of tables) {
      const columns = (challengeCatalog as Catalog)[name];
      await sql`create or replace table ${sql.id(name)} (${sql.join(columns.map(c => sql`${sql.id(c.name)} ${sql.raw(types[c.type])}${c.nullable ? sql`` : sql` not null`}`))})`.execute(tx);
      for (let offset = 0; offset < rows.length; offset += 100) {
        const values = rows.slice(offset, offset + 100).map(row => sql`(${sql.join(columns.map(c => sql.val(row[c.name])))})`);
        await sql`insert into ${sql.id(name)} values ${sql.join(values)}`.execute(tx);
      }
    }
  });
  return {
    source: 'goldenbeers/golden-query-challenge:1.0 PostgreSQL Northwind logical catalog',
    sha256: createHash('sha256').update(JSON.stringify(tables)).digest('hex'),
    rows: Object.fromEntries(tables.map(t => [t.name, t.rows.length])),
  };
}
