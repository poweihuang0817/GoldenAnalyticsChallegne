. (Join-Path $PSScriptRoot 'diagram-base.ps1')
$s=Slide 'How Golden uses Substrait in TypeScript' 'Source-backed walkthrough: src/api.ts RuntimeTable stores relation: S.IRel, fields and source identity. table() constructs a ReadRel with namedTable and baseSchema. filter() creates a FilterRel around the previous relation and resolves the predicate against the relation scope. aggregate() creates AggregateRel with groupingExpressions, measures, functionReference, arguments, outputType, phase and invocation. Expr.lower/eq create scalarFunction objects; column references resolve to positional field indices. Functions use numeric anchors into extension declarations. toSubstrait() packages the existing relation into a v0.63 Plan, declares Golden function URI/anchors, assigns root output names, and calls toPlanJson. plan.ts checks known fields, protobuf shape and the supported Zod profile. The code excerpts on the slide are shortened from these methods, with helper variables retained. client.compile calls CompileService.compile(query.toSubstrait()). CompileService posts this JSON object with backend/catalog to a worker using structured cloning, without protobuf binary encoding. Worker calls compilePlanSync, which validates/normalizes input and dispatches plans with extensions to compileAnalytics. relational.ts resolves function anchors and recursively visits relations, checks catalog and types, chooses SQL blocks/capability rewrites and uses Kysely to render SQL and parameters. execute then sends those to the driver. encodePlan/decodePlan exist for binary serialization but are not the ordinary client compilation path. Substrait provides the data model; Golden implements supported semantics and SQL lowering.'
[void](Text $s 48 119 864 40 'API operations build Substrait objects before compile() runs' 26 $green $true)
[void](Text $s 48 184 435 38 '1. filter() wraps the current relation' 23 $green $true)
$a=@'
// Inside RuntimeTable.filter()
new RuntimeTable({
  filter: {
    input: this.relation,
    condition: expr.resolve(this.scope())
  }
}, this.fields, this.source);
'@
$q=Text $s 48 235 440 190 $a 17;$q.TextFrame.TextRange.Font.Name='Consolas'
[void](Text $s 530 184 382 38 '2. toSubstrait() packages the tree' 23 $green $true)
$b=@'
return toPlanJson({
  version: { majorNumber: 0,
    minorNumber: 63, patchNumber: 0 },
  extensionUris: [/* Golden URI */],
  extensions: [/* function anchors */],
  relations: [{ root: {
    input: this.relation,
    names: this.fields.map(f => f.name)
  } }]
});
'@
$q=Text $s 530 235 382 210 $b 16;$q.TextFrame.TextRange.Font.Name='Consolas'
[void](Text $s 48 457 864 42 'Validated JSON goes to the worker. Golden lowers it through Kysely to SQL.' 22 $green $true)
$out=Join-Path $root 'output/Golden-Substrait-Internals.pptx'
$deck.SaveAs($out,24)
$renders=Join-Path $root '.build/substrait-internals-renders'
New-Item -ItemType Directory -Force -Path $renders | Out-Null
$deck.Export($renders,'PNG',1600,900)
$deck.Close()
Write-Output $out
