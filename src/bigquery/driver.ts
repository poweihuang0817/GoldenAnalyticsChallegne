import type { CompiledQuery, DatabaseConnection, Driver, QueryResult } from 'kysely';
import type { Query as JobQuery } from '@google-cloud/bigquery';

export interface BigQueryOptions {
  projectId?: string;
  dataset?: string;
  location?: string;
  /** Per-query billing limit, in bytes. Defaults to 1 GiB. */
  maximumBytesBilled?: string;
}
export interface BigQueryJob {
  getQueryResults(options: { wrapIntegers: boolean }): Promise<[Record<string, unknown>[], ...unknown[]]>;
  cancel(): Promise<unknown>;
}
export interface BigQueryTransport {
  createQueryJob(options: JobQuery): Promise<[BigQueryJob, ...unknown[]]>;
}
export function resolveBigQueryOptions(options: BigQueryOptions, env: NodeJS.ProcessEnv = process.env) {
  const projectId = options.projectId ?? env.BIGQUERY_PROJECT_ID;
  const dataset = options.dataset ?? env.BIGQUERY_DATASET;
  const location = options.location ?? env.BIGQUERY_LOCATION;
  const maximumBytesBilled = options.maximumBytesBilled ?? env.BIGQUERY_MAXIMUM_BYTES_BILLED ?? '1073741824';
  if (!projectId || !/^[a-z][a-z0-9-]{4,61}[a-z0-9]$/.test(projectId)) throw new Error('Set a valid BIGQUERY_PROJECT_ID');
  if (!dataset || !/^[A-Za-z_][A-Za-z0-9_]{0,1023}$/.test(dataset)) throw new Error('Set a valid BIGQUERY_DATASET');
  if (location !== undefined && !/^[A-Za-z0-9-]+$/.test(location)) throw new Error('Invalid BIGQUERY_LOCATION');
  if (!/^[1-9][0-9]*$/.test(maximumBytesBilled) || BigInt(maximumBytesBilled) > 9223372036854775807n) throw new Error('Invalid BIGQUERY_MAXIMUM_BYTES_BILLED');
  return { projectId, dataset, location, maximumBytesBilled };
}
/** Bind values through the SDK, never substitute them into SQL text. */
export function bigQueryParameters(parameters: readonly unknown[]) {
  const types = parameters.map(value => {
    if (value === null || typeof value === 'string') return 'STRING';
    if (typeof value === 'boolean') return 'BOOL';
    if (typeof value === 'number' && Number.isFinite(value)) {
      // The public API's number literals are fp64. Only safe integers (including
      // validated pagination/i32 values) can also be represented exactly as INT64.
      return Number.isSafeInteger(value) ? 'INT64' : 'FLOAT64';
    }
    throw new Error('Unsupported BigQuery parameter type');
  });
  return { params: [...parameters], types };
}
export function normalizeBigQueryValue(value: unknown): unknown {
  if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) return value;
  if (value && typeof value === 'object') {
    const boxed = value as { constructor: { name: string }; value?: unknown };
    if (boxed.constructor.name === 'BigQueryDate' && typeof boxed.value === 'string') return boxed.value;
    if (boxed.constructor.name === 'BigQueryInt' && typeof boxed.value === 'string') {
      const number = Number(boxed.value);
      if (!Number.isSafeInteger(number)) throw new Error('Unsafe uncast BigQuery INT64 result; use the canonical i64 string projection');
      return number;
    }
  }
  throw new Error('Unsupported BigQuery result type');
}

export class BigQueryConnection implements DatabaseConnection {
  private job?: Promise<BigQueryJob>;
  constructor(private readonly transport: BigQueryTransport, private readonly config: ReturnType<typeof resolveBigQueryOptions>) {}
  async executeQuery<R>(query: CompiledQuery): Promise<QueryResult<R>> {
    if (this.job) throw new Error('BigQuery connection already has an active job');
    const parameters = bigQueryParameters(query.parameters);
    this.job = this.transport.createQueryJob({
      query: query.sql, ...parameters, useLegacySql: false,
      defaultDataset: { projectId: this.config.projectId, datasetId: this.config.dataset },
      location: this.config.location, maximumBytesBilled: this.config.maximumBytesBilled,
    }).then(([job]) => job);
    try {
      const job = await this.job;
      const [rows] = await job.getQueryResults({ wrapIntegers: true });
      return { rows: rows.map(row => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, normalizeBigQueryValue(value)])) as R) };
    } finally { this.job = undefined; }
  }
  async cancelQuery(): Promise<void> {
    // Wait for job creation: cancellation during submission must not lose the job.
    const pending = this.job;
    if (!pending) return;
    let job: BigQueryJob;
    try { job = await pending; } catch { return; } // Submission itself failed; no job to cancel.
    await job.cancel();
  }
  async *streamQuery<R>(): AsyncIterableIterator<QueryResult<R>> { throw new Error('BigQuery streaming is unsupported'); }
}
export class BigQueryDriver implements Driver {
  private config?: ReturnType<typeof resolveBigQueryOptions>;
  private transport?: BigQueryTransport;
  private readonly connections = new Set<BigQueryConnection>();
  constructor(private readonly options: BigQueryOptions, private readonly factory = async (projectId: string): Promise<BigQueryTransport> => {
    const { BigQuery } = await import('@google-cloud/bigquery');
    return new BigQuery({ projectId }); // Application Default Credentials; no credentials in plans/workers.
  }) {}
  async init() {
    this.config = resolveBigQueryOptions(this.options);
    this.transport = await this.factory(this.config.projectId);
  }
  async acquireConnection() {
    if (!this.transport || !this.config) throw new Error('BigQuery driver is not initialized');
    const connection = new BigQueryConnection(this.transport, this.config);
    this.connections.add(connection);
    return connection;
  }
  async releaseConnection(connection: DatabaseConnection) { this.connections.delete(connection as BigQueryConnection); }
  async beginTransaction(): Promise<never> { throw new Error('BigQuery transactions are outside this adapter profile'); }
  async commitTransaction(): Promise<never> { throw new Error('BigQuery transactions are outside this adapter profile'); }
  async rollbackTransaction(): Promise<never> { throw new Error('BigQuery transactions are outside this adapter profile'); }
  async destroy() {
    await Promise.all([...this.connections].map(c => c.cancelQuery()));
    this.connections.clear(); this.transport = undefined;
  }
}
