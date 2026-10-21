import { MysqlAdapter, PostgresAdapter, type Kysely } from 'kysely';
import type { Backend } from './backend.js';
import type { Database } from './compiler.js';
import { DuckDBAdapter } from './duckdb.js';
import { BigQueryAdapter } from './bigquery/dialect.js';
import { CompileQueryError } from './errors.js';

export type Capability = 'exactDecimalAverage' | 'continuousPercentile' | 'rowNumber' | 'exactDecimalDivision';
export type FeatureSupport =
  | { readonly kind: 'native' }
  | { readonly kind: 'rewrite' }
  | { readonly kind: 'unsupported'; readonly reason: string };

/** Describes this compiler's implemented lowering, not every feature a database offers.
 * Native/rewrite does not bypass contextual type, argument or profile validation.
 */
export function capabilitySupport(backend: Backend, capability: Capability): FeatureSupport {
  switch (capability) {
    case 'exactDecimalAverage': return backend === 'duckdb'
      ? { kind: 'unsupported', reason: 'DuckDB exact decimal average is unsupported; use explicit fp64 inputs' }
      : { kind: 'native' };
    case 'continuousPercentile': return { kind: backend === 'bigquery' ? 'native' : 'rewrite' };
    case 'rowNumber': return { kind: 'native' };
    case 'exactDecimalDivision': return { kind: backend === 'duckdb' ? 'rewrite' : 'native' };
  }
}

export function requireCapability(backend: Backend, capability: Capability): FeatureSupport {
  const support = capabilitySupport(backend, capability);
  if (support.kind === 'unsupported') throw new CompileQueryError(support.reason, {
    code: 'UNSUPPORTED_CAPABILITY', stage: 'compile', backend, capability,
  });
  return support;
}

/** Unknown third-party adapters are not mislabeled PostgreSQL. */
export function compilerBackend(db: Kysely<Database>): Backend | undefined {
  const adapter = db.getExecutor().adapter;
  if (adapter instanceof BigQueryAdapter) return 'bigquery';
  if (adapter instanceof DuckDBAdapter) return 'duckdb';
  if (adapter instanceof MysqlAdapter) return 'mysql';
  if (adapter instanceof PostgresAdapter) return 'postgres';
  return undefined;
}
