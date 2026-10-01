import { Worker } from 'node:worker_threads';
import { tmpdir } from 'node:os';
import type { Backend } from './backend.js';
import type { Catalog } from './compiler.js';
import type { SupportedPlanJson } from './plan.js';
import type { QueryPreview } from './client.js';
import { CompileQueryError } from './errors.js';

export interface CompileRequest { id: number; backend: Backend; catalog: Catalog; plan: SupportedPlanJson }
export type CompileResponse = { id: number; preview: QueryPreview; threadId: number } | { id: number; error: Error & Partial<CompileQueryError> };

/** One serial CPU worker, with at most 32 outstanding jobs (including the active job). */
export class CompileService {
  private worker?: Worker;
  private nextId = 0;
  private failure?: Error;
  private closing?: Promise<void>;
  private readonly pending = new Map<number, { resolve: (preview: QueryPreview) => void; reject: (error: Error) => void }>();

  constructor(private readonly backend: Backend, private readonly catalog: Catalog,
    private readonly startWorker = () => new Worker(new URL('./compile-worker.mjs', import.meta.url), {
      workerData: { entry: new URL(import.meta.url.endsWith('.ts') ? './compile-worker-run.ts' : './compile-worker-run.js', import.meta.url).href },
      // Only OS temp paths are inherited, never database URLs or credentials.
      env: { TEMP: tmpdir(), TMP: tmpdir() }, execArgv: [],
    })) {}

  async compile(plan: SupportedPlanJson): Promise<QueryPreview> {
    if (this.failure) throw this.failure;
    if (this.pending.size >= 32) throw new Error('Compilation queue is full (32 outstanding requests)');
    if (!this.worker) {
      try {
        this.worker = this.startWorker();
        this.worker.on('message', (response: CompileResponse) => {
          const request = this.pending.get(response.id);
          if (!request) return;
          this.pending.delete(response.id);
          if ('error' in response) {
            const error = response.error;
            request.reject(error.code && error.stage
              ? new CompileQueryError(error.message, { code: error.code, stage: error.stage, backend: error.backend, capability: error.capability, cause: error.cause })
              : error);
          } else request.resolve(response.preview);
        });
        this.worker.on('error', error => this.fail(error instanceof Error ? error : new Error(String(error))));
        this.worker.on('exit', code => this.fail(new Error(`Compilation worker exited (${code})`)));
      } catch (error) {
        this.fail(error instanceof Error ? error : new Error(String(error)));
        throw this.failure;
      }
    }
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      try { this.worker!.postMessage({ id, backend: this.backend, catalog: this.catalog, plan } satisfies CompileRequest); }
      catch (error) { this.pending.delete(id); reject(error); }
    });
  }

  private fail(error: Error) {
    this.failure ??= error;
    for (const request of this.pending.values()) request.reject(this.failure);
    this.pending.clear();
  }

  destroy(): Promise<void> {
    this.fail(new Error('Query client is closed'));
    return this.closing ??= this.worker ? this.worker.terminate().then(() => {}) : Promise.resolve();
  }
}
