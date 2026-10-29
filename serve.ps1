# Serves this folder at http://localhost:8080 for local previewing. Stop with Ctrl+C.
# GET /api/market returns live market data: if the saved data is older than -RefreshMinutes,
# it first runs tools/update-market-data.ps1 to fetch the latest from the Bank of England.
param([int]$Port = 8080, [int]$RefreshMinutes = 60)

$root = $PSScriptRoot
$types = @{
  '.html' = 'text/html; charset=utf-8'; '.css' = 'text/css; charset=utf-8'
  '.js' = 'text/javascript; charset=utf-8'; '.json' = 'application/json'
  '.svg' = 'image/svg+xml'; '.png' = 'image/png'; '.ico' = 'image/x-icon'
}
$marketJson = Join-Path $root 'data\market-data.json'
$updater = Join-Path $root 'tools\update-market-data.ps1'

function Send($ctx, [byte[]]$bytes, $type) {
  $ctx.Response.ContentType = $type
  $ctx.Response.ContentLength64 = $bytes.Length
  # HEAD requests (used by health checks) get headers only.
  if ($ctx.Request.HttpMethod -ne 'HEAD') { $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length) }
}

# Returns the market data, refreshing it first if it is stale. Sets X-Market-Refresh to
# 'fresh' (refreshed now), 'cached' (recent enough) or 'failed' (refresh failed, saved data sent).
function Send-Market($ctx) {
  $status = 'cached'
  $stale = -not (Test-Path $marketJson) -or ((Get-Date) - (Get-Item $marketJson).LastWriteTime).TotalMinutes -ge $RefreshMinutes
  if ($stale) {
    Write-Host 'Refreshing market data...'
    & powershell -NoProfile -ExecutionPolicy Bypass -File $updater | Out-Host
    $status = if ($LASTEXITCODE -eq 0) { 'fresh' } else { 'failed' }
  }
  if (-not (Test-Path $marketJson)) { $ctx.Response.StatusCode = 503; return }
  $ctx.Response.Headers.Add('Cache-Control', 'no-store')
  $ctx.Response.Headers.Add('X-Market-Refresh', $status)
  Send $ctx ([IO.File]::ReadAllBytes($marketJson)) 'application/json; charset=utf-8'
}

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$Port/")
$listener.Start()
Write-Host "Serving $root at http://localhost:$Port/"

while ($listener.IsListening) {
  $ctx = $listener.GetContext()
  try {
    $rel = [Uri]::UnescapeDataString($ctx.Request.Url.AbsolutePath.TrimStart('/'))
    if ($rel -eq '') { $rel = 'index.html' }
    if ($rel -eq 'api/market') {
      Send-Market $ctx
    } else {
      $path = [IO.Path]::GetFullPath((Join-Path $root $rel))
      if ($path.StartsWith($root) -and (Test-Path $path -PathType Leaf)) {
        $type = $types[[IO.Path]::GetExtension($path).ToLower()]
        if (-not $type) { $type = 'application/octet-stream' }
        Send $ctx ([IO.File]::ReadAllBytes($path)) $type
      } else {
        $ctx.Response.StatusCode = 404
      }
    }
  } catch {
    Write-Host "Error: $($_.Exception.Message)"
    $ctx.Response.StatusCode = 500
  } finally {
    $ctx.Response.Close()
  }
}
