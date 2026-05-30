# Shared UI-Automation helpers for the §11b real-corpus drivers.
# Dot-sourced by drive-excel.ps1 / drive-outlook.ps1 / drive-word.ps1.
#
# These functions raise REAL UIA gestures (InvokePattern.Invoke,
# ValuePattern.SetValue, SelectionItemPattern.Select) against live desktop
# apps, which fire the genuine UIA events the C# recorder observes. The driver
# CANNOT fabricate recorder events -- it only operates the real UI.
#
# Sentinel protocol on stdout (Node watches these to fire session markers):
#   PDT>>READY            app open, ready to drive
#   PDT>>START <label>    begin a case (Node fires a start marker)
#   PDT>>END              end a case   (Node fires an end marker)
#   PDT>>LOG <msg>        diagnostic
#   PDT>>DONE             all cases complete; the script will exit

$ErrorActionPreference = 'Continue'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -AssemblyName Microsoft.VisualBasic

$Global:AE  = [System.Windows.Automation.AutomationElement]
$Global:TS  = [System.Windows.Automation.TreeScope]
$Global:IP  = [System.Windows.Automation.InvokePattern]
$Global:VP  = [System.Windows.Automation.ValuePattern]
$Global:SIP = [System.Windows.Automation.SelectionItemPattern]
$Global:PID_PROP = [System.Windows.Automation.AutomationElement]::ProcessIdProperty
$Global:AID_PROP = [System.Windows.Automation.AutomationElement]::AutomationIdProperty
$Global:NAME_PROP = [System.Windows.Automation.AutomationElement]::NameProperty

function Emit($s) {
  # Direct, unbuffered write so Node sees the sentinel immediately.
  [Console]::Out.WriteLine($s)
  [Console]::Out.Flush()
}
function Log($s)   { Emit "PDT>>LOG $s" }
function Ready()   { Emit "PDT>>READY" }
function Start-Case($label) { Emit "PDT>>START $label" }
function End-Case() { Emit "PDT>>END" }
function Done()    { Emit "PDT>>DONE" }

function Activate-Pid($procId) {
  try { [Microsoft.VisualBasic.Interaction]::AppActivate($procId) | Out-Null } catch {}
  Start-Sleep -Milliseconds 600
}

# First top-level window for a pid (the app's main / active window).
function Get-WinByPid($procId) {
  $root = $AE::RootElement
  $cond = New-Object System.Windows.Automation.PropertyCondition($PID_PROP, $procId)
  return $root.FindFirst($TS::Children, $cond)
}

# A top-level window of $procId whose Name matches a regex (e.g. a compose
# window "* - Message"). Polls a few times because the window appears async.
function Get-WinByTitle($procId, $regex, $tries = 12) {
  $root = $AE::RootElement
  $cond = New-Object System.Windows.Automation.PropertyCondition($PID_PROP, $procId)
  for ($i = 0; $i -lt $tries; $i++) {
    $wins = $root.FindAll($TS::Children, $cond)
    foreach ($w in $wins) {
      try { if ($w.Current.Name -match $regex) { return $w } } catch {}
    }
    Start-Sleep -Milliseconds 700
  }
  return $null
}

function Find-ByAid($win, $aid) {
  if (-not $win) { return $null }
  $c = New-Object System.Windows.Automation.PropertyCondition($AID_PROP, $aid)
  return $win.FindFirst($TS::Subtree, $c)
}

# Focus an element first so a focus_changed event carries the automation_id
# even when the transient Invoked/value event resolves to an empty element
# (the managed UIA event source can go stale before the recorder queries it --
# focus is the stable identity signal). 450 ms > the recorder's 750 ms-window
# is paced by the callers.
function Focus-El($el) {
  try { $el.SetFocus() } catch {}
  Start-Sleep -Milliseconds 450
}

# Invoke a control by automation id. Returns a status string (also logged).
function Invoke-Aid($win, $aid) {
  $el = Find-ByAid $win $aid
  if (-not $el) { Log "$aid NOT FOUND"; return $false }
  Focus-El $el
  try {
    $p = $el.GetCurrentPattern($IP::Pattern)
    $p.Invoke()
    Log "invoked $aid"
    return $true
  } catch {
    Log "invoke $aid FAILED: $($_.Exception.Message)"
    return $false
  }
}

# Toggle a control by automation id (TogglePattern) -- Excel's ribbon "Filter"
# is a toggle button, not an Invoke target (GetCurrentPattern(Invoke) throws
# "Unsupported Pattern"). Falls back to Invoke if Toggle is unsupported.
function Toggle-Aid($win, $aid) {
  $el = Find-ByAid $win $aid
  if (-not $el) { Log "$aid NOT FOUND (toggle)"; return $false }
  Focus-El $el
  try {
    $p = $el.GetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern)
    $p.Toggle()
    Log "toggled $aid"
    return $true
  } catch {
    try { $el.GetCurrentPattern($IP::Pattern).Invoke(); Log "invoked $aid (toggle fallback)"; return $true }
    catch { Log "toggle $aid FAILED: $($_.Exception.Message)"; return $false }
  }
}

# Open a split-button / dropdown's menu via ExpandCollapsePattern. Use this for
# controls whose default Invoke opens a MODAL dialog and blocks until COM
# timeout (e.g. InsertPivotTableDropdown): Expand fires the real UIA gesture the
# vocab matches without launching the blocking dialog. Caller sends {ESC} after.
function Expand-Aid($win, $aid) {
  $el = Find-ByAid $win $aid
  if (-not $el) { Log "$aid NOT FOUND (expand)"; return $false }
  Focus-El $el
  try {
    $p = $el.GetCurrentPattern([System.Windows.Automation.ExpandCollapsePattern]::Pattern)
    $p.Expand()
    Log "expanded $aid"
    return $true
  } catch { Log "expand $aid FAILED: $($_.Exception.Message)"; return $false }
}

# Type a value into a field by automation id via ValuePattern.SetValue --
# raises a real value_changed UIA event carrying the value.
function Set-Aid($win, $aid, $val) {
  $el = Find-ByAid $win $aid
  if (-not $el) { Log "$aid NOT FOUND"; return $false }
  Focus-El $el
  try {
    $p = $el.GetCurrentPattern($VP::Pattern)
    $p.SetValue($val)
    Log "set $aid"
    return $true
  } catch {
    Log "set $aid FAILED: $($_.Exception.Message)"
    return $false
  }
}

# Select a ribbon tab by automation id (TabData / TabInsert / TabMailings ...)
# so its buttons enter the UIA tree. Retries because the ribbon rebuilds.
function Select-Tab($win, $aid, $tries = 5) {
  for ($i = 0; $i -lt $tries; $i++) {
    $tab = Find-ByAid $win $aid
    if ($tab) {
      try {
        $p = $tab.GetCurrentPattern($SIP::Pattern)
        $p.Select()
        Start-Sleep -Milliseconds 900
        Log "selected tab $aid"
        return $true
      } catch { Start-Sleep -Milliseconds 500 }
    } else { Start-Sleep -Milliseconds 500 }
  }
  Log "tab $aid NOT FOUND"
  return $false
}

# Focus an element by aid and send literal keystrokes (for canvases like the
# Word body that expose no ValuePattern). Raises real text/value events.
function Type-IntoAid($win, $aid, $text) {
  $el = Find-ByAid $win $aid
  if (-not $el) { Log "$aid NOT FOUND (type)"; return $false }
  try { $el.SetFocus() } catch {}
  Start-Sleep -Milliseconds 300
  [System.Windows.Forms.SendKeys]::SendWait($text)
  Log "typed into $aid"
  return $true
}
