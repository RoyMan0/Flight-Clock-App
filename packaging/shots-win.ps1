# Screenshots of the built Windows app, for checking rendering from a Mac (CI uploads them as
# the "windows-screenshots" artifact; `gh run download <id> -n windows-screenshots`):
#   case-*.png   the real panel window over a magenta backdrop: magenta in the rounded corners
#                and round the cases means they're see-through; grey/white means they aren't
#   fixture-*    flip board / e-ink pages rendered by Edge (the same engine as WebView2) with
#                Windows' own fonts: the W in NEW / WSH must fit its flap
# Run after build-win.ps1. Never fails the build: it's for looking at.
$ErrorActionPreference = "Continue"
$Root = (Resolve-Path "$PSScriptRoot\..").Path
$exe = Join-Path $Root "dist\Flight Clock\Flight Clock.exe"
$out = Join-Path $Root "dist\shots"
New-Item -ItemType Directory -Force $out | Out-Null
Add-Type -AssemblyName System.Windows.Forms, System.Drawing

function New-Data($name, $prefs) {
    $data = Join-Path $env:TEMP $name
    Remove-Item -Recurse -Force $data -ErrorAction SilentlyContinue
    New-Item -ItemType Directory -Force (Join-Path $data "config") | Out-Null
    $cfg = Get-Content (Join-Path $Root "core-src\config\config.example.json") -Raw | ConvertFrom-Json
    $cfg.location.location_home = @(41.8781, -87.6298)
    $cfg.location.clock_format = "12hr"
    $cfg | ConvertTo-Json -Depth 32 | Set-Content -Encoding utf8 (Join-Path $data "config\config.json")
    if ($prefs) { $prefs | ConvertTo-Json -Depth 8 | Set-Content -Encoding utf8 (Join-Path $data "config\desktop.json") }
    return $data
}

function Save-Screen($path) {
    $b = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
    $bmp = New-Object System.Drawing.Bitmap $b.Width, $b.Height
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.CopyFromScreen($b.Location, [System.Drawing.Point]::Empty, $b.Size)
    $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
    $g.Dispose(); $bmp.Dispose()
}

# A magenta backdrop behind the panel (its own process, so it keeps painting)
$backdrop = Start-Process powershell -PassThru -WindowStyle Hidden -ArgumentList @("-NoProfile", "-Command", @'
Add-Type -AssemblyName System.Windows.Forms, System.Drawing
$f = New-Object System.Windows.Forms.Form
$f.BackColor = [System.Drawing.Color]::Magenta; $f.FormBorderStyle = 'None'; $f.WindowState = 'Maximized'
[System.Windows.Forms.Application]::Run($f)
'@)
Start-Sleep 4

$env:FLIGHTCLOCK_HEADLESS = $null
$theme = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Themes\Personalize"
New-Item -Force $theme -ErrorAction SilentlyContinue | Out-Null
foreach ($run in @(
        @{ name = "case-none";     prefs = @{ case = "none";    screen = "led";       panel_frame = @(80, 80, 640, 320) } },
        @{ name = "case-bedside";  prefs = @{ case = "bedside"; screen = "flipboard"; panel_frame = @(80, 80, 760, 340) } },
        @{ name = "case-mac_se";   prefs = @{ case = "mac_se";  screen = "eink";      panel_frame = @(80, 80, 440, 480) } },
        @{ name = "case-trayonly"; prefs = @{ case = "imac_g3"; screen = "led"; window_mode = "menubar"; panel_frame = @(80, 80, 560, 560) } },
        # Windows in dark mode: pywebview gives its windows the Mica backdrop then, which
        # DWM paints over the whole window rectangle (#202020) whatever the window's shape
        @{ name = "case-bedside-dark"; dark = $true; prefs = @{ case = "bedside"; screen = "led"; panel_frame = @(80, 80, 760, 340) } })) {
    Set-ItemProperty $theme AppsUseLightTheme -Type DWord -Value $(if ($run.dark) { 0 } else { 1 })
    $data = New-Data "fc-shot-$($run.name)" $run.prefs
    $env:FLIGHTCLOCK_DATA_DIR = $data
    $p = Start-Process $exe -PassThru
    Start-Sleep 25
    Save-Screen (Join-Path $out "$($run.name).png")
    Write-Host "  shot $($run.name)"
    $shotLog = Join-Path $data "logs\flightclock.log"
    if (Test-Path $shotLog) { Get-Content $shotLog | Select-String "shape|snapshot|Traceback|Error" | ForEach-Object { Write-Host "    $_" } }
    Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue
    Start-Sleep 2
}
Stop-Process -Id $backdrop.Id -Force -ErrorAction SilentlyContinue

# Fixture pages in Edge (headless app for the server)
$data = New-Data "fc-shot-fixtures" $null
$env:FLIGHTCLOCK_DATA_DIR = $data; $env:FLIGHTCLOCK_HEADLESS = "1"
$p = Start-Process $exe -PassThru
$log = Join-Path $data "logs\flightclock.log"; $url = $null
for ($i = 0; $i -lt 90 -and -not $url; $i++) {
    Start-Sleep 1
    if ((Test-Path $log) -and ((Get-Content $log -Raw) -match "web UI on http://[\d.]+:(\d+)")) { $url = "http://127.0.0.1:$($Matches[1])" }
}
$edge = @("${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe", "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe") |
        Where-Object { Test-Path $_ } | Select-Object -First 1
if ($url -and $edge) {
    Start-Sleep 5
    foreach ($f in @(@{ n = 25; s = "flipboard" }, @{ n = 22; s = "flipboard" }, @{ n = 8; s = "flipboard" },
                     @{ n = 0; s = "flipboard" }, @{ n = 26; s = "eink" }, @{ n = 25; s = "eink" })) {
        $png = Join-Path $out "fixture-$($f.n)-$($f.s).png"
        & $edge --headless=new --disable-gpu --hide-scrollbars --window-size=960,480 --virtual-time-budget=8000 `
            "--screenshot=$png" "$url/desktop/panel?fixture=$($f.n)&screen=$($f.s)&case=none" 2>$null | Out-Null
        Start-Sleep 1
        Write-Host "  shot fixture $($f.n) $($f.s): $(Test-Path $png)"
    }
} else { Write-Host "  no server ($url) or Edge ($edge): skipped the fixture shots" }
Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue
exit 0
