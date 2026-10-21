. (Join-Path $PSScriptRoot 'diagram-base.ps1')
$s=Slide 'Substrait in Golden' 'Substrait is a standardized representation of relational plans. Golden uses a constrained profile with Golden function extensions. The diagram is a readable logical outline, not literal protobuf JSON: the filter contains field references, typed literals and function references; the aggregate counts rows and the root names the result. The API constructs the plan without reading data. Golden validates supported relations/functions and lowers the plan through Kysely to backend SQL and parameters. The remote database chooses its physical execution plan. This boundary separates the application frontend from SQL construction. A future semantic frontend could produce the supported profile, but external-engine interoperability and federation are not implemented. Retaining this boundary costs compiler implementation and conformance tests; Kysely alone would be simpler for SQL-only requirements. Sources: docs/ARCHITECTURE.md, src/api.ts, src/plan.ts, src/relational.ts, src/queries.ts.'
[void](Text $s 48 112 864 55 'A shared relational plan between our typed API and SQL compiler' 25 $green $true)
[void](Text $s 48 188 400 35 'London customer count' 24 $navy $true)
$outline=@'
Typed Table / Expr API
          |
Substrait logical outline
  Read customers
  Filter lower(city) = lower('london')
  Aggregate count()
          |
Golden lowering + Kysely
          |
Backend SQL + bound parameters
'@
$q=Text $s 48 235 465 245 $outline 19
$q.TextFrame.TextRange.Font.Name='Consolas'
[void](Text $s 555 188 357 35 'What the plan preserves' 24 $green $true)
[void](Text $s 555 236 357 90 'Operator order, field references, typed literals and function references' 23)
[void](Text $s 555 340 357 35 'What Golden still owns' 24 $green $true)
[void](Text $s 555 386 357 95 'Supported-profile validation, SQL lowering and cross-backend correctness tests' 23)
$out=Join-Path $root 'output/Golden-Substrait-Explained.pptx'
$deck.SaveAs($out,24)
$renders=Join-Path $root '.build/substrait-slide-renders'
New-Item -ItemType Directory -Force -Path $renders | Out-Null
$deck.Export($renders,'PNG',1600,900)
foreach($q in $s.Shapes){if($q.HasTextFrame -eq -1 -and $q.TextFrame.HasText -eq -1){if($q.TextFrame.TextRange.BoundHeight -gt ($q.Height+3)){Write-Warning 'Text exceeds allocated height'}}}
$deck.Close()
Write-Output $out
