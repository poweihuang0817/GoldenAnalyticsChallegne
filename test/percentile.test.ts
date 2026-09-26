import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { sql } from 'kysely';
import { connect } from '../src/backend.js';
import { compilePlan, type Catalog } from '../src/compiler.js';
import { countryPercentile } from '../src/challenge.js';
import { ref, type Rel, encodePlan, decodePlan } from '../src/plan.js';

function fixturePlan(table: string, fraction: number, grouped = true) {
  const plan = countryPercentile(fraction);
  const root = plan.relations[0].root;
  if (!('sort' in root.input) || !('aggregate' in root.input.sort.input)) throw new Error('Expected percentile plan');
  const aggregate = root.input.sort.input.aggregate;
  aggregate.input = { read: { namedTable: { names: [table] }, baseSchema: {
    names: ['category', 'amount'], struct: { nullability: 'NULLABILITY_REQUIRED', types: [
      { string: { nullability: 'NULLABILITY_REQUIRED' } },
      { decimal: { nullability: 'NULLABILITY_NULLABLE', precision: 38, scale: 10 } },
    ] },
  } } };
  aggregate.groupings[0].groupingExpressions = grouped ? [ref(0)] : [];
  aggregate.measures[0].measure.arguments[0].value = ref(1);
  root.input = grouped ? { sort: { input: { aggregate }, sorts: [{ expr: ref(0), direction: 'SORT_DIRECTION_ASC_NULLS_LAST' }] } } : { aggregate } as Rel;
  root.names = grouped ? ['category', 'p'] : ['p'];
  return plan;
}

for (const backend of ['postgres', 'mysql'] as const) {
  test(`${backend}: percentile interpolation, nulls, ties, boundaries and large exact decimals`, async () => {
    const db = connect(backend), table = `quantile_test_${randomBytes(6).toString('hex')}`;
    const catalog: Catalog = { [table]: [
      { name: 'category', type: 'string', nullable: false }, { name: 'amount', type: 'decimal', nullable: true },
    ] };
    try {
      await db.connection().execute(async connection => {
        await sql`create temporary table ${sql.id(table)} (category varchar(20) not null, amount decimal(38,10))`.execute(connection);
        try {
          for (const [category, amount] of [['a','10'],['a','20'],['a','30'],['a','40'],['a',null],['b',null],['c','7'],['d','1'],['d','1'],['big','9007199254740993.0000000000'],['big','9007199254740993.0000000100']]) {
            await sql`insert into ${sql.id(table)} values (${category}, ${amount})`.execute(connection);
          }
          const run = async (fraction: number, grouped = true) => (await connection.executeQuery(compilePlan(connection, decodePlan(encodePlan(fixturePlan(table, fraction, grouped))), catalog))).rows;
          assert.deepEqual(await run(0.75), [
            { category: 'a', p: '32.5000000000' }, { category: 'b', p: null },
            { category: 'big', p: '9007199254740993.0000000075' },
            { category: 'c', p: '7.0000000000' }, { category: 'd', p: '1.0000000000' },
          ]);
          assert.equal((await run(0))[0].p, '10.0000000000');
          assert.equal((await run(1))[0].p, '40.0000000000');
          await sql`delete from ${sql.id(table)}`.execute(connection);
          assert.deepEqual(await run(0.75), []);
          assert.deepEqual(await run(0.75, false), [{ p: null }]);
          assert.throws(() => compilePlan(connection, fixturePlan(table, 1.01), catalog), /fraction/);
        } finally { await sql`drop table ${sql.id(table)}`.execute(connection); }
      });
    } finally { await db.destroy(); }
  });
}
