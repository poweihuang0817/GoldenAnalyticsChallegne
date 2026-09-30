/** Source-generation experiment only, not an application API or a new serialized IR. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
import { CompiledQuery, sql } from 'kysely';
import { connect } from '../../src/backend.js';
import { seedDuckDB } from '../../src/duckdb-seed.js';

const require = createRequire(import.meta.url);
const prql: typeof import('prqlc') = require('prqlc');
type Kind = 'text' | 'i32';
type Schema = Record<string, Kind>;
type Value<K extends Kind> = K extends 'text' ? string : number;
// Intentionally narrow, fail-closed identifier subset; no quoting implementation claimed.
function identifier(value: string) {
  if (!/^[a-z][a-z0-9_]*$/.test(value) || ['this','that','from','select','filter','group'].includes(value)) {
    throw new Error('Unsupported identifier');
  }
  return value;
}
class Predicate {
  constructor(readonly owner: symbol, readonly render: (values: unknown[]) => string) {}
}
class Column<T> {
  declare private invariant: (value: T) => T;
  constructor(readonly owner: symbol, readonly name: string, readonly kind: Kind) {}
  eq(value: NoInfer<T>) {
    if (this.kind === 'text' ? typeof value !== 'string' : typeof value !== 'number' || !Number.isInteger(value) || value < -2147483648 || value > 2147483647) {
      throw new Error('Invalid literal');
    }
    return new Predicate(this.owner, values => { values.push(value); return `${this.name} == $${values.length}`; });
  }
}
type Columns<S extends Schema> = {[K in keyof S]: Column<Value<S[K]>>};
type Projection = Record<string, Column<any>>;
type Output<P extends Projection> = {[K in keyof P]: P[K] extends Column<infer T> ? T : never};
class Query<R> {
  declare readonly rowType: R; // Static expectation only, not a runtime decoder.
  constructor(readonly source: string, readonly parameters: readonly unknown[]) {}
}
function table<const S extends Schema>(name: string, schema: S) {
  identifier(name);
  const owner=Symbol(name);
  const cols=Object.fromEntries(Object.entries(schema).map(([key,kind])=>[key,new Column(owner,identifier(key),kind)])) as Columns<S>;
  function build(predicates: readonly Predicate[]) {
    return {
      cols,
      filter(predicate: Predicate) {
        if (!(predicate instanceof Predicate) || predicate.owner !== owner) throw new Error('Wrong relation scope');
        return build([...predicates,predicate]);
      },
      select<const P extends Projection>(projection: P): Query<Output<P>> {
        const fields=Object.entries(projection).map(([alias,column])=>{
          identifier(alias);
          if (!(column instanceof Column) || column.owner !== owner) throw new Error('Wrong relation scope');
          return `${alias} = ${column.name}`;
        });
        if (!fields.length) throw new Error('Empty projection');
        const parameters: unknown[]=[];
        const filters=predicates.map(p=>`filter ${p.render(parameters)}`);
        return new Query([`from ${name}`,...filters,`select {${fields.join(', ')}}`].join('\n'),parameters);
      },
    };
  }
  return build([]);
}
const customers=table('customers',{customer_id:'text',city:'text'});
const orders=table('orders',{order_id:'i32'});
function typeAssertions() {
  // @ts-expect-error unknown schema column
  customers.cols.missing;
  // @ts-expect-error literal must match the column's type
  customers.cols.city.eq(123);
  // @ts-expect-error integer column cannot compare with text
  orders.cols.order_id.eq('1');
  const projected=customers.select({id:customers.cols.customer_id});
  const id: string=projected.rowType.id;
  // @ts-expect-error projection removes city from inferred result
  projected.rowType.city;
  // @ts-expect-error projected string is not number
  const wrong: number=projected.rowType.id;
  void id; void wrong;
}
void typeAssertions; // Typechecked, never executed; rowType is not a returned row.
assert.throws(()=>customers.filter(orders.cols.order_id.eq(1)),/scope/);
assert.throws(()=>customers.select({id:orders.cols.order_id}),/scope/);
assert.throws(()=>table('customers; drop table orders',{}),/identifier/);
assert.throws(()=>customers.select({'bad alias':customers.cols.city}),/identifier/);
assert.throws(()=>customers.cols.city.eq(1 as never),/literal/);
const findings: Record<string,unknown>[]=[];
for (const backend of ['postgres','mysql','duckdb'] as const) {
  const db=connect(backend,{duckdbPath:':memory:'});
  try {
    if(backend==='duckdb') {
      const pg=connect('postgres');
      try {await seedDuckDB(pg,db);} finally {await pg.destroy();}
    }
    for(const city of ['London',"London' OR 1=1 --"]) {
      const query=customers.filter(customers.cols.city.eq(city)).select({id:customers.cols.customer_id});
      assert.ok(!query.source.includes(city));
      assert.deepEqual(query.parameters,[city]);
      const options=new prql.CompileOptions();options.target=`sql.${backend}`;options.signature_comment=false;
      const generated=prql.compile(query.source,options)!;
      const record: Record<string,unknown>={backend,city,source:query.source,parameters:query.parameters,sql:generated};findings.push(record);
      // Independent fixed SQL with driver binding, not generated from this frontend.
      const reference=await sql<{id:string}>`select customer_id as id from customers where city = ${city}`.execute(db);
      record.expected=reference.rows.map(r=>r.id).sort();
      try {
        const result=await db.executeQuery<{id:string}>(CompiledQuery.raw(generated,[...query.parameters]));
        record.rows=result.rows.map(r=>r.id).sort();
        assert.deepEqual(record.rows,record.expected);
        record.status='pass';
        assert.notEqual(backend,'mysql','Reassess the previously observed binding limitation');
      } catch(error) {
        if(backend!=='mysql')throw error;
        // Require the known missing-placeholder error, not any arbitrary execution failure.
        assert.equal((error as {code?:string}).code,'ER_BAD_FIELD_ERROR');
        assert.match(String(error),/\$1/);
        record.status='known-binding-rejection';record.error=String(error);
      }
    }
  } finally {await db.destroy();}
}
writeFileSync(new URL('./typed-source-results.json',import.meta.url),JSON.stringify({node:process.version,prql:require('prqlc/package.json').version,findings},null,2)+'\n');
for(const f of findings)console.log(f.backend,f.status);
