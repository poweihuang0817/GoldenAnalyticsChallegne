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
