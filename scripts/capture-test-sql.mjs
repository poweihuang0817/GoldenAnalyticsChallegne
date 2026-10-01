import {readFileSync, writeFileSync, mkdirSync, readdirSync, unlinkSync} from 'node:fs';
import {resolve} from 'node:path';
import {spawnSync, execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {format} from 'sql-formatter';

// Run only in a dedicated, idle worktree. Temporary instrumentation is restored
// in finally; it must never be committed. Forced process termination can bypass
// finally: a byte-for-byte backup is kept in the output directory.
const directory = resolve(process.argv[2] ?? `.sql-audit-all/run-${Date.now()}`);
mkdirSync(directory, {recursive:true});
const compiler = resolve('src/compiler.ts');
const original = readFileSync(compiler);
const lock = resolve('.sql-capture.lock');
writeFileSync(lock, 'Capture in progress; do not run other commands in this worktree.', {flag:'wx'});
writeFileSync(resolve(directory, 'compiler.ts.backup'), original);
const wrapper = `
import {appendFileSync as appendCapture} from 'node:fs';
export function compilePlan(...args: Parameters<typeof captureOriginalCompilePlan>) {
  const trace: LoweringDecision[] = args[3]?.trace ?? [];
  const start = trace.length;
  const origin = new Error().stack?.split('\\n').slice(2, 7);
  const record = (event: object) => appendCapture(process.env.GOLDEN_SQL_CAPTURE + '/' + process.pid + '.jsonl', JSON.stringify(event) + '\\n');
  try {
    const result = captureOriginalCompilePlan(args[0], args[1], args[2], {...args[3], trace});
    record({status:'compiled',backend:compilerBackend(args[0]),sql:result.sql,parameters:result.parameters,trace:trace.slice(start),origin});
    return result;
  } catch(error) {
    record({status:'rejected',errorType:error instanceof Error ? error.name : typeof error,origin});
    throw error;
  }
}
`;
const runs=[];
try {
  const source=original.toString('utf8');
  if(!source.includes('export function compilePlan(')) throw Error('Compiler entry point changed; update capture tool.');
  writeFileSync(compiler,source.replace('export function compilePlan(', 'function captureOriginalCompilePlan(')+wrapper);
  for(const name of ['test','test:integration','test:duckdb','docs:examples','demo']) {
    const child=spawnSync(process.platform==='win32'?'cmd.exe':'npm',process.platform==='win32'?['/d','/c',`npm run ${name}`]:['run',name],
      {encoding:'utf8',env:{...process.env,GOLDEN_SQL_CAPTURE:directory},maxBuffer:32*1024*1024});
    writeFileSync(resolve(directory,name.replaceAll(':','-')+'.log'),(child.stdout??'')+(child.stderr??''));
    runs.push({command:`npm run ${name}`,exitCode:child.status});
    console.log(runs.at(-1));
  }
} finally {writeFileSync(compiler,original);unlinkSync(lock);}
const events=readdirSync(directory).filter(n=>n.endsWith('.jsonl')).flatMap(n=>readFileSync(resolve(directory,n),'utf8').trim().split('\n').filter(Boolean).map(s=>JSON.parse(s)));
const unique=new Map();
for(const event of events.filter(e=>e.status==='compiled')) {
  const key=createHash('sha256').update(JSON.stringify([event.backend,event.sql,event.parameters,event.trace])).digest('hex').slice(0,16);
  if(!unique.has(key)) {
    let text=event.sql;
    try{text=format(text,{language:event.backend==='postgres'?'postgresql':event.backend,tabWidth:2});}catch{}
    const file=`${event.backend??'unknown'}-${key}.sql`;
    writeFileSync(resolve(directory,file),`-- Ordered fixture parameters: ${JSON.stringify(event.parameters)}\n`+event.trace.map(e=>'-- '+JSON.stringify(e)).join('\n')+'\n'+text+';\n');
    unique.set(key,{file,...event,occurrences:0,origins:[]});
  }
  const entry=unique.get(key);entry.occurrences++;entry.origins.push(event.origin);
}
const summary={revision:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),runs,totalCompilations:events.filter(e=>e.status==='compiled').length,uniqueOutputs:unique.size,rejections:events.filter(e=>e.status==='rejected').length,
  scope:'Observed compilePlan calls in runtime tests, docs compilation and default driver; not all possible queries, type-only negatives or raw reference SQL. Random fixture names remain unnormalized. Full local artifacts may include synthetic secret-test values; do not publish blindly.'};
writeFileSync(resolve(directory,'summary.json'),JSON.stringify(summary,null,2)+'\n');
writeFileSync(resolve(directory,'index.json'),JSON.stringify([...unique.values()],null,2)+'\n');
writeFileSync(resolve(directory,'INDEX.md'), '# Captured Golden SQL\n\nEach file includes ordered fixture parameters and lowering trace. See index.json for caller locations.\n\n'+[...unique.values()].map(e=>`- [${e.file}](${e.file}) — ${e.occurrences} compilation(s)`).join('\n')+'\n');
writeFileSync(resolve(directory,'rejected.json'),JSON.stringify(events.filter(e=>e.status==='rejected'),null,2)+'\n');
console.log(JSON.stringify({...summary,directory}));
if(runs.some(r=>r.exitCode!==0))process.exitCode=1;
