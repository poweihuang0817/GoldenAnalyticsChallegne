import { DuckDBInstance, DuckDBDecimalValue, DuckDBDateValue, type DuckDBConnection as NativeConnection, type DuckDBValue } from '@duckdb/node-api';
import { DialectAdapterBase, PostgresQueryCompiler, CompiledQuery, type Dialect, type Driver, type DatabaseConnection, type QueryResult, type TransactionSettings } from 'kysely';

/** Only the supported query profile is portable; this is not a general PostgreSQL dialect. */
export class DuckDBAdapter extends DialectAdapterBase {
  override get supportsTransactionalDdl() { return true; }
  override get supportsReturning() { return true; }
  async acquireMigrationLock(): Promise<void> { throw new Error('DuckDB migrations are outside this adapter profile'); }
  async releaseMigrationLock(): Promise<void> { throw new Error('DuckDB migrations are outside this adapter profile'); }
}

function parameter(value: unknown): DuckDBValue {
  if (value === null || ['string', 'number', 'boolean', 'bigint'].includes(typeof value)) return value as DuckDBValue;
  throw new Error('Unsupported DuckDB parameter type');
}
function normalize(value: DuckDBValue): unknown {
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof DuckDBDecimalValue || value instanceof DuckDBDateValue) return value.toString();
  if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) return value;
  throw new Error('Unsupported DuckDB result type');
}
class Connection implements DatabaseConnection {
  constructor(readonly native: NativeConnection) {}
  async cancelQuery(): Promise<void> { this.native.interrupt(); }
  async executeQuery<R>(query: CompiledQuery): Promise<QueryResult<R>> {
    const result = await this.native.runAndReadAll(query.sql, query.parameters.map(parameter));
    const names = result.columnNames();
    return { rows: result.getRows().map(row => Object.fromEntries(row.map((value, i) => [names[i], normalize(value)])) as R) };
  }
  async *streamQuery<R>(): AsyncIterableIterator<QueryResult<R>> { throw new Error('DuckDB streaming is outside this adapter profile'); }
}
class DuckDBDriver implements Driver {
  private instance?: DuckDBInstance;
  private readonly connections = new Set<Connection>();
  constructor(private readonly path: string) {}
  async init() { this.instance = await DuckDBInstance.create(this.path); }
  async acquireConnection() {
    if (!this.instance) throw new Error('DuckDB driver is not initialized');
    const connection = new Connection(await this.instance.connect());
    this.connections.add(connection);
    return connection;
  }
  async beginTransaction(connection: DatabaseConnection, settings: TransactionSettings) {
    if (settings.isolationLevel || settings.accessMode) throw new Error('DuckDB transaction options are outside this adapter profile');
    await connection.executeQuery(CompiledQuery.raw('begin transaction'));
  }
  async commitTransaction(connection: DatabaseConnection) { await connection.executeQuery(CompiledQuery.raw('commit')); }
  async rollbackTransaction(connection: DatabaseConnection) { await connection.executeQuery(CompiledQuery.raw('rollback')); }
  async releaseConnection(connection: DatabaseConnection) {
    if (connection instanceof Connection && this.connections.delete(connection)) connection.native.closeSync();
  }
  async destroy() {
    for (const connection of this.connections) connection.native.closeSync();
    this.connections.clear();
    this.instance?.closeSync();
    this.instance = undefined;
  }
}
export class DuckDBDialect implements Dialect {
  constructor(private readonly path: string) {}
  createAdapter() { return new DuckDBAdapter(); }
  createDriver() { return new DuckDBDriver(this.path); }
  createQueryCompiler() { return new PostgresQueryCompiler(); }
  createIntrospector() {
    return {
      async getSchemas(): Promise<never> { throw new Error('DuckDB introspection is outside this adapter profile'); },
      async getTables(): Promise<never> { throw new Error('DuckDB introspection is outside this adapter profile'); },
    };
  }
}
