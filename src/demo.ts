import { connect, type Backend } from './backend.js';
import { compilePlan } from './compiler.js';
import { catalog, recentOrders } from './example.js';
import { analyticalExamples, challengeCatalog } from './challenge.js';

const plan = recentOrders();
for (const backend of ['postgres', 'mysql'] as Backend[]) {
  const db = connect(backend);
  try {
    const query = compilePlan(db, plan, catalog);
    console.log(backend, query.sql, query.parameters);
    console.table((await db.executeQuery(query)).rows);
    for (const example of analyticalExamples) {
      const compiled = compilePlan(db, example.plan, challengeCatalog);
      console.log(backend, example.name);
      console.table((await db.executeQuery(compiled)).rows);
    }
  } finally { await db.destroy(); }
}
