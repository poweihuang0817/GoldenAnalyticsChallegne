. (Join-Path $PSScriptRoot 'diagram-base.ps1')
function Node($s,$x,$y,$w,$h,$label){
 $q=$s.Shapes.AddShape(1,$x,$y,$w,$h);$q.Fill.ForeColor.RGB=Color 'EDF4F2';$q.Line.ForeColor.RGB=$green
 $q.TextFrame.MarginLeft=10;$q.TextFrame.MarginRight=10;$q.TextFrame.VerticalAnchor=3
 $q.TextFrame.TextRange.Text=$label;$q.TextFrame.TextRange.Font.Name='Aptos';$q.TextFrame.TextRange.Font.Size=20;$q.TextFrame.TextRange.Font.Color.RGB=$navy;$q.TextFrame.TextRange.ParagraphFormat.Alignment=2
}
function Arrow($s,$x1,$y1,$x2,$y2){$q=$s.Shapes.AddLine($x1,$y1,$x2,$y2);$q.Line.ForeColor.RGB=$green;$q.Line.Weight=2;$q.Line.EndArrowheadStyle=3}
function Code($s,$x,$y,$w,$h,$str,$size=19){$q=Text $s $x $y $w $h $str $size;$q.TextFrame.TextRange.Font.Name='Consolas'}

$s=Slide '1. The result: SQL and bound parameters' 'Bottom-up walkthrough: begin at the database boundary. The running example counts customers whose city matches London after lowercasing. This SQL is the PostgreSQL city-query snapshot. $1 is a placeholder, not the literal 1. The driver sends SQL and [london] separately. COUNT returns an i64 logical result and Golden casts it to text to preserve its result representation without unsafe JS-number conversion. The observed Northwind result is customer_count string 6. Matching is lower-based, not a universal locale-independent case-folding promise. Source: src/queries.ts cityQuery, PostgreSQL SQL snapshot and previous provided-database tests. The physical database chooses its execution plan.'
[void](Text $s 48 125 860 45 'Example: count customers in London' 27 $green $true)
$sql=@'
SELECT CAST(COUNT(*) AS text) AS customer_count
FROM customers
WHERE LOWER(customers.city) = LOWER(CAST($1 AS text));
'@
Code $s 48 195 864 115 $sql 21
Node $s 48 345 250 65 "Parameters`n['london']"
Node $s 355 345 250 65 'PostgreSQL executes'
Node $s 662 345 250 65 "Result`ncustomer_count: '6'"
Arrow $s 298 377 355 377;Arrow $s 605 377 662 377
[void](Text $s 48 455 864 35 'Values stay separate from SQL. The database owns physical execution.' 22 $green $true)

$s=Slide '2. Golden lowers the plan; Kysely builds SQL' 'SQL lowering maps relational operations to legal SQL clauses and query-block boundaries. Golden decides whether an operation can merge into a block or needs a subquery, implements semantic casts and capability rewrites, then uses Kysely to construct/compile SQL. Kysely also offers a typed SQL-shaped public builder (selectFrom/select/where). Golden does not expose that builder as its public API. Its analytical compiler predominantly uses Kysely structured sql templates and reference/value builders. sql.val values become parameters; identifiers use sql.ref/sql.id. Kysely does not automatically translate Substrait or prove relational semantics. Source: src/relational.ts compileAnalytics, src/compiler.ts compilePlanSync.'
Node $s 48 145 250 75 "Relational operations`nRead / Filter / Aggregate"
Node $s 355 145 250 75 "Golden lowering`nFROM / WHERE / SELECT"
Node $s 662 145 250 75 "Kysely dialect`nSQL + parameters"
Arrow $s 298 182 355 182;Arrow $s 605 182 662 182
[void](Text $s 48 260 410 42 'Kysely API building blocks' 25 $green $true)
Code $s 48 315 420 120 "sql.ref('customers.city')`nsql.val('london')`nsql``count(*)``" 22
[void](Text $s 520 270 392 150 "Golden decides query structure.`n`nKysely renders identifiers, expressions and placeholders." 25)
[void](Text $s 48 455 864 35 'Nested aggregates and window filters may require separate SQL blocks.' 22 $green $true)

