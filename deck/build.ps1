$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot -Parent
function Color($hex){$n=[Convert]::ToInt32($hex,16);return (($n -shr 16) -band 255)+($n -band 65280)+(($n -band 255) -shl 16)}
$navy=Color '142735';$green=Color '087F6B';$muted=Color '526471';$white=Color 'FFFFFF'
$app=New-Object -ComObject PowerPoint.Application
$deck=$app.Presentations.Add()
$deck.PageSetup.SlideWidth=960;$deck.PageSetup.SlideHeight=540
function Text($s,$x,$y,$w,$h,$value,$size=23,$color=$navy,$bold=$false){
 $q=$s.Shapes.AddTextbox(1,$x,$y,$w,$h);$q.TextFrame.MarginLeft=0;$q.TextFrame.MarginRight=0;$q.TextFrame.MarginTop=0;$q.TextFrame.MarginBottom=0
 $q.TextFrame.WordWrap=-1;$q.TextFrame.TextRange.Text=$value;$q.TextFrame.TextRange.Font.Name='Aptos';$q.TextFrame.TextRange.Font.Size=$size;$q.TextFrame.TextRange.Font.Color.RGB=$color;$q.TextFrame.TextRange.Font.Bold=[int]$bold * -1
 return $q
}
function Slide($title,$notes){
 $s=$deck.Slides.Add($deck.Slides.Count+1,12);$s.Background.Fill.ForeColor.RGB=$white
 [void](Text $s 48 35 864 85 $title 34 $navy $true)
 [void](Text $s 48 509 820 18 'Po-wei Huang / Golden query prototype / October 2026' 11 $muted)
 [void](Text $s 900 509 30 18 "$($s.SlideIndex)" 11 $muted)
 $s.NotesPage.Shapes.Placeholders.Item(2).TextFrame.TextRange.Text=$notes;return $s
}
function Pair($s,$y,$label,$body){[void](Text $s 48 $y 245 64 $label 24 $green $true);[void](Text $s 325 $y 580 90 $body 23)}
function Table($s,$rows,$y=140,$height=290){
 $t=$s.Shapes.AddTable($rows.Count,$rows[0].Count,48,$y,864,$height).Table
 for($r=1;$r -le $rows.Count;$r++){for($c=1;$c -le $rows[0].Count;$c++){
 $q=$t.Cell($r,$c).Shape;$q.TextFrame.TextRange.Text=$rows[$r-1][$c-1];$q.TextFrame.TextRange.Font.Name='Aptos';$q.TextFrame.TextRange.Font.Size=20
 $q.TextFrame.TextRange.Font.Color.RGB=$(if($r -eq 1){$white}else{$navy});$q.Fill.ForeColor.RGB=$(if($r -eq 1){$green}else{Color 'F2F6F5'})
 }}
}
$s=Slide 'A query layer for evolving dashboards' 'Opening: Claude already built a useful dashboard and concise BigQuery SQL. My proposed contribution is to make analytical behavior reusable and testable as users change filters and views. This is a product hypothesis, not a claim that Golden is already better overall. Evidence: downloaded northwind-dashboard-handoff/handoff/queries.sql; Golden PR64 d5c5cad and PR65 436e5fd.'
[void](Text $s 48 165 850 125 'My opportunity: reliable changes to analytical queries' 42 $navy $true)
[void](Text $s 48 335 840 100 'Claude creates the dashboard experience. Golden can provide reusable query definitions and verified execution.' 27 $muted)

$s=Slide 'What Claude already does well' 'The exported dashboard has nine datasets, optional date/country inputs, product/category charts and native BigQuery SQL. Fixed SQL can already use parameters without another LLM call. We should not claim that Claude must regenerate SQL whenever a filter changes. The opportunity is broader structural changes and consistent contracts across datasets and backends. Source: downloaded queries.sql, SHA256 47EA9532CC94CE3CDECEA912483062871FE8545D037C05F6C56778302A8CB0C0.'
Pair $s 145 'Observed strengths' 'Nine datasets, shared filter patterns and concise native BigQuery queries.'
Pair $s 260 'My proposed addition' 'Reusable analytical definitions, explicit filter scope and tests for structural changes.'
[void](Text $s 48 400 864 65 'A fixed dashboard may already work well with parameterized SQL.' 26 $green $true)

