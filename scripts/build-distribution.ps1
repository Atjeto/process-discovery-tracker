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

    dist/release/                zipped release assets, ready to upload
      capture-vX.Y.Z.zip         to a GitHub Release via `gh release create`
      viewer-vX.Y.Z.zip

  Sequence:
    1. (optional) Build the Python embeddable into viewer/python/.
    2. Stage normalization/ into viewer/normalization/ (electron-packager
       only accepts resources rooted in the project dir).
    3. electron-packager capture.
    4. electron-packager viewer (carries python/ and normalization/ as
       --extra-resource args).
    5. Move the per-app outputs into dist/.
    6. Clean up the staging copy.
    7. Zip each app folder into dist/release/<name>-v<version>.zip for
       attaching to a GitHub Release. Version is read from capture's
       package.json unless -Version is passed.

.PARAMETER SkipPython
  Skip the Python embeddable build. Use when viewer/python/ is current.

.PARAMETER Clean
  Wipe dist/ and per-app dist/ folders before building.

.PARAMETER Version
  Override the version tag used in release asset filenames. Defaults to
  the `version` field in capture/package.json.

.PARAMETER SkipRelease
  Skip the final zip-into-dist/release/ step. Useful for fast local
  iteration when you just want the unzipped dist trees.

.EXAMPLE
  .\scripts\build-distribution.ps1
  .\scripts\build-distribution.ps1 -SkipPython
  .\scripts\build-distribution.ps1 -Clean -SkipPython
  .\scripts\build-distribution.ps1 -Version 0.2.0
