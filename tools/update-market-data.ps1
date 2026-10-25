# Downloads market and longevity data and writes data/market-data.js:
#   - Bank of England: the latest nominal gilt zero coupon yields at 5, 10 and 20 years, and the
#     historical volatility of nominal yields and market implied inflation at those terms
#     (standard deviation of 12-month changes in month-end values over the lookback period)
#   - ONS national life tables: period life expectancy at 65 (average of men and women) and the
#     standard deviation of its year-to-year changes over the longevity lookback period
# Run from anywhere:  powershell -ExecutionPolicy Bypass -File tools\update-market-data.ps1
# Optional:           -LookbackYears 15 -LongevityLookbackYears 30

param([int]$LookbackYears = 10, [int]$LongevityLookbackYears = 20)

$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$out = Join-Path $root 'data\market-data.js'
$inv = [Globalization.CultureInfo]::InvariantCulture

# Bank of England yield curve series (zero coupon) by term in years.
$terms = @(5, 10, 20)
$nominal = @{ 5 = 'IUDSNZC'; 10 = 'IUDMNZC'; 20 = 'IUDLNZC' }
$inflation = @{ 5 = 'IUDSIZC'; 10 = 'IUDMIZC'; 20 = 'IUDLIZC' }
$codes = @($terms | ForEach-Object { $nominal[$_] }) + @($terms | ForEach-Object { $inflation[$_] })

# One extra year of history so the first 12-month change in the window has a starting point.
$from = (Get-Date).AddYears(-$LookbackYears - 1).AddMonths(-1)
$to = Get-Date

# Daily history is kept in data/boe-history.csv, so each run only downloads the recent weeks.
# The Bank's server fails intermittently, so downloads go in six-month chunks with retries.
# (Its shorter Datefrom/Dateto download link started returning errors in October 2026.)
$historyFile = Join-Path $root 'data\boe-history.csv'

function Get-BoeCsv($start, $end) {
  $url = 'https://www.bankofengland.co.uk/boeapps/database/_iadb-fromshowcolumns.asp?Travel=NIxAZxSUx&FromSeries=1&ToSeries=50&DAT=RNG' +
    "&FD=$($start.Day)&FM=$($start.ToString('MMM', $inv))&FY=$($start.Year)" +
    "&TD=$($end.Day)&TM=$($end.ToString('MMM', $inv))&TY=$($end.Year)" +
    "&FNY=Y&CSVF=TN&csv.x=yes&SeriesCodes=$($codes -join ',')&UsingCodes=Y&Filter=N&title=Headroom&VPD=Y"
  for ($attempt = 1; $attempt -le 6; $attempt++) {
    try {
      $response = Invoke-WebRequest $url -UseBasicParsing -TimeoutSec 90 -UserAgent 'Mozilla/5.0'
      return [Text.Encoding]::UTF8.GetString($response.Content).Trim() -split "`r?`n" | ConvertFrom-Csv
    } catch {
      if ($attempt -eq 6) { throw "Bank of England download failed for $($start.ToString('d MMM yyyy')) to $($end.ToString('d MMM yyyy')): $($_.Exception.Message)" }
      Start-Sleep -Seconds (5 * $attempt)
    }
  }
}

# Load saved history (keyed by ISO date), then download from a week before its last date.
$history = @{}
if (Test-Path $historyFile) { Import-Csv $historyFile | ForEach-Object { $history[$_.DATE] = $_ } }
$start = $from
if ($history.Count) {
  $start = [DateTime]::ParseExact(($history.Keys | Sort-Object | Select-Object -Last 1), 'yyyy-MM-dd', $inv).AddDays(-7)
}
for (; $start -le $to; $start = $start.AddMonths(6)) {
  $end = $start.AddMonths(6).AddDays(-1)
  if ($end -gt $to) { $end = $to }
  foreach ($r in Get-BoeCsv $start $end) {
    $key = [DateTime]::ParseExact($r.DATE, 'dd MMM yyyy', $inv).ToString('yyyy-MM-dd')
    $record = [ordered]@{ DATE = $key }
    foreach ($c in $codes) { $record[$c] = $r.$c }
    $history[$key] = [pscustomobject]$record
  }
}
$history.Values | Sort-Object DATE | Export-Csv $historyFile -NoTypeInformation -Encoding UTF8

$rows = foreach ($h in $history.Values) {
  if ($codes | Where-Object { [string]::IsNullOrWhiteSpace($h.$_) }) { continue }
  $o = [ordered]@{ Day = [DateTime]::ParseExact($h.DATE, 'yyyy-MM-dd', $inv) }
  foreach ($c in $codes) { $o[$c] = $h.$c }
  [pscustomobject]$o
}
$rows = @($rows | Where-Object { $_.Day -ge $from } | Sort-Object Day)
if (-not $rows) { throw 'No complete rows of Bank of England data found.' }

$latest = $rows | Select-Object -Last 1

# Month-end values (last complete row in each month).
$monthEnds = @($rows | Group-Object { $_.Day.ToString('yyyy-MM') } | ForEach-Object { $_.Group | Select-Object -Last 1 })

# Standard deviation of 12-month changes in a series, over the lookback window, in decimal form.
function Get-AnnualChangeVol($code) {
  $cutoff = $latest.Day.AddYears(-$LookbackYears)
  $changes = @()
  for ($i = 12; $i -lt $monthEnds.Count; $i++) {
    if ($monthEnds[$i].Day -lt $cutoff) { continue }
    $changes += ([double]$monthEnds[$i].$code - [double]$monthEnds[$i - 12].$code) / 100
  }
  $mean = ($changes | Measure-Object -Average).Average
  $var = ($changes | ForEach-Object { ($_ - $mean) * ($_ - $mean) } | Measure-Object -Sum).Sum / ($changes.Count - 1)
  return [Math]::Sqrt($var)
}

