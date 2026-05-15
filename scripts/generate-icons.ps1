<#
.SYNOPSIS
  Generates the brand-square app icon (PNG + ICO) from CSS tokens.

.DESCRIPTION
  Renders the topbar brand-square design from viewer/styles.css
  (.brand .logo) as a rasterised icon at multiple resolutions. Drops:

    capture/tray-icon.png        32x32, used by Tray (Win shrinks to 16)
    shared/tracker-icon.ico      multi-res ICO with 16/32/48/64/128/256

  Both build-package.js files reference shared/tracker-icon.ico via
  the electron-packager `icon:` option, so the .exe + Window chrome
  + Start menu entry + taskbar all show the brand square instead of
  the default Electron diamond.

  The previous tray-icon.png was the Motif three-bar logo (wrong
  product); this overwrites it with the matching brand asset.

  Uses only System.Drawing (in-box on Win10+). No external tools.

.EXAMPLE
  powershell -File .\scripts\generate-icons.ps1
#>
[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"

Add-Type -AssemblyName System.Drawing | Out-Null

# Pull palette tokens directly from viewer/styles.css so the icons stay
# in sync if the palette changes. Falls back to known-good defaults if
# the file or a token is missing (so a stripped dist still builds icons).
function Get-CssToken {
    param([string]$Path, [string]$Name, [string]$Default)
    if (-not (Test-Path $Path)) { return $Default }
    $line = Select-String -Path $Path -Pattern "^\s*--$Name\s*:\s*(#[0-9A-Fa-f]{3,8})" -CaseSensitive | Select-Object -First 1
    if ($line -and $line.Matches.Count -gt 0 -and $line.Matches[0].Groups.Count -ge 2) {
        return $line.Matches[0].Groups[1].Value
    }
    return $Default
}
$cssPath        = Join-Path $PSScriptRoot "..\viewer\styles.css"
$accentTopHex   = Get-CssToken -Path $cssPath -Name "accent"   -Default "#6E8A66"
$accentBotHex   = Get-CssToken -Path $cssPath -Name "accent-2" -Default "#5A7488"
$bgHex          = Get-CssToken -Path $cssPath -Name "bg"       -Default "#08080A"
$ACCENT_TOP     = [System.Drawing.ColorTranslator]::FromHtml($accentTopHex)   # --accent (sage)
$ACCENT_BOTTOM  = [System.Drawing.ColorTranslator]::FromHtml($accentBotHex)   # --accent-2 (slate)
$BG             = [System.Drawing.ColorTranslator]::FromHtml($bgHex)          # --bg (inset cutout)

function Add-RoundedRect {
    param(
        [System.Drawing.Drawing2D.GraphicsPath]$Path,
        [System.Drawing.RectangleF]$Rect,
        [single]$Radius
    )
    if ($Radius -le 0) {
        $Path.AddRectangle($Rect)
        return
    }
    $d = $Radius * 2.0
    $Path.AddArc($Rect.X, $Rect.Y, $d, $d, 180, 90)
    $Path.AddArc($Rect.Right - $d, $Rect.Y, $d, $d, 270, 90)
    $Path.AddArc($Rect.Right - $d, $Rect.Bottom - $d, $d, $d, 0, 90)
    $Path.AddArc($Rect.X, $Rect.Bottom - $d, $d, $d, 90, 90)
    $Path.CloseFigure()
}

function New-BrandSquare {
    param([int]$Size)

    # CSS source (28px reference): border-radius: 6px, inset 5px,
    # border 1.5px, inner border-radius: 3px.
    [single]$outerCorner = $Size * 0.214
    [single]$insetPad    = $Size * 0.179
    [single]$innerBorder = [Math]::Max(1.0, $Size * 0.054)
    [single]$innerCorner = $Size * 0.107

    $bmp = [System.Drawing.Bitmap]::new($Size, $Size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic

    # 1. Rounded-rect background with diagonal gradient.
    $bgRect = [System.Drawing.RectangleF]::new(0.0, 0.0, [single]$Size, [single]$Size)
    $bgPath = [System.Drawing.Drawing2D.GraphicsPath]::new()
    Add-RoundedRect -Path $bgPath -Rect $bgRect -Radius $outerCorner

    $p0 = [System.Drawing.PointF]::new(0.0, 0.0)
    $p1 = [System.Drawing.PointF]::new([single]$Size, [single]$Size)
    $brush = [System.Drawing.Drawing2D.LinearGradientBrush]::new($p0, $p1, $ACCENT_TOP, $ACCENT_BOTTOM)
    $g.FillPath($brush, $bgPath) | Out-Null
    $brush.Dispose()
    $bgPath.Dispose()

    # 2. Inset rounded-square cutout: stroke the inner outline in BG color
    #    to match the CSS `border: 1.5px solid var(--bg); border-radius: 3px;`.
    [single]$ix = $insetPad
    [single]$iy = $insetPad
    [single]$iw = [single]$Size - 2.0 * $insetPad
    [single]$ih = [single]$Size - 2.0 * $insetPad
    $innerRect = [System.Drawing.RectangleF]::new($ix, $iy, $iw, $ih)
    $innerPath = [System.Drawing.Drawing2D.GraphicsPath]::new()
    Add-RoundedRect -Path $innerPath -Rect $innerRect -Radius $innerCorner

    $pen = [System.Drawing.Pen]::new($BG, $innerBorder)
    $g.DrawPath($pen, $innerPath) | Out-Null
    $pen.Dispose()
    $innerPath.Dispose()

    $g.Dispose()
    return ,$bmp   # comma operator prevents PowerShell from unwrapping
}

function Save-Png {
    param([System.Drawing.Bitmap]$Bitmap, [string]$Path)
    $Bitmap.Save($Path, [System.Drawing.Imaging.ImageFormat]::Png)
}

function Save-Ico {
    <#
      Writes a multi-resolution ICO with each entry as a PNG-compressed
      image (supported since Vista; modern Windows handles all sizes).
        ICONDIR    (6 bytes): reserved(2)=0, type(2)=1, count(2)=N
        ICONDIRENTRY[N] (16 bytes each)
        image data[N]    (raw PNG bytes)
    #>
    param([System.Drawing.Bitmap[]]$Bitmaps, [string]$Path)

    $entries = New-Object System.Collections.ArrayList
    foreach ($bmp in $Bitmaps) {
        $ms = [System.IO.MemoryStream]::new()
        $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
        [void]$entries.Add([pscustomobject]@{
            W   = $bmp.Width
            H   = $bmp.Height
            Png = $ms.ToArray()
        })
        $ms.Dispose()
    }

    $headerSize = 6 + 16 * $entries.Count
    $offset = $headerSize

    $writer = [System.IO.MemoryStream]::new()
    $bw = [System.IO.BinaryWriter]::new($writer)
    $bw.Write([uint16]0)
    $bw.Write([uint16]1)
    $bw.Write([uint16]$entries.Count)

    foreach ($e in $entries) {
        $bw.Write([byte]($e.W -band 0xFF))
        $bw.Write([byte]($e.H -band 0xFF))
        $bw.Write([byte]0)
        $bw.Write([byte]0)
        $bw.Write([uint16]1)
        $bw.Write([uint16]32)
        $bw.Write([uint32]$e.Png.Length)
        $bw.Write([uint32]$offset)
        $offset += $e.Png.Length
    }
    foreach ($e in $entries) { $bw.Write($e.Png) }

    [System.IO.File]::WriteAllBytes($Path, $writer.ToArray())
    $bw.Dispose()
    $writer.Dispose()
}

$repoRoot = Split-Path -Parent $PSScriptRoot
$sharedDir = Join-Path $repoRoot "shared"
if (-not (Test-Path $sharedDir)) { New-Item -ItemType Directory -Path $sharedDir | Out-Null }
$icoPath = Join-Path $sharedDir "tracker-icon.ico"
$captureTrayPath = Join-Path $repoRoot "capture\tray-icon.png"

Write-Host "Rendering brand square at multiple resolutions..." -ForegroundColor Cyan
$bitmaps = New-Object System.Collections.ArrayList
foreach ($size in 16, 32, 48, 64, 128, 256) {
    $bmp = New-BrandSquare -Size $size
    [void]$bitmaps.Add($bmp)
    Write-Host "  ${size}x${size}"
}

Write-Host "Writing multi-resolution ICO: $icoPath" -ForegroundColor Cyan
Save-Ico -Bitmaps $bitmaps.ToArray() -Path $icoPath

Write-Host "Writing 32x32 tray PNG: $captureTrayPath" -ForegroundColor Cyan
$tray = $null
foreach ($b in $bitmaps) { if ($b.Width -eq 32) { $tray = $b; break } }
if ($tray) { Save-Png -Bitmap $tray -Path $captureTrayPath }
else { throw "32x32 bitmap missing from set" }

foreach ($b in $bitmaps) { $b.Dispose() }

Write-Host ""
Write-Host "Done. To regenerate after a token change:" -ForegroundColor Green
Write-Host "  powershell -File scripts\generate-icons.ps1"