$s=Slide 'One filter, different dataset behavior' 'Explain the actual export behavior: by_country and p75_country deliberately ignore the selected country but use date filters. KPI, monthly and top-customer datasets use country and date. Proposed Golden orchestration would store these policies explicitly and compose queries, rather than rely on duplicated query text. This orchestration is not implemented. Source: downloaded queries.sql datasets 1-4 and 8.'
Table $s @(@('Dataset','Date selection','Country selection'),@('Revenue KPI','Apply','Apply'),@('Monthly revenue','Apply','Apply'),@('Country comparison','Apply','Ignore'),@('Country P75','Apply','Ignore')) 135 280
[void](Text $s 48 445 864 45 'The semantic layer decides scope. The query layer preserves it.' 24 $green $true)

$s=Slide 'Reusable query definitions' 'Proposed reuse: define pricedOrders once with exactly one row per order, including customer, date and discounted merchandise value. Different queries reuse the definition, then apply their own filters and grouping. This does not imply one database scan, caching, or federation. Existing Golden has Table/Expr composition; full date/month dashboard coverage is pending. Sources: src/queries.ts, docs/DASHBOARD-QUERY-COVERAGE.md in PR65.'
Pair $s 135 'Common relation' 'pricedOrders: one row per order, with order value and customer identity.'
Pair $s 250 'Different views' 'Group by month, rank customers, or calculate country P75 from the same definition.'
Pair $s 365 'Controlled changes' 'Filter before Top 10 for the top customers in Germany. Filter after Top 10 for German customers in the global top ten.'

$s=Slide 'Responsibilities across the stack' 'Semantic definitions resolve customer versus shipping country, revenue grain, join relationships and filter scope. The relational IR represents the chosen operations but does not decide business intent. The compiler implements backend-specific lowering. This capability is not exclusive to Substrait. Its standardized wire representation is an additional potential benefit, but external engine interoperability is unproven here. Sources: docs/ARCHITECTURE.md; PR64 capabilities.ts and relational.ts.'
Table $s @(@('Layer','Responsibility'),@('LLM and semantic model','Choose metrics, dimensions and filter scope'),@('Typed API and relational IR','Represent and validate query composition'),@('Compiler and capabilities','Choose native SQL or a supported rewrite'),@('Database and visual service','Execute queries and render the results')) 140 290
[void](Text $s 48 450 864 35 'Current IR: constrained Substrait. Full semantic modeling remains proposed.' 20 $muted)

$s=Slide 'Verification beyond executable SQL' 'Hand-calculated fixture now exists in test/bigquery-integration.test.ts at d5c5cad. One order has freight 10 and three lines of value 100. Correct ratio is 10/300 = 0.0333333333. Joining details and summing freight produces 30/300 = 0.1. Both SQL statements execute. Independent fixtures catch this semantic error. Testing one production dataset or asking a second LLM is insufficient by itself.'
[void](Text $s 48 140 864 65 'One order. Freight $10. Three lines worth $100 each.' 27 $navy $true)
Table $s @(@('Calculation','Freight ratio'),@('Correct order-level freight: 10 / 300','3.33%'),@('Repeated freight after join: 30 / 300','10.00%')) 225 175
[void](Text $s 48 435 864 55 'Both queries execute. A small counterexample distinguishes them.' 25 $green $true)

$s=Slide 'Float precision and display rounding' 'FLOAT64 uses binary floating-point approximations. The number 0.75 itself is exactly representable in binary, so do not say the fraction is inaccurate. In the inspected BigQuery query, its type promotes decimal percentile computation to FLOAT64. Some decimal inputs/intermediate results then become approximate. Observed USA P75: Golden exact 2477.5750000000; dashboard rounded output 2477.57. A typed NUMERIC fraction gave 2477.58. This difference matters according to the product precision contract. Decimal is bounded, and strict per-operation decimal(38,10) is a Golden choice, not a universal Substrait requirement. Sources: prior live read-only comparison in this session; docs/BIGQUERY.md.'
Pair $s 135 'FLOAT64' 'Approximate binary arithmetic. It cannot represent every decimal value exactly.'
Pair $s 250 'Observed P75' 'Exact: 2477.575. Two-decimal display differed: 2477.57 versus 2477.58.'
Pair $s 365 'Contract first' 'Choose precision for the use case. A one-cent difference alone does not justify an IR.'

$s=Slide 'SQL quality remains an engineering cost' 'Measured generated SQL character counts, not tokens or comparable end-to-end dashboard SQL. Changes at d5c5cad remove proven redundant integer and COALESCE decimal guards without relaxing the contract. P75 before this cleanup already used native percentile. Two uncached Northwind runs retained bytes scanned and comparable slot usage, but are not a speed benchmark. A shorter scalar-subquery attempt increased slot usage and was rejected. Source: docs/BIGQUERY.md in PR64 d5c5cad.'
Table $s @(@('Golden BigQuery SQL','Before cleanup','After cleanup'),@('Freight ratio','10,476 chars','7,366 chars'),@('Country P75','9,639 chars','6,885 chars')) 145 190
[void](Text $s 48 375 864 95 'Golden SQL is still verbose. Next: test named intermediate projections while preserving rounding, overflow and conditional behavior.' 25 $navy)

