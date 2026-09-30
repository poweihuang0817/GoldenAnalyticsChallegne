import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {writeFileSync} from 'node:fs';
import {sql} from 'kysely';
import {connect} from '../../src/backend.js';
import {seedDuckDB} from '../../src/duckdb-seed.js';
import {compilePlan} from '../../src/compiler.js';
import {challengeCatalog} from '../../src/challenge.js';
import {queryExamples} from '../../src/queries.js';
import {calculate,scaled,type Data,type Row} from './oracle.js';

const evidence: Record<string,unknown>[]=[];
let reference: ReturnType<typeof calculate> | undefined;
const normalizedMoney=(rows:Row[],field:string)=>rows.map(r=>({...r,[field]:r[field]===null?null:scaled(r[field],10).toString()}));
for(const backend of ['postgres','mysql','duckdb'] as const){
  const db=connect(backend,{duckdbPath:':memory:'});
  try {
    let seed: unknown;
    if(backend==='duckdb'){const pg=connect('postgres');try {seed=await seedDuckDB(pg,db);}finally{await pg.destroy();}}
    const data:Data={
      customers:(await sql<Row>`select customer_id, city, country from customers order by customer_id`.execute(db)).rows,
      orders:(await sql<Row>`select order_id, order_date, customer_id, employee_id, shipped_date, cast(freight as decimal(38,10)) as freight from orders order by order_id`.execute(db)).rows,
      details:(await sql<Row>`select order_id, cast(unit_price as decimal(38,10)) as unit_price, quantity, cast(discount as decimal(38,10)) as discount from order_details order by order_id, unit_price, quantity, discount`.execute(db)).rows,
      employees:(await sql<Row>`select employee_id from employees order by employee_id`.execute(db)).rows,
    };
    const results=calculate(data), baseline=results.money['net/allOrders'] as any;
    if(reference)assert.deepEqual(results,reference,`${backend}: all alternative reference results agree`);else reference=results;
    const api:Record<string,unknown>[]=[];
    for(const [i,example] of queryExamples.entries()){
      const compiled=compilePlan(db,example.query.toSubstrait(),challengeCatalog);
      const rows=(await db.executeQuery<Row>(compiled)).rows;
      if(i===0)assert.deepEqual(rows.map(r=>r.order_id),results.recent.exactN);
      else if(i===1||i===2){const city=i===1?'london':'mexico d.f.';assert.equal(String(rows[0].customer_count),String(results.cities.find(c=>c.city===city)!.caseInsensitive));}
      else if(i===3){const v=results.average.allOrders!;assert.ok(Math.abs(Number(rows[0].average_units)-Number(v.numerator)/Number(v.denominator))<1e-12);}
      else if(i===4)assert.deepEqual(rows.map(r=>({employee_id:r.employee_id,shipped:Number(r.shipped),unshipped:Number(r.unshipped)})),results.employees.all.map(({employee_id,shipped,unshipped})=>({employee_id,shipped,unshipped})));
      else if(i===5){const wanted=baseline.ratios.map((r:any)=>({customer_id:r.customer_id,freight_ratio:r.ratio?.decimal10??null}));assert.deepEqual(normalizedMoney(rows,'freight_ratio'),normalizedMoney(wanted,'freight_ratio'));}
      else if(i===6){const wanted=baseline.countries.map((r:any)=>({country:r.country,order_price_p75:r.continuous?.decimal10??null}));assert.deepEqual(normalizedMoney(rows,'order_price_p75'),normalizedMoney(wanted,'order_price_p75'));}
      api.push({name:example.name,status:'matches-independent-reference',rowCount:rows.length,sql:compiled.sql,parameterCount:compiled.parameters.length});
    }
    evidence.push({backend,seed,counts:results.counts,rawSnapshotSha256:createHash('sha256').update(JSON.stringify(data)).digest('hex'),referenceResultsSha256:createHash('sha256').update(JSON.stringify(results)).digest('hex'),api});
    console.log(`${backend}: all seven driver examples match; all variant references agree`);
  } finally {await db.destroy();}
}
writeFileSync(new URL('../../docs/semantic-results.json',import.meta.url),JSON.stringify({
  scope:'Raw-row reference calculations for named alternatives; only current baseline executed through Golden API. No claim of API support for every alternative.',
  sourceRevision:'5737fe26f5d398a9c25c91293a29274cdc578d5f',node:process.version,image:'goldenbeers/golden-query-challenge:1.0',
  numericPolicy:'Money exact rational arithmetic from cent prices/freight and hundredth discounts, checked without truncation; display rounded half away from zero to 10 places. Average API comparison tolerance 1e-12.',
  evidence,results:reference,
},null,2)+'\n');
