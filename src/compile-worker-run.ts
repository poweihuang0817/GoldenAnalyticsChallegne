import { parentPort, threadId } from 'node:worker_threads';
import { DummyDriver, Kysely, MysqlAdapter, MysqlQueryCompiler, PostgresAdapter, PostgresQueryCompiler } from 'kysely';
import { DuckDBAdapter } from './duckdb.js';
import { compilePlanSync, type Database } from './compiler.js';
import { CompileQueryError } from './errors.js';
import type { CompileRequest } from './compile-service.js';

if (!parentPort) throw new Error('Compiler entry must run in a worker');
parentPort.on('message', ({ id, backend, plan, catalog }: CompileRequest) => {
  // No connection pools, native connections, credentials or backend connect() calls.
  const db = new Kysely<Database>({ dialect: {
    createDriver: () => new DummyDriver(),
    createAdapter: () => backend === 'duckdb' ? new DuckDBAdapter() : backend === 'mysql' ? new MysqlAdapter() : new PostgresAdapter(),
    createQueryCompiler: () => backend === 'mysql' ? new MysqlQueryCompiler() : new PostgresQueryCompiler(),
    createIntrospector: () => { throw new Error('Compilation cannot inspect a database'); },
  } });
  try {
    const { sql, parameters } = compilePlanSync(db, plan, catalog);
    parentPort!.postMessage({ id, preview: { sql, parameters: [...parameters] }, threadId });
  } catch (cause) {
    const error = cause instanceof Error ? cause : new Error(String(cause));
    // Structured-cloned Error drops custom fields. Send stable compiler details explicitly.
    parentPort!.postMessage({ id, error: error instanceof CompileQueryError
      ? { name: error.name, message: error.message, code: error.code, stage: error.stage, backend: error.backend, capability: error.capability, cause: error.cause }
      : error });
  }
});
