import { createServer, type IncomingMessage } from 'node:http';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { createClient } from '../client.js';
import { challengeCatalog } from '../challenge.js';
import { coverage, customerCountQuery, dailySalesQuery, forecast, type FilterStage } from '../forecast-demo.js';
import { planOutline, sqlPreview } from './preview.js';

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
    const preview = { code, plan: planOutline(query.toSubstrait()),
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

async function readBody(req: IncomingMessage) {
  const chunks: Buffer[] = []; let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 1024) throw new Error('Request exceeds 1024 bytes.');
    chunks.push(Buffer.from(chunk));
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
}
const assets: Record<string, [string, string]> = {
  '/': ['explore.html', 'text/html; charset=utf-8'],
  '/explore.js': ['explore.js', 'text/javascript; charset=utf-8'],
  '/explore.css': ['explore.css', 'text/css; charset=utf-8'],
  '/p75-evidence.json': ['p75-evidence.json', 'application/json; charset=utf-8'],
};
export function createExploreServer(execute: (request: ExploreRequest) => Promise<unknown> = runExplore) {
  let busy = false;
  return createServer({ requestTimeout: 5000, headersTimeout: 5000 }, async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
    const send = (status: number, value: unknown) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(value)); };
    const host = `127.0.0.1:${req.socket.localPort}`;
    if (req.headers.host !== host || (req.headers.origin && req.headers.origin !== `http://${host}`) ||
      (req.headers['sec-fetch-site'] && !['same-origin', 'none'].includes(String(req.headers['sec-fetch-site'])))) {
      send(403, { error: 'Only the local demo page may access this server.' }); return;
    }
    if (req.method === 'GET' && Object.hasOwn(assets, req.url ?? '')) {
      const [file, type] = assets[req.url!]; res.writeHead(200, { 'Content-Type': type });
      res.end(readFileSync(new URL(file, import.meta.url))); return;
    }
    if (req.url !== '/explore/query') { send(404, { error: 'Not found.' }); return; }
    if (req.method !== 'POST') { send(405, { error: 'Use POST.' }); return; }
    if (req.headers['content-type'] !== 'application/json') { send(415, { error: 'Use application/json.' }); return; }
    let input: ExploreRequest;
    try { input = validateExploreRequest(await readBody(req)); }
    catch { send(400, { error: 'Request rejected: choose a listed stage, backend and action; no raw SQL. Maximum request size is 1024 bytes.' }); return; }
    if (busy) { send(429, { error: 'A query is running. Try again when it finishes.' }); return; }
    busy = true;
    try { send(200, await execute(input)); }
    catch { send(500, { error: 'Demo query failed or exceeded its data limits. Check database setup and the selected backend.' }); }
    finally { busy = false; }
  });
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.GOLDEN_EXPLORE_PORT ?? 4319);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid GOLDEN_EXPLORE_PORT');
  const server = createExploreServer();
  server.on('error', error => { console.error(error.message); process.exitCode = 1; });
  server.listen(port, '127.0.0.1', () => console.log(`Forecast and filter demo: http://127.0.0.1:${port}`));
}
