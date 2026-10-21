. (Join-Path $PSScriptRoot 'diagram-base.ps1')
function Node($s,$x,$y,$w,$h,$label,$dark=$false){
 $q=$s.Shapes.AddShape(1,$x,$y,$w,$h);$q.Fill.ForeColor.RGB=$(if($dark){$green}else{Color 'EDF4F2'});$q.Line.ForeColor.RGB=$green;$q.Line.Weight=1
 $q.TextFrame.MarginLeft=12;$q.TextFrame.MarginRight=12;$q.TextFrame.MarginTop=9;$q.TextFrame.MarginBottom=9;$q.TextFrame.VerticalAnchor=3
 $q.TextFrame.TextRange.Text=$label;$q.TextFrame.TextRange.Font.Name='Aptos';$q.TextFrame.TextRange.Font.Size=22;$q.TextFrame.TextRange.Font.Color.RGB=$(if($dark){$white}else{$navy});$q.TextFrame.TextRange.ParagraphFormat.Alignment=2
}
function Arrow($s,$x1,$y1,$x2,$y2){$l=$s.Shapes.AddLine($x1,$y1,$x2,$y2);$l.Line.ForeColor.RGB=$green;$l.Line.Weight=2;$l.Line.EndArrowheadStyle=3}
function Note($s,$value){[void](Text $s 48 445 864 50 $value 23 $green $true)}

$s=Slide 'Opportunities in SQL generation' 'Opening: Claude produced a useful dashboard with nine datasets and concise SQL. I would add a reusable query layer for evolving analysis. The opportunity spans semantic intent, safe composition, backend lowering and verification. Current Golden covers only part of this path. This diagram is a proposed product workflow, not a claim of a completed integration. Sources: exported Northwind dashboard queries; PR64 d5c5cad; PR65 coverage plan.'
[void](Text $s 48 130 850 55 'A proposed query layer beneath the dashboard' 26 $muted)
Node $s 48 235 190 90 "User intent`nMetrics and scope"
Node $s 273 235 190 90 "Query structure`nCompose changes"
Node $s 498 235 190 90 "Backend SQL`nChoose lowering"
Node $s 723 235 190 90 "Evidence`nTest and measure" $true
Arrow $s 238 280 273 280;Arrow $s 463 280 498 280;Arrow $s 688 280 723 280
Note $s 'Success means correct changes with acceptable execution cost.'

$s=Slide 'Reusable definitions with explicit filter scope' 'Proposed orchestration based on actual exported behavior. Country comparison and P75 ignore the selected country. KPI and customer rankings apply it. Date selection applies to both branches. A shared definition is not shared materialized execution: the database may still run separate scans. Golden has query composition but date predicates and full dashboard filter orchestration remain planned.'
Node $s 325 125 310 65 'pricedOrders: one row per order' $true
Node $s 325 220 310 60 'Apply selected dates'
Arrow $s 480 190 480 220
Arrow $s 390 280 225 330;Arrow $s 570 280 735 330
Node $s 65 330 320 75 "Keep all countries`nCountry comparison and P75"
Node $s 575 330 320 75 "Apply selected country`nKPI and Top customers"
Note $s 'The semantic layer decides which filters each dataset inherits.'

$s=Slide 'Operation order changes the answer' 'These two query structures have different meanings even though their operators are the same. First pipeline means top ten customers within Germany. Second means German customers within the worldwide top ten, potentially fewer than ten. Assume customer revenue has already been computed and top ten has deterministic ordering. An IR preserves order but does not infer which meaning the user intended. A SQL AST can also represent this.'
[void](Text $s 48 125 864 40 'Starting relation: revenue per customer' 25 $muted)
Node $s 48 205 230 65 'Filter Germany';Node $s 335 205 230 65 'Revenue Top 10';Node $s 622 205 290 65 'Top customers in Germany' $true
Arrow $s 278 237 335 237;Arrow $s 565 237 622 237
Node $s 48 325 230 65 'Revenue Top 10';Node $s 335 325 230 65 'Filter Germany';Node $s 622 325 290 65 'German customers in global Top 10' $true
Arrow $s 278 357 335 357;Arrow $s 565 357 622 357
Note $s 'Opportunity: test structural edits rather than rewrite SQL text blindly.'

