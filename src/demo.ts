import { connect, type Backend } from './backend.js';
import { compilePlan } from './compiler.js';
import { catalog, recentOrders } from './example.js';

const plan = recentOrders();
for (const backend of ['postgres', 'mysql'] as Backend[]) {
  const db = connect(backend);
  try {
    const query = compilePlan(db, plan, catalog);
    console.log(backend, query.sql, query.parameters);
    console.table((await db.executeQuery(query)).rows);
  } finally { await db.destroy(); }
}
