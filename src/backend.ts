import { Kysely, MysqlDialect, PostgresDialect } from 'kysely';
import { createPool, createConnection } from 'mysql2';
import pg from 'pg';
import type { Database } from './compiler.js';
import { DuckDBDialect } from './duckdb.js';
import { BigQueryDialect } from './bigquery/dialect.js';
import type { BigQueryOptions } from './bigquery/driver.js';

/** Remote SQL targets plus an independently seeded local DuckDB snapshot. */
export type Backend = 'postgres' | 'mysql' | 'duckdb' | 'bigquery';
export interface ConnectionOptions { duckdbPath?: string; bigquery?: BigQueryOptions }
/**
 * Create a Kysely handle configured for the selected backend.
 * @param backend - PostgreSQL, MySQL, DuckDB or BigQuery.
 * @param options - Optional DuckDB path or BigQuery project/dataset settings.
 * @remarks PG/MySQL use URL settings; BigQuery uses ADC and BIGQUERY_* settings.
 * DuckDB defaults to DUCKDB_PATH or northwind.duckdb. Always await destroy in finally.
 */
export function connect(backend: Backend, options: ConnectionOptions = {}): Kysely<Database> {
  if (backend === 'bigquery') return new Kysely({ dialect: new BigQueryDialect(options.bigquery) });
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
