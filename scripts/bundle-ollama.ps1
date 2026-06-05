<#
.SYNOPSIS
Bundle Ollama + the configured model into viewer/ollama/ for self-contained release.

.DESCRIPTION
PDT 1.0 ships to machines where Ollama is NOT installed. The viewer's
release bundle includes the ollama binary, required runtime DLLs, and
the model blobs so the Naming Layer (ADR-0028) works out of the box.

GPU acceleration libs (cuda_v12, cuda_v13, rocm_v7_1 — ~3 GB combined)
are EXCLUDED. Local-first AI on a worker's laptop runs CPU-only; that's
fine for a 1.5B model (a few seconds per cluster name on commodity
hardware). The bundle stays under ~1.1 GB instead of ~4 GB.

.PARAMETER OllamaSource
Where the installed Ollama lives. Defaults to D:\Ollama.

.PARAMETER ModelsSource
Where ollama keeps its model blobs. Defaults to D:\ollama-models.

.PARAMETER Model
Which model tag to bundle. Defaults to qwen2.5:1.5b-instruct.

.PARAMETER Destination
viewer/ollama/ target. Defaults to the project's viewer/ollama/ path.
#>

param(
  [string]$OllamaSource = "D:\Ollama",
  [string]$ModelsSource = "D:\ollama-models",
  [string]$Model = "qwen2.5:1.5b-instruct",
  [string]$EmbedModel = "all-minilm",
  [string]$Destination = ""
)

$ErrorActionPreference = "Stop"

if (-not $Destination) {
  $repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
  $Destination = Join-Path $repoRoot "viewer\ollama"
}

Write-Host "PDT 1.0 - Bundle Ollama into viewer release" -ForegroundColor Cyan
Write-Host "  source binary:  $OllamaSource"
Write-Host "  source models:  $ModelsSource"
Write-Host "  model:          $Model"
Write-Host "  destination:    $Destination"
Write-Host ""

if (-not (Test-Path $OllamaSource)) {
  throw "Ollama source not found at $OllamaSource. Run setup-ollama.ps1 first."
}
if (-not (Test-Path $ModelsSource)) {
  throw "Models source not found at $ModelsSource. Run setup-ollama.ps1 first."
}

# Fresh destination.
if (Test-Path $Destination) {
  Remove-Item -Path $Destination -Recurse -Force
}
New-Item -ItemType Directory -Force -Path $Destination | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $Destination "bin") | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $Destination "lib\ollama") | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $Destination "models") | Out-Null

# 1. Binary.
Write-Host "[1/3] Copying ollama.exe..." -ForegroundColor Yellow
Copy-Item -Path (Join-Path $OllamaSource "ollama.exe") `
          -Destination (Join-Path $Destination "bin\ollama.exe") -Force

# 2. Runtime libs (CPU-only — skip cuda_v12 / cuda_v13 / rocm_v7_1).
Write-Host "[2/3] Copying CPU runtime libs (skipping CUDA/ROCm)..." -ForegroundColor Yellow
$libSrc = Join-Path $OllamaSource "lib\ollama"
$libDst = Join-Path $Destination "lib\ollama"
Get-ChildItem -Path $libSrc -File | ForEach-Object {
  Copy-Item -Path $_.FullName -Destination $libDst -Force
}

# 3. Model blobs + manifest for the configured models (LLM + embedding).
Write-Host "[3/3] Copying models: $Model + $EmbedModel ..." -ForegroundColor Yellow
$blobsSrc = Join-Path $ModelsSource "blobs"
$blobsDst = Join-Path $Destination "models\blobs"
$manifestsSrc = Join-Path $ModelsSource "manifests"
$manifestsDst = Join-Path $Destination "models\manifests"
New-Item -ItemType Directory -Force -Path $blobsDst | Out-Null
Copy-Item -Path $manifestsSrc -Destination $manifestsDst -Recurse -Force

function Copy-ModelBlobs {
  param([string]$ModelTag)
  $parts = $ModelTag -split ':'
  $family = $parts[0]
  $tag = if ($parts.Length -gt 1) { $parts[1] } else { 'latest' }
  $manifestFile = Join-Path $manifestsSrc "registry.ollama.ai\library\$family\$tag"
  if (-not (Test-Path $manifestFile)) {
    Write-Host "  WARNING: manifest missing for $ModelTag at $manifestFile" -ForegroundColor Red
    return
  }
  $manifestJson = Get-Content $manifestFile -Raw | ConvertFrom-Json
  $digests = @($manifestJson.config.digest)
  foreach ($l in $manifestJson.layers) { $digests += $l.digest }
  foreach ($d in ($digests | Sort-Object -Unique)) {
    $blobName = $d -replace ':', '-'
    $src = Join-Path $blobsSrc $blobName
    if (Test-Path $src) {
      Copy-Item -Path $src -Destination $blobsDst -Force
    } else {
      Write-Host "  WARNING: missing blob $blobName for $ModelTag" -ForegroundColor Red
    }
  }
}

Copy-ModelBlobs -ModelTag $Model
Copy-ModelBlobs -ModelTag $EmbedModel

# Marker file declaring what is bundled.
$markerObj = @{
  bundled_model       = $Model
  bundled_embed_model = $EmbedModel
  bundled_at          = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
  bundle_format       = 2
}
$markerJson = $markerObj | ConvertTo-Json
$markerPath = Join-Path $Destination "BUNDLE.json"
[System.IO.File]::WriteAllText($markerPath, $markerJson)

$size = (Get-ChildItem $Destination -Recurse -File |
         Measure-Object -Property Length -Sum).Sum
Write-Host ""
Write-Host ("Bundle ready at: " + $Destination) -ForegroundColor Green
Write-Host ("Total size:      " + [math]::Round($size/1MB, 1) + " MB") -ForegroundColor Green
