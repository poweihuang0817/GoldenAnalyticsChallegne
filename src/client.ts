import { CompiledQuery } from 'kysely';
import { executeControlled, validateExecutionOptions, ExecutionError, type ExecuteOptions } from './execution.js';
import type { Query, InferRow } from './api.js';
import { connect, type Backend, type ConnectionOptions } from './backend.js';
import type { Catalog } from './compiler.js';
import { CompileService } from './compile-service.js';

export interface QueryPreview {
  readonly sql: string;
  readonly parameters: readonly unknown[];
}

/** Owns a backend pool and a lazy compilation worker. Always await destroy. */
export function createClient(backend: Backend, catalog: Catalog, options: ConnectionOptions = {}) {
  const compiler = new CompileService(backend, structuredClone(catalog));
  const db = connect(backend, options);
  let closed = false;
  let destroying: Promise<void> | undefined;
  async function compile(query: Query): Promise<QueryPreview> {
    if (closed) throw new Error('Query client is closed');
    return compiler.compile(query.toSubstrait());
  }
  return {
    /** Asynchronously inspect SQL/values; compilation runs in a reusable worker. Values may be sensitive. */
    compile,
    /** Compile and execute on this backend; preserves existing driver result representations. */
    async execute<Q extends Query>(query: Q, executionOptions: ExecuteOptions = {}): Promise<{ rows: InferRow<Q>[] }> {
      validateExecutionOptions(executionOptions);
      if (executionOptions.signal?.aborted) throw new ExecutionError('QUERY_CANCELLED', backend);
      const preview = await compile(query);
      if (closed) throw new Error('Query client is closed');
      const result = await executeControlled(db, backend, CompiledQuery.raw(preview.sql, [...preview.parameters]), executionOptions);
      return { rows: result.rows as InferRow<Q>[] };
    },
    /** Reject pending compilation and terminate its worker; finish database executions before destroying. */
    destroy(): Promise<void> {
      closed = true;
      return destroying ??= Promise.all([compiler.destroy(), db.destroy()]).then(() => {});
    },
  };
}
