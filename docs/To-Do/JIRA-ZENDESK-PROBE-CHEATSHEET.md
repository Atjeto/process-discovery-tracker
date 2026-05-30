# Jira + Zendesk — live-probe cheat-sheet (§11d)

**Status (2026-05-30):** DRAFT doc-derived vocab/template skeletons are committed
(`normalization/app_vocabularies/{jira,zendesk}.yaml`,
`normalization/process_templates/{jira-create-issue,zendesk-create-ticket}.yaml`).
They are **flagged DRAFT and NOT live-probed** — the field set + labels come from
Atlassian/Zendesk docs, not a UIA walk, because no logged-in Jira/Zendesk tab was
open on the dev box when they were authored (a clean check found 0 browser windows
to probe).

**What's left is a ~2-minute owner step per app:** open the create form in your
already-logged-in Chrome, run the foreground-watcher, paste the harvested
signatures over the PROVISIONAL ones, and drop the draft flag. This sheet is the
recipe. The probe is *Claude's method run by the owner* — Claude can't reach your
authenticated SaaS; you bring the tab to the foreground and the watcher does the
UIA harvest.

> Why doc-derived skeletons are safe to ship meanwhile: a vocab signature matches
> on **exact equality** of `control_type` + `name`, so a wrong label guess simply
> fails to match (under-coverage) — it can never *mis-name* a control. That is the
> opposite of the invented-`automation_id` fiction §11d removed. Worst case here is
> "named nothing," never "named wrong."

---

## TL;DR — the two commands

From `_pdt_verify/` (the out-of-repo probe harness), with the create form open and
**foreground** in your logged-in Chrome:

```powershell
# Jira — open Create-issue modal first, then:
powershell -NoProfile -ExecutionPolicy Bypass -File probe_web_uia.ps1 -TitleMatch "Jira"

# Zendesk — open the new-ticket form first, then:
powershell -NoProfile -ExecutionPolicy Bypass -File probe_web_uia.ps1 -TitleMatch "Zendesk"
```

You have `-TimeoutSec` (default 40s) to Alt-Tab the form to the front. The watcher
wakes the a11y tree (an active FindAll walk — you can't pass
`--force-renderer-accessibility` to an already-running Chrome) and prints, per
control: `control_type / name / automation_id / class_name / framework_id` + the
supported patterns, then a block of copy-paste-ready `- signature: {…}` lines.

