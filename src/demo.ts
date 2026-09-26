import { connect } from './backend.js';
import { compilePlan } from './compiler.js';
import { challengeCatalog } from './challenge.js';
import { queryExamples, recentOrdersPerCustomer } from './queries.js';
for (const backend of ['postgres', 'mysql'] as const) {
  const db = connect(backend);
  try {
    for (const { name, query } of [...queryExamples, { name: 'Extension: most recent three orders per customer', query: recentOrdersPerCustomer() }]) {
      const compiled = compilePlan(db, query.toSubstrait(), challengeCatalog);
      console.log({ backend, name, sql: compiled.sql, parameterCount: compiled.parameters.length });
      console.table((await db.executeQuery(compiled)).rows);
    }
  } finally { await db.destroy(); }
}
