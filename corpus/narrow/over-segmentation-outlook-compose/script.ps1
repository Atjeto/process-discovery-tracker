param(
  [int]$Drafts = 3,
  [string]$LibPath = ""
)
# Outlook (classic) compose driver (§11b real corpus) + the deferred
# end-to-end Outlook vocab proof. Each "case" opens a compose window and types
# the recipient / cc / subject / body fields the outlook.yaml vocab keys on
# (To=4117, Cc=4126, Subject=4101, body=_WwG). These are DISTINCT-element value
# entries, so this is the scenario that exercises the over-segmentation knob
# (step_split_on_element) hardest: one step per field with split-on vs one step
# for the whole compose with split-off.
#
# SAFETY: the driver NEVER sends and NEVER saves -- each draft is closed with
# olDiscard, so nothing leaves the machine and no draft is left behind. If
# Outlook was already running we attach to it and never quit it.

if (-not $LibPath) { $LibPath = Join-Path $PSScriptRoot "uia-lib.ps1" }
. $LibPath
Add-Type -AssemblyName System.Windows.Forms
# NOTE: the compose body is a _WwG Word-canvas Document that raises only
# TextPattern.TextChanged, which the recorder gates behind verbose mode (it is
# NOT in the production stream). So body keystrokes are not captured in a
# non-verbose corpus capture -- the To/Cc/Subject ValuePattern fields are the
# value_changed events that drive segmentation here. Body typing is left in as a
# best-effort realism gesture; its absence from events.jsonl is expected.

function Retry-Call([scriptblock]$sb, [int]$tries = 8, [int]$delayMs = 900) {
  for ($i = 0; $i -lt $tries; $i++) {
    try { return & $sb } catch { Start-Sleep -Milliseconds $delayMs }
  }
  return $null
}

$preExisting = [bool](Get-Process outlook -ErrorAction SilentlyContinue)

# Attach to (or launch) classic Outlook via its registered COM ProgID. The
# Outlook.Application ProgID maps to classic Office Outlook (Office16
# OUTLOOK.EXE), and New-Object returns the running single-instance server if one
# exists (else launches it) -- reliable where Marshal::GetActiveObject is not
# (it needs the server already in the ROT). CreateItem/Display calls are then
# retried to ride out RPC_E_CALL_REJECTED / E_ABORT during Outlook's startup.
$ol = Retry-Call { New-Object -ComObject Outlook.Application } 12 1000
if (-not $ol) {
  Log "could not create/attach Outlook COM; aborting"
  Done
  return
}
# Settle: MAPI must be live before CreateItem.
Retry-Call { $ol.GetNamespace("MAPI") | Out-Null; $true } 15 1000 | Out-Null
$procId = (Get-Process outlook | Sort-Object StartTime | Select-Object -First 1).Id
Start-Sleep -Milliseconds 1200
Ready

for ($d = 1; $d -le $Drafts; $d++) {
  $cust = "CUST-220$d"
  Start-Case "Email to $cust"
  Start-Sleep -Milliseconds 900

  # Open a modeless compose window (retry around RPC_E_CALL_REJECTED).
  $mail = Retry-Call { $ol.CreateItem(0) } 10 900
  if (-not $mail) { Log "CreateItem failed for $cust"; End-Case; Start-Sleep -Milliseconds 600; continue }
  Retry-Call { $mail.Display($false); $true } 8 900 | Out-Null
  Start-Sleep -Milliseconds 1400

  # The compose inspector window: title "<subject-or-empty> - Message ...".
  $win = Get-WinByTitle $procId 'Message' 14
  if (-not $win) { Log "compose window not found for $cust"; try { $mail.Close(1) } catch {}; End-Case; Start-Sleep -Milliseconds 600; continue }
  Activate-Pid $procId

  # Distinct-element field entry (the over-segmentation drivers).
  Set-Aid $win '4117' "$($cust.ToLower())@example.com"; Start-Sleep -Milliseconds 700   # To
  Set-Aid $win '4126' "records@example.com";             Start-Sleep -Milliseconds 700   # Cc
  Set-Aid $win '4101' "Order $cust follow-up";           Start-Sleep -Milliseconds 700   # Subject
  # Body is the Word canvas (_WwG) -- no ValuePattern; focus + type.
  $body = $null
  try {
    $cc = New-Object System.Windows.Automation.PropertyCondition(
      [System.Windows.Automation.AutomationElement]::ClassNameProperty, '_WwG')
    $body = $win.FindFirst($TS::Subtree, $cc)
  } catch {}
  if ($body) {
    try { $body.SetFocus(); Start-Sleep -Milliseconds 300
      [System.Windows.Forms.SendKeys]::SendWait("Following up on order $cust. Please advise.")
      Log "typed body" } catch { Log "body type failed: $($_.Exception.Message)" }
  } else { Log "body _WwG not found" }
  Start-Sleep -Milliseconds 1300            # let value_changed events drain

  # Discard: no save, no send, no leftover draft.
  Retry-Call { $mail.Close(1); $true } 6 700 | Out-Null
  Start-Sleep -Milliseconds 900

  End-Case
  Start-Sleep -Milliseconds 700
}

Done
Start-Sleep -Milliseconds 500
# Only quit Outlook if WE launched it; never close the user's running Outlook.
if (-not $preExisting) { try { $ol.Quit() } catch {} }
