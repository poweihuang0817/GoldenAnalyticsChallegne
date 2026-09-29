import type { CompiledQuery, Kysely, QueryResult } from 'kysely';
import type { Backend } from './backend.js';

export interface ExecuteOptions {
  readonly signal?: AbortSignal;
  /** Running-query budget in milliseconds; excludes compilation and connection acquisition. */
  readonly timeoutMs?: number;
}
export type ExecutionErrorCode = 'QUERY_TIMEOUT' | 'QUERY_CANCELLED' | 'CANCELLATION_FAILED' | 'CONNECTION_FAILED' | 'EXECUTION_FAILED';
export class ExecutionError extends Error {
  get stage() { return this.code === 'CONNECTION_FAILED' ? 'connect' : 'execute'; }
  constructor(readonly code: ExecutionErrorCode, readonly backend: Backend, cause?: unknown) {
    super({ QUERY_TIMEOUT: 'Query execution timed out', QUERY_CANCELLED: 'Query execution cancelled', CANCELLATION_FAILED: 'Backend query cancellation failed', CONNECTION_FAILED: 'Backend connection failed', EXECUTION_FAILED: 'Backend query execution failed' }[code], { cause });
    this.name = 'ExecutionError';
  }
}
export function validateExecutionOptions(options: ExecuteOptions): void {
  if (options.timeoutMs !== undefined && (!Number.isInteger(options.timeoutMs) || options.timeoutMs <= 0 || options.timeoutMs > 2_147_483_647)) {
    throw new RangeError('timeoutMs must be a positive integer no greater than 2147483647');
  }
}

/** Hold the connection until query AND cancellation settle; late cancellation cannot hit a new borrower. */
export async function executeControlled<R>(db: Kysely<any>, backend: Backend, query: CompiledQuery<R>, options: ExecuteOptions = {}): Promise<QueryResult<R>> {
  validateExecutionOptions(options);
  let reason: 'QUERY_TIMEOUT' | 'QUERY_CANCELLED' | undefined;
  let cancel: (() => void) | undefined;
  const abort = () => { reason ??= 'QUERY_CANCELLED'; cancel?.(); };
  if (options.signal?.aborted) throw new ExecutionError('QUERY_CANCELLED', backend);
  options.signal?.addEventListener('abort', abort, { once: true });
  let timer: ReturnType<typeof setTimeout> | undefined;
  let acquired = false;
  try {
    return await db.getExecutor().provideConnection(async connection => {
      acquired = true;
      if (reason) throw new ExecutionError(reason, backend);
      await connection.collectSessionInfo?.();
      if (reason) throw new ExecutionError(reason, backend);
      let finished = false;
      let cancellation: Promise<void> | undefined;
      let cancellationFailure: unknown;
      cancel = () => {
        if (finished || cancellation) return;
        cancellation = (async () => {
          try {
            if (!connection.cancelQuery) throw new Error('Backend does not implement query cancellation');
            // Configured native drivers use independent control connections, never this busy pool.
            await connection.cancelQuery(async () => { throw new Error('Independent cancellation connection unavailable'); });
          } catch (error) {
            cancellationFailure = error;
          }
        })();
      };
      timer = options.timeoutMs === undefined ? undefined : setTimeout(() => { reason ??= 'QUERY_TIMEOUT'; cancel?.(); }, options.timeoutMs);
      let result: QueryResult<R> | undefined;
      let failure: unknown;
      try { result = await connection.executeQuery(query); }
      catch (error) { failure = error; }
      finally { finished = true; cancel = undefined; }
      await cancellation;
      if (cancellationFailure) throw new ExecutionError('CANCELLATION_FAILED', backend, cancellationFailure);
      if (reason) throw new ExecutionError(reason, backend, failure);
      if (failure) throw new ExecutionError('EXECUTION_FAILED', backend, failure);
      return result!;
    });
  } catch (error) {
    if (error instanceof ExecutionError) throw error;
    throw new ExecutionError(acquired ? 'EXECUTION_FAILED' : 'CONNECTION_FAILED', backend, error);
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', abort);
  }
}
