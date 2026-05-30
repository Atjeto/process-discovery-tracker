param(
  [int]$Cases = 2,
  [string]$DocxPath = "",
  [string]$LibPath = ""
)
# Word mail-merge driver (§11b real corpus). Mail merge is the flagship Word
# automation target the word.yaml vocab keys on. The merge dropdowns are opened
# (firing the real Invoke events the vocab matches: MailMergeStartMailMergeMenu,
# MailMergeSelectRecipients) then dismissed with Escape so the flow stays
# non-blocking (no file picker / wizard). Like Excel, this is a ribbon-Invoke
# flow, so it tells us how step_split_on_element behaves outside field entry.
#
# SAFETY: only quits Word if we launched it; closes only our own document.

if (-not $LibPath) { $LibPath = Join-Path $PSScriptRoot "uia-lib.ps1" }
. $LibPath
Add-Type -AssemblyName System.Windows.Forms

$preExisting = [bool](Get-Process winword -ErrorAction SilentlyContinue)
$w = New-Object -ComObject Word.Application
$w.Visible = $true
try { $w.DisplayAlerts = 0 } catch {}
$doc = $w.Documents.Add()
if (-not $DocxPath) { $DocxPath = Join-Path $PSScriptRoot "_word_corpus.docx" }
if (Test-Path $DocxPath) { Remove-Item -Force $DocxPath -ErrorAction SilentlyContinue }
try { $doc.SaveAs([ref]$DocxPath) } catch { try { $doc.SaveAs($DocxPath) } catch { Log "SaveAs failed: $($_.Exception.Message)" } }
$procId = (Get-Process winword | Sort-Object StartTime -Descending | Select-Object -First 1).Id
Start-Sleep -Milliseconds 1200
Ready

for ($c = 1; $c -le $Cases; $c++) {
  $batch = "BATCH-30$c"
  Start-Case "Mail merge $batch"
  Start-Sleep -Milliseconds 900

  Activate-Pid $procId
  $win = Get-WinByPid $procId

  # Type a short letter body (real text into the canvas).
  [System.Windows.Forms.SendKeys]::SendWait("Dear customer, regarding $batch.")
  Start-Sleep -Milliseconds 900

  # Mailings tab: open the mail-merge dropdowns (fires the vocab Invokes),
  # then Escape so no wizard / file picker blocks the autonomous run.
  if (Select-Tab $win 'TabMailings') {
    Invoke-Aid $win 'MailMergeStartMailMergeMenu'; Start-Sleep -Milliseconds 900
    [System.Windows.Forms.SendKeys]::SendWait('{ESC}'); Start-Sleep -Milliseconds 700
    Invoke-Aid $win 'MailMergeSelectRecipients';   Start-Sleep -Milliseconds 900
    [System.Windows.Forms.SendKeys]::SendWait('{ESC}'); Start-Sleep -Milliseconds 700
  }

  # Home tab + silent save.
  Select-Tab $win 'TabHome'
  Invoke-Aid $win 'FileSave'; Start-Sleep -Milliseconds 1000

  Start-Sleep -Milliseconds 800
  End-Case
  Start-Sleep -Milliseconds 700
}

Done
Start-Sleep -Milliseconds 500
try { $doc.Close($false) } catch {}
if (-not $preExisting) { try { $w.Quit() } catch {} }
