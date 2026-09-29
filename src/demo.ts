import { createClient } from './client.js';
import { challengeCatalog } from './challenge.js';
import { queryExamples, recentOrdersPerCustomer } from './queries.js';
const backends = process.argv.includes('--duckdb') ? ['duckdb'] as const : ['postgres', 'mysql'] as const;
for (const backend of backends) {
  const client = createClient(backend, challengeCatalog);
  try {
    for (const { name, query } of [...queryExamples, { name: 'Extension: most recent three orders per customer', query: recentOrdersPerCustomer() }]) {
      const compiled = client.compile(query);
      console.log({ backend, name, sql: compiled.sql, parameterCount: compiled.parameters.length });
      console.table((await client.execute(query)).rows);
    }
  } finally { await client.destroy(); }
}
