import {readFileSync,writeFileSync} from 'node:fs';
import {sql} from 'kysely';
import assert from 'node:assert/strict';
import {connect} from '../src/backend.js';
import {compilePlan} from '../src/compiler.js';
import {freightQuery} from '../src/queries.js';
import {challengeCatalog} from '../src/challenge.js';
import {seedDuckDB} from '../src/duckdb-seed.js';
const baseline=JSON.parse(readFileSync('docs/evidence/sql-query-blocks/before.json','utf8')).observations.find((x:any)=>x.backend==='duckdb'&&x.name.includes('freight'));
const rounds:any[]=[];
for(let round=0;round<6;round++){
 const db=connect('duckdb',{duckdbPath:':memory:'}),pg=connect('postgres');
 try{await seedDuckDB(pg,db);await db.connection().execute(async c=>{
 if(round>=3) await sql`set threads=1`.execute(c);
 const compiled=compilePlan(c,freightQuery().toSubstrait(),challengeCatalog);
 assert.deepEqual(compiled.parameters,[0,0,1]); // baseline fixture uses the same literal ordering
 const queries=[{...compiled,sql:baseline.sql},compiled];
 const values=await Promise.all(queries.map(q=>c.executeQuery(q)));assert.deepEqual(values[0].rows,values[1].rows);
 const samples:number[][]=[[],[]];
 for(let i=0;i<26;i++)for(const j of (i+round)%2?[1,0]:[0,1]){const t=performance.now();await c.executeQuery(queries[j]);if(i>=5)samples[j].push(performance.now()-t);}
 const profiles=[];
 for(const q of queries)profiles.push((await c.executeQuery({...q,sql:'EXPLAIN (ANALYZE, FORMAT JSON) '+q.sql})).rows);
 const info=(await sql`select version() as version, current_setting('threads') as threads`.execute(c)).rows;
 const medians=samples.map(s=>[...s].sort((a,b)=>a-b)[10]);rounds.push({round,info,samples,medians,profiles});console.log({round,info,medians});
 });}finally{await db.destroy();await pg.destroy();}
}
writeFileSync('docs/evidence/sql-query-blocks/duckdb-freight-investigation.json',JSON.stringify({methodology:'Six independently seeded in-memory instances (three default threads, three single-thread); five warmup pairs then 21 measured AB/BA pairs; exact raw results equal; JSON analyzed profiles are observations, not test snapshots.',rounds},null,2)+'\n');
