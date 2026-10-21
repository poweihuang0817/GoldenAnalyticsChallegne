import { readFileSync } from 'node:fs';
import { createClient } from '../client.js';
import { challengeCatalog } from '../challenge.js';
import { coverage, customerCountQuery, dailySalesQuery, forecast, type FilterStage } from '../forecast-demo.js';
import { sqlPreview } from './preview.js';

export type ExploreRequest = { stage: FilterStage; backend: 'postgres' | 'mysql' | 'duckdb'; action: 'compile' | 'run' };
export function validateExploreRequest(value: unknown): ExploreRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Choose a listed stage, backend and action.');
  const v = value as Record<string, unknown>;
  if (Object.keys(v).length !== 3 || !['stage', 'backend', 'action'].every(k => Object.hasOwn(v, k)) ||
    !['all', 'uk', 'london'].includes(String(v.stage)) || !['postgres', 'mysql', 'duckdb'].includes(String(v.backend)) ||
    !['compile', 'run'].includes(String(v.action)) || Object.values(v).some(x => typeof x !== 'string')) {
    throw new Error('Only predefined stages, backends and actions are allowed. Raw SQL and arbitrary predicates are rejected.');
  }
  return value as ExploreRequest;
}

const source = readFileSync(new URL('../forecast-demo.ts', import.meta.url), 'utf8');
const code = source.slice(source.indexOf('export function salesStages()'), source.indexOf('\nexport function customerCountQuery'));
export async function runExplore(input: ExploreRequest, options: { duckdbPath?: string } = {}) {
  const request = validateExploreRequest(input);
  const client = createClient(request.backend, challengeCatalog, options);
  try {
    const query = dailySalesQuery(request.stage), countQuery = customerCountQuery(request.stage);
    const countPreview = await client.compile(countQuery), salesPreview = await client.compile(query);
    const preview = { code,
      countSQL: sqlPreview(countPreview.sql, request.backend).text, countParameters: countPreview.parameters,
      salesSQL: sqlPreview(salesPreview.sql, request.backend).text, salesParameters: salesPreview.parameters };
    if (request.action === 'compile') return { ...preview, stage: request.stage, backend: request.backend };
    // Sequential reads: no shared mutable fixtures or claims of transaction snapshot consistency.
    const allRows = (await client.execute(dailySalesQuery('all'), { timeoutMs: 10_000 })).rows;
    const rows = request.stage === 'all' ? allRows : (await client.execute(query, { timeoutMs: 10_000 })).rows;
    const customers = (await client.execute(countQuery, { timeoutMs: 10_000 })).rows[0]?.customers;
    return { ...preview, stage: request.stage, backend: request.backend, customers,
      dailyRows: rows.length, ...forecast(rows, coverage(allRows)) };
  } finally { await client.destroy(); }
}