$s=Slide 'How I would demonstrate an advantage' 'Closing: I would compare both approaches on the same nine datasets, declared populations, filter changes and edge cases. Current evidence: typed composition, three existing backends and BigQuery in open PR64, capability-selected native percentile, independent fanout test. Proposed work: DATE predicates, month grouping, date min/max, catalog expansion, percentile plus count, explicit dataset filter policies. Success means fewer semantic regressions with acceptable query cost and iteration effort, not merely owning an IR. PR65 contains the coverage plan. No full dashboard portability or token savings has been demonstrated.'
Pair $s 140 'Already demonstrated' 'Typed composition, backend lowering and independent tests that catch join fanout.'
Pair $s 255 'Next experiment' 'Cover all nine datasets and test changes to country, date range and grouping.'
Pair $s 370 'Decision criteria' 'Correct results, predictable filter scope, acceptable execution cost and less maintenance.'

$s=Slide 'Appendix: the API has four operations' 'This is the existing recentOrdersQuery example, expanded for readability. source.table identifies a relation, select names output columns, orderBy establishes a deterministic order and limit chooses N rows. Equal dates use order_id as a tie-breaker. Calling this helper constructs a query; execution requires await client.execute(query). Object projection supports renaming and computed expressions. A future same-name select shorthand could improve ergonomics but is not implemented. Source: src/queries.ts and src/api.ts. No API redesign is needed to explain this example.'
[void](Text $s 48 135 864 310 "const orders = source.table('orders');`n`nreturn orders`n  .select({`n    order_id: orders.columns.order_id,`n    order_date: orders.columns.order_date`n  })`n  .orderBy(`n    { column: 'order_date', direction: 'desc' },`n    { column: 'order_id', direction: 'desc' }`n  )`n  .limit(n);" 19)
[void](Text $s 48 455 864 35 'Build a query now. Execute it later with await client.execute(query).' 22 $green $true)
$s=Slide 'Claude P75 SQL: the final aggregation' 'Exact final aggregation excerpt from downloaded queries.sql, dataset p75_country. The preceding ov/o CTEs calculate discounted order value, join customers and apply dates. They are omitted for readability. The export ignores the selected country on purpose. BigQuery inferred FLOAT64 for percentile_cont(NUMERIC value, 0.75) in our live probe. 0.75 itself is exactly representable; the issue is type promotion of the computation. A typed NUMERIC fraction gave the expected decimal tie rounding. Golden uses BIGNUMERIC for its larger decimal domain. This excerpt does not claim equal populations or result contracts between the full exported query and Golden.'
$code=@'
SELECT
  country,
  COUNT(*) AS orders,
  CAST(ROUND(ANY_VALUE(p75), 2) AS FLOAT64) AS p75_order_value
FROM (
  SELECT country,
    PERCENTILE_CONT(value, 0.75) OVER (PARTITION BY country) AS p75
  FROM o
)
GROUP BY country
ORDER BY p75_order_value DESC;
'@
$codeBox=Text $s 48 132 864 280 $code 18
$codeBox.TextFrame.TextRange.Font.Name='Consolas'
[void](Text $s 48 420 864 65 'o contains filtered orders and their value. For exact decimal P75, use a typed decimal fraction and keep the result decimal.' 22 $green $true)
$out=Join-Path $root 'output\Golden-Dashboard-Query-Layer-v3.pptx'
$deck.SaveAs($out,24)
$renders=Join-Path $root '.build\renders';New-Item -ItemType Directory -Force -Path $renders | Out-Null
$deck.Export($renders,'PNG',1600,900)
$warnings=@()
foreach($s in $deck.Slides){foreach($q in $s.Shapes){if($q.HasTextFrame -eq -1 -and $q.TextFrame.HasText -eq -1){if($q.TextFrame.TextRange.BoundHeight -gt ($q.Height+3)){$warnings+="Slide $($s.SlideIndex): text exceeds height"}}}}
$warnings | Set-Content (Join-Path $root '.build\layout-warnings.txt')
$deck.Close()
Write-Output "Created $out"
Write-Output "Layout warnings: $($warnings.Count)"

