<#
.SYNOPSIS
  Creates a GitHub Release and uploads the prebuilt asset zips.

.DESCRIPTION
  Expects scripts/build-distribution.ps1 to have already produced:
    dist/release/capture-v<version>.zip
    dist/release/viewer-v<version>.zip

  Then calls `gh release create v<version> <assets>` to publish them.
  The release notes default to a one-line title; pass -NotesFile to
  supply a richer body (e.g. CHANGELOG.md).

  Requires the GitHub CLI (`gh`) authenticated to the repo. If the
  current working directory is inside the repo, `gh` picks up the
  remote automatically. Run `gh auth login` once on a new machine.

.PARAMETER Version
  Release version, e.g. "0.2.0". Must match what was passed to
  build-distribution.ps1 (or the package.json default). Required.

.PARAMETER NotesFile
  Path to a markdown file used as the release body. Optional.

.PARAMETER NotesFromChangelog
  Extract just the `## [<Version>]` section from CHANGELOG.md at the
  repo root and use that as the release body. Preferred over passing
  the whole CHANGELOG.

.PARAMETER Title
  Release title. Defaults to "Process Discovery Tracker v<Version>".

.PARAMETER Draft
  Create as a draft (not published). Useful for previewing.

.PARAMETER Prerelease
  Mark as a pre-release.

.EXAMPLE
  .\scripts\publish-release.ps1 -Version 0.2.0 -NotesFromChangelog
  .\scripts\publish-release.ps1 -Version 0.2.0 -NotesFile CHANGELOG.md
  .\scripts\publish-release.ps1 -Version 0.2.0 -Draft
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$Version,
  [string]$NotesFile,
  [switch]$NotesFromChangelog,
  [string]$Title,
  [switch]$Draft,
  [switch]$Prerelease
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
$releaseDir = Join-Path $repoRoot "dist\release"

if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
  throw "gh CLI not found on PATH. Install from https://cli.github.com/ and run 'gh auth login'."
}

$captureAsset = Join-Path $releaseDir "capture-v$Version.zip"
$viewerAsset = Join-Path $releaseDir "viewer-v$Version.zip"
foreach ($a in @($captureAsset, $viewerAsset)) {
  if (-not (Test-Path $a)) {
    throw "Asset missing: $a`nRun: .\scripts\build-distribution.ps1 -Version $Version"
  }
}

if ([string]::IsNullOrWhiteSpace($Title)) {
  $Title = "Process Discovery Tracker v$Version"
}

# Resolve release-notes source. Precedence:
#   1. -NotesFile (explicit path wins)
#   2. -NotesFromChangelog (extract just the version's section)
#   3. Generic fallback string
$tempNotesFile = $null
if ($NotesFile) {
  if (-not (Test-Path $NotesFile)) { throw "NotesFile not found: $NotesFile" }
  $notesArg = $NotesFile
} elseif ($NotesFromChangelog) {
  $changelog = Join-Path $repoRoot "CHANGELOG.md"
  if (-not (Test-Path $changelog)) {
    throw "CHANGELOG.md not found at $changelog; pass -NotesFile instead."
  }
  # Capture lines from `## [<Version>]` (exclusive of the header) to the
  # next `## [` heading. Section header lives in the first match group.
  $lines = Get-Content $changelog
  $inSection = $false
  $section = @()
  $headerPattern = '^##\s+\[' + [regex]::Escape($Version) + '\](\s|$)'
  foreach ($l in $lines) {
    if ($inSection -and $l -match '^##\s+\[') { break }
    if ($l -match $headerPattern) { $inSection = $true; continue }
    if ($inSection) { $section += $l }
  }
  if ($section.Count -eq 0) {
    throw "No `## [$Version]` section in CHANGELOG.md."
  }
  $tempNotesFile = New-TemporaryFile
  Set-Content -Path $tempNotesFile -Value ($section -join "`n") -Encoding UTF8
  $notesArg = $tempNotesFile.FullName
} else {
  $notesArg = $null
}

$ghArgs = @("release", "create", "v$Version", $captureAsset, $viewerAsset, "--title", $Title)
if ($notesArg) {
  $ghArgs += @("--notes-file", $notesArg)
} else {
  $ghArgs += @("--notes", "Prebuilt Windows binaries. See README for install steps.")
}
if ($Draft) { $ghArgs += "--draft" }
if ($Prerelease) { $ghArgs += "--prerelease" }

Write-Host "Creating release v$Version with:" -ForegroundColor Cyan
Write-Host "  $captureAsset"
Write-Host "  $viewerAsset"
Write-Host ""
try {
  & gh @ghArgs
  if ($LASTEXITCODE -ne 0) {
    throw "gh release create failed (exit $LASTEXITCODE). If the tag already exists, delete it first: gh release delete v$Version --yes; git push origin :refs/tags/v$Version"
  }
  Write-Host ""
  Write-Host "Release v$Version published." -ForegroundColor Green
} finally {
  if ($tempNotesFile -and (Test-Path $tempNotesFile)) {
    Remove-Item $tempNotesFile -Force -ErrorAction SilentlyContinue
  }
}
