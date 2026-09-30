/** Opt-in research only. Fixed inline fixtures; no table writes or production imports of PRQL. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
import { CompiledQuery } from 'kysely';
import { connect, type Backend } from '../../src/backend.js';

const require = createRequire(import.meta.url);
const prql: typeof import('prqlc') = require('prqlc');
const findings: Record<string, unknown>[] = [];
function compile(source: string, backend: Backend) {
  const options = new prql.CompileOptions();
  options.target = `sql.${backend}`; options.signature_comment = false;
  return prql.compile(source, options)!;
}
const fixture = `from [
  {g="four", id=1, v=10}, {g="four", id=2, v=20},
  {g="four", id=3, v=30}, {g="four", id=4, v=40},
  {g="single", id=5, v=7}, {g="ties", id=6, v=4},
  {g="ties", id=7, v=4}, {g="ties", id=8, v=8},
  {g="nulls", id=9, v=null}, {g="nulls", id=10, v=null},
  {g="mixed", id=11, v=null}, {g="mixed", id=12, v=10},
  {g="mixed", id=13, v=20}
]`;
// Count non-null values explicitly: PRQL count(column) counts all rows.
const percentile = `${fixture}
derive {missing = v == null, valid = case [v == null => 0, true => 1]}
group g (
  window rows:.. (derive {n = sum valid})
  sort {missing, v, id}
  derive {r = row_number this}
)
derive {h = 1 + 0.75 * (n - 1)}
derive {lo = math.floor h, hi = math.ceil h, fraction = h - math.floor h}
filter r == lo || r == hi
group g (aggregate {low = min v, high = max v, fraction = max fraction, n = max n})
derive {p75 = case [n == 0 => null, true => low + (high-low)*fraction]}
select {g, p75}
sort g`;

const expected = [
  {g:'four',p75:32.5}, {g:'mixed',p75:17.5}, {g:'nulls',p75:null},
  {g:'single',p75:7}, {g:'ties',p75:6},
];
for (const backend of ['postgres','mysql','duckdb'] as const) {
  const db = connect(backend, {duckdbPath:':memory:'});
  try {
    for (const [name, source, wanted] of [
      ['percentile-inline-groups', percentile, expected],
      ['percentile-empty-grouped', percentile.replace('derive {missing', 'filter id < 0\nderive {missing'), []],
    ] as const) {
      const finding: Record<string, unknown> = {backend,name,source,expected:wanted};
      findings.push(finding);
      try { finding.sql = compile(source,backend); }
      catch (error) { finding.status='compile-rejected'; finding.error=String(error); continue; }
      try {
        const rows = (await db.executeQuery<{g:string;p75:unknown}>(CompiledQuery.raw(finding.sql as string))).rows;
        finding.rows=rows;
        // Only bounded fixture values: this is NOT an exact decimal oracle.
        assert.deepEqual(rows.map(row=>({g:row.g,p75:row.p75 === null ? null : Number(row.p75)})),wanted);
        finding.status='pass';
      } catch(error) { finding.status='execution-or-assertion-failed'; finding.error=String(error); }
    }
  } finally { await db.destroy(); }
}
// Compilation without a catalog does not establish that a column exists.
for (const [source,expectedStatus] of [
  ['from orders | select definitely_missing_column','compiled'],
  ['from [{x=1}] | select definitely_missing_column','compile-rejected'],
] as const) {
  const finding: Record<string,unknown>={name:'schema-resolution',source,expectedStatus}; findings.push(finding);
  try {finding.sql=compile(source,'postgres');finding.status='compiled';}
  catch(error){finding.status='compile-rejected';finding.error=String(error);}
  assert.equal(finding.status,expectedStatus);
}
const source='prql target:sql.mysql\nfrom orders | filter order_id == $2 || order_id == $1 | select order_id';
const pl=prql.prql_to_pl(source)!;
const rq=prql.pl_to_rq(pl)!;
const roundtripSql=prql.rq_to_sql(rq)!;
assert.ok(roundtripSql.includes('$2') && roundtripSql.includes('$1'));
findings.push({name:'intermediate-roundtrip',source,pl:JSON.parse(pl),rq:JSON.parse(rq),sql:roundtripSql});
writeFileSync(new URL('./followup-results.json',import.meta.url),JSON.stringify({node:process.version,prql:require('prqlc/package.json').version,findings},null,2)+'\n');
for (const finding of findings) console.log(finding.backend??'',finding.name,finding.status??'recorded');
if(findings.some(f=>f.status==='execution-or-assertion-failed'||f.status==='compile-rejected'&&String(f.name).startsWith('percentile')))process.exitCode=1;
