/** Opt-in experiment: never imported by the application or default test suite. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { CompiledQuery, sql } from 'kysely';
import { connect, type Backend } from '../../src/backend.js';
import { seedDuckDB } from '../../src/duckdb-seed.js';
import { createConnection } from 'mysql2/promise';

const require = createRequire(import.meta.url);
const prql: typeof import('prqlc') = require('prqlc');
type Row = Record<string, any>;
type Finding = { backend: Backend; name: string; source: string; sql?: string; status: string; rows?: Row[]; expected?: unknown; error?: string };
const findings: Finding[] = [];
function compile(source: string, backend: Backend) {
  // The binding consumes options; do not reuse or free after compile.
  const opts = new prql.CompileOptions();
  opts.target = `sql.${backend}`; opts.signature_comment = false;
  const result = prql.compile(source, opts);
  assert.equal(typeof result, 'string');
  return result!;
}
const average = `let totals = (from order_details | group order_id (aggregate {units = sum quantity}))
from o=orders
join side:left t=totals (o.order_id == t.order_id)
derive {units = t.units ?? 0}
aggregate {average_units = average units}`;
const ranked = `from orders
derive {missing_date = order_date == null}
group customer_id (sort {missing_date, -order_date, -order_id} | derive {position = row_number this})
filter position <= 3
select {customer_id, order_id, position}
sort {customer_id, position}`;
const shipping = `from e=employees
join side:left o=orders (e.employee_id == o.employee_id)
derive {
 shipped = case [o.order_id != null && o.shipped_date != null => 1, true => 0],
 unshipped = case [o.order_id != null && o.shipped_date == null => 1, true => 0]
}
group e.employee_id (aggregate {shipped = sum shipped, unshipped = sum unshipped})
sort employee_id`;
const priced = `let totals = (from order_details | group order_id (aggregate {price = sum (unit_price * quantity * (1 - discount))}))
let priced = (from o=orders | join side:left t=totals (o.order_id == t.order_id) | select {customer_id=o.customer_id, price=t.price ?? 0, freight=o.freight ?? 0})`;
const freight = `${priced}
from c=customers | join side:left p=priced (c.customer_id == p.customer_id)
group c.customer_id (aggregate {freight=sum p.freight, price=sum p.price})
select {customer_id, freight_ratio = case [price == 0 => null, true => freight / price]}
sort customer_id`;
const percentile = `${priced}
from c=customers | join p=priced (c.customer_id == p.customer_id)
group country (aggregate {order_price_p75 = percentile 0.75 p.price}) | sort country`;
const safeError = (e: unknown) => e instanceof Error ? `${e.name}: ${e.message}` : String(e);
// Exact numeric comparison only removes insignificant trailing zeros, never uses Number.
// Raw output is retained so representation differences are still visible.
const decimalText = (value: unknown) => {
  assert.equal(typeof value, 'string');
  assert.match(value as string, /^-?\d+(\.\d+)?$/);
  return (value as string).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
};

for (const backend of ['postgres', 'mysql', 'duckdb'] as const) {
  const db = connect(backend, { duckdbPath: ':memory:' });
  const fixture = `prql_probe_${randomBytes(6).toString('hex')}`;
  let created = false;
  async function run(name: string, source: string, parameters: unknown[], expected: unknown,
    verify: (rows: Row[]) => void = rows => assert.deepEqual(rows, expected)) {
    const f: Finding = {backend, name, source, status: 'untested', expected};
    findings.push(f);
    try { f.sql = compile(source, backend); }
    catch (e) { f.status = 'compile-rejected'; f.error = safeError(e); return; }
    try { f.rows = (await db.executeQuery<Row>(CompiledQuery.raw(f.sql, parameters))).rows; }
    catch (e) { f.status = 'execution-rejected'; f.error = safeError(e); return; }
    try { verify(f.rows); f.status = 'pass'; }
    catch { f.status = 'contract-mismatch'; }
  }
  try {
    if (backend === 'duckdb') {
      const pg = connect('postgres');
      try { await seedDuckDB(pg, db); } finally { await pg.destroy(); }
    }
    const orders = (await sql<Row>`select order_id, order_date, customer_id, employee_id, shipped_date from orders`.execute(db)).rows;
    const details = (await sql<Row>`select order_id, quantity from order_details`.execute(db)).rows;
    const customers = (await sql<Row>`select customer_id, city from customers`.execute(db)).rows;
    const employees = (await sql<Row>`select employee_id from employees`.execute(db)).rows;
    const recent = [...orders].sort((a,b) => String(b.order_date ?? '').localeCompare(String(a.order_date ?? '')) || b.order_id-a.order_id)
      .slice(0,5).map(o => ({order_id:o.order_id,order_date:o.order_date}));
    await run('recent-orders-literal-N', 'from orders | derive {missing_date = order_date == null} | sort {missing_date, -order_date, -order_id} | take 5 | select {order_id, order_date}', [], recent);
    await run('recent-orders-parameter-N', 'from orders | sort {-order_id} | take $1 | select order_id', [5], 'parameterized N must compile and execute');
    for (const city of ['london', 'mexico d.f.', "london' OR 1=1 --"]) {
      const expected = customers.filter(c => c.city?.toLowerCase() === city).length;
      await run(`city-parameter:${city}`, 'from customers | filter (text.lower city) == (text.lower $1) | aggregate {customer_count = count this}', [city], expected,
        rows => { assert.equal(rows.length,1); assert.equal(String(rows[0].customer_count), String(expected)); });
    }
    const repeatedExpected = customers.filter(c => ['London','Berlin'].includes(c.city)).map(c=>c.customer_id).sort();
    await run('repeated-out-of-order-parameters', 'from customers | filter city == $2 || city == $1 || city == $2 | select customer_id | sort customer_id', ['London','Berlin'], repeatedExpected,
      rows=>assert.deepEqual(rows.map(r=>r.customer_id), repeatedExpected));
    const units = new Map<number,number>();
    for (const d of details) units.set(d.order_id, (units.get(d.order_id)??0)+Number(d.quantity));
    const avg = orders.reduce((n,o)=>n+(units.get(o.order_id)??0),0)/orders.length;
    await run('average-units-all-orders', average, [], avg, rows=>{
      assert.equal(rows.length,1); assert.ok(Math.abs(Number(rows[0].average_units)-avg)<1e-12);
    });
    await run('average-units-explicit-float', average.replace('average units', 'average (as float units)'), [], avg, rows=>{
      assert.equal(rows.length,1); assert.ok(Math.abs(Number(rows[0].average_units)-avg)<1e-12);
    });
    const positions = new Map<string, number>();
    const top = [...orders].sort((a,b)=>String(a.customer_id).localeCompare(String(b.customer_id)) || String(b.order_date??'').localeCompare(String(a.order_date??'')) || b.order_id-a.order_id)
      .flatMap(o=>{const n=(positions.get(o.customer_id)??0)+1; positions.set(o.customer_id,n); return n<=3?[{customer_id:o.customer_id,order_id:o.order_id,position:String(n)}]:[];});
    await run('window-then-filter', ranked, [], top);
    const shipped = employees.map(e=>({employee_id:e.employee_id,
      shipped:orders.filter(o=>o.employee_id===e.employee_id&&o.shipped_date!==null).length,
      unshipped:orders.filter(o=>o.employee_id===e.employee_id&&o.shipped_date===null).length})).sort((a,b)=>a.employee_id-b.employee_id);
    await run('employee-shipping', shipping, [], shipped, rows=>assert.deepEqual(rows.map(r=>({...r,shipped:Number(r.shipped),unshipped:Number(r.unshipped)})),shipped));
    // These are compile-only coverage markers; execution alone would not establish money semantics.
    for (const [name, source] of [['freight-ratio',freight],['country-percentile',percentile]]) {
      const f: Finding={backend,name,source,status:'compiled-not-executed'}; findings.push(f);
      try { f.sql=compile(source,backend); } catch(e) {f.status='compile-rejected';f.error=safeError(e);}
    }
    // Unique private fixture: no writes to Northwind and no shared DuckDB file.
    await sql`create table ${sql.id(fixture)} (id integer, amount decimal(38,10))`.execute(db); created=true;
    await sql`insert into ${sql.id(fixture)} values (1, null), (2, null), (3, cast(${'9007199254740993.0000000000'} as decimal(38,10))), (4, cast(${'9007199254740993.0000000100'} as decimal(38,10)))`.execute(db);
    await run('sum-all-null', `from ${fixture} | filter id <= 2 | aggregate {total = sum amount}`, [], [{total:null}]);
    await run('sum-empty', `from ${fixture} | filter id < 0 | aggregate {total = sum amount}`, [], [{total:null}]);
    await run('count-null-column', `from ${fixture} | filter id <= 2 | aggregate {n = count amount}`, [], 'SQL/Golden COUNT(column) excludes NULL', rows=>assert.equal(String(rows[0].n),'0'));
    await run('exact-decimal-divide-one', `from ${fixture} | filter id == 3 | select {value = amount / 1}`, [], '9007199254740993.0000000000', rows=>assert.equal(decimalText(rows[0].value),decimalText('9007199254740993.0000000000')));
    await run('exact-decimal-interpolation', `from ${fixture} | filter id >= 3 | aggregate {lo = min amount, hi = max amount} | select {p75 = lo + (hi - lo) * 0.75}`, [], '9007199254740993.0000000075', rows=>assert.equal(decimalText(rows[0].p75),decimalText('9007199254740993.0000000075')));
    // Independent SQL controls bypass both Golden and PRQL compilers.
    const controls = [
      ['sql-null-aggregates', sql<Row>`select sum(amount) as total, count(amount) as n from ${sql.id(fixture)} where id <= 2`,
        (rows: Row[])=>{assert.equal(rows[0].total,null); assert.equal(String(rows[0].n),'0');}],
      ['sql-decimal-division', sql<Row>`select amount / 1 as value from ${sql.id(fixture)} where id = 3`,
        (rows: Row[])=>assert.equal(decimalText(rows[0].value),decimalText('9007199254740993.0000000000'))],
    ] as const;
    for(const [name, expression, verify] of controls) {
      const q=expression.compile(db);
      const f: Finding={backend,name,source:'Independent SQL control (no PRQL or Golden compiler)',sql:q.sql,status:'untested'};
      findings.push(f);
      f.rows=(await db.executeQuery<Row>(q)).rows;
      try {verify(f.rows); f.status='pass';} catch {f.status='contract-mismatch';}
    }
    if(backend==='mysql') {
      // Native prepared execution also fails for $1: rules out Kysely placeholder rewriting.
      const native=await createConnection(process.env.MYSQL_URL??'mysql://northwind:northwind@127.0.0.1:3306/northwind');
      try {
        for(const placeholder of ['$1','?']) {
          const f: Finding={backend,name:`native-mysql-parameter:${placeholder}`,source:'Direct mysql2.execute; Kysely bypassed',sql:`select ${placeholder} as value`,status:'untested'};findings.push(f);
          try { const [rows]=await native.execute(f.sql!, ['bound-value']); f.rows=rows as Row[];assert.equal(f.rows[0].value,'bound-value');f.status='pass'; }
          catch(e) {f.status='execution-rejected';f.error=safeError(e);}
        }
      } finally {await native.end();}
    }
  } catch(e) { findings.push({backend,name:'setup-or-cleanup',source:'',status:'infrastructure-failure',error:safeError(e)}); }
  finally {
    try { if(created) await sql`drop table ${sql.id(fixture)}`.execute(db); }
    finally { await db.destroy(); }
  }
}
const report={node:process.version,prql:require('prqlc/package.json').version,findings:findings.map(f=>({...f,
  rows:f.rows?.slice(0,3), rowCount:f.rows?.length,
  expected:Array.isArray(f.expected)?f.expected.slice(0,3):f.expected,
  expectedRowCount:Array.isArray(f.expected)?f.expected.length:undefined,
}))};
writeFileSync(new URL('./results.json',import.meta.url), JSON.stringify(report,null,2)+'\n');
for(const f of findings) console.log(`${f.backend.padEnd(8)} ${f.status.padEnd(23)} ${f.name}`);
if(findings.some(f=>f.status==='infrastructure-failure')) process.exitCode=1;
