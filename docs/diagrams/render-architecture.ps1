# Render the checked-in architecture PNG on Windows; no additional packages required.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$canvas = New-Object System.Drawing.Bitmap 1600,1500
$graphics = [System.Drawing.Graphics]::FromImage($canvas)
$graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$graphics.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
$graphics.Clear([System.Drawing.ColorTranslator]::FromHtml('#F5F7FB'))
$fonts = @{}
foreach ($size in @(18,22,25,30,44)) { $fonts[$size] = New-Object System.Drawing.Font 'Segoe UI',$size }
$brushes = @{}
function Brush([string]$hex) {
    if (-not $brushes.ContainsKey($hex)) { $brushes[$hex] = New-Object System.Drawing.SolidBrush ([System.Drawing.ColorTranslator]::FromHtml($hex)) }
    return $brushes[$hex]
}
function Label([string]$text, [int]$x, [int]$y, [int]$w, [int]$h, [int]$size = 22, [string]$color = '#172B4D') {
    $format = New-Object System.Drawing.StringFormat
    $format.Alignment = [System.Drawing.StringAlignment]::Center
    $format.LineAlignment = [System.Drawing.StringAlignment]::Center
    $graphics.DrawString($text, $fonts[$size], (Brush $color), [System.Drawing.RectangleF]::new($x,$y,$w,$h), $format)
    $format.Dispose()
}
function Box([int]$x,[int]$y,[int]$w,[int]$h,[string]$title,[string]$detail,[string]$fill = '#FFFFFF') {
    $graphics.FillRectangle((Brush '#E3E9F2'),$x+3,$y+5,$w,$h)
    $graphics.FillRectangle((Brush $fill),$x,$y,$w,$h)
    Label $title $x ($y+14) $w 44 25
    Label $detail ($x+20) ($y+60) ($w-40) ($h-65) 18 '#455773'
}
$arrowPen = New-Object System.Drawing.Pen ([System.Drawing.ColorTranslator]::FromHtml('#647795')),3
$cap = New-Object System.Drawing.Drawing2D.AdjustableArrowCap 5,7
$arrowPen.CustomEndCap = $cap
$linePen = New-Object System.Drawing.Pen ([System.Drawing.ColorTranslator]::FromHtml('#647795')),3
function Arrow([int]$x1,[int]$y1,[int]$x2,[int]$y2) { $graphics.DrawLine($arrowPen,$x1,$y1,$x2,$y2) }

Label 'Golden Query | Substrait to remote SQL' 60 35 1480 65 44
Label 'Initial implementation: read / project / sort / fetch' 60 107 1480 42 22 '#455773'
Label 'NODE / TYPESCRIPT APPLICATION' 60 170 1480 34 18 '#586E91'

Box 60 230 450 140 'Generated Substrait types' "IPlan + generated enums`ntoPlanJson validates capabilities" '#E8F0FF'
Box 575 230 450 140 'Substrait JSON' "fromPlanJson validates capabilities`nthen uses the generated codec" '#E8F0FF'
Box 1090 230 450 140 'Protobuf binary' "decodePlan scans wire fields`nthen decodes + validates capabilities" '#E8F0FF'
Arrow 285 370 285 420
Arrow 1315 370 1315 420
$graphics.DrawLine($linePen,285,420,1315,420)
Arrow 800 370 800 475

Box 250 480 1100 160 'Supported-plan boundary' "Official v0.63.0 schemas generate the types + codec`nCapability rules reject unsupported operators, extensions and malformed input`nCatalog checks schemas and resolves positional fields / emit mappings" '#E8F0FF'
Arrow 800 640 800 705

Box 250 710 1100 140 'Kysely query construction' "Compiler lowers the supported relations; Kysely quotes identifiers and binds values`nCASE sort keys preserve explicit null ordering across both backends" '#FFFFFF'
Arrow 800 850 800 890
$graphics.DrawLine($linePen,400,890,1200,890)
Arrow 400 890 400 930
Arrow 1200 890 1200 930

Box 100 935 600 130 'PostgreSQL dialect + pg adapter' 'SQL uses quoted identifiers and $1, $2 parameters' '#FFFFFF'
Box 900 935 600 130 'MySQL dialect + mysql2 adapter' 'SQL uses backtick identifiers and ? parameters' '#FFFFFF'

$divider = New-Object System.Drawing.Pen ([System.Drawing.ColorTranslator]::FromHtml('#A2AEC0')),2
$divider.DashStyle = [System.Drawing.Drawing2D.DashStyle]::Dash
$graphics.DrawLine($divider,60,1120,1540,1120)
$graphics.FillRectangle((Brush '#F5F7FB'),520,1095,560,50)
Label 'REMOTE DATABASE SERVERS' 520 1095 560 50 18 '#586E91'
Arrow 400 1065 400 1170
Arrow 1200 1065 1200 1170

Box 100 1175 600 145 'PostgreSQL 17' "Executes the generated SQL`nNorthwind data stays in the remote database" '#E4F4EB'
Box 900 1175 600 145 'MySQL 8' "Executes the generated SQL`nNorthwind data stays in the remote database" '#E4F4EB'
Label 'Results return through the adapters to the caller | DATE values are calendar-date strings' 80 1345 1440 50 22
Label 'Planned: filters, joins, aggregates and nested analytics. No local execution engine.' 80 1400 1440 44 18 '#586E91'

$outputPath = Join-Path $PSScriptRoot 'architecture.png'
$canvas.Save($outputPath,[System.Drawing.Imaging.ImageFormat]::Png)
$divider.Dispose()
$arrowPen.Dispose()
$linePen.Dispose()
$cap.Dispose()
foreach ($font in $fonts.Values) { $font.Dispose() }
foreach ($brush in $brushes.Values) { $brush.Dispose() }
$graphics.Dispose()
$canvas.Dispose()
Write-Output $outputPath