$s=Slide '3. Substrait carries the relational intent' 'This is a readable logical outline, not literal protobuf JSON. Read yields customer columns with catalog types; Filter contains equal(lower(field reference),lower(string literal)). Aggregate has no group keys and counts rows. The actual Golden count() currently uses a non-null constant aggregate argument that lowering simplifies to COUNT(*). A root gives the output name customer_count. The constrained profile uses standard relation structures plus Golden function extensions; it rejects unsupported inputs. Substrait is not a semantic model, SQL generator or execution engine. Its value is a validated serialized boundary independent of backend SQL. External engine interoperability is not demonstrated. Sources: src/api.ts, src/plan.ts, src/functions.ts, docs/ARCHITECTURE.md.'
Node $s 48 150 420 65 'Read customers'
Node $s 48 255 420 65 'Filter lower(city) = lower(london)'
Node $s 48 360 420 65 'Aggregate count as customer_count'
Arrow $s 258 215 258 255;Arrow $s 258 320 258 360
[void](Text $s 530 150 380 65 'A constrained relational contract' 26 $green $true)
[void](Text $s 530 240 380 180 "Field references and typed literals`n`nExplicit operator order`n`nSupported functions and validation" 23)
[void](Text $s 48 455 864 35 'Same intent can target different backends. Golden still owns the compiler.' 22 $green $true)

$s=Slide '4. Our typed API builds and validates the query' 'Top-down return to the same example. source derives typed columns from an authored catalog, such as city:string nullable and customer_id:string required. Our TypeScript Expr interface constrains lower(this: Expr<string,N>), and Table.filter requires Expr<bool>. An orders order_id i32 expression cannot call lower in checked TS. Column names are keys of the inferred row type. Projection and aggregation replace the output schema. Runtime checks also reject bad kinds, unknown fields, stale relation scopes and unsupported plans because TS disappears at runtime. query construction is lazy. await client.compile(query) previews SQL via the worker; await client.execute(query) compiles and executes. These are our library constraints implemented using TypeScript, not automatic protections supplied by Substrait or Kysely. Source: src/api.ts Expr/Table/RuntimeExpr, src/client.ts and src/queries.ts cityQuery. Imports/source initialization omitted for slide readability.'
$code=@'
const c = source.table('customers');
const query = c
  .filter(c.columns.city.lower()
    .eq(literal('london').lower()))
  .aggregate({ customer_count: count() });

const result = await client.execute(query);
'@
Code $s 48 140 545 230 $code 18
[void](Text $s 620 140 292 50 'Our constraints' 25 $green $true)
[void](Text $s 620 205 292 165 "lower(): string only`nfilter(): boolean only`nKnown column names`nRuntime scope checks" 22)
Node $s 48 395 175 65 'Typed API'
Node $s 265 395 175 65 'Substrait'
Node $s 482 395 215 65 "Golden lowering`nand Kysely"
Node $s 739 395 175 65 'Bound SQL'
Arrow $s 223 427 265 427;Arrow $s 440 427 482 427;Arrow $s 697 427 739 427

if($deck.Slides.Count -ne 4){throw 'Expected exactly four slides'}
$out=Join-Path $root 'output\Golden-API-to-SQL-Four-Slides.pptx'
$deck.SaveAs($out,24)
$renders=Join-Path $root '.build\four-slide-renders';New-Item -ItemType Directory -Force -Path $renders | Out-Null
$deck.Export($renders,'PNG',1600,900)
$warnings=@()
foreach($s in $deck.Slides){foreach($q in $s.Shapes){if($q.HasTextFrame -eq -1 -and $q.TextFrame.HasText -eq -1){if($q.TextFrame.TextRange.BoundHeight -gt ($q.Height+3)){$warnings+="Slide $($s.SlideIndex): text exceeds height"}}}}
$warnings | Set-Content (Join-Path $root '.build\four-slide-layout-warnings.txt')
$deck.Close()
Write-Output "Created $out"
Write-Output "Layout warnings: $($warnings.Count)"
