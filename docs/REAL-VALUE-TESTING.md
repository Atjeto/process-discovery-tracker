# Real-value testing

**The method for getting *real* data into vocab/template authoring (§11d) and
pipeline calibration (§11b) — without asking the owner to hand over captures.**
Claude generates the data by probing and driving real applications; the owner
validates **last**, after the work is built, not as its input.

## Why this exists

The synthetic suites (`scripts/generate-test-suite.py`,
`scripts/generate-demo-sessions.py`) hand-write `events.jsonl` with **invented**
`automation_id`s (`searchInput`, `kyc_id`, `accountName`, …). They prove the
*pipeline math* — case assignment, segmentation, stats, map mining — but they
**cannot** prove that the C# recorder actually emits the fields we assumed, and
any App Vocabulary or process template authored against them is fiction. The two
shipped starter vocabs ([`outlook.yaml`](../normalization/app_vocabularies/outlook.yaml),
[`salesforce.yaml`](../normalization/app_vocabularies/salesforce.yaml)) are exactly
this: bootstrapped from the demo's synthetic controls, not from any real app.

**Real-value testing** closes the gap with two techniques that operate on *real*
applications, and feeds two workstreams:

- **§11d — real App Vocabularies + process templates.** Harvest the actual UIA
  control identities a real app exposes, then hand-author
  [`normalization/app_vocabularies/*.yaml`](../normalization/app_vocabularies/) and
  [`canonical_process`](../normalization/canonical_match.py) templates keyed to them.
- **§11b — calibration.** Drive the real recorder against real apps to produce a
  **ground-truth corpus** ([`corpus/`](../corpus/README.md)), then sweep the
  segmentation / marker / anchor knobs against known-correct output (fixes the
  over-segmentation class — 64 steps where ~15–21 is right).

## Technique 1 — UIA probing (harvest real control identities)

Pattern: `_pdt_verify/probe_office_uia.ps1` (out-of-repo harness). Launch the
target app, walk the live `System.Windows.Automation` `AutomationElement` tree,
and print each control's real `Name`, `AutomationId`, `ControlType`,
`FrameworkId`, `ClassName`, and supported patterns (Invoke / Value / Toggle).

Those are precisely the fields an App Vocabulary `signature` matches on
(`control_type` + `automation_id` + `name` + `class_name` + `framework_id`) and
the [recognition layer](../shared/recognition-patterns.json) keys on — so a probe
run drops straight into a vocab YAML. **Signatures are UIA properties, never CSS
selectors.**

## Technique 2 — drive the real recorder (ground-truth captures)

Pattern: `_pdt_verify/real-capture-test/scenarios.js` (out-of-repo). Playwright's
`_electron.launch` starts the **real** capture tray + the compiled **C# recorder**;
markers are fired over the live IPC; real apps are driven (Chrome via Playwright,
desktop apps via PowerShell `AppActivate` + `SendKeys`); the recorder observes
real UIA; sessions are staged to `sessions/_real_suite/` and normalized. The
driver **cannot fabricate UIA events** — whatever lands in `events.jsonl` is what
the recorder genuinely saw. The honest end-to-end write-up is
[`scripts/real-capture-report.md`](../scripts/real-capture-report.md).

## The web-app constraint (must-read)

Browsers do **not** expose page content to UIA by default — the accessibility
tree is built lazily. Without waking it, the recorder sees only *browser chrome*
(omnibox, tab strip), **not** the Salesforce / ServiceNow / web-ERP fields the
worker actually uses. The fix is to launch Chrome/Edge with
**`--force-renderer-accessibility`** — proven in the real-capture report (3
omnibox-only interactions → **13** real form-field interactions once the flag was
set). The drive harness must set it for every web scenario.

Corollary: **new Outlook for Windows** (the `Microsoft.OutlookForWindows` AppX) is
a WebView2 web app → same constraint, web a11y tree. **Classic Outlook**
(`Office16\OUTLOOK.EXE`) is rich Win32 UIA. They are different surfaces and need
**separate vocabularies**.

## Access routes (how we get real values per app)

| Tier | Route | Example |
|------|-------|---------|
| **A** | **Installed desktop — probe live now** from the dev box | Outlook (classic), Excel, Word are installed here |
| **B** | **Free public/developer instance** the owner provisions once; Claude drives it from the dev box over the internet | ServiceNow PDI, Salesforce Developer Edition |
| **C** | **Documentation-derived** — no reachable free instance; derive identities from public developer/admin/UI docs, ship the vocab **flagged doc-derived**, refine later | gated enterprise SaaS |

The owner **cannot run Claude on the locked-down work laptop**, so a gated SaaS is
reached via a *free public instance Claude can hit from the dev box* — never via
the laptop. The live per-app worklist (which app is in which tier, with the
canonical processes to template) is [`docs/To-Do/APP-COVERAGE-LIST.md`](To-Do/APP-COVERAGE-LIST.md).

## Invariants this honors

- **Raw immutability / suggest-don't-mutate** — probing and driving produce normal
  sessions; nothing edits `events.jsonl`.
- **Company captures stay local** — real-value testing uses *installed apps + public
  demo instances*, never a real company capture. `sessions/_real_suite/` is
  gitignored like every other capture.

## Reproduce

```
# Probe a desktop app's real controls (adapt the Start-Process target):
powershell -NoProfile -File _pdt_verify/probe_office_uia.ps1

# Drive the real recorder to build / refresh the real corpus:
cd _pdt_verify/real-capture-test
node scenarios.js            # all scenarios -> sessions/_real_suite/
node run.js                  # single end-to-end smoke
```

Verify the produced suite with [`scripts/verify-real-suite.py`](../scripts/verify-real-suite.py).
