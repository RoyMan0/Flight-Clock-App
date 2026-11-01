# Build Flight Clock for Windows (run on Windows, or by .github/workflows/windows.yml).
#
#   powershell -ExecutionPolicy Bypass -File packaging\build-win.ps1
#     → dist\Flight Clock\                          the app folder (Flight Clock.exe)
#       dist\FlightClock-Setup-<version>.exe        installer (needs Inno Setup 6: winget install JRSoftware.InnoSetup)
#       dist\FlightClock-<version>-portable.zip     unzip-and-run copy
#
# Needs uv (https://docs.astral.sh/uv/). Creates .venv with Python 3.12 (x64).
# Unsigned: SmartScreen shows "Windows protected your PC" → More info → Run anyway.
$ErrorActionPreference = "Stop"
$Root = (Resolve-Path "$PSScriptRoot\..").Path
Set-Location $Root

function Run($exe, [string[]]$argv) {
    & $exe @argv
    if ($LASTEXITCODE -ne 0) { throw "$exe failed ($LASTEXITCODE)" }
}

# 1. Shared code (the core-src submodule)
if (Test-Path .gitmodules) { Run git @("submodule", "update", "--init") }
if (-not (Test-Path core-src\core\bootstrap.py)) { throw "core-src\ is missing or too old (needs core\bootstrap.py)" }

# 2. Build environment
$uv = (Get-Command uv -ErrorAction SilentlyContinue).Source
if (-not $uv) { $uv = Join-Path $env:USERPROFILE ".local\bin\uv.exe" }
$py = Join-Path $Root ".venv\Scripts\python.exe"
if (-not (Test-Path $py)) { Run $uv @("venv", "-p", "3.12", ".venv") }
Run $uv @("pip", "install", "-p", $py, "-q", "-r", "core-src\requirements.txt", "-r", "packaging\requirements-win.txt")

$version = (& $py -c "import sys; sys.path.insert(0, 'desktop'); from version import __version__; print(__version__)").Trim()
Write-Host "==> Flight Clock $version (Windows)"

# 3. Icon, then the app folder
Run $py @("packaging\make_art.py", "packaging\art")
Remove-Item -Recurse -Force build, "dist\Flight Clock" -ErrorAction SilentlyContinue
Run $py @("-m", "PyInstaller", "--noconfirm", "--clean", "--distpath", "dist", "--workpath", "build", "packaging\FlightClock-win.spec")
$app = Join-Path $Root "dist\Flight Clock"

# 4. Personal files and secrets must never ship (see CLAUDE.md, Packaging gotchas)
$bad = Get-ChildItem -Recurse -File $app | Where-Object {
    $_.Name -in @("close.txt", "farthest.txt", "secrets.json", "config.json") -or $_.FullName -match "\\static\\maps\\"
}
if ($bad) { $bad | ForEach-Object { Write-Host "  !! $($_.FullName)" }; throw "personal files in the bundle" }

# 5. Portable zip
$zip = Join-Path $Root "dist\FlightClock-$version-portable.zip"
Remove-Item -Force $zip -ErrorAction SilentlyContinue
Compress-Archive -Path $app -DestinationPath $zip

# 6. Installer
$iscc = @((Get-Command iscc -ErrorAction SilentlyContinue).Source,
          "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe",
          "$env:ProgramFiles\Inno Setup 6\ISCC.exe",
          "$env:LOCALAPPDATA\Programs\Inno Setup 6\ISCC.exe") | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
if ($iscc) {
    Run $iscc @("/Q", "/DAppVersion=$version", "/DSourceDir=$app", "/DOutputDir=$Root\dist",
                "/DIconFile=$Root\packaging\art\icon.ico", "packaging\installer.iss")
    Write-Host "==> dist\FlightClock-Setup-$version.exe"
} else {
    Write-Host "Inno Setup not found: skipped the installer (winget install JRSoftware.InnoSetup)"
}
Write-Host "==> $zip"
