import { connect } from '../src/backend.js';
import { seedDuckDB } from '../src/duckdb-seed.js';

const source = connect('postgres'), target = connect('duckdb');
try {
  console.log(await seedDuckDB(source, target));
} finally { await Promise.all([source.destroy(), target.destroy()]); }