#>
[CmdletBinding()]
param(
  [switch]$SkipPython,
  [switch]$Clean,
  [switch]$SkipRelease,
  [string]$Version,
  # SHA-1 thumbprint of a code-signing cert in the build user's store. When set,
  # every .exe in the assembled dist/ is Authenticode-signed. Absent (default,
  # and the deliberate norm) => unsigned, build unchanged.
  # NOTE (ADR-0026): releases ship UNSIGNED by design. Signing under the
  # *company* certificate is declined — PDT is the owner's IP, not to be signed
  # under the employer's license; the SmartScreen/"unknown publisher" prompt is
  # accepted. This scaffolding stays ready for a *future owner-held* cert, but is
  # NOT passed for current releases. See docs/adr/0026-*.md.
  [string]$CertThumbprint,
  [string]$TimestampUrl = "http://timestamp.digicert.com"
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

function Invoke-NpmPackage([string]$appDir, [int]$maxRetries = 3) {
  # electron-packager copies node_modules into a temp staging dir
  # ($env:TEMP\electron-packager\tmp-*) before asar packaging. On
  # machines with active Defender / Search-indexer scanning, files in
  # that staging dir can vanish mid-copy and electron-packager dies
  # with ENOENT on a path it just wrote (verified against
  # bpmn-js/dist/assets/bpmn-font/font/bpmn.svg during the v0.17.1
  # build). The package step is idempotent on retry once the temp
  # dir is cleared, so wrap it.
  $name = Split-Path -Leaf $appDir
  Push-Location $appDir
  try {
    $attempt = 0
    while ($true) {
      $attempt++
      # See the broader npm-notice / NativeCommandError discussion at
      # the slim step: locally relax the script-level "Stop" preference
      # around the native call and check $LASTEXITCODE explicitly.
      $prevPref = $ErrorActionPreference
      $ErrorActionPreference = "Continue"
      & npm run package
      $pkgExit = $LASTEXITCODE
      $ErrorActionPreference = $prevPref
      if ($pkgExit -eq 0) { return }
      if ($attempt -ge $maxRetries) {
        throw "$name package failed (exit $pkgExit) after $maxRetries attempt(s)"
      }
      Write-Host ""
      Write-Host "  $name package failed on attempt $attempt of $maxRetries (likely a Defender/indexer race in `$env:TEMP\electron-packager\). Cleaning temp + retrying..." -ForegroundColor Yellow
      Get-ChildItem -Path $env:TEMP -Filter "electron-packager" -Directory -ErrorAction SilentlyContinue | ForEach-Object {
        Remove-Item -Recurse -Force $_.FullName -ErrorAction SilentlyContinue
      }
      Start-Sleep -Seconds 2
    }
  } finally {
    Pop-Location
  }
}

function Remove-LongPathFolder([string]$folder) {
  #PowerShell's Remove-Item -Recurse hits MAX_PATH on deep pm4py
  #__pycache__ trees. cmd's rmdir /S /Q handles long paths via the
  #native Windows shell. PowerShell 5.1 wraps native stderr as
  #NativeCommandError records regardless of `2>$null`, and under
  #$ErrorActionPreference="Stop" those still terminate the script.
  #Locally relaxing the preference around the call is the only thing
  #that reliably suppresses it.
  if (-not (Test-Path $folder)) { return }
  $saved = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try {
    & cmd /c "rmdir /S /Q `"$folder`"" 2>&1 | Out-Null
    if (Test-Path $folder) {
      #Fallback: PowerShell's own deletion (long paths handled in PS 5+
      #on Win10 with long-path support enabled).
      Remove-Item -Recurse -Force -LiteralPath $folder -ErrorAction SilentlyContinue
    }
    if (Test-Path $folder) {
      #Last resort: robocopy mirror from an empty dir. Robocopy uses
      #UNC long-path semantics internally and reliably wins where both
      #rmdir and Remove-Item give up. Exit codes 0-7 are success-ish.
      $empty = Join-Path $env:TEMP "pdt-empty-$(Get-Random)"
      New-Item -ItemType Directory -Path $empty | Out-Null
      & robocopy $empty $folder /MIR /NFL /NDL /NJH /NJS /NC /NS /NP /R:1 /W:1 2>&1 | Out-Null
      Remove-Item -Recurse -Force -LiteralPath $empty -ErrorAction SilentlyContinue
      Remove-Item -Recurse -Force -LiteralPath $folder -ErrorAction SilentlyContinue
    }
  } finally {
    $ErrorActionPreference = $saved
  }
}

if ($Clean) {
  Write-Host "Cleaning previous build outputs..."
  foreach ($d in @($distDir, (Join-Path $captureDir "dist"), (Join-Path $viewerDir "dist"), $viewerNormStage)) {
    Remove-LongPathFolder $d
  }
}

# Step 0: preflight (npm audit + CHANGELOG header integrity + lockfile sync).
# Implicit in every release build; catches three failure modes that have
# bitten this project (corrupt CHANGELOG, drifted lockfile, fresh-advisory
# regression).
Write-Host "[0/5] Preflight sanity checks" -ForegroundColor Yellow
& powershell -NoProfile -ExecutionPolicy RemoteSigned -File (Join-Path $PSScriptRoot "preflight.ps1")
if ($LASTEXITCODE -ne 0) { throw "preflight failed -- see messages above. Fix before building." }
Write-Host ""

# Step 1: Python embeddable
if (-not $SkipPython) {
  Write-Host "[1/5] Building Python embeddable bundle (3-5 min)" -ForegroundColor Yellow
  & powershell -NoProfile -ExecutionPolicy RemoteSigned -File (Join-Path $repoRoot "scripts\build-python-embeddable.ps1") -Force
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
# Top-level .py/.yaml/.yml/.txt/.md files
Get-ChildItem -Path $normalizationDir -File | Where-Object {
  $_.Extension -in ".py", ".yaml", ".yml", ".txt", ".md"
} | ForEach-Object {
  Copy-Item -Force $_.FullName $viewerNormStage
}
# Subdirectories: canonical/, app_vocabularies/. Skip __pycache__ and test/.
foreach ($sub in @("canonical", "app_vocabularies")) {
  $src = Join-Path $normalizationDir $sub
  if (Test-Path $src) {
    $dst = Join-Path $viewerNormStage $sub
    & robocopy $src $dst /E /XD __pycache__ /NFL /NDL /NJH /NJS /NC /NS /NP /R:1 /W:1 | Out-Null
    if ($LASTEXITCODE -ge 8) { throw "staging $sub failed (exit $LASTEXITCODE)" }
  }
}

# Step 3: Capture
Write-Host ""
Write-Host "[3/5] Packaging capture (electron-packager)" -ForegroundColor Yellow
Invoke-NpmPackage $captureDir

# Step 4: Viewer
Write-Host ""
Write-Host "[4/5] Packaging viewer (electron-packager, includes Python + normalization)" -ForegroundColor Yellow
Invoke-NpmPackage $viewerDir

# Slim the packaged Python tree. -SkipPython skips the embeddable
# rebuild (and the slim that runs at the end of that rebuild), so
# without this step the dist tree carries __pycache__ trees that
# accumulated from any dev usage between rebuilds. Slimming the
# packaged copy (not the source) keeps the source warm for `npm
# start` while the shipped tree stays lean.
# Assert EXACTLY one build folder: a stale prior build (different platform/arch
# left behind without -Clean) would make `Select-Object -First 1` slim an
# arbitrary one and ship the other un-slimmed. Fail loudly instead.
$viewerBuildDirs = @(Get-ChildItem (Join-Path $viewerDir "dist") -Directory)
if ($viewerBuildDirs.Count -ne 1) {
  throw "Expected exactly one viewer build folder under viewer\dist, found $($viewerBuildDirs.Count): " +
        "$($viewerBuildDirs.Name -join ', '). Re-run with -Clean to rebuild from a clean dist."
}
$viewerBuildOut = $viewerBuildDirs[0]
$packagedPython = Join-Path $viewerBuildOut.FullName "resources\python"
if ($packagedPython -and (Test-Path $packagedPython)) {
  Write-Host ""
  Write-Host "Slimming packaged Python tree at $packagedPython" -ForegroundColor Yellow
  $sourcePy = Join-Path $viewerDir "python\python.exe"
  # Use the source python.exe to run slim (the packaged tree's
  # python.exe is identical; either works).
  #
  # Locally relax $ErrorActionPreference for this native call: the
  # embedded Python prints a benign "Error processing line 1 of
  # distutils-precedence.pth" warning to stderr on startup, and
  # PowerShell 5.1 wraps any native-command stderr line as a
  # NativeCommandError -- with the script-level "Stop" preference
  # that aborts the build even though slim exits 0. Check
  # $LASTEXITCODE explicitly instead.
  $prevPref = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  & $sourcePy (Join-Path $PSScriptRoot "slim-python-embeddable.py") --path $packagedPython --skip-smoke-test
  $slimExit = $LASTEXITCODE
  $ErrorActionPreference = $prevPref
  if ($slimExit -ne 0) { throw "Slim of packaged Python tree failed (exit $slimExit)" }
}

# Cleanup staged copy
if (Test-Path $viewerNormStage) { Remove-Item -Recurse -Force $viewerNormStage }

# Step 5: Assemble dist/
Write-Host ""
Write-Host "[5/5] Assembling dist/" -ForegroundColor Yellow
Remove-LongPathFolder $distDir
# When Defender / Search indexer hangs onto a file in the just-built
# dist (common on a re-run shortly after the previous build), the
# Remove-LongPathFolder above leaves the dir behind. -Force on
# New-Item is a no-op if the dir already exists; robocopy below will
# overwrite contents irrespective.
New-Item -ItemType Directory -Path $distDir -Force | Out-Null

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

function Resolve-SignTool {
  $cmd = (Get-Command signtool.exe -ErrorAction SilentlyContinue).Source
  if ($cmd) { return $cmd }
  # Fall back to the newest x64 signtool under the Windows 10/11 SDK.
  $sdkBin = "C:\Program Files (x86)\Windows Kits\10\bin"
  if (Test-Path $sdkBin) {
    $found = Get-ChildItem $sdkBin -Recurse -Filter signtool.exe -ErrorAction SilentlyContinue |
      Where-Object { $_.FullName -match "\\x64\\" } | Sort-Object FullName -Descending | Select-Object -First 1
    if ($found) { return $found.FullName }
  }
  return $null
}

function Invoke-SignBinaries([string]$rootFolder, [string]$thumbprint, [string]$timestampUrl) {
  if ([string]::IsNullOrWhiteSpace($thumbprint)) {
    Write-Host "  Code-signing skipped (no -CertThumbprint) for $rootFolder" -ForegroundColor DarkGray
    return
  }
  $signtool = Resolve-SignTool
  if (-not $signtool) {
    throw "signtool.exe not found (install the Windows SDK signing tools) -- required when -CertThumbprint is set."
  }
  $exes = @(Get-ChildItem $rootFolder -Recurse -Filter *.exe -ErrorAction SilentlyContinue)
  if (-not $exes.Count) { Write-Host "  No .exe found under $rootFolder" -ForegroundColor Yellow; return }
  Write-Host "  Signing $($exes.Count) .exe under $rootFolder (cert $thumbprint)" -ForegroundColor Yellow
  foreach ($exe in $exes) {
    & $signtool sign /sha1 $thumbprint /fd SHA256 /tr $timestampUrl /td SHA256 $exe.FullName | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "signtool failed on $($exe.FullName) (exit $LASTEXITCODE)" }
  }
  # Sanity: verify the top-level app exe signed + chains.
  $top = Get-ChildItem $rootFolder -Filter *.exe -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($top) {
    & $signtool verify /pa /q $top.FullName
    if ($LASTEXITCODE -ne 0) { throw "signtool verify failed on $($top.FullName) (exit $LASTEXITCODE)" }
  }
}

Copy-WithRobocopy $captureBuild.FullName (Join-Path $distDir "capture")
Copy-WithRobocopy $viewerBuild.FullName (Join-Path $distDir "viewer")

# Code-sign the assembled binaries (no-op without -CertThumbprint). Signs in
# the final dist/ location so the release zips carry signed exes -- the app
# exes (Process Discovery Tracker.exe / Viewer.exe), the bundled recorder.exe,
# and the Electron helper exes all get signed.
Invoke-SignBinaries (Join-Path $distDir "capture") $CertThumbprint $TimestampUrl
Invoke-SignBinaries (Join-Path $distDir "viewer") $CertThumbprint $TimestampUrl

# Generate SBOM into dist/
Write-Host ""
Write-Host "Generating SBOM..." -ForegroundColor Yellow
& node (Join-Path $repoRoot "scripts\generate-sbom.js") | Out-Null
if ($LASTEXITCODE -ne 0) {
  Write-Host "WARNING: SBOM generation failed; continuing anyway." -ForegroundColor Yellow
}

# User guide
$userGuide = Join-Path $repoRoot "docs\User-Guide.docx"
if (Test-Path $userGuide) {
  Copy-Item $userGuide (Join-Path $distDir "User-Guide.docx")
}

# Security docs that recipients / security teams want
foreach ($doc in @("SECURITY.md", "LICENSE", "docs\Security-QA.md")) {
  $src = Join-Path $repoRoot $doc
  if (Test-Path $src) {
    Copy-Item $src (Join-Path $distDir (Split-Path -Leaf $src))
  }
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
- App Library "Discover from window" borrows the recorder from a co-located
  capture app: extract the ``capture/`` folder alongside ``viewer/`` (same parent)
  for that one feature. Every other viewer feature is standalone.
- Size on disk: $([math]::Round($viewerSize / 1MB, 1)) MB.

### User-Guide.docx
Complete user guide covering installation, configuration, OBS setup,
running a session, reviewing in the viewer, aggregate analysis, exports,
annotations, keyboard shortcuts, install topology, and troubleshooting.

### Security artifacts (for corp security review)
- ``SECURITY.md`` - threat model, data flows, network behavior, Electron hardening, input validation, dependency audit status, vulnerability reporting.
- ``Security-QA.md`` - one-page Q&A for fast-track security review.
- ``LICENSE`` - internal-use license.
- ``SBOM.json`` - CycloneDX 1.5 software bill of materials, ~400 components covering both apps and the bundled Python.

## Installation

Both apps are portable (no installer). To deploy:

1. Copy the relevant folder to the target machine (anywhere - Program Files,
   ``C:\Tools\``, the user's profile, your call).
2. Optionally pin the .exe to the taskbar or create a Start Menu shortcut.
3. For capture, install OBS Studio 28+ if you want video recording, and
   enable Tools > WebSocket Server Settings (port 4455). Capture works
   without OBS but produces no video.

## SmartScreen note

These binaries are **unsigned by design** (ADR-0026 — PDT is the owner's IP and
is not signed under the employer's certificate). First launch on a fresh machine
may show "Windows protected your PC"; click **More info > Run anyway**. This is
expected for an internal, unzip-and-run tool.

## See also

- ``../process_discovery_tracker_design.md`` - full design doc (kept at the
  repo root; not shipped in dist by default).
- In-app help: tray menu -> Help (capture), ? button in topbar (viewer).
"@

Set-Content -Path $distMd -Value $distMdContent -Encoding UTF8

# Zip the unzipped dist trees into release assets unless skipped.
$releaseAssets = @()
if (-not $SkipRelease) {
  # Resolve version: explicit flag wins, else capture/package.json.
  $releaseVersion = $Version
  if ([string]::IsNullOrWhiteSpace($releaseVersion)) {
    $pkgJson = Join-Path $captureDir "package.json"
    if (Test-Path $pkgJson) {
      try {
        $releaseVersion = (Get-Content $pkgJson -Raw | ConvertFrom-Json).version
      } catch {
        $releaseVersion = $null
      }
    }
  }
  if ([string]::IsNullOrWhiteSpace($releaseVersion)) {
    $releaseVersion = (Get-Date).ToString("yyyy.MM.dd")
    Write-Host "WARNING: no version in capture/package.json; using date-stamp $releaseVersion" -ForegroundColor Yellow
  }

  Write-Host ""
  Write-Host "Zipping release assets (v$releaseVersion)" -ForegroundColor Yellow
  $releaseDir = Join-Path $distDir "release"
  Remove-LongPathFolder $releaseDir
  New-Item -ItemType Directory -Path $releaseDir | Out-Null

  $tar = Join-Path $env:WINDIR "System32\tar.exe"
  if (-not (Test-Path $tar)) {
    throw "tar.exe not found at $tar. Windows 10+ required (libarchive-backed tar produces .zip)."
  }

  # tar -a -cf foo.zip -C parent topdir  archives "topdir/..." -- a single
  # named folder at the zip root, which is what Windows Explorer's
  # "Extract All" wants. Earlier versions archived "." which produced
  # entries with a leading "./" prefix and silently extracted to an
  # empty folder under Windows Shell. We use a directory junction
  # (mklink /J) rather than Rename-Item: junctions are instant,
  # consume no extra disk, and -- crucially -- aren't blocked by file
  # locks that linger on the freshly-built tree from Defender / Search
  # indexing. tar transparently follows the junction.
  foreach ($appName in @("capture", "viewer")) {
    $appRoot = Join-Path $distDir $appName
    if (-not (Test-Path $appRoot)) {
      Write-Host "  [skip] $appName -- $appRoot not present" -ForegroundColor DarkGray
      continue
    }
    $versioned = "$appName-v$releaseVersion"
    $junction = Join-Path $distDir $versioned
    if (Test-Path $junction) {
      & cmd /c "rmdir `"$junction`"" 2>$null | Out-Null
    }
    & cmd /c "mklink /J `"$junction`" `"$appRoot`"" 2>$null | Out-Null
    if (-not (Test-Path $junction)) {
      throw "mklink /J failed for $appName -> $junction"
    }
    try {
      $asset = Join-Path $releaseDir "$versioned.zip"
      Write-Host "  $asset" -ForegroundColor Cyan
      & $tar -a -cf $asset -C $distDir $versioned
      if ($LASTEXITCODE -ne 0) {
        throw "tar -a -cf failed (exit $LASTEXITCODE) for $appName"
      }
      $releaseAssets += $asset
    } finally {
      # rmdir on a junction deletes the link, not the target tree.
      & cmd /c "rmdir `"$junction`"" 2>$null | Out-Null
    }
  }
}

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
if ($releaseAssets.Count -gt 0) {
  Write-Host ""
  Write-Host "Release assets:"
  foreach ($a in $releaseAssets) {
    $sz = (Get-Item $a).Length
    Write-Host ("  {0}  ({1:N1} MB)" -f $a, ($sz / 1MB))
  }
  Write-Host ""
  Write-Host "Upload via: scripts\publish-release.ps1 -Version $releaseVersion"
  Write-Host "    or:     gh release create v$releaseVersion <asset>... --notes-file CHANGELOG.md"
}
