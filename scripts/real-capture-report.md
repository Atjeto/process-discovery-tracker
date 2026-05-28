# Real Capture Integration Test — Report

**This report covers an honest end-to-end run of the capture pipeline.**
None of the events in this session were synthesized. They are all the
real output of the live capture tray + the C# Windows UI Automation
recorder, observing real foreground applications that were driven by
Playwright (Chrome) and PowerShell (`Start-Process mspaint` + `SendKeys`).

Compare to `scripts/test-suite-report.md`, where every `events.jsonl`
was hand-crafted JSON and the "bad" sessions were mockups. Those tests
prove the pipeline math, but they cannot prove that the recorder
actually emits the events we assumed it would.

## Setup

| Layer | What ran |
|---|---|
| Capture app | `capture/main.js` via `npm start`, launched through Playwright's `_electron.launch` with `APPDATA` redirected to a temp dir (so the user's real config is untouched). |
| Recorder | The compiled C# .NET 8 sidecar at `capture/recorder/publish/recorder.exe`, spawned by the capture's `tracker.js`. Used Windows UI Automation to observe the foreground apps. |
| Driver | `_pdt_verify/real-capture-test/run.js` opens a hidden helper window inside the capture and calls `ipcRenderer.invoke('pdt:fireStart' / 'pdt:fireEnd')` against the live IPC channel. Marker labels are issued via IPC instead of the global hotkey; everything else is the real pipeline. |
| Driven apps | (a) System Chrome via Playwright (the bundled Chromium failed with `spawn UNKNOWN` on this Windows install — fell back to `channel: "chrome"`); (b) MS Paint via PowerShell `Start-Process mspaint.exe` + `SendKeys`. |

## What was observed — verbatim from the real `events.jsonl`

Session folder: `sessions/_real/20260528-124523/`
Total events: **26**: 12 system · 2 markers · **7 interactions** · 5 activity.

```
  SYS  session_start
  SYS  recorder_start
  MARK start    Real-test order ORD-1
  SYS  screenshot
  INT  value_changed   Edit         chrome.exe    "Address and search bar"  val="example.com"
  INT  value_changed   Edit         chrome.exe    "Address and search bar"  val="bing.com"
  ACT  Claude                 5000ms title="Claude"
  SYS  idle_start
  SYS  screenshot
  INT  value_changed   Edit         chrome.exe    "Address and search bar"  val="wikipedia.org"
  ACT  Google Chrome          5000ms title="Search - Microsoft Bing - Google Chrome"
  INT  value_changed   Edit         chrome.exe    "Address and search bar"  val="duckduckgo.com"
  ACT  Google Chrome         10000ms title="DuckDuckGo - Protection. Privacy. Peace of mind."
  INT  toggle_changed  Button       mspaint.exe   "Eraser"                  val=""
  INT  toggle_changed  RadioButton  mspaint.exe   "Brushes"                 val=""
  SYS  idle_end
  SYS  screenshot
  INT  value_changed   Slider       mspaint.exe   "Size"                    val="7"
  ACT  mspaint.exe            6530ms title="Untitled - Paint"
  MARK end
  SYS  screenshot
  SYS  recorder_health
  SYS  recorder_stop
  SYS  recorder_died
  ACT  mspaint.exe             495ms title="Untitled - Paint"
  SYS  session_end
```

The above is **whatever the recorder actually saw**. Every JSONL line in
the test session came from the real capture stack. The driver cannot
fabricate UIA events; if the recorder didn't observe them, they aren't
in the file.

## Pipeline output (real `normalize.py --mine` on the real session)

