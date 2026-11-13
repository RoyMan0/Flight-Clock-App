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
try {
    Get-Ok "$($run.Url)/setup" | Out-Null
    # The wizard's "Find your address" (utilities/geocode.py, online lookup)
    $geo = (Invoke-WebRequest -UseBasicParsing -TimeoutSec 30 -Method Post -ContentType "application/json" `
            -Body '{"q":"Chicago, Illinois"}' "$($run.Url)/setup/geocode").Content | ConvertFrom-Json
    Write-Host "  geocode: ok=$($geo.ok) first=$($geo.results[0].name) $($geo.results[0].lat),$($geo.results[0].lon) $($geo.error)"
    if (-not $geo.ok -or -not $geo.results) { Write-Host "  !! address lookup failed"; $failed = $true }
    # The wizard's Save & Start (its ~15 config writes in a row once failed on Windows)
    $body = @{ location = @{ lat = 41.8781; lon = -87.6298; units = "imperial"; clock_format = "12hr"; search_radius_nm = 3;
                             journey_code = "ORD"; min_altitude = 8000; flight_email = "" };
               secrets = @{ tomorrow_api_key = ""; airlabs_key = ""; flightaware_key = ""; owm_api_key = "" };
               plugins = @(@{ id = "clock_weather"; enabled = $true; duration = 30 }, @{ id = "flight_tracker"; enabled = $true; duration = 30 }) } |
            ConvertTo-Json -Depth 8
    try {
        $save = Invoke-WebRequest -UseBasicParsing -TimeoutSec 30 -Method Post -ContentType "application/json" -Body $body "$($run.Url)/setup/save"
        Write-Host "  wizard save: $($save.StatusCode)"
    } catch { Write-Host "  !! wizard save failed: $_"; $failed = $true }
} finally { Stop-Process -Id $run.Process.Id -Force }

# 2. Configured: every plugin, every page
$data = Join-Path $env:TEMP "fc-smoke"
Remove-Item -Recurse -Force $data -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force (Join-Path $data "config") | Out-Null
$cfg = Get-Content (Join-Path $Root "core-src\config\config.example.json") -Raw | ConvertFrom-Json
$cfg.location.location_home = @(41.8781, -87.6298)
$cfg.location.clock_format = "12hr"           # %l in the clock formats raised "Invalid format string" on Windows
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
    # The Test button's preview draws each module off-screen: the clock and the daylight map
    foreach ($pid_ in "clock_weather", "world_daylight") {
        try {
            $pv = (Invoke-WebRequest -UseBasicParsing -TimeoutSec 60 -Method Post -ContentType "application/json" -Body "{}" "$url/api/plugins/$pid_/preview").Content | ConvertFrom-Json
            Write-Host "  preview ${pid_}: ok=$($pv.ok) frames=$($pv.frames.Count) $($pv.message)"
            if (-not $pv.ok) { $failed = $true }
        } catch {
            $msg = $_.ErrorDetails.Message
            Write-Host "  preview ${pid_}: $msg"
            if ($msg -match "format") { Write-Host "  !! $pid_ can't draw"; $failed = $true }
        }
    }
    # Snow Report's resort search reads plugins/snow_report/resorts.json, which must ship in the bundle
    $resorts = @((Get-Ok "$url/api/snow_report/resorts?q=keystone").Content | ConvertFrom-Json)
    Write-Host "  resort search: $($resorts.Count) match(es), first=$($resorts[0].name)"
    if (-not $resorts.Count) { Write-Host "  !! resort search found nothing (resorts.json missing?)"; $failed = $true }
} finally {
    Stop-Process -Id $p.Id -Force
}

$text = Get-Content $log -Raw
$imports = Select-String -InputObject $text -Pattern "failed to import|Invalid format string" -AllMatches
if ($imports) {
    Get-Content $log | Select-String "failed to import|Traceback|Error" | ForEach-Object { Write-Host "  !! $_" }
    $failed = $true
}
Write-Host "---- log tail ----"; Get-Content $log -Tail 40
if ($failed) { throw "smoke test failed" }
Write-Host "==> smoke test passed"