function Num($x, $digits) { ([Math]::Round($x, $digits)).ToString($inv) }

$curve = ($terms | ForEach-Object { "    { term: $_, yield: $(Num ([double]$latest.($nominal[$_]) / 100) 6) }" }) -join ",`n"
$vols = ($terms | ForEach-Object {
  "    { term: $_, yieldVol: $(Num (Get-AnnualChangeVol $nominal[$_]) 5), inflationVol: $(Num (Get-AnnualChangeVol $inflation[$_]) 5) }"
}) -join ",`n"
$volFrom = $latest.Day.AddYears(-$LookbackYears).ToString('yyyy-MM-dd')

# ---- ONS national life tables (UK) ----
$onsPage = 'https://www.ons.gov.uk/peoplepopulationandcommunity/birthsdeathsandmarriages/lifeexpectancies/datasets/nationallifetablesunitedkingdomreferencetables/current'
$link = (Invoke-WebRequest $onsPage -UseBasicParsing -UserAgent 'Mozilla/5.0' -TimeoutSec 60).Links |
  Where-Object { $_.href -match '/current/[^/]+\.xlsx$' } | Select-Object -First 1 -ExpandProperty href
if (-not $link) { throw 'Could not find the current ONS national life tables file.' }
$xlsx = Join-Path ([IO.Path]::GetTempPath()) 'headroom-nltuk.xlsx'
Invoke-WebRequest "https://www.ons.gov.uk$link" -OutFile $xlsx -UseBasicParsing -UserAgent 'Mozilla/5.0' -TimeoutSec 120

# Life expectancy at 65 from each period sheet (named like 2022-2024): column F is men, M is women.
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [IO.Compression.ZipFile]::OpenRead($xlsx)
function Read-ZipXml($name) { $s = New-Object IO.StreamReader($zip.GetEntry($name).Open()); $x = [xml]$s.ReadToEnd(); $s.Close(); $x }
$workbook = Read-ZipXml 'xl/workbook.xml'
$wbRels = Read-ZipXml 'xl/_rels/workbook.xml.rels'
$relNs = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
$e65 = foreach ($sheet in $workbook.workbook.sheets.sheet | Where-Object { $_.name -match '^\d{4}-\d{4}$' }) {
  $target = ($wbRels.Relationships.Relationship | Where-Object { $_.Id -eq $sheet.GetAttribute('id', $relNs) }).Target
  $data = Read-ZipXml ('xl/' + ($target -replace '^/?(xl/)?', ''))
  $row = $data.worksheet.sheetData.row | Where-Object { ($_.c | Where-Object { $_.r -match '^A\d+$' }).v -eq '65' } | Select-Object -First 1
  $men = [double]($row.c | Where-Object { $_.r -match '^F\d+$' }).v
  $women = [double]($row.c | Where-Object { $_.r -match '^M\d+$' }).v
  [pscustomobject]@{ Period = $sheet.name; EndYear = [int]$sheet.name.Substring(5); Value = ($men + $women) / 2 }
}
$zip.Dispose()
Remove-Item $xlsx
$e65 = @($e65 | Sort-Object EndYear)
if ($e65.Count -lt 5) { throw 'Too few ONS life table periods found.' }

$latestEnd = $e65[-1].EndYear
$window = @($e65 | Where-Object { $_.EndYear -ge $latestEnd - $LongevityLookbackYears })
$leChanges = for ($i = 1; $i -lt $window.Count; $i++) { $window[$i].Value - $window[$i - 1].Value }
$leMean = ($leChanges | Measure-Object -Average).Average
$leVol = [Math]::Sqrt((($leChanges | ForEach-Object { ($_ - $leMean) * ($_ - $leMean) } | Measure-Object -Sum).Sum) / ($leChanges.Count - 1))
$e65Js = ($window | ForEach-Object { "      { period: '$($_.Period)', years: $(Num $_.Value 3) }" }) -join ",`n"

$js = @"
// Generated by tools/update-market-data.ps1 on $(Get-Date -Format 'yyyy-MM-dd HH:mm'). Do not edit by hand.
window.HEADROOM_MARKET = {
  source: 'Bank of England, UK gilt zero coupon yield curves',
  asAt: '$($latest.Day.ToString('yyyy-MM-dd'))',
  // Nominal zero coupon yields ($($terms | ForEach-Object { $nominal[$_] }) ).
  giltCurve: [
$curve
  ],
  // Standard deviation of 12-month changes in month-end nominal yields and implied inflation
  // ($($terms | ForEach-Object { $inflation[$_] }) ) from $volFrom to $($latest.Day.ToString('yyyy-MM-dd')).
  volatility: {
    method: 'Standard deviation of 12-month changes in month-end values',
    lookbackYears: $LookbackYears,
    from: '$volFrom',
    curve: [
$vols
    ]
  },
  // ONS national life tables, UK: period life expectancy at 65, average of men and women.
  longevity: {
    source: 'ONS national life tables, UK',
    method: 'Standard deviation of year-to-year changes in life expectancy at 65 (average of men and women)',
    lookbackYears: $LongevityLookbackYears,
    fromPeriod: '$($window[0].Period)',
    toPeriod: '$($window[-1].Period)',
    volYears: $(Num $leVol 4),
    lifeExpectancy65: [
$e65Js
    ]
  }
};
"@

New-Item -ItemType Directory -Force (Split-Path $out) | Out-Null
[IO.File]::WriteAllText($out, $js + "`n", (New-Object System.Text.UTF8Encoding $false))
Write-Host "Wrote market data as at $($latest.Day.ToString('d MMM yyyy')) and ONS life tables to $($e65[-1].Period) to $out"
