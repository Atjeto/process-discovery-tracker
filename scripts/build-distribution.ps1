<#
.SYNOPSIS
  Builds a complete ship-ready distribution for the Process Discovery Tracker.

.DESCRIPTION
  Uses electron-packager (not electron-builder) to avoid the Windows
  symbolic-link / admin-rights requirement during winCodeSign cache
  extraction. Produces folder-based distributions ready to zip and copy.

    dist/capture/<app folder>/   Process Discovery Tracker (worker)
    dist/viewer/<app folder>/    Process Discovery Viewer (analyst,
                                 with Python + normalization in resources/)

    dist/DISTRIBUTION.md         operations-facing README

  Sequence:
    1. (optional) Build the Python embeddable into viewer/python/.
    2. Stage normalization/ into viewer/normalization/ (electron-packager
       only accepts resources rooted in the project dir).
    3. electron-packager capture.
    4. electron-packager viewer (carries python/ and normalization/ as
       --extra-resource args).
    5. Move the per-app outputs into dist/.
    6. Clean up the staging copy.

.PARAMETER SkipPython
  Skip the Python embeddable build. Use when viewer/python/ is current.

.PARAMETER Clean
  Wipe dist/ and per-app dist/ folders before building.

.EXAMPLE
  .\scripts\build-distribution.ps1
  .\scripts\build-distribution.ps1 -SkipPython
  .\scripts\build-distribution.ps1 -Clean -SkipPython
