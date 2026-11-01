# Smoke-test the built Windows app (CLAUDE.md "Verification checklist", steps 2–3), headless:
# no windows, a throwaway data folder. Run after build-win.ps1; used by the CI workflow.
$ErrorActionPreference = "Stop"
$Root = (Resolve-Path "$PSScriptRoot\..").Path
$exe = Join-Path $Root "dist\Flight Clock\Flight Clock.exe"

function Start-App($data) {
    Remove-Item -Recurse -Force $data -ErrorAction SilentlyContinue
    New-Item -ItemType Directory -Force (Join-Path $data "config") | Out-Null
    $env:FLIGHTCLOCK_DATA_DIR = $data
    $env:FLIGHTCLOCK_HEADLESS = "1"
    $p = Start-Process $exe -PassThru
    $log = Join-Path $data "logs\flightclock.log"
    for ($i = 0; $i -lt 90; $i++) {
        Start-Sleep 1
        if ($p.HasExited) { if (Test-Path $log) { Get-Content $log }; throw "the app exited ($($p.ExitCode))" }
        if ((Test-Path $log) -and ((Get-Content $log -Raw) -match "web UI on http://[\d.]+:(\d+)")) {
            Start-Sleep 4                                # let the server and plugins come up
            return @{ Process = $p; Url = "http://127.0.0.1:$($Matches[1])"; Log = $log }
        }
    }
    throw "no 'web UI on' line in the log after 90 s"
}

function Get-Ok($url) {
    $r = Invoke-WebRequest -UseBasicParsing -TimeoutSec 20 $url
    if ($r.StatusCode -ne 200) { throw "$url → $($r.StatusCode)" }
    Write-Host "  200 $url"
    return $r
}

$failed = $false
# 1. First launch (no home location): only the setup wizard
$run = Start-App (Join-Path $env:TEMP "fc-smoke-setup")
try { Get-Ok "$($run.Url)/setup" | Out-Null } finally { Stop-Process -Id $run.Process.Id -Force }

# 2. Configured: every plugin, every page
$data = Join-Path $env:TEMP "fc-smoke"
Remove-Item -Recurse -Force $data -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force (Join-Path $data "config") | Out-Null
$cfg = Get-Content (Join-Path $Root "core-src\config\config.example.json") -Raw | ConvertFrom-Json
$cfg.location.location_home = @(41.8781, -87.6298)
$cfg | ConvertTo-Json -Depth 32 | Set-Content -Encoding utf8 (Join-Path $data "config\config.json")
$env:FLIGHTCLOCK_DATA_DIR = $data; $env:FLIGHTCLOCK_HEADLESS = "1"
$p = Start-Process $exe -PassThru
$log = Join-Path $data "logs\flightclock.log"
$url = $null
for ($i = 0; $i -lt 90 -and -not $url; $i++) {
    Start-Sleep 1
    if ($p.HasExited) { if (Test-Path $log) { Get-Content $log }; throw "the app exited ($($p.ExitCode))" }
    if ((Test-Path $log) -and ((Get-Content $log -Raw) -match "web UI on http://[\d.]+:(\d+)")) { $url = "http://127.0.0.1:$($Matches[1])" }
}
if (-not $url) { throw "no 'web UI on' line in the log after 90 s" }
Start-Sleep 8
try {
    foreach ($path in "/", "/config", "/about", "/flights", "/display", "/desktop/panel", "/desktop/gallery",
                      "/desktop/panel/js/core.js", "/api/desktop/settings", "/api/display/model") {
        Get-Ok "$url$path" | Out-Null
    }
    $status = (Get-Ok "$url/api/status").Content | ConvertFrom-Json
    $plugins = @($status.plugins.PSObject.Properties.Name) + @($status.plugins | ForEach-Object { $_.id }) | Where-Object { $_ }
    Write-Host "  plugins: $($plugins -join ', ')"
    $frame = Invoke-WebRequest -UseBasicParsing "$url/api/display/frame"
    $len = $frame.RawContentStream.Length
    Write-Host "  frame: $len bytes"
    if ($len -ne 64 * 32 * 3) { Write-Host "  !! expected 6144 bytes"; $failed = $true }
    # System Stats for this PC (psutil + the GPU counters); a CI runner may have no GPU, so only CPU/memory must show
    $body = '{"type":"local","metrics":{"cpu":true,"gpu":true,"mem":true,"uptime":true,"disk":true,"net":true}}'
    $ss = (Invoke-WebRequest -UseBasicParsing -TimeoutSec 30 -Method Post -ContentType "application/json" -Body $body "$url/api/system_stats/test").Content | ConvertFrom-Json
    Write-Host "  system stats: ok=$($ss.ok) os=$($ss.os) values=$($ss.values | ConvertTo-Json -Compress) missing=$($ss.missing | ConvertTo-Json -Compress) $($ss.message)"
    if (-not $ss.ok -or -not $ss.values.cpu -or -not $ss.values.mem) { Write-Host "  !! system stats for this PC failed"; $failed = $true }
} finally {
    Stop-Process -Id $p.Id -Force
}

$text = Get-Content $log -Raw
$imports = Select-String -InputObject $text -Pattern "failed to import" -AllMatches
if ($imports) {
    Get-Content $log | Select-String "failed to import|Traceback|Error" | ForEach-Object { Write-Host "  !! $_" }
    $failed = $true
}
Write-Host "---- log tail ----"; Get-Content $log -Tail 40
if ($failed) { throw "smoke test failed" }
Write-Host "==> smoke test passed"
