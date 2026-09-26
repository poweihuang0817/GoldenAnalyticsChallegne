import { connect } from './backend.js';
import { compilePlan } from './compiler.js';
import { challengeCatalog } from './challenge.js';
import { queryExamples } from './queries.js';
const backends = process.argv.includes('--duckdb') ? ['duckdb'] as const : ['postgres', 'mysql'] as const;
for (const backend of backends) {
  const db = connect(backend);
  try {
    for (const { name, query } of queryExamples) {
      const compiled = compilePlan(db, query.toSubstrait(), challengeCatalog);
      console.log({ backend, name, sql: compiled.sql, parameterCount: compiled.parameters.length });
      console.table((await db.executeQuery(compiled)).rows);
    }
  } finally { await db.destroy(); }
}
