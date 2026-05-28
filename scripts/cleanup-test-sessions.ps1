<#
.SYNOPSIS
  Delete test-session artifacts under sessions/ (gitignored, but they
  accumulate disk space across test runs).

.DESCRIPTION
  Removes the following gitignored test-output folders:
    sessions/_real         (early integration tests)
    sessions/_real_suite   (real-data test suite)
    sessions/_demo         (synthetic demo generator)
    sessions/_testsuite    (synthetic test suite)

  Run from the repo root:
    powershell -ExecutionPolicy Bypass -File scripts\cleanup-test-sessions.ps1

  Use -WhatIf to preview, -Force to skip the confirmation.
#>
[CmdletBinding(SupportsShouldProcess = $true)]
param(
  [switch]$Force
)

$ErrorActionPreference = 'Stop'
$RepoRoot = Split-Path -Parent $PSScriptRoot
$Sessions = Join-Path $RepoRoot 'sessions'

$Targets = @('_real', '_real_suite', '_demo', '_testsuite') |
  ForEach-Object { Join-Path $Sessions $_ } |
  Where-Object { Test-Path $_ }

if (-not $Targets) {
  Write-Host "No test-session folders present. Nothing to clean."
  return
}

Write-Host "Will remove:"
foreach ($t in $Targets) {
  $size = (Get-ChildItem -Path $t -Recurse -Force -ErrorAction SilentlyContinue |
           Measure-Object -Property Length -Sum).Sum
  $mb = if ($size) { [math]::Round($size / 1MB, 1) } else { 0 }
  Write-Host ("  {0}  ({1} MB)" -f $t, $mb)
}

if (-not $Force) {
  $reply = Read-Host "Proceed? [y/N]"
  if ($reply -notmatch '^[yY]') {
    Write-Host "Aborted."
    return
  }
}

foreach ($t in $Targets) {
  if ($PSCmdlet.ShouldProcess($t, "Remove-Item -Recurse -Force")) {
    Remove-Item -Path $t -Recurse -Force -ErrorAction Continue
    Write-Host "Removed $t"
  }
}
Write-Host "Done."