| Pipeline metric | Value |
|---|---|
| events_in | 26 |
| events_out (after collapse) | 5 |
| cases | 1 |
| step_count | **1** (mspaint interactions formed a real step; the Chrome omnibox interactions were correctly dropped by `step_suggest`'s `filter_browser_chrome`) |
| interaction_count | **7** |
| Apps with vocab coverage | `chrome.exe` (4 ints), `mspaint.exe` (3 ints) |
| analysis.json | **Written** — heuristic_version=2, 1 segment detected, 1 automation candidate (`single_instance`) |
| process_map.bpmn | Written |
| process_map_step.bpmn | Written |
| Per-case BPMNs | 2 |

The single detected segment is a chrome.exe contiguous run, 8.5 s, no
step labels (because the omnibox events were filtered out of steps —
the segment exists at the interaction grain, just unlabeled). That's
exactly the behavior the spec describes: browser-chrome filtering
removes navigation noise from steps but the underlying interactions
still feed segmentation.

## What this proves vs. what the synthetic suite proves

| Claim | How we tested it | Conclusion |
|---|---|---|
| The capture app launches and spawns the C# recorder | Real launch via `_electron.launch`, watched `recorder_start` and `recorder_health` events appear in the JSONL | **Verified** |
| The C# UIA recorder emits real UIA events | The 7 interaction rows above came directly out of the recorder over IPC — names, automation_ids, framework_ids (Chrome, Win32), class_names (OmniboxViewViews, "Brushes", "Size") are all real UIA properties | **Verified** |
| Multiple distinct foreground apps are observed correctly | Chrome (`OmniboxViewViews`, framework_id=`Chrome`) and MS Paint (`Button`/`RadioButton`/`Slider`, framework_id=`Win32`) both produced events with distinct schemas | **Verified** |
| Different interaction kinds reach the JSONL | `value_changed` (text), `toggle_changed` (buttons, radio buttons) | **Verified** |
| `normalize.py` runs on real captured data end-to-end | Real session staged into the repo, normalize rc=0, all expected output files written | **Verified** |
| The browser-chrome step filter does what it claims | 4 Chrome omnibox events present in raw JSONL, 0 of them survived into a step. Only mspaint interactions formed a step | **Verified** |

## Known platform limitations I hit — and the one critical product finding

1. **🚨 Chrome's web content is NOT exposed to UIA by default — and this
   affects most real enterprise processes.** Chrome's accessibility tree
   is built lazily; without something to wake it up, the recorder sees
   only browser-chrome (omnibox, tab strip), not the page contents users
   actually work in. I verified this honestly by running the recorder
   against Chrome with and without the fix:

   | Chrome configuration | Real recorder result |
   |---|---|
   | Chrome launched normally | **3 interactions** captured, all on the omnibox — page content invisible |
   | Chrome launched with `--force-renderer-accessibility` | **13 chrome interactions** captured, including real form-field labels ("Customer name:", "E-mail address:") and real typed values ("Acme Corp", "test@example.com") — full web-content visibility |

   The recorder's code is right and ADR-0001's claim that "browsers
   expose page content via UIA" is right *in principle*. But on a stock
   machine with a plain user-launched Chrome, **the recorder will not
   see web content** — which means Salesforce, ServiceNow, and most
   web-based ERPs would be silent to the recorder.

   **Three reasonable product fixes (not implemented in this test, just
   flagged):**
   - Document the `--force-renderer-accessibility` requirement in the
     deploy guide. (Currently zero hits for that string in `docs/` or
     `capture/`.)
   - Have the capture app wake Chrome's accessibility on session start by
     issuing a UIA property query against the foreground Chrome window —
     accessibility tools do this routinely.
   - Detect a Chrome foreground window with an empty UIA tree during a
     session and toast the analyst with the fix instructions.

   When the flag IS set, the pipeline performs as designed: the second
   real session captured 16 interactions across 8 steps, produced a real
   `analysis.json` with a 4-field form-fill segment as an automation
   candidate.

2. **Windows 11 Store-app variants of classic tools don't spawn cleanly
   via `Start-Process notepad`/`calc`.** Win11 ships a "Pick an app"
   dialog instead. MS Paint and `mspaint.exe` remain a real Win32 app
   and work fine for testing.

3. **Playwright's bundled Chromium hit `spawn UNKNOWN`** on this
   machine — a Windows-specific Chromium launch issue (likely
   AppContainer / antivirus / signature). The fallback to system
   Chrome (`channel: "chrome"`) worked.

## What's still mocked, openly

Two things in this test are not literally what a worker would do:

1. **Marker start/end was fired via IPC instead of the global hotkey.**
   The hotkey path goes through the SAME `fireStartMarker`/`fireEndMarker`
   functions, so the produced JSONL is identical — but if someone wanted
   to also stress the global-shortcut registration, that would need a
   foreground keystroke-injection step.
2. **`APPDATA` was redirected to a temp dir for isolation.** This affects
   only WHERE the session lands on disk, not what's in it.

Everything else — the tracker, the C# recorder, the UIA event stream,
the marker-stamping, the active-case stamping, the normalize pipeline,
the analysis layer — was the real production code path.

## Reproducing

```
# 1. Make sure the C# recorder is built (capture/recorder/publish/recorder.exe)
cd capture
npm run build:recorder   # one-time

# 2. Run the real integration test
cd ../../_pdt_verify/real-capture-test
node run.js
```

Console output lists the exact userData path that received the session;
the staged session is left under `sessions/_real/<timestamp>/`.

## What is still NOT proved by this test

I want to be explicit about gaps so a future run can close them:

- **Multi-case sessions through the real recorder.** This run fired one
  marker pair. To prove case detection / segment pooling on real data,
  drive multiple marker pairs in one session and re-run.
- **Anchor-based case detection on real data.** Needs a canonical
  template loaded and an interaction with a stable anchor field; the
  test doesn't currently load `--canonical`.
- **App-vocab enrichment on real recorder output.** The recorder emits
  `framework_id`/`automation_id` from real UIA; the vocab matching code
  is the same path the synthetic suite exercised. A quick extension
  would point `PDT_APP_VOCABULARIES` at a vocab targeting `mspaint.exe`
  Eraser/Brushes/Size and verify enrichment fires.
- **Long-session stress on real recorder.** This run was 30 seconds.
  The recorder's batched-queue behaviour, recorder restart on death,
  and the 500ms activity-queue flush are exercised in synthetic fuzz
  tests but not under real-load conditions.
- **Multi-monitor capture.** The session ran on one display.
