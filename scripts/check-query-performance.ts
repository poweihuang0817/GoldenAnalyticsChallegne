import { writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { connect } from '../src/backend.js';
import { compilePlanSync } from '../src/compiler.js';
import { challengeCatalog } from '../src/challenge.js';
import { queryExamples, recentOrdersPerCustomer } from '../src/queries.js';
import { seedDuckDB } from '../src/duckdb-seed.js';

// Fixed read-only corpus; EXPLAIN ANALYZE executes queries. Never accepts user SQL.
const output = process.argv[2];
if (!output) throw new Error('Usage: tsx scripts/check-query-performance.ts <output.json>');
const observations: unknown[] = [];
const examples = [...queryExamples, { name: 'Window top N', query: recentOrdersPerCustomer() }];
for (const backend of ['postgres', 'mysql', 'duckdb'] as const) {
  const db = connect(backend, { duckdbPath: ':memory:' });
  try {
    if (backend === 'duckdb') {
      const pg = connect('postgres');
      try { await seedDuckDB(pg, db); } finally { await pg.destroy(); }
    }
    await db.connection().execute(async connection => {
      for (const { name, query } of examples) {
        const start = performance.now();
        const compiled = compilePlanSync(connection, query.toSubstrait(), challengeCatalog);
        const compileMs = performance.now() - start;
        await connection.executeQuery(compiled); // warm connection/query once
        const elapsedMs: number[] = [];
        let rows: unknown[] = [];
        for (let i = 0; i < 7; i++) {
          const start = performance.now();
          rows = (await connection.executeQuery(compiled)).rows;
          elapsedMs.push(performance.now() - start);
        }
        const explain = async (prefix: string) => (await connection.executeQuery({ ...compiled, sql: prefix + compiled.sql })).rows;
        const plan = await explain(backend === 'postgres' ? 'EXPLAIN (FORMAT JSON) ' : backend === 'mysql' ? 'EXPLAIN FORMAT=JSON ' : 'EXPLAIN ');
        const analyzedPlan = await explain(backend === 'postgres' ? 'EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ' : 'EXPLAIN ANALYZE ');
        observations.push({ backend, name, sql: compiled.sql, parameterCount: compiled.parameters.length,
          compileMs, elapsedMs, medianMs: [...elapsedMs].sort((a,b) => a-b)[3], rows, plan, analyzedPlan });
      }
    });
  } finally { await db.destroy(); }
}
writeFileSync(output, JSON.stringify({ revision: execFileSync('git', ['rev-parse', 'HEAD'], {encoding:'utf8'}).trim(),
  capturedAt: new Date().toISOString(), methodology: 'Fixed Northwind corpus; one warm-up plus seven sequential executions on a held connection. Execution includes transfer/decoding, excludes acquisition. Single cold-ish compile observation. EXPLAIN ANALYZE runs separately. No throughput/large-data claim. Rows contain public sample data; no bound parameter values logged.', observations },
  (_, value) => typeof value === 'bigint' ? String(value) : value, 2) + '\n');
console.log(`Saved ${observations.length} observations to ${output}`);
