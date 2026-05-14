<#
.SYNOPSIS
  Builds a portable python-embeddable bundle alongside the viewer.

.DESCRIPTION
  Downloads the python-embeddable distribution from python.org, enables
  site-packages, installs the normalization requirements, and produces
  a self-contained python\ folder next to viewer\main.js.

  Result: viewer\python\python.exe with PM4Py + pandas + networkx + pyyaml
  preinstalled. No admin rights, no installer, no registry writes, no
  PATH changes. The viewer's python-runner.js auto-discovers this layout.

.PARAMETER PythonVersion
  Embedded Python version to download. Default: 3.11.9.

.PARAMETER Force
  Overwrite an existing viewer\python\ folder.

.EXAMPLE
  .\scripts\build-python-embeddable.ps1
  .\scripts\build-python-embeddable.ps1 -PythonVersion 3.12.4 -Force
#>
[CmdletBinding()]
param(
  [string]$PythonVersion = "3.11.9",
  [switch]$Force
)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$viewerDir = Join-Path $repoRoot "viewer"
$targetDir = Join-Path $viewerDir "python"
$normDir = Join-Path $repoRoot "normalization"

if (-not (Test-Path $viewerDir)) {
  throw "viewer folder not found at $viewerDir (run from the repo root)"
}
if (-not (Test-Path $normDir)) {
  throw "normalization folder not found at $normDir"
}

if (Test-Path $targetDir) {
  if ($Force) {
    Write-Host "Removing existing $targetDir"
    Remove-Item -Recurse -Force $targetDir
  } else {
    throw "$targetDir already exists. Pass -Force to overwrite."
  }
}

$workDir = Join-Path $env:TEMP "pdt-py-build"
if (Test-Path $workDir) { Remove-Item -Recurse -Force $workDir }
New-Item -ItemType Directory -Path $workDir | Out-Null

$arch = if ([Environment]::Is64BitOperatingSystem) { "amd64" } else { "win32" }
$zipName = "python-$PythonVersion-embed-$arch.zip"
$url = "https://www.python.org/ftp/python/$PythonVersion/$zipName"
$zipPath = Join-Path $workDir $zipName

Write-Host "Downloading $url"
Invoke-WebRequest -Uri $url -OutFile $zipPath

Write-Host "Extracting to $targetDir"
New-Item -ItemType Directory -Path $targetDir | Out-Null
Expand-Archive -Path $zipPath -DestinationPath $targetDir -Force

# Enable site-packages so pip installs work. The embeddable distribution
# ships with site disabled by default via a python<major><minor>._pth file.
$pthFile = Get-ChildItem -Path $targetDir -Filter "python*._pth" | Select-Object -First 1
if (-not $pthFile) { throw "Could not locate python*._pth in $targetDir" }
Write-Host "Patching $($pthFile.Name) to enable site-packages"
$content = Get-Content -Raw -Path $pthFile.FullName
$content = $content -replace '(?m)^#?\s*import\s+site\s*$', "import site"
if ($content -notmatch "import site") { $content += "`r`nimport site`r`n" }
Set-Content -Path $pthFile.FullName -Value $content -Encoding UTF8

# Bootstrap pip via get-pip.py
$getPip = Join-Path $workDir "get-pip.py"
Write-Host "Downloading get-pip.py"
Invoke-WebRequest -Uri "https://bootstrap.pypa.io/get-pip.py" -OutFile $getPip

$pythonExe = Join-Path $targetDir "python.exe"
Write-Host "Bootstrapping pip"
& $pythonExe $getPip --no-warn-script-location
if ($LASTEXITCODE -ne 0) { throw "get-pip.py failed with exit code $LASTEXITCODE" }

# Install normalization dependencies
$reqs = Join-Path $normDir "requirements.txt"
Write-Host "Installing $reqs"
& $pythonExe -m pip install --no-warn-script-location -r $reqs
if ($LASTEXITCODE -ne 0) { throw "pip install failed with exit code $LASTEXITCODE" }

# Smoke test
Write-Host "Smoke-testing the bundle"
& $pythonExe -c "import pm4py, pandas, networkx, yaml; print('PM4Py:', pm4py.__version__, 'pandas:', pandas.__version__)"
if ($LASTEXITCODE -ne 0) { throw "Smoke test failed" }

# Clean up working dir
Remove-Item -Recurse -Force $workDir

Write-Host ""
Write-Host "Done. Bundle is at: $targetDir" -ForegroundColor Green
Write-Host "The viewer's python-runner.js will auto-discover this folder."
Write-Host "Bundle size:"
$size = (Get-ChildItem -Recurse $targetDir | Measure-Object -Property Length -Sum).Sum
Write-Host ("  {0:N1} MB" -f ($size / 1MB))
