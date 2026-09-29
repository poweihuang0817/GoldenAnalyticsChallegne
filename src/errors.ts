import type { Backend } from './backend.js';

export type CompileQueryErrorCode = 'INVALID_QUERY' | 'UNSUPPORTED_CAPABILITY';
export type CompileQueryErrorStage = 'validation' | 'compile';

/** Stable compiler failure details. Messages/cause are diagnostics, not a parsing API. */
export class CompileQueryError extends Error {
  readonly code: CompileQueryErrorCode;
  readonly stage: CompileQueryErrorStage;
  readonly backend?: Backend;
  readonly capability?: string;

  constructor(message: string, options: {
    code: CompileQueryErrorCode; stage: CompileQueryErrorStage; backend?: Backend;
    capability?: string; cause?: unknown;
  }) {
    super(message, { cause: options.cause });
    this.name = 'CompileQueryError';
    this.code = options.code;
    this.stage = options.stage;
    this.backend = options.backend;
    this.capability = options.capability;
  }
}