The full watcher source is in the [appendix](#appendix--probe_web_uiaps1-source)
(it lives at `_pdt_verify/probe_web_uia.ps1`, which is **outside the repo** and so
isn't committed — the appendix is the durable copy).

---

## Jira

**Account (precondition):** free-forever plan at `atlassian.com` → a
`*.atlassian.net` site (≤10 users, no card). Log in once in your default Chrome.

**Where the create form is:** click **Create** in the top nav of any Jira page (or
press **`c`**). The **Global Issue Create (GIC)** modal opens. Pick a Project +
Issue type so the field set renders, then run the probe.

> ⚠️ The GIC is a **modal overlay** — it does **not** change the browser tab title
> (the tab stays "Your work - Jira", a board name, etc.). So `-TitleMatch "Jira"`
> fires on the underlying tab, which is correct; just make sure a Jira tab is
> foreground. There's also a classic full-page create at
> `/secure/CreateIssue!default.jspa` titled "Create Issue - Jira" if you prefer a
> titled screen.

**Expected field set** (from Atlassian docs — the DRAFT `jira.yaml` provisional
signatures; *confirm/replace via probe*):

| Field (visible label) | Provisional signature | Probe note |
|---|---|---|
| Project | `ComboBox` / "Project" | picker — ComboBox or Button? |
| Issue type | `ComboBox` / "Issue type" | label may be "Issue Type" (classic) |
| Summary | `Edit` / "Summary" | required; the case anchor |
| Description | `Edit` / "Description" | ProseMirror — may be Document/Group |
| Assignee | `ComboBox` / "Assignee" | picker control_type |
| Reporter | `ComboBox` / "Reporter" | picker control_type |
| Priority | `ComboBox` / "Priority" | |
| Labels | `ComboBox` / "Labels" | multi-select token input |
| Components | `ComboBox` / "Components" | company-managed projects only |
| Due date | `Edit` / "Due date" | date picker — Edit or Button? |
| **Create** (submit) | `Button` / "Create" | `automation_candidate` |
| Create another | `CheckBox` / "Create another" | |
| Cancel | `Button` / "Cancel" | |

**Probe:** `... -File probe_web_uia.ps1 -TitleMatch "Jira"`

---

## Zendesk

**Account (precondition):** 14-day trial at `zendesk.com/free-trial` → a
`*.zendesk.com` site. Log in to the **agent interface** once in your default Chrome.

**Where the create form is:** in the agent interface, **+ Add** → **Ticket** (top
bar), or go straight to `https://<your-subdomain>.zendesk.com/agent/tickets/new`.
The new-ticket composer renders the standard fields, then run the probe.

> ⚠️ Confirm the **tab-title scope**. The DRAFT `zendesk.yaml` assumes the tab
> title contains the literal word "Zendesk". Some accounts brand the title with the
> help-desk/account name and may **not** include "Zendesk" — if so, re-scope the
> vocab's `window_title_regex` (and `-TitleMatch`) to whatever the title actually
> is (e.g. the subdomain). Check the harvested `title=` line the watcher prints.

**Expected field set** (from Zendesk "About ticket fields" — the DRAFT
`zendesk.yaml` provisional signatures; *confirm/replace via probe*):

| Field (visible label) | Provisional signature | Probe note |
|---|---|---|
| Requester | `ComboBox` / "Requester" | search picker control_type |
| Assignee | `ComboBox` / "Assignee" | search picker control_type |
| Subject | `Edit` / "Subject" | required; the case anchor |
| Description | `Edit` / "Description" | rich composer — may be Document/Group |
| Type | `ComboBox` / "Type" | values: Question/Incident/Problem/Task |
| Priority | `ComboBox` / "Priority" | values: Low/Normal/High/Urgent |
| Status | `ComboBox` / "Status" | values: New/Open/Pending/On-hold/Solved |
| Tags | `ComboBox` / "Tags" | token input — ComboBox or Edit? |
| Group | `ComboBox` / "Group" | |
| **Submit** | `Button` / "Submit as New" (and bare "Submit") | status-dependent label; `automation_candidate` |

**Probe:** `... -File probe_web_uia.ps1 -TitleMatch "Zendesk"` (adjust `-TitleMatch`
if the title is account-branded).

---

## After probing — fold the results back in

For each app:

1. **Diff** the watcher's `VOCAB SIGNATURES` block against the DRAFT vocab. Replace
   each PROVISIONAL `- signature: {…}` with what was actually harvested — fix any
   wrong `control_type` (the `# PROBE:` lines flag the uncertain ones) and any
   `name` that differs from the label (required fields sometimes carry an asterisk
   or a verbose `aria-label`).
2. **Only add an `automation_id`** to a signature if the probe shows a *stable* one
   (no embedded digits). React/Ember auto-generate volatile ids — the watcher tags
   those `# likely VOLATILE, do NOT use`. Stay label-keyed otherwise (the Salesforce
   pattern).
3. **Confirm the scopes:** the vocab `scope.window_title_regex`, each `screen`'s
   title regex, and (Zendesk) whether the title even contains "Zendesk".
4. **Mirror into the template:** update the matching `match:` blocks in
   `jira-create-issue.yaml` / `zendesk-create-ticket.yaml`, and confirm the
   `case_anchor` field name (Summary / Subject) is the real accessible name.
5. **Drop the draft flag:** remove the `⚠️ DRAFT — DOC-DERIVED` headers and the
   "DRAFT doc-derived" suffix in `app_vocabulary.name` / `canonical_process.name`.
6. **Re-validate + commit** (see *Validation* below); update
   `APP-COVERAGE-LIST.md` (move Jira/Zendesk from "queued" to "probed live") and
   `NEXT-SESSION-SPEC.md`.

## Validation (same gates these skeletons already pass)

```powershell
# unit suites (system Python — golden test auto-skips without pandas/pm4py):
python -m pytest normalization/test/test_app_vocab.py normalization/test/test_canonical_match.py -q

# byte-for-byte session golden (bundled Python has pandas/pm4py):
viewer\python\python.exe normalization\golden_check.py
```

The new vocabs are scoped `.*Jira.*` / `.*Zendesk.*`; the golden reference corpus
is the order-to-cash demo (Salesforce/SAP/Excel/Outlook), so they are **inert**
there and the golden stays green. Re-confirm after editing.

---

## Appendix — `probe_web_uia.ps1` source

Durable copy of the foreground-watcher (runnable copy at
`_pdt_verify/probe_web_uia.ps1`, out-of-repo). Generalises `probe_office_uia.ps1`
to a foreground browser window. ASCII-only in code strings (PS 5.1 treats Unicode
smart-quotes as string delimiters).

```powershell
param(
  [string]$TitleMatch = "",     # regex the foreground tab title must match before probing (e.g. "Jira")
  [int]$TimeoutSec   = 40,      # how long to watch for the matching foreground window
  [string]$Grep      = "",      # optional: only print controls whose Name contains this substring
  [int]$MaxPrint     = 400      # safety cap on printed controls (complex SPAs have thousands)
)

Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class Fg {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern int GetWindowThreadProcessId(IntPtr hWnd, out int procId);
}
"@

$AE = [System.Windows.Automation.AutomationElement]
$TS = [System.Windows.Automation.TreeScope]
$CT = [System.Windows.Automation.ControlType]

function Get-ForegroundInfo {
  $h = [Fg]::GetForegroundWindow()
  if ($h -eq [IntPtr]::Zero) { return $null }
  $procId = 0; [void][Fg]::GetWindowThreadProcessId($h, [ref]$procId)
  $pname = "?"; try { $pname = (Get-Process -Id $procId -ErrorAction Stop).ProcessName } catch {}
  $el = $null; try { $el = $AE::FromHandle($h) } catch {}
  $title = ""; if ($el) { try { $title = $el.Current.Name } catch {} }
  return [pscustomobject]@{ Handle = $h; ProcId = $procId; PName = $pname; Title = $title; El = $el }
}

# --- Watch for the target foreground window -------------------------------
$desc = if ($TitleMatch -ne "") { "matching /$TitleMatch/" } else { "(any)" }
Write-Host "[probe] watching for a foreground Chrome/Edge tab $desc for $TimeoutSec s..." -ForegroundColor Cyan
Write-Host "[probe] -> bring the create form (Jira Create-issue / Zendesk new-ticket) to the front now." -ForegroundColor Yellow

$deadline = (Get-Date).AddSeconds($TimeoutSec)
$target = $null
while ((Get-Date) -lt $deadline) {
  $fg = Get-ForegroundInfo
  if ($fg -and ($fg.PName -eq "chrome" -or $fg.PName -eq "msedge")) {
    if (($TitleMatch -eq "") -or ($fg.Title -match $TitleMatch)) {
      $target = $fg; break
    }
  }
  Start-Sleep -Milliseconds 500
}

if ($null -eq $target) {
  Write-Host "[probe] NO matching foreground browser window within ${TimeoutSec}s. Nothing probed." -ForegroundColor Red
  Write-Host "[probe] (Is Chrome/Edge the foreground app? Does the tab title match /$TitleMatch/?)"
  exit 2
}

Write-Host "`n[probe] target: [$($target.PName)] pid=$($target.ProcId) title='$($target.Title)'" -ForegroundColor Green
$win = $target.El
if ($null -eq $win) { Write-Host "[probe] could not bind AutomationElement to the window." -ForegroundColor Red; exit 3 }

# Condition = OR over the form-relevant control types.
$types = @($CT::Edit, $CT::ComboBox, $CT::Button, $CT::CheckBox, $CT::RadioButton,
           $CT::Document, $CT::List, $CT::ListItem, $CT::Hyperlink, $CT::Tab, $CT::TabItem)
$conds = $types | ForEach-Object {
  New-Object System.Windows.Automation.PropertyCondition($AE::ControlTypeProperty, $_)
}
$orCond = New-Object System.Windows.Automation.OrCondition([System.Windows.Automation.Condition[]]$conds)

function Walk-Once($label) {
  try { return $win.FindAll($TS::Subtree, $orCond) } catch { Write-Host "[probe] FindAll($label) failed: $($_.Exception.Message)" -ForegroundColor Red; return $null }
}

# WAKE: first walk populates the a11y tree; wait; harvest on the second.
Write-Host "[probe] waking a11y tree (walk 1)..." -ForegroundColor DarkGray
$null = Walk-Once "wake"
Start-Sleep -Milliseconds 1200
Write-Host "[probe] harvesting (walk 2)..." -ForegroundColor DarkGray
$els = Walk-Once "harvest"
if ($null -eq $els) { exit 4 }

Write-Host "[probe] candidate controls found: $($els.Count)`n" -ForegroundColor Cyan
Write-Host ("=" * 78)
Write-Host "RAW UIA  (the authoritative signature fields)"
Write-Host ("=" * 78)

$rows = @()
$shown = 0
foreach ($e in $els) {
  if ($shown -ge $MaxPrint) { Write-Host "...(capped at $MaxPrint)"; break }
  try {
    $name = $e.Current.Name
    $aid  = $e.Current.AutomationId
    $ct   = $e.Current.ControlType.ProgrammaticName -replace "ControlType.",""
    $cls  = $e.Current.ClassName
    $fw   = $e.Current.FrameworkId
  } catch { continue }
  # Skip pure-noise: no name AND no automation id (identityless chrome).
  if ([string]::IsNullOrWhiteSpace($name) -and [string]::IsNullOrWhiteSpace($aid)) { continue }
  if ($Grep -ne "" -and ($name -notmatch [regex]::Escape($Grep))) { continue }
  $sup = @()
  try { $sup = @($e.GetSupportedPatterns() | ForEach-Object { $_.ProgrammaticName -replace "PatternIdentifiers.Pattern","" -replace "Identifiers.Pattern","" }) } catch {}
  $pat = ($sup | Where-Object { $_ -match "Invoke|Value|Toggle|ExpandCollapse|SelectionItem|Selection" }) -join ","
  $rows += [pscustomobject]@{ ct=$ct; name=$name; aid=$aid; cls=$cls; fw=$fw; pat=$pat }
  Write-Host ("  ct={0,-10} name='{1}' aid='{2}' cls='{3}' fw={4} [{5}]" -f $ct,$name,$aid,$cls,$fw,$pat)
  $shown++
}

# --- Copy-paste-ready vocab signatures ------------------------------------
# Emit label-keyed signatures (control_type + name) for the named controls, the
# stable handle for a React/Ember app. Dedup by (ct,name). Diff vs the DRAFT vocab.
Write-Host "`n$("=" * 78)"
Write-Host "VOCAB SIGNATURES  (label-keyed; paste under app_vocabulary.interactions)"
Write-Host ("=" * 78)
$seen = @{}
foreach ($r in $rows) {
  if ([string]::IsNullOrWhiteSpace($r.name)) { continue }
  $key = "$($r.ct)|$($r.name)"
  if ($seen.ContainsKey($key)) { continue }
  $seen[$key] = $true
  # Note if a STABLE-looking automation_id is present (no digits => maybe stable).
  $aidNote = ""
  if ($r.aid -and ($r.aid -notmatch '\d{2,}')) { $aidNote = "   # probe: aid='$($r.aid)' looks stable - consider adding" }
  elseif ($r.aid) { $aidNote = "   # probe: aid='$($r.aid)' has digits - likely VOLATILE, do NOT use" }
  Write-Host ("    - signature: {{ control_type: ""{0}"", name: ""{1}"" }}{2}" -f $r.ct, $r.name, $aidNote)
}
Write-Host "`n[probe] done. Diff the signatures above against the DRAFT vocab; replace the"
Write-Host "[probe] PROVISIONAL entries with what was actually harvested, then drop the draft flag."
```
