import { createServer, type IncomingMessage } from 'node:http';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { connect, type Backend } from '../backend.js';
import { compilePlanSync, type LoweringDecision } from '../compiler.js';
import { challengeCatalog } from '../challenge.js';
import { cityQuery, averageUnitsQuery, percentileQuery, recentOrdersQuery, shippingQuery, freightQuery, recentOrdersPerCustomer } from '../queries.js';
import { sqlPreview, planOutline } from './preview.js';

const source = readFileSync(new URL('../queries.ts', import.meta.url), 'utf8');
function definition(name: string) {
  const start = source.search(new RegExp(`(?:export )?(?:const|function) ${name}\\b`));
  if (start < 0) throw new Error('Missing example source');
  const rest = source.slice(start), next = rest.slice(1).search(/\n(?:export |function )/);
  return (next < 0 ? rest : rest.slice(0, next + 1)).trim();
}
const examples = [
  { id: 'recent', title: 'Most recent 5 orders', description: 'Sort by order date, break ties by order ID, then take five orders.', code: `${definition('recentOrdersQuery')}\n\nrecentOrdersQuery(5)`, build: () => recentOrdersQuery(5) },
  { id: 'city', title: 'Customers in London', description: 'Filter with a bound value, then count. Case-insensitive matching is explicit.', code: `${definition('cityQuery')}\n\ncityQuery('london')`, build: () => cityQuery('london') },
  { id: 'city-mexico', title: 'Customers in Mexico D.F.', description: 'The same city-count API with a different bound value. Accent-sensitive matching: mexico does not match México.', code: `${definition('cityQuery')}\n\ncityQuery('mexico d.f.')`, build: () => cityQuery('mexico d.f.') },
  { id: 'units', title: 'Average units per order', description: 'Aggregate order lines, join back to orders, then aggregate again. Orders without lines contribute zero.', code: `${definition('averageUnitsQuery')}\n\naverageUnitsQuery()`, build: averageUnitsQuery },
  { id: 'shipping', title: 'Employee shipped/unshipped orders', description: 'Left join employees to orders and count each shipping status; include employees with no orders.', code: `${definition('shippingQuery')}\n\nshippingQuery()`, build: shippingQuery },
  { id: 'freight', title: 'Customer freight/order-price ratio', description: 'Sum freight once per order and divide by discounted merchandise totals per customer.', code: `${definition('pricedOrders')}\n\n${definition('freightQuery')}\n\nfreightQuery()`, build: freightQuery },
  { id: 'percentile', title: '75th percentile by country', description: 'Exact continuous percentile of discounted order prices, rounded to decimal scale 10. Each country is a separate group.', code: `${definition('pricedOrders')}\n\n${definition('percentileQuery')}\n\npercentileQuery(0.75)`, build: percentileQuery },
  { id: 'window', title: 'Extension: latest 3 orders per customer', description: 'ROW_NUMBER partitions by customer and ranks by date, then order ID. Filter to the first three rows per customer.', code: `${definition('recentOrdersPerCustomer')}\n\nrecentOrdersPerCustomer(3)`, build: () => recentOrdersPerCustomer(3) },
];
export type Request = { query: string; backend: Backend; action: 'compile' | 'run' };
export async function executeExample(request: Request, options: { duckdbPath?: string } = {}) {
  const example = examples.find(e => e.id === request.query);
  if (!example) throw new Error('Unknown example');
  const plan = example.build().toSubstrait(), db = connect(request.backend, options), start = performance.now();
  try {
    const loweringTrace: LoweringDecision[] = [];
    const compiled = compilePlanSync(db, plan, challengeCatalog, { trace: loweringTrace });
    const rows = request.action === 'run' ? (await db.executeQuery(compiled)).rows : undefined;
    const elapsedMs = Math.round((performance.now() - start) * 10) / 10;
    return { sql: compiled.sql, sqlPreview: sqlPreview(compiled.sql, request.backend), planOutline: planOutline(plan), parameterCount: compiled.parameters.length, parameters: compiled.parameters, plan,
      loweringTrace, rows: rows?.slice(0, 100), rowCount: rows?.length, elapsedMs };
  } finally { await db.destroy(); }
}
const assets: Record<string, [string, string]> = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
  '/style.css': ['style.css', 'text/css; charset=utf-8'],
  '/architecture.svg': ['architecture.svg', 'image/svg+xml'],
};
async function body(request: IncomingMessage) {
  const chunks: Buffer[] = []; let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 1024) throw new Error('Body too large');
    chunks.push(Buffer.from(chunk));
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
}
export function createDemoServer(execute: (request: Request) => Promise<unknown> = executeExample) {
  let busy = false;
  // HTTP receive timeouts only: these do not limit or cancel database execution.
  return createServer({ requestTimeout: 5000, headersTimeout: 5000 }, async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
    const send = (status: number, value: unknown) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(value)); };
    const port = req.socket.localPort, host = `127.0.0.1:${port}`;
    // Defense in depth, not authentication. Keep the loopback bind and fixed allowlist;
    // this walkthrough must not be exposed through a public proxy.
    if (req.headers.host !== host || (req.headers.origin && req.headers.origin !== `http://${host}`)
      || (req.headers['sec-fetch-site'] && !['same-origin', 'none'].includes(String(req.headers['sec-fetch-site'])))) {
      send(403, { error: 'Only the local demo page may access this server.' }); return;
    }
    if (req.method === 'GET' && Object.hasOwn(assets, req.url ?? '')) {
      const [file, contentType] = assets[req.url!];
      res.writeHead(200, { 'Content-Type': contentType }); res.end(readFileSync(new URL(file, import.meta.url))); return;
    }
    if (req.method === 'GET' && req.url === '/examples') {
      send(200, examples.map(({ build, ...example }) => example)); return;
    }
    if (req.url !== '/query') { send(404, { error: 'Not found.' }); return; }
    if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); send(405, { error: 'Use POST.' }); return; }
    if (req.headers['content-type'] !== 'application/json') { send(415, { error: 'Use application/json.' }); return; }
    let input: any;
    try { input = await body(req); } catch { send(400, { error: 'Expected a JSON request of at most 1024 bytes.' }); return; }
    if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).length !== 3
      || !['query', 'backend', 'action'].every(k => Object.hasOwn(input, k))
      || !examples.some(e => e.id === input.query) || !['postgres', 'mysql', 'duckdb'].includes(input.backend)
      || !['compile', 'run'].includes(input.action)) { send(400, { error: 'Choose a listed example, backend and action.' }); return; }
    if (busy) { send(429, { error: 'A query is running. Try again when it finishes.' }); return; }
    busy = true;
    try { send(200, await execute(input)); }
    catch { send(500, { error: 'Query failed. Check the sample databases. For DuckDB, run npm run seed:duckdb with the same DUCKDB_PATH before starting the demo.' }); }
    finally { busy = false; }
  });
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  createDemoServer().listen(4317, '127.0.0.1', () => console.log('Demo: http://127.0.0.1:4317'));
}