#>
[CmdletBinding()]
param(
  [switch]$SkipPython,
  [switch]$Clean
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
$captureDir = Join-Path $repoRoot "capture"
$viewerDir = Join-Path $repoRoot "viewer"
$normalizationDir = Join-Path $repoRoot "normalization"
$distDir = Join-Path $repoRoot "dist"
$viewerNormStage = Join-Path $viewerDir "normalization"

Write-Host ""
Write-Host "Process Discovery Tracker - Distribution build" -ForegroundColor Cyan
Write-Host "Repo: $repoRoot"
Write-Host ""

if ($Clean) {
  Write-Host "Cleaning previous build outputs..."
  foreach ($d in @($distDir, (Join-Path $captureDir "dist"), (Join-Path $viewerDir "dist"), $viewerNormStage)) {
    if (Test-Path $d) { Remove-Item -Recurse -Force $d }
  }
}

# Step 1: Python embeddable
if (-not $SkipPython) {
  Write-Host "[1/5] Building Python embeddable bundle (3-5 min)" -ForegroundColor Yellow
  & powershell -ExecutionPolicy Bypass -File (Join-Path $repoRoot "scripts\build-python-embeddable.ps1") -Force
  if ($LASTEXITCODE -ne 0) { throw "Python embeddable build failed" }
} else {
  Write-Host "[1/5] Skipping Python embeddable build (-SkipPython)" -ForegroundColor Yellow
  if (-not (Test-Path (Join-Path $viewerDir "python\python.exe"))) {
    throw "viewer\python\python.exe not found. Run without -SkipPython at least once."
  }
}

# Step 2: Stage normalization into viewer/normalization/
Write-Host ""
Write-Host "[2/5] Staging normalization/ into viewer\normalization\" -ForegroundColor Yellow
if (Test-Path $viewerNormStage) { Remove-Item -Recurse -Force $viewerNormStage }
New-Item -ItemType Directory -Path $viewerNormStage | Out-Null
Get-ChildItem -Path $normalizationDir -File | Where-Object {
  $_.Extension -in ".py", ".yaml", ".yml", ".txt", ".md"
} | ForEach-Object {
  Copy-Item -Force $_.FullName $viewerNormStage
}

# Step 3: Capture
Write-Host ""
Write-Host "[3/5] Packaging capture (electron-packager)" -ForegroundColor Yellow
Push-Location $captureDir
try {
  & npm run package
  if ($LASTEXITCODE -ne 0) { throw "capture package failed (exit $LASTEXITCODE)" }
} finally {
  Pop-Location
}

# Step 4: Viewer
Write-Host ""
Write-Host "[4/5] Packaging viewer (electron-packager, includes Python + normalization)" -ForegroundColor Yellow
Push-Location $viewerDir
try {
  & npm run package
  if ($LASTEXITCODE -ne 0) { throw "viewer package failed (exit $LASTEXITCODE)" }
} finally {
  Pop-Location
}

# Cleanup staged copy
if (Test-Path $viewerNormStage) { Remove-Item -Recurse -Force $viewerNormStage }

# Step 5: Assemble dist/
Write-Host ""
Write-Host "[5/5] Assembling dist/" -ForegroundColor Yellow
if (Test-Path $distDir) { Remove-Item -Recurse -Force $distDir }
New-Item -ItemType Directory -Path $distDir | Out-Null

$captureBuild = Get-ChildItem (Join-Path $captureDir "dist") -Directory | Select-Object -First 1
$viewerBuild = Get-ChildItem (Join-Path $viewerDir "dist") -Directory | Select-Object -First 1
if (-not $captureBuild) { throw "Capture build output not found" }
if (-not $viewerBuild) { throw "Viewer build output not found" }

# Use robocopy - PowerShell Copy-Item hits MAX_PATH on deep pm4py __pycache__ paths.
function Copy-WithRobocopy([string]$src, [string]$dst) {
  $args = @($src, $dst, "/E", "/NFL", "/NDL", "/NJH", "/NJS", "/NC", "/NS", "/NP", "/R:1", "/W:1")
  & robocopy @args | Out-Null
  # robocopy exit codes: 0 = nothing to copy, 1 = success, 2 = extras, 3 = 1+2
  # 4+ = mismatches or failures (treat as error)
  if ($LASTEXITCODE -ge 8) {
    throw "robocopy failed (exit $LASTEXITCODE) copying $src -> $dst"
  }
}

Copy-WithRobocopy $captureBuild.FullName (Join-Path $distDir "capture")
Copy-WithRobocopy $viewerBuild.FullName (Join-Path $distDir "viewer")

# User guide
$userGuide = Join-Path $repoRoot "docs\User-Guide.docx"
if (Test-Path $userGuide) {
  Copy-Item $userGuide (Join-Path $distDir "User-Guide.docx")
}

# DISTRIBUTION.md
$distMd = Join-Path $distDir "DISTRIBUTION.md"
$builtAt = (Get-Date).ToString("yyyy-MM-dd HH:mm")
$captureSize = (Get-ChildItem -Recurse (Join-Path $distDir "capture") -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum).Sum
$viewerSize = (Get-ChildItem -Recurse (Join-Path $distDir "viewer") -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum).Sum

$distMdContent = @"
# Process Discovery Tracker - Distribution

Built: $builtAt

## Contents

### capture/
Process Discovery Tracker (worker-side). Tray app, no install required.
- Run ``Process Discovery Tracker.exe`` from this folder.
- Sessions land in ``%APPDATA%\process-discovery-tracker\sessions\``.
- Size on disk: $([math]::Round($captureSize / 1MB, 1)) MB.

### viewer/
Process Discovery Viewer (analyst-side). Ships with Python 3.11 embeddable
and the normalization pipeline already installed in ``resources\``.
- Run ``Process Discovery Viewer.exe`` from this folder.
- No Python install required - the bundled interpreter is auto-discovered.
- Size on disk: $([math]::Round($viewerSize / 1MB, 1)) MB.

### User-Guide.docx
Complete user guide covering installation, configuration, OBS setup,
running a session, reviewing in the viewer, aggregate analysis, exports,
annotations, keyboard shortcuts, install topology, and troubleshooting.

## Installation

Both apps are portable (no installer). To deploy:

1. Copy the relevant folder to the target machine (anywhere - Program Files,
   ``C:\Tools\``, the user's profile, your call).
2. Optionally pin the .exe to the taskbar or create a Start Menu shortcut.
3. For capture, install OBS Studio 28+ if you want video recording, and
   enable Tools > WebSocket Server Settings (port 4455). Capture works
   without OBS but produces no video.

## SmartScreen note

These binaries are not code-signed. First launch on a fresh machine may
show "Windows protected your PC". Click **More info > Run anyway**.
Production deployment should add EV code signing.

## See also

- ``../process_discovery_tracker_design.md`` - full design doc (kept at the
  repo root; not shipped in dist by default).
- In-app help: tray menu -> Help (capture), ? button in topbar (viewer).
"@

Set-Content -Path $distMd -Value $distMdContent -Encoding UTF8

# Summary
Write-Host ""
Write-Host "Distribution build complete." -ForegroundColor Green
Write-Host "  Output: $distDir"
$totalSize = (Get-ChildItem -Recurse $distDir -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum).Sum
Write-Host ("  Total: {0:N1} MB" -f ($totalSize / 1MB))
Write-Host ""
Write-Host "Per-app sizes:"
Write-Host ("  capture: {0:N1} MB" -f ($captureSize / 1MB))
Write-Host ("  viewer:  {0:N1} MB (includes bundled Python + PM4Py)" -f ($viewerSize / 1MB))
Write-Host ""
Write-Host "Zip each folder for shipping, or copy as-is to the target machine."
