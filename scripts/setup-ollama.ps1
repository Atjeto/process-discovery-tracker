<#
.SYNOPSIS
PDT 1.0 Naming Layer — local Ollama setup helper (ADR-0028).

.DESCRIPTION
The Naming Layer is local-first and not bundled. This script installs
Ollama, configures it to keep its model storage on D: (the dev machine's
C: is constrained — see CLAUDE memory `project_c_drive_full_extract_to_d`),
and pulls a small instruction-tuned model so `viewer/python/python.exe
normalization/normalize.py <session> --mine` produces AI-named activity
clusters instead of falling back to the heuristic process_label.

After this script completes, the Cockpit will display the "AI" badge on
named clusters and PDD exports will carry an LLM-drafted §1 paragraph.
Without it, the system runs identically — NullBackend → heuristic
fallbacks — per the graceful-degrade rule in ADR-0028.

.PARAMETER Model
The Ollama model tag to pull. Defaults to qwen2.5:1.5b-instruct (about
1 GB; reasonable quality for short activity names). For higher quality
exec-summary prose, the spec recommends llama3.1:8b-instruct (~5 GB) or
qwen2.5:14b-instruct (~9 GB).

.PARAMETER ModelsDir
Where Ollama stores its model files. Defaults to D:\ollama-models.

.EXAMPLE
.\scripts\setup-ollama.ps1

.EXAMPLE
.\scripts\setup-ollama.ps1 -Model "llama3.1:8b-instruct"
#>

param(
  [string]$Model = "qwen2.5:1.5b-instruct",
  [string]$ModelsDir = "D:\ollama-models"
)

$ErrorActionPreference = "Stop"

Write-Host "PDT 1.0 — Ollama setup for the Naming Layer (ADR-0028)" -ForegroundColor Cyan
Write-Host ""

# 1. Set OLLAMA_MODELS so Ollama doesn't try to write to %USERPROFILE%
# (which is on C:, where space is constrained on this dev box).
New-Item -ItemType Directory -Force -Path $ModelsDir | Out-Null
[Environment]::SetEnvironmentVariable("OLLAMA_MODELS", $ModelsDir, "User")
$env:OLLAMA_MODELS = $ModelsDir
Write-Host "[1/4] OLLAMA_MODELS = $ModelsDir" -ForegroundColor Green

# 2. Check if Ollama is already installed.
$ollama = Get-Command ollama -ErrorAction SilentlyContinue
if (-not $ollama) {
  Write-Host "[2/4] Ollama not installed. Downloading the official installer..." -ForegroundColor Yellow
  $installer = "$ModelsDir\OllamaSetup.exe"
  Invoke-WebRequest -Uri "https://ollama.com/download/OllamaSetup.exe" `
                    -OutFile $installer -UseBasicParsing
  Write-Host "      Downloaded to $installer. Running installer (silent)..." -ForegroundColor Yellow
  Start-Process -FilePath $installer -ArgumentList "/SILENT" -Wait
  Write-Host "      Ollama installed." -ForegroundColor Green
} else {
  Write-Host "[2/4] Ollama already installed at $($ollama.Source)" -ForegroundColor Green
}

# 3. Confirm the service is reachable.
$ready = $false
for ($i = 0; $i -lt 20; $i++) {
  try {
    Invoke-WebRequest -Uri "http://localhost:11434/api/tags" -TimeoutSec 2 `
                      -UseBasicParsing -ErrorAction Stop | Out-Null
    $ready = $true
    break
  } catch {
    Start-Sleep -Seconds 1
  }
}
if (-not $ready) {
  Write-Host "[3/4] Ollama service not reachable on localhost:11434." -ForegroundColor Red
  Write-Host "      Launch it manually: ollama serve" -ForegroundColor Red
  exit 2
}
Write-Host "[3/4] Ollama service ready on localhost:11434" -ForegroundColor Green

# 4. Pull the model.
Write-Host "[4/4] Pulling model: $Model ..." -ForegroundColor Yellow
& ollama pull $Model
if ($LASTEXITCODE -ne 0) {
  Write-Host "      ollama pull failed (exit $LASTEXITCODE)" -ForegroundColor Red
  exit 3
}
Write-Host "      Model ready." -ForegroundColor Green
Write-Host ""

# 5. Wire the model name into the Python backend default.
Write-Host "Ollama is set up. The Naming Layer will now use it on the next"
Write-Host "normalize run. To pick a different model in code, set the"
Write-Host "PDT_OLLAMA_MODEL environment variable before launching the viewer."
[Environment]::SetEnvironmentVariable("PDT_OLLAMA_MODEL", $Model, "User")
$env:PDT_OLLAMA_MODEL = $Model
Write-Host ""
Write-Host "PDT_OLLAMA_MODEL = $Model"
Write-Host ""
Write-Host "Done. Run any normalize and watch for '[normalize] naming: N/M clusters named'"
Write-Host "in the output."
