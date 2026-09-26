import { Kysely, MysqlDialect, PostgresDialect } from 'kysely';
import { createPool } from 'mysql2';
import pg from 'pg';
import type { Database } from './compiler.js';

export type Backend = 'postgres' | 'mysql';
export function connect(backend: Backend): Kysely<Database> {
  if (backend === 'postgres') return new Kysely({ dialect: new PostgresDialect({
    pool: new pg.Pool({
      connectionString: process.env.POSTGRES_URL ?? 'postgres://northwind:northwind@127.0.0.1:5432/northwind',
      // DATE is a calendar date, not an instant; match MySQL dateStrings.
      types: { getTypeParser: (oid, format) => oid === 1082 ? (value: string) => value : pg.types.getTypeParser(oid, format) },
    }),
  }) });
  return new Kysely({ dialect: new MysqlDialect({ pool: createPool({
    uri: process.env.MYSQL_URL ?? 'mysql://northwind:northwind@127.0.0.1:3306/northwind',
    dateStrings: true, supportBigNumbers: true, bigNumberStrings: true,
  }) }) });
}
