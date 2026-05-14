<#
.SYNOPSIS
  Pre-commit / pre-release security audit gate.

.DESCRIPTION
  Runs npm audit --omit=dev against both apps. Exits non-zero if any
  critical or high advisory is found in runtime dependencies. Use as
  a pre-commit / pre-push hook or in CI.

.PARAMETER FailOnModerate
  Also fail on moderate advisories. Default: only critical + high gate.

.EXAMPLE
  .\scripts\preflight.ps1
  .\scripts\preflight.ps1 -FailOnModerate
#>
[CmdletBinding()]
param(
  [switch]$FailOnModerate
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot

function Audit-App([string]$appDir) {
  $name = Split-Path -Leaf $appDir
  Push-Location $appDir
  try {
    $json = npm audit --omit=dev --json 2>$null | Out-String
    $data = $json | ConvertFrom-Json
    $v = $data.metadata.vulnerabilities
    $row = [PSCustomObject]@{
      App      = $name
      Critical = [int]$v.critical
      High     = [int]$v.high
      Moderate = [int]$v.moderate
      Low      = [int]$v.low
    }
    return $row
  } finally {
    Pop-Location
  }
}

Write-Host "Preflight: runtime dependency audit" -ForegroundColor Cyan
Write-Host ""

$results = @()
foreach ($app in @("capture", "viewer")) {
  $dir = Join-Path $repoRoot $app
  if (Test-Path (Join-Path $dir "package.json")) {
    $results += Audit-App $dir
  }
}

$results | Format-Table -AutoSize

$failed = $false
foreach ($r in $results) {
  if ($r.Critical -gt 0 -or $r.High -gt 0) { $failed = $true }
  if ($FailOnModerate -and $r.Moderate -gt 0) { $failed = $true }
}

if ($failed) {
  Write-Host "FAIL: runtime dependency audit found critical or high advisories." -ForegroundColor Red
  Write-Host "Run 'npm audit --omit=dev' inside the affected app for details," -ForegroundColor Red
  Write-Host "then update package.json overrides or upgrade the offending package." -ForegroundColor Red
  exit 1
}

Write-Host "OK: no critical or high runtime advisories." -ForegroundColor Green
exit 0
