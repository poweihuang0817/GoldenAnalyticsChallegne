. (Join-Path $PSScriptRoot 'diagram-base.ps1')
$s=Slide 'Substrait in our TypeScript API' 'Actual public methods from src/api.ts, src/queries.ts and src/client.ts. Imports and setup are abbreviated: createSource, count and literal come from src/api.ts; challengeCatalog comes from src/challenge.ts. On the right, client means createClient("postgres", challengeCatalog); await client.destroy() in a finally block when finished. query.toSubstrait() exports fresh profile-validated Substrait JSON using generated protobuf structures and our constrained profile. It does not return protobuf binary or execute SQL. Internally client.compile(query) calls compiler.compile(query.toSubstrait()); compilation runs in a worker and validates catalog/function semantics. client.execute(query) compiles and sends SQL plus separate parameters through the backend driver. The plan contains Read, Filter and Aggregate relations, typed literals, field references and function anchors. Golden extensions constrain the semantics supported here; arbitrary Substrait plans and external engine interoperability are not promised.'
[void](Text $s 48 116 864 45 'One query object, an inspectable plan, and backend SQL' 26 $green $true)
[void](Text $s 48 184 430 35 '1. Build the query' 25 $green $true)
$left=@'
const source = createSource(challengeCatalog);
const c = source.table('customers');

const query = c
  .filter(c.columns.city.lower()
    .eq(literal('london').lower()))
  .aggregate({ customer_count: count() });
'@
$q=Text $s 48 238 450 200 $left 17
$q.TextFrame.TextRange.Font.Name='Consolas'
[void](Text $s 535 184 377 35 '2. Inspect, compile, execute' 25 $green $true)
$right=@'
// Export Substrait JSON
const plan = query.toSubstrait();

// Compile for the client's backend
const { sql, parameters } =
  await client.compile(query);

const { rows } =
  await client.execute(query);
'@
$q=Text $s 535 238 377 215 $right 17
$q.TextFrame.TextRange.Font.Name='Consolas'
[void](Text $s 48 460 864 37 'compile() uses toSubstrait() internally. Exporting the plan is optional.' 22 $green $true)
$out=Join-Path $root 'output/Golden-Substrait-TypeScript.pptx'
$deck.SaveAs($out,24)
$renders=Join-Path $root '.build/substrait-typescript-renders'
New-Item -ItemType Directory -Force -Path $renders | Out-Null
$deck.Export($renders,'PNG',1600,900)
$deck.Close()
Write-Output $out