$s=Slide 'Capability-driven SQL generation' 'Implemented in open PR64 f05c732 and retained in d5c5cad. BigQuery uses native percentile_cont with typed BIGNUMERIC fraction for exact decimal inputs, while MySQL uses portable rank/count interpolation. Native support is not sufficient alone: types, nulls, empty inputs and precision need tests. Unsupported operations fail explicitly. The capability model describes implemented compiler support. PostgreSQL currently retains rewrite too, so do not claim all native engines choose native.'
Node $s 280 130 400 65 'Logical operation: continuous percentile' $true
Node $s 325 225 310 60 'Capability resolution'
Arrow $s 480 195 480 225
Arrow $s 370 285 200 335;Arrow $s 480 285 480 335;Arrow $s 590 285 770 335
Node $s 55 335 290 75 "BigQuery native`nPERCENTILE_CONT"
Node $s 370 335 220 75 "MySQL rewrite`nRank + count"
Node $s 615 335 290 75 "Unsupported operation`nExplicit error"
Note $s 'The caller keeps the same supported analytical operation.'

$s=Slide 'SQL size: repeated trees versus named stages' 'Current compiler duplicates decimal expressions inside rounding and overflow guards. Proposal: introduce query-block projections to name intermediate results and reference columns. This is not implemented by this presentation. A naive scalar-subquery/UNNEST attempt was rejected after slot-use regression and conditional-evaluation problems. CTEs do not guarantee materialization or speed. Preserve CASE/COALESCE laziness, aggregate scope, intermediate rounding and overflow.'
[void](Text $s 48 125 390 40 'Current expansion' 26 $muted)
[void](Text $s 520 125 392 40 'Proposed named stages' 26 $green $true)
Node $s 90 185 300 60 'Check final expression'
Node $s 48 310 180 75 "Repeat child`nexpression"
Node $s 258 310 180 75 "Repeat child`nexpression"
Arrow $s 180 245 138 310;Arrow $s 300 245 348 310
Node $s 545 180 340 55 'Compute intermediate columns'
Node $s 545 265 340 55 'Check named values'
Node $s 545 350 340 55 'Aggregate and reference aliases'
Arrow $s 715 235 715 265;Arrow $s 715 320 715 350
Note $s 'Fewer repeated expressions must also preserve semantics and cost.'

$s=Slide 'Verification needs a semantic oracle' 'Implemented fanout fixture in test/bigquery-integration.test.ts at d5c5cad. One order freight 10 and three lines worth 100 each: correct ratio 10/300, wrong joined-row freight sum 30/300. Both queries execute. A trusted fixture catches the difference. This test does not establish that the exported Claude query has this bug; it is a deliberately wrong SQL candidate. Validation can evaluate both LLM SQL and compiler SQL. Full production safety needs more than this example.'
Node $s 48 145 260 65 'LLM or compiler SQL'
Node $s 350 145 260 65 'Independent fixtures'
Node $s 652 145 260 65 'Compare results' $true
Arrow $s 308 177 350 177;Arrow $s 610 177 652 177
[void](Text $s 48 260 864 45 'One order: $10 freight and three $100 detail lines' 26 $navy $true)
Node $s 65 330 370 70 'Correct: 10 / 300 = 3.33%'
Node $s 525 330 370 70 'Fanout error: 30 / 300 = 10.00%'
Note $s 'Executable SQL can still answer the wrong question.'

