<#
.SYNOPSIS
  Pre-commit / pre-release sanity gate.

.DESCRIPTION
  Runs three independent checks, any of which can fail the gate:

  1. **Runtime dependency audit.** `npm audit --omit=dev` against both
     apps. Exits non-zero on any critical / high advisory (and on
     moderate too if -FailOnModerate). Use as a pre-commit / pre-push
     hook or in CI.

  2. **CHANGELOG header integrity.** Every `## [X.Y.Z]` version header
     present at the latest git tag must still be present in
     CHANGELOG.md. Catches the failure mode where a section header is
     accidentally removed and its content rolls into [Unreleased]
     (which happened at the v0.17.0 prep -- the [0.16.3] header had
     been silently absorbed by an earlier commit).

  3. **package.json / package-lock.json version sync.** The lockfile's
     root `version` field must match `package.json`. Catches the
     failure mode where the version is bumped in package.json without
     running `npm install` (viewer/package-lock.json had lagged four
     minor versions before the v0.17.0 prep caught it).

  build-distribution.ps1 invokes this as step zero, so a clean
  preflight is implicit in every release build.

.PARAMETER FailOnModerate
  Also fail on moderate npm advisories. Default: only critical + high.

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

function Test-ChangelogHeaders([string]$repoRoot) {
  $changelogPath = Join-Path $repoRoot "CHANGELOG.md"
  if (-not (Test-Path $changelogPath)) {
    return [PSCustomObject]@{ Skipped = $true; Reason = "CHANGELOG.md not found" }
  }
  $latestTag = $null
  $prevPref = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try {
    $latestTag = (& git -C $repoRoot describe --tags --abbrev=0 2>$null)
  } finally {
    $ErrorActionPreference = $prevPref
  }
  if (-not $latestTag) {
    return [PSCustomObject]@{ Skipped = $true; Reason = "no git tags yet" }
  }
  $latestTag = $latestTag.Trim()

  $prevPref = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try {
    $oldChangelog = (& git -C $repoRoot show "${latestTag}:CHANGELOG.md" 2>$null) -join "`n"
  } finally {
    $ErrorActionPreference = $prevPref
  }
  if ([string]::IsNullOrWhiteSpace($oldChangelog)) {
    return [PSCustomObject]@{ Skipped = $true; Reason = "tag $latestTag has no CHANGELOG.md" }
  }

  $newChangelog = Get-Content $changelogPath -Raw
  $pattern = '(?m)^## \[\d[^\]]+\][^\r\n]*'
  $oldHeaders = [regex]::Matches($oldChangelog, $pattern) | ForEach-Object { $_.Value.Trim() }
  $newHeaders = [regex]::Matches($newChangelog, $pattern) | ForEach-Object { $_.Value.Trim() }
  $missing = @($oldHeaders | Where-Object { $newHeaders -notcontains $_ })
  return [PSCustomObject]@{
    Skipped = $false
    Tag     = $latestTag
    OldCount = $oldHeaders.Count
    NewCount = $newHeaders.Count
    Missing = $missing
  }
}

function Get-TopLevelVersion([string]$path) {
  # Read the version field from the top of a package.json / package-lock.json.
  # Avoids ConvertFrom-Json -- PS 5.1's parser chokes on the empty-string
  # property keys ({"packages": {"": {...}}}) that npm v3+ uses in lockfiles.
  # The "version" field is always among the first handful of lines in both
  # file shapes, so a head + regex is robust and avoids the JSON parser
  # entirely.
  $head = Get-Content $path -TotalCount 12
  foreach ($line in $head) {
    if ($line -match '^\s*"version":\s*"([^"]+)"') {
      return $matches[1]
    }
  }
  return $null
}

function Test-LockfileSync([string]$repoRoot) {
  $mismatches = @()
  foreach ($appName in @("capture", "viewer")) {
    $appPath = Join-Path $repoRoot $appName
    $pkgPath = Join-Path $appPath "package.json"
    $lockPath = Join-Path $appPath "package-lock.json"
    if ((Test-Path $pkgPath) -and (Test-Path $lockPath)) {
      $pkgVersion = Get-TopLevelVersion $pkgPath
      $lockVersion = Get-TopLevelVersion $lockPath
      if ($pkgVersion -ne $lockVersion) {
        $mismatches += [PSCustomObject]@{
          App = $appName
          PackageJsonVersion = $pkgVersion
          LockfileVersion = $lockVersion
        }
      }
    }
  }
  return $mismatches
}

$failed = $false

# === Check 1: npm audit ===

Write-Host "Preflight 1/3: runtime dependency audit" -ForegroundColor Cyan
$results = @()
foreach ($app in @("capture", "viewer")) {
  $dir = Join-Path $repoRoot $app
  if (Test-Path (Join-Path $dir "package.json")) {
    $results += Audit-App $dir
  }
}
$results | Format-Table -AutoSize

foreach ($r in $results) {
  if ($r.Critical -gt 0 -or $r.High -gt 0) { $failed = $true }
  if ($FailOnModerate -and $r.Moderate -gt 0) { $failed = $true }
}

if ($failed) {
  Write-Host "FAIL: runtime dependency audit found critical or high advisories." -ForegroundColor Red
  Write-Host "Run 'npm audit --omit=dev' inside the affected app for details," -ForegroundColor Red
  Write-Host "then update package.json overrides or upgrade the offending package." -ForegroundColor Red
} else {
  Write-Host "  OK: no critical or high runtime advisories." -ForegroundColor Green
}

# === Check 2: CHANGELOG header integrity ===

Write-Host ""
Write-Host "Preflight 2/3: CHANGELOG header integrity" -ForegroundColor Cyan
$cl = Test-ChangelogHeaders $repoRoot
if ($cl.Skipped) {
  Write-Host "  Skipped: $($cl.Reason)" -ForegroundColor DarkGray
} elseif ($cl.Missing.Count -gt 0) {
  Write-Host "  FAIL: version headers present at $($cl.Tag) are missing in current CHANGELOG.md:" -ForegroundColor Red
  foreach ($h in $cl.Missing) { Write-Host "    $h" -ForegroundColor Red }
  Write-Host "  Restore the missing headers before committing." -ForegroundColor Red
  $failed = $true
} else {
  Write-Host "  OK: $($cl.OldCount) version headers from $($cl.Tag) still present (current has $($cl.NewCount))." -ForegroundColor Green
}

# === Check 3: lockfile / package.json version sync ===

Write-Host ""
Write-Host "Preflight 3/3: lockfile version sync" -ForegroundColor Cyan
$lockMismatches = Test-LockfileSync $repoRoot
if ($lockMismatches.Count -gt 0) {
  Write-Host "  FAIL: package.json / package-lock.json version mismatch:" -ForegroundColor Red
  foreach ($m in $lockMismatches) {
    Write-Host "    $($m.App): package.json=$($m.PackageJsonVersion)  vs  package-lock.json=$($m.LockfileVersion)" -ForegroundColor Red
  }
  Write-Host "  Run 'npm install' in the affected app dir to sync." -ForegroundColor Red
  $failed = $true
} else {
  Write-Host "  OK: capture + viewer lockfiles match package.json." -ForegroundColor Green
}

Write-Host ""
if ($failed) {
  Write-Host "Preflight FAILED. See messages above." -ForegroundColor Red
  exit 1
}
Write-Host "Preflight OK." -ForegroundColor Green
exit 0
