import { Kysely, MysqlDialect, PostgresDialect } from 'kysely';
import { createPool, createConnection } from 'mysql2';
import pg from 'pg';
import type { Database } from './compiler.js';
import { DuckDBDialect } from './duckdb.js';

/** Supported execution targets; DuckDB uses an independently seeded local snapshot. */
export type Backend = 'postgres' | 'mysql' | 'duckdb';
/**
 * Create a Kysely handle configured for the selected backend.
 * @param backend - PostgreSQL, MySQL or DuckDB.
 * @param options - Optional DuckDB path; otherwise DUCKDB_PATH or northwind.duckdb is used.
 * @remarks PG/MySQL read environment URLs or local sample defaults. Always await destroy in finally.
 */
export function connect(backend: Backend, options: { duckdbPath?: string } = {}): Kysely<Database> {
  if (backend === 'duckdb') return new Kysely({ dialect: new DuckDBDialect(options.duckdbPath ?? process.env.DUCKDB_PATH ?? 'northwind.duckdb') });
  if (backend === 'postgres') return new Kysely({ dialect: new PostgresDialect({
    pool: new pg.Pool({
      connectionTimeoutMillis: 5000,
      connectionString: process.env.POSTGRES_URL ?? 'postgres://northwind:northwind@127.0.0.1:5432/northwind',
      // DATE is a calendar date, not an instant; match MySQL dateStrings.
      types: { getTypeParser: (oid, format) => oid === 1082 ? (value: string) => value : pg.types.getTypeParser(oid, format) },
    }),
  }) });
  return new Kysely({ dialect: new MysqlDialect({ controlConnection: createConnection, pool: createPool({
    uri: process.env.MYSQL_URL ?? 'mysql://northwind:northwind@127.0.0.1:3306/northwind',
    dateStrings: true, supportBigNumbers: true, bigNumberStrings: true,
  }) }) });
}
