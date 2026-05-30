param(
  [int]$Cases = 2,
  [string]$XlsxPath = "",
  [string]$LibPath = ""
)
# Excel data-prep driver (§11b real corpus). Each case runs the repetitive
# data-prep core the excel.yaml vocab keys on: Filter -> Sort -> (PivotTable)
# -> Copy -> Save. All are ribbon Invoke gestures (idMso automation_ids), so
# this scenario also tells us how the step_split_on_element knob behaves on a
# ribbon-click flow (vs a field-entry flow like Outlook compose).

if (-not $LibPath) { $LibPath = Join-Path $PSScriptRoot "uia-lib.ps1" }
. $LibPath
Add-Type -AssemblyName System.Windows.Forms

$xl = New-Object -ComObject Excel.Application
$xl.Visible = $true
$xl.DisplayAlerts = $false
$wb = $xl.Workbooks.Add()
$ws = $wb.Worksheets.Item(1)
# A small Name column to filter/sort.
$ws.Range('A1').Value2 = 'Name'
$ws.Range('A2').Value2 = 'Charlie'
$ws.Range('A3').Value2 = 'Alice'
$ws.Range('A4').Value2 = 'Bob'
$ws.Range('A5').Value2 = 'Dora'
$ws.Range('A6').Value2 = 'Evan'
# Pre-save so the per-case FileSave is silent (no Save-As backstage/dialog).
if (-not $XlsxPath) { $XlsxPath = Join-Path $PSScriptRoot "_excel_corpus.xlsx" }
if (Test-Path $XlsxPath) { Remove-Item -Force $XlsxPath -ErrorAction SilentlyContinue }
try { $wb.SaveAs($XlsxPath) } catch { Log "SaveAs failed: $($_.Exception.Message)" }
$procId = (Get-Process EXCEL | Sort-Object StartTime -Descending | Select-Object -First 1).Id
Start-Sleep -Milliseconds 1200
Ready

for ($c = 1; $c -le $Cases; $c++) {
  $ds = "DS-100$c"
  Start-Case "Excel data-prep $ds"
  Start-Sleep -Milliseconds 900           # let the start-marker land first

  Activate-Pid $procId
  $ws.Range('A1:A6').Select() | Out-Null
  Start-Sleep -Milliseconds 600
  $win = Get-WinByPid $procId

  # Data tab: Filter (a toggle button, not an Invoke target) then Sort A->Z.
  Select-Tab $win 'TabData'
  Toggle-Aid $win 'Filter';             Start-Sleep -Milliseconds 1200
  Invoke-Aid $win 'SortAscendingExcel'; Start-Sleep -Milliseconds 1200

  # Insert tab: EXPAND the PivotTable split-button dropdown (its default Invoke
  # opens a modal dialog that blocks until COM timeout); Escape closes the menu.
  Select-Tab $win 'TabInsert'
  Expand-Aid $win 'InsertPivotTableDropdown'; Start-Sleep -Milliseconds 900
  [System.Windows.Forms.SendKeys]::SendWait('{ESC}'); Start-Sleep -Milliseconds 700

  # Home tab: Copy the range, then Save (silent, already saved once).
  Select-Tab $win 'TabHome'
  $ws.Range('A1:A6').Select() | Out-Null
  Invoke-Aid $win 'Copy';     Start-Sleep -Milliseconds 1000
  Invoke-Aid $win 'FileSave'; Start-Sleep -Milliseconds 1200

  Start-Sleep -Milliseconds 800           # drain before the end-marker
  End-Case
  Start-Sleep -Milliseconds 700
}

Done
Start-Sleep -Milliseconds 500
try { $wb.Close($false) } catch {}
try { $xl.Quit() } catch {}