$s=Slide 'Float and decimal are explicit choices' 'Observed BigQuery query: percentile_cont(NUMERIC value,0.75) returned FLOAT64. 0.75 itself is exactly representable; the computation type promotes decimal inputs/results to approximate arithmetic. USA P75 exact 2477.5750000000, exported float path rounded to 2477.57, typed NUMERIC fraction rounded to 2477.58. This is an observed example, not a claim that all float computations are wrong. Golden decimal(38,10) per-operation enforcement is its own policy and contributes to verbose SQL. Evidence: live comparison during this session and PR64 docs/BIGQUERY.md.'
Node $s 48 210 240 95 "Order values`nExact P75: 2477.575"
Node $s 390 145 240 80 "FLOAT64 path`nApproximate arithmetic"
Node $s 390 305 240 80 "Decimal path`nTyped fraction"
Node $s 730 145 180 80 'Display 2477.57'
Node $s 730 305 180 80 'Display 2477.58'
Arrow $s 288 240 390 185;Arrow $s 288 280 390 345
Arrow $s 630 185 730 185;Arrow $s 630 345 730 345
Note $s 'Choose a precision contract. A one-cent difference alone does not justify IR.'

$s=Slide 'A practical validation roadmap' 'Proposal, not completed implementation. First define grains and filter inheritance for the nine actual dashboard datasets. Build independent fixtures and mutation-style wrong SQL examples. Then extend date filters, month grouping, catalog fields and percentile-with-count support. Compare LLM SQL and Golden SQL with matched semantics and populations, cost and change effort. Current measured cleanup: freight 10476 to7366 characters, native P75 9639 to6885; shorter text is not proof of speed. The test harness is useful even if the product later chooses direct SQL instead of Substrait.'
Node $s 48 205 190 100 "1. Define intent`nGrain and filters"
Node $s 273 205 190 100 "2. Test semantics`nSmall counterexamples"
Node $s 498 205 190 100 "3. Expand coverage`nNine datasets"
Node $s 723 205 190 100 "4. Measure value`nCost and change effort" $true
Arrow $s 238 255 273 255;Arrow $s 463 255 498 255;Arrow $s 688 255 723 255
[void](Text $s 48 355 864 55 'Golden already has typed composition, backend lowering and regression tests.' 25 $navy)
Note $s 'The next proof is reliable dashboard evolution across real query changes.'

$s=Slide 'Reference: Claude country P75 SQL' 'Actual final aggregation excerpt from downloaded queries.sql p75_country. Preceding CTEs define o with filtered orders and discounted order values. The export deliberately ignores country selection for this chart. A typed decimal percentile fraction can avoid FLOAT64 promotion, but keeping the final cast to FLOAT64 would still discard exact transport precision. Full export and Golden populations differ. No claim that Claude requires a new LLM call for parameter-only filter changes.'
$code=@'
SELECT country, COUNT(*) AS orders,
  CAST(ROUND(ANY_VALUE(p75), 2) AS FLOAT64) AS p75_order_value
FROM (
  SELECT country,
    PERCENTILE_CONT(value, 0.75)
      OVER (PARTITION BY country) AS p75
  FROM o
)
GROUP BY country
ORDER BY p75_order_value DESC;
'@
$t=Text $s 48 145 864 260 $code 18;$t.TextFrame.TextRange.Font.Name='Consolas'
Note $s 'Opportunity: retain native SQL while making precision and filter scope explicit.'
$out=Join-Path $root 'output\Golden-SQL-Generation-Opportunities.pptx'
$deck.SaveAs($out,24)
$renders=Join-Path $root '.build\diagram-renders';New-Item -ItemType Directory -Force -Path $renders | Out-Null
$deck.Export($renders,'PNG',1600,900)
$warnings=@()
foreach($s in $deck.Slides){foreach($q in $s.Shapes){if($q.HasTextFrame -eq -1 -and $q.TextFrame.HasText -eq -1){if($q.TextFrame.TextRange.BoundHeight -gt ($q.Height+3)){$warnings+="Slide $($s.SlideIndex): text exceeds height"}}}}
$warnings | Set-Content (Join-Path $root '.build\diagram-layout-warnings.txt')
$deck.Close()
Write-Output "Created $out"
Write-Output "Layout warnings: $($warnings.Count)"
