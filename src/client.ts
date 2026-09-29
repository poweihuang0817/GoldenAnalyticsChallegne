import type { Query, InferRow } from './api.js';
import { connect, type Backend } from './backend.js';
import { compilePlan, type Catalog } from './compiler.js';

export interface QueryPreview {
  readonly sql: string;
  readonly parameters: readonly unknown[];
}

/** Owns a backend connection pool. Call destroy when the application is finished. */
export function createClient(backend: Backend, catalog: Catalog, options: { duckdbPath?: string } = {}) {
  const schema = structuredClone(catalog);
  const db = connect(backend, options);
  let closed = false;
  function compile(query: Query) {
    if (closed) throw new Error('Query client is closed');
    return compilePlan(db, query.toSubstrait(), schema);
  }
  return {
    /** Inspect SQL and bound values without executing a database query. Values may be sensitive. */
    compile(query: Query): QueryPreview {
      const compiled = compile(query);
      return { sql: compiled.sql, parameters: [...compiled.parameters] };
    },
    /** Compile and execute on this backend; preserves existing driver result representations. */
    async execute<Q extends Query>(query: Q): Promise<{ rows: InferRow<Q>[] }> {
      const result = await db.executeQuery(compile(query));
      return { rows: result.rows as InferRow<Q>[] };
    },
    /** Close the pool. Do not call while queries are still in flight. */
    async destroy() {
      closed = true;
      await db.destroy();
    },
  };
}
