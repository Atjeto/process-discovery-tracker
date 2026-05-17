# Implementation Spec — Process Discovery Tracker

> **Purpose:** concrete implementation guide for Claude Code. Each section
> is a self-contained change with file paths, function signatures, data
> structures, and dependencies.
>
> **Problem context:** see `IMPROVEMENTS.md` (81 entries, 15 clusters).
> This document covers the HOW; that document covers the WHY.
>
> **Workflow A (primary):** structured 1-hour process walkthroughs →
> BPMN map + PDD for a developer. Improve the analyst's time in the viewer.
>
> **Workflow B (prep only):** 8-hour passive shift recording for IE review.
> Minimal enablement for a first recording next week.

---

## Repo orientation

```
capture/                  Electron tray app (main process)
  main.js                 Orchestration — tray, hotkeys, session lifecycle, IPC
  config.js               DEFAULTS + YAML deep merge
  tracker.js              5s active-window poll, event append
  recorder.js             C# sidecar supervisor
  session.js              Session folder + manifest I/O
  events.js               Event envelope factories
  obs.js                  OBS WebSocket integration
  screenshots.js          desktopCapturer multi-monitor
  notify.js               OS toast notifications
  window-manager.js       Singleton window helper
  operator-panel.js       Live Session window
  ui/*.html               Window markup (extracted from JS)
  recorder/               C# .NET 8 sidecar
    Program.cs             NDJSON control loop
    UiaSubscriber.cs       UIA event subscription + noise filter

normalization/            Python pipeline
  normalize.py            CLI entry, orchestrates stages
  case_assignment.py      Marker → case tree → stamp events
  classification.py       Rule-based activity classification
  step_suggest.py         Heuristic step grouping
  canonical_match.py      Match against canonical step set
  app_vocab.py            App Vocabulary enrichment
  stats_compute.py        Activity/case/variant/rework stats
  xes_export.py           IEEE 1849 XES
  step_csv.py             Flat step CSV
  mining.py               PM4Py miners
  pdd_export.py           Process definition .docx
  bpmn_step.py / bpmn_phase.py
  log_setup.py            Rolling log config

viewer/                   Electron app (renderer)
  main.js                 Electron main process — window, IPC, file I/O
  renderer.js             Entry — tab routing, level switcher, boot
  state.js                Central state store + pub/sub bus
  session.js              Annotations persistence + undo
  ipc.js                  Typed IPC wrappers
  dom.js                  DOM helpers
  modals.js               Confirm/prompt modals
  recent.js               Recent sessions localStorage
  project.js              Project file layer
  theme.js                Theme state + JS palettes
  charts.js               Inline SVG bar charts
  dfg-viewer.js           DFG (cytoscape + dagre)
  bpmn-viewer.js          BPMN (bpmn-js)
  report-md.js            Markdown report generation
  step-editor.js          Steps list/detail + mini-timeline
  phase-editor.js         Phases list/detail + mini-timeline
  layout-controls.js      Drag-resize handles
  command-palette.js      Ctrl+K palette
  views/
    flow-view.js           Flow timeline, session load, annotations panel
    steps-view.js          Steps level orchestration
    phases-view.js         Phases level orchestration
    aggregate-view.js      Compare Sessions view
    template-view.js       Process Template editor
    vocab-view.js          App Library editor
  timeline/
    timeline-core.js       Shared timeline: ticks, lanes, bands
    timeline-core.test.js  Tests

shared/
  SCHEMA.md               Authoritative data format contract
```

### Key patterns

- **CommonJS everywhere.** `module.exports` / `require()`. No bundler.
- **State bus.** `State.subscribe(topic, fn)` / `State.emit(topic)`.
  Annotation edits emit topics; subscribed views re-render.
- **IPC via `ipc.js`.** Typed wrappers. Renderer calls
  `Ipc.loadSession(folder)`, main handles `viewer:loadSession`.
- **Annotations round-trip.** Edit → `session.js` →
  `persistAnnotations(annotations, label, topics)` →
  `Ipc.saveAnnotations()` → `State.emit(topics)` → view re-renders.
- **No full reload on edit.** Annotation edits are targeted re-renders
  (Phase 2 refactor fixed this).
- **`loadSessionData()` in `viewer/main.js`** assembles the session
  object: `{ sessionFolder, manifest, events, stats, dfg, annotations,
  obsSync, recordingPath, recordingAvailable, externalVideoOffsetMs }`.
  Adding a new sidecar file = add it here, it's available in the
  renderer via `State.getSession()`.

---

## Phase A — Session Summary + Analyst Orientation

**Goal:** the analyst's first 10 minutes with a session go from "what is
this" to "here's what happened, here's what to do next."

**Ref:** I1, I2, I3, I54, I55, I56, I71, I73 (Clusters A + I)

---

### A1. Session summary panel

**What:** replace the event table (`#event-table-container` or equivalent
in `index.html`) with a summary panel as the default content when a session
loads. The event table becomes toggleable via a menu item.

**Where:**
- `viewer/views/flow-view.js` — add `renderSessionSummary(session)` function
- `viewer/index.html` — add `#session-summary` container (can reuse the
  event table's slot)
- `viewer/styles.css` — summary panel styling

**Data source:** `currentSession.stats` (already available), plus
`currentSession.annotations` and `currentSession.manifest`.

**Contents of `renderSessionSummary(session)`:**

```
Session: [manifest.engagement_id] — [manifest.worker || "unknown worker"]
Duration: [stats.total_duration formatted]
Cases: [stats.cases.length] ([list top 3 by duration])
Events: [stats.total_events] ([stats.activity_events] activities,
         [stats.interaction_events] interactions)

Top apps by time:
  SAP MM        38%  14m 12s
  Excel         22%   8m 30s
  Chrome        18%   6m 48s
  [remaining]   22%   8m 14s

App switches: [count from events where consecutive activities have
               different app]
Longest single-app stretch: [app] — [duration] starting at [time]

[if stats missing: banner "This session hasn't been analyzed yet.
 Click **Analyze** to identify cases, steps, and statistics."]
[if steps exist and all auto_suggested: banner "Review the **Steps**
 tab — N steps were auto-detected and may need editing."]
[if steps exist, some edited, no phases: banner "Group your steps
 into **Phases** to organize the process."]
```

**Marker problems list** (feeds I4). Scan `currentSession.events` for:
- Start markers with no matching End → "Start '[label]' at [time] has
  no matching End" + button "Close at [session end | next idle gap]"
- End markers with no matching Start → "Orphaned End at [time]"
- Cases shorter than 5 seconds → "Case '[label]' is only [N]s long —
  accidental?"

Each problem row has a one-click fix button that creates the appropriate
`marker_edit` entry and calls `persistAnnotations()`.

**Event table toggle:** add a "Show event table" item to the topbar or
a gear menu. When toggled, swap `#session-summary` and `#event-table`.
Preference stored in `localStorage` under `pdt.showEventTable`.

**Step state simplification (I55):** in `step-editor.js`, where step
state badges are rendered, map the four states to two:
- `auto_suggested` / `auto_matched` → render as "Auto-detected" with a
  light badge
- `manually_authored` / `edited` → render as "Confirmed" with a solid
  badge

The underlying `state` field is unchanged. This is purely a display map.

**Cases-vs-steps hint (I56):** in the summary panel, if both cases and
steps exist, include a one-liner: "Cases are time ranges marked during
recording. Steps are logical actions identified during analysis. They
are independent."

**Density histogram filter (I71):** in `flow-view.js` where the density
histogram lane counts events, filter to `type === "interaction"` (or
`type === "activity"` if interactions are sparse). This is one `filter()`
call on the events array before bucketing.

**Auto-zoom to first case (I2):** in `flow-view.js` after
`renderTimeline()`, if `State.zoomFactor === 1` (default, not
user-modified) and cases exist, compute the first case's start position
as a scroll fraction and set `#timeline-scroll.scrollLeft`. Don't
override if the user has already zoomed or scrolled.

---

### A2. Outlier flag in Compare Sessions

**Where:** `viewer/views/aggregate-view.js`

**When:** after loading multiple sessions (`aggregateSessions.length > 2`)

**How:** compute median total duration across loaded sessions. For each
session, if `abs(duration - median) > 1.5 * IQR`, flag it. Render a
yellow banner at the top of the aggregate view: "Session [name] is an
outlier — [2.3x] longer than median. Consider excluding." Link to
remove it from the loaded set.

---

## Phase B — Capture Confidence

**Goal:** the worker hands off sessions knowing they're complete. Bad
config caught before recording.

**Ref:** I20, I21, I44, I45, I46, I51, I52 (Cluster H)

---

### B1. Post-session summary

**Where:** `capture/operator-panel.js` + `capture/ui/operator-panel.html`

**When:** `session.end()` is called

**What:** replace the Live Session window content with a summary panel:

```
Session complete ✓
Duration:      [formatted]
Events:        [tracker.eventCount]
Cases:         [tracker.markerStack.length resolved]
Screenshots:   [tracker.screenshotCount]
Interactions:  [tracker.interactionCount]
Video:         [yes (2.1 GB) | no — OBS not connected]
Label:         [text input, writes to manifest.label]
```

The label input (I52) adds a `label` field to `manifest.json` on blur.
`viewer/recent.js` shows `label || timestamp` in the Recents list.

**Implementation:** send a `pdt:sessionSummary` IPC message from
`main.js` at session end with the counter values. `operator-panel.js`
listens and swaps the UI.

### B2. Config validation at session start

**Where:** `capture/main.js` — new `validateConfig(config)` function
called before the first event is written

**Checks:**
- `config.engagement_id` is set and not the default → green / red
- OBS reachable (if `config.obs.enabled`): try `obs.connect()`, timeout
  2s → green / red / skip
- Recorder spawned: `recorder.js` confirms `ready` event received → green / red
- Hotkeys registered: check `globalShortcut.isRegistered()` for each → green / red
- Session folder writable: `fs.accessSync(folder, fs.constants.W_OK)` → green / red

Show results in the Live Session window before recording starts. If any
red, show a "Start anyway" button instead of auto-starting.

### B3. Hotkey fallback (I45)

**Where:** `capture/main.js` — hotkey registration block

**How:** for each hotkey, if `globalShortcut.register(primary)` returns
false, try `globalShortcut.register(fallback)`. Fallback map:
`Ctrl+Shift+X → Ctrl+Alt+X`. If fallback succeeds, notify via
`notify.js`: "Ctrl+Shift+S was taken, using Ctrl+Alt+S instead." If both
fail, notify and continue without that hotkey.

### B4. Accidental-start countdown (I44)

**Where:** `capture/main.js` — marker fire handler

**When:** the first marker of a session (session not yet active)

**How:** instead of immediately starting, show a 3-second countdown in
the Live Session window via IPC. `setTimeout` starts the session after
3000ms. If the worker presses Esc (sent as `pdt:cancelStart` IPC), clear
the timeout and don't start. Subsequent markers within an active session
fire immediately — no countdown.

### B5. Session integrity file (I51)

**Where:** `capture/session.js` — at `session.end()`

**What:** write `session-integrity.json` to the session folder:

```json
{
  "files": [
    { "name": "events.jsonl", "size": 1234567 },
    { "name": "manifest.json", "size": 890 },
    { "name": "screenshots/001.jpg", "size": 45678 },
    ...
  ],
  "created_at": "ISO timestamp"
}
```

**Viewer side:** in `viewer/main.js` `loadSessionData()`, if
`session-integrity.json` exists, compare against actual directory listing.
Missing files → warning in the session object → viewer shows a yellow
banner: "Video file expected but not found — was the session copied
completely?"

### B6. OBS scene reuse (I46)

**Where:** `capture/obs.js` — scene bootstrap function

**How:** before `CreateScene`, call `GetSceneList()`. If a scene named
`"Process Discovery"` (or matching `config.obs.scene_name`) exists, skip
creation and use it. Log "Reusing existing OBS scene" vs "Created new
OBS scene."

---

## Phase C — Pipeline Hardening

**Goal:** normalization handles edge cases and explains failures.

**Ref:** I35, I37, I40, I67, I38 (Cluster E)

---

### C1. Web-app visibility — capture splits on title (was: collapse-by-app)

**Resolved — see [ADR-0007](../adr/0007-activity-event-granularity.md).**

I35's premise was backwards. It read "browser title changes create a
wall of activity events — collapse them by app." But the capture tracker
keyed activity runs on `(app, pid)` and discarded the window title, so a
20-minute Chrome session across three web apps (Salesforce, web-SAP,
Workday) produced **one** `chrome.exe` event. The timeline was
*under*-fragmented, not over-fragmented — and no collapse option can
recover web-app visibility that was never captured. (Verified against
`tracker.js`, and against the original design `process_discovery_tracker_design.md`
§3.1/§7.1, which specified title-grained runs all along.)

**The fix (done, this initiative):** `tracker.js` now keys activity runs
on `(app, pid, normalized-title)` — a normalized-title change starts a
new activity event. Navigation between web apps inside one browser now
produces distinct events; the v0.7.0 per-web-app `taxonomy.yaml`
classifies each. Title normalization strips cosmetic churn (unread
counts, unsaved markers, the browser-name suffix) so notification ticks
don't fragment the stream. Full rationale, trade-offs, and the
interaction with the rest of this spec are in ADR-0007.

**Remaining, optional — collapse-by-app coarse view:** now that capture
is title-grained, a `--collapse-mode app_only` flag on `normalize.py`'s
collapse stage would be a genuine *coarse-view* toggle — merge a
browser's title-grained events back to one app-level band on demand.
Lower priority; worth doing when the 8-hour passive timeline (Phase G)
actually needs the denser view tamed. **Not yet built.**

### C2. Merge overlap detection (I37)

**Where:** `normalization/normalize.py` — `_merge_steps()`

**After** keeping manual steps and generating auto steps, scan for
overlaps:

```python
for auto_step in auto_steps:
    for manual_step in manual_steps:
        overlap = compute_overlap(auto_step, manual_step)
        if overlap > 0.5 * auto_step.duration:
            logger.info(f"Dropping auto step '{auto_step.name}' — "
                        f"overlaps manual step '{manual_step.name}'")
            auto_steps.remove(auto_step)
            break
```

### C3. DFG/BPMN decoupling (I40)

**Where:** `normalization/normalize.py` — the `--mine` path

**How:** wrap the BPMN mining call in its own try/except:

```python
if args.mine:
    try:
        dfg_data = mining.compute_dfg(events)
        write_json(session_folder / "dfg.json", dfg_data)
    except Exception as e:
        logger.error(f"DFG computation failed: {e}")

    try:
        bpmn_xml = mining.mine_bpmn(events)
        write_file(session_folder / "process_map.bpmn", bpmn_xml)
    except Exception as e:
        logger.warning(f"BPMN mining failed: {e} — "
                       f"dfg.json is still available")
```

Currently if either fails, both are lost. This ensures the DFG survives
independently.

### C4. Taxonomy validation (I67)

**Where:** `normalization/classification.py` — after classification pass

**What:** count matches per taxonomy rule. Write to
`stats.json` → `meta.taxonomy_report`:

```json
{
  "taxonomy_report": [
    { "rule": "SAP.*invoice", "matches": 47 },
    { "rule": "SAP.*incoive", "matches": 0, "warning": "zero matches" }
  ]
}
```

**Viewer:** in the normalization log host, append a line for each
zero-match rule: "⚠ Taxonomy rule 'SAP.*incoive' matched 0 events —
possible typo?"

### C5. Canonical drift surface (I38)

**Where:** `normalization/canonical_match.py`

**When:** `match_rate` is available from a previous session (stored in
`stats.json.meta.previous_match_rate` or passed as a parameter)

**What:** if current `match_rate < previous - 20`, emit
`stats.json.meta.canonical_drift`:

```json
{
  "warning": true,
  "current_rate": 34,
  "previous_rate": 85,
  "stopped_matching": [
    { "step": "Enter customer data", "expected_field": "CustID_input",
      "found_fields": ["CustomerIdentifier_txt"] }
  ]
}
```

**Viewer:** if `stats.meta.canonical_drift.warning`, show a yellow
banner in the Steps view: "Canonical match rate dropped from 85% to
34% — [N] steps stopped matching. The target app may have updated."

---

## Phase D — Report + PDD Enhancement

**Goal:** the analyst's output is a deliverable, not raw data.

**Ref:** I14, I16, I69, I70, I78 (Cluster F)

---

### D1. Self-contained HTML findings report

**New file:** `viewer/report-html.js`

**Exports:** `generateFindingsReport(session, options) → string`

**Inputs:**
- `session` — the `currentSession` object from `State.getSession()`
- `options.includeProcessMap` — boolean
- `options.includeScreenshots` — boolean (starred only)
- `options.includeNotes` — boolean

**Output:** a complete HTML string (doctype, head with inline CSS, body)
that opens in any browser.

**Sections:**

1. **Header** — engagement ID, worker, date, duration
2. **Process summary** — total duration, case count, step count, app
   breakdown, efficiency ratio (from `analysis.json` when it exists)
3. **Process map** — inline SVG from `dfg-viewer.js` `exportSvg()`,
   cropped, light palette forced, legible fonts. Wrapped in a `<figure>`
4. **Steps** — table: step name, duration (mean if multi-session), waste
   classification (if `analysis.json` exists), automation score (if exists)
5. **Notes** — from `annotations.json.notes[]`, rendered in timestamp
   order, each with its timestamp formatted
6. **Screenshots** — starred screenshots base64-embedded as `<img>` tags
   with captions (timestamp + trigger reason). Requires a `starred`
   boolean on screenshot entries in annotations.
7. **Recommendations** — a `<div contenteditable>` placeholder:
   "Recommendations: [to be completed]". The analyst fills this in before
   sending, or exports and edits in a text editor.

**Styling:** inline `<style>` block. White background, system fonts
(Arial, Helvetica), max-width 900px centered, clean table styling.
No external dependencies.

**Wiring:**
- Add `generateFindingsReport` to `report-html.js` exports
- In `flow-view.js` or `aggregate-view.js`, add an "Export findings
  report" button
- Button handler: `const html = generateFindingsReport(session, opts);`
  then `Ipc.exportFile({ content: html, defaultName: 'findings.html',
  filters: [{ name: 'HTML', extensions: ['html'] }] })`
- The `viewer:exportFile` IPC handler already supports writing string
  content to a user-picked path

**Screenshot starring:** add a `starred` boolean to screenshot entries.
In the screenshot gallery (`flow-view.js` screenshot panel), add a star
icon on each thumbnail. Click toggles `starred` on the screenshot
metadata in `annotations.json.screenshots[]` (or a new
`annotations.json.starred_screenshots[]` array of filenames). Starred
screenshots have a filled star icon. The report includes only starred
screenshots.

### D2. PDD export enhancement (I78)

**Where:** `normalization/pdd_export.py`

**What:** after each step paragraph, if `analysis.json` exists in the
session folder, append:

```
Step: Enter customer data
Duration: 4m 12s (avg across 5 sessions)
[if waste data] Waste: 38s waiting (system load), 12s app switching
[if automation data] Automation potential: High (repetitiveness 92%,
  rule-based 88%) — estimated savings 3.5 min/instance
```

**Implementation:** `pdd_export.py` already receives the session folder
path. Read `analysis.json` if it exists, look up each step by ID, and
add runs to the step paragraph.

---

## Phase E — Recorder Signal Quality

**Goal:** cleaner interaction stream, diagnosable failures.

**Ref:** I28, I29, I30, I31, I32, I33, I34, I36 (Cluster D)

---

### E1. Browser noise filter (I29)

**Where:** `capture/recorder/UiaSubscriber.cs` — the event filter chain

**Add** alongside the existing Win32 desktop chrome filter:

```csharp
// Drop browser chrome noise
if (element.FrameworkId == "Chrome" &&
    string.IsNullOrEmpty(element.AutomationId) &&
    (element.ControlType == ControlType.Pane ||
     element.ControlType == ControlType.Group ||
     element.ControlType == ControlType.Document ||
     element.ControlType == ControlType.Custom))
{
    return; // noise — browser internal DOM, not a user-facing control
}
```

This preserves events from web-app form controls (which have
AutomationIds set by the web app) while dropping the browser's own
chrome events.

### E2. Sequence counter (I36)

**Where:** `capture/recorder/Program.cs`

**What:** add an incrementing `_seq` field to every NDJSON event:

```csharp
private static long _eventSeq = 0;
// in the event emit method:
eventObj["_seq"] = Interlocked.Increment(ref _eventSeq);
```

**Python side:** in `normalization/normalize.py` `load_events()`, use
`_seq` as the secondary sort key:

```python
events.sort(key=lambda e: (e["timestamp"], e.get("_seq", 0)))
```

### E3. Crash diagnostic + enriched stats (I33, I34)

**Where:** `capture/recorder/UiaSubscriber.cs` + `Program.cs`

**Stats line** (emitted every 30s) gains fields:

```json
{
  "type": "stats",
  "events_emitted": 142,
  "events_dropped": 38,
  "errors": 2,
  "last_error": {
    "pid": 1234,
    "process_name": "SAP.exe",
    "control_type": "Edit",
    "message": "Element no longer available"
  }
}
```

**C# implementation:** add module-level counters `_emitted`, `_dropped`,
`_errors`. Increment in the event handler. On exception, record the last
element's properties before the catch block. Emit on the stats timer.

**Electron side:** `capture/recorder.js` already parses stats lines.
Add the new fields to the parse. Optionally emit a `system` event
`{ kind: "recorder_health", ... }` per stats line so the data lands in
`events.jsonl`.

### E4. Configurable debounce (I30)

**Where:** `capture/config.js`, `capture/recorder.js`,
`capture/recorder/UiaSubscriber.cs`

**Config:** add `interactions.debounce_ms: 750` to `DEFAULTS` in
`config.js`.

**Protocol:** `recorder.js` sends the value in the `hello` message:
```json
{ "command": "hello", "debounce_ms": 750 }
```

**C#:** `Program.cs` reads `debounce_ms` from the `hello` message and
passes it to `UiaSubscriber`. The hardcoded `750` in the debounce timer
becomes the parameter.

### E5. Elevated process detection (I32)

**Where:** `capture/tracker.js`

**How:** when `active-win` returns a window, check if the process is
elevated. On Windows, this requires checking the process token — use
a child process call or a native binding. If elevated:
- Emit `{ type: "system", data: { kind: "elevated_process",
  process_name, pid } }` — once per PID per session
- `notify.js` surfaces a one-time toast: "Interactions from [app]
  cannot be captured — it is running with elevated privileges."

**Simpler alternative if native token check is complex:** just flag it
when the recorder emits zero interaction events for a foreground app
over a configurable period. This is a heuristic but avoids native code.

### E6. UIA coverage hint (I28)

**Where:** `capture/recorder/UiaSubscriber.cs`

**What:** on the first interaction event for a new `(pid, process_name)`
pair, include a `coverage_hint` field:
- `"rich"` if the element has a non-empty `AutomationId`
- `"basic"` if it has a `ControlType` but no `AutomationId`
- `"minimal"` if it has only `ClassName`

**Viewer:** the Live Session window can show a per-app indicator, but
this is optional for the first pass. The data being in `events.jsonl`
is the important part.

### E7. Value truncation flag + PII suppression (I31)

**Where:** `capture/recorder/UiaSubscriber.cs`, `capture/config.js`

**Truncation flag:** when the 256-char clamp fires, add
`"value_truncated": true` to the NDJSON event.

**PII suppression:** add `interactions.suppress_values_for` to config:
```yaml
interactions:
  suppress_values_for:
    - process_name: "MyApp.exe"
      automation_id: "SSN_input"
```

The C# side reads this list from the `hello` message and replaces
matching field values with `"[suppressed]"`.

---

## Phase F — Project Layer + Knowledge Persistence

**Goal:** knowledge persists across sessions and engagements.

**Ref:** I19, I41, I60, I61, I62, I63 (Cluster C)

---

### F1. Project auto-save (I19)

**Where:** `viewer/project.js`

**How:** after every state change that would be saved (session load,
tab switch, zoom change, etc.), start a 5-second debounce timer. On
timer fire, save the project to its current path (if it has one).
If no path exists (unsaved project), skip — auto-save only works on
named project files.

```js
let _autoSaveTimer = null;
function scheduleAutoSave() {
  if (!_projectPath) return;
  clearTimeout(_autoSaveTimer);
  _autoSaveTimer = setTimeout(() => saveProject(_projectPath), 5000);
}
```

Wire `scheduleAutoSave()` into `State.subscribe("*")` or the specific
topics that project state cares about.

### F2. Relative paths (I62)

**Where:** `viewer/project.js` — save and load functions

**Save:** before writing the project JSON, resolve all absolute paths
to relative (relative to the project file's directory):
```js
const projectDir = path.dirname(projectPath);
const relPath = path.relative(projectDir, absolutePath);
```

**Load:** after reading the project JSON, resolve relative paths back
to absolute using the project file's directory as the base.

### F3. Team-level denylist (I41)

**Where:** `viewer/project.js` — project schema

**Add** `default_ignored_processes: string[]` to the project file schema.

**On session load:** in `loadSessionIntoView()`, if the project has a
`default_ignored_processes` and the session's
`annotations.step_filters.ignored_processes` is empty, apply the project
defaults. If the session already has its own denylist, don't override.

### F4. Project-level notes (I61)

**Where:** `viewer/project.js` + `viewer/renderer.js` (or a new
`views/project-notes-view.js` if warranted)

**Add** `findings: string` to the project file schema.

**UI:** a "Project notes" panel accessible from the topbar Project menu.
A `<textarea>` that auto-saves on blur to the project file. The content
appears in the findings report (Phase D) if the report is generated in
project context.

### F5. Step template reference (I63)

**Where:** `viewer/project.js` + `viewer/views/steps-view.js`

**Add** `step_template_session: string` (relative path) to the project
file schema.

**Behaviour:** when loading a session that has no steps
(`annotations.steps.length === 0`) and the project has a
`step_template_session`:
1. Load the template session's `annotations.json`
2. Extract its step names and relative time positions (step start as
   fraction of session duration)
3. Show a prompt: "Apply step structure from [template session]?
   [Apply] [Skip]"
4. On Apply, create new `manually_authored` steps with the template
   names, positioned at the equivalent time fractions in the new session
5. The analyst adjusts, splits, merges as needed

---

## Phase G (minimal) — Workflow B Prep for 8h Recording

**Goal:** enable a first 8-hour passive recording next week. Minimal
changes — just enough that the recording produces usable data.

---

### G1. Don't auto-end on idle

**Where:** `capture/main.js` — idle handler

**Current:** when idle exceeds `auto_end_idle_minutes`, the session ends.

**Change:** add `auto_end_on_idle: true` to `config.js` DEFAULTS. When
set to `false` in the session config, idle events are still recorded
but the session doesn't auto-end. The worker explicitly ends the session
(or the shift ends and they close the app).

This is the one config change needed for an 8-hour recording. The rest
of the capture machinery works unchanged.

### G2. Browser noise filter (E1)

Already covered in Phase E. Critical for all-day recording — without it,
an 8-hour browser-heavy session could produce 100k+ noise events.

### G3. Collapse-by-app (C1)

Already covered in Phase C. Critical for the viewer to render an 8-hour
session without being a wall of thin bands.

### G4. Manual case creation via range-to-case (I15)

**Where:** `viewer/views/flow-view.js` — range selection handler

**Current:** Shift-drag on the timeline creates a range selection and
shows a stats card.

**Add:** an "Insert case" button on the stats card. Click opens a prompt
for a case label. On confirm, creates two `marker_edit` entries
(`op: "insert"`, one start + one end at the range boundaries) and calls
`persistAnnotations()`. Re-normalize applies them.

This lets the analyst manually bracket process instances in the 8-hour
recording after the fact, without needing capture-time markers.

---

## Phase H — Comparison + Video + Markers

**Goal:** multi-worker comparison, video usability, marker and undo polish.

**Ref:** I7, I8, I9, I12, I13, I15, I48, I49, I65 + I39

---

### H1. Per-worker grouping in Compare Sessions (I48)

**Where:** `viewer/views/aggregate-view.js`

**When:** `aggregateSessions.length > 1` and at least two sessions have
different `manifest.worker` values.

**What:** add a "Group by worker" toggle button on the activity-frequency
and case-duration bar charts. When enabled, bars are grouped (or
side-by-side) by worker, using `manifest.worker` as the key. Colour-code
per worker. The data is already loaded — this is a rendering change to
`charts.js`'s `renderBarChart` call.

### H2. Two-session side-by-side comparison (I49)

**Where:** `viewer/views/aggregate-view.js`

**When:** exactly two sessions are loaded.

**What:** show a "Compare side-by-side" button. On click, render two
`TimelineCore.renderMiniTimeline` strips stacked vertically in a new
`#side-by-side-container` div:
- Align by time (left edge = first event of each) or by first case
  start (toggle)
- Steps from each session rendered as bands; matching step names
  highlighted, divergent steps in amber
- A text summary below: "Sessions agree on steps 1, 2, 4. Session A
  has step 3 (Excel lookup) that Session B skips. Session B's step 5
  takes 2.1x longer."

Reuses `TimelineCore.renderMiniTimeline` from `timeline/timeline-core.js`.

### H3. Conformance overlay on the DFG (I12)

**Where:** `viewer/dfg-viewer.js` — the `render()` function

**When:** the session has a Process Template loaded and `auto_matched`
steps exist in `annotations.steps`.

**What:** colour DFG nodes by conformance status:
- Green — activity matches a canonical step
- Amber — activity exists in the session but not in the template
- Red — template step expected but not found in the session

Look up each node's activity label against the canonical step names.
Use `auto_matched` steps to map activity → canonical step. Nodes not in
any `auto_matched` step are amber. Canonical steps not represented by
any node are listed as "missing" in a legend below the graph.

Apply colours via cytoscape's `node.style('background-color', hex)`.

### H4. Interactive video re-sync (I8)

**Where:** `viewer/views/flow-view.js`

**What:** add a "Sync video" button near the `<video>` element. On click:

1. Show a modal: "Click a recognizable moment in the video, then click
   the matching event on the timeline."
2. The analyst clicks the video → record `video.currentTime`
3. The analyst clicks an event on the timeline → record the event
   timestamp
4. Compute offset: `event_timestamp - (videoStartTs + video.currentTime)`
5. Write to `annotations.json.externalVideoOffsetMs` via
   `persistAnnotations()`
6. Reload the session to apply

**UI:** modal with two states — "Step 1: click a moment in the video"
(highlight video pane), "Step 2: click the matching event on the
timeline" (highlight timeline). Cancel button. Two click handlers
registered temporarily, removed after completion.

### H5. Step-to-video "Watch" button (I9)

**Where:** `viewer/step-editor.js` — `renderStepDetail()`

**When:** a step is selected and `currentSession.recordingAvailable`

**What:** add a "▶ Watch" button in the step detail header. On click:
- `video.currentTime = stepStartTimestamp - videoStartTs`
- `video.play()`
- Optionally, set a `timeupdate` listener that pauses when
  `video.currentTime >= stepEndTimestamp - videoStartTs`

### H6. Range-to-case + exclude range (I15, I4)

**Where:** `viewer/views/flow-view.js` — range selection stats card

**What:** add two buttons to the existing range selection stats card:

1. **"Insert case"** — prompt for a label, create two `marker_edit`
   entries (`op: "insert"`, start at range start, end at range end),
   call `persistAnnotations()`. (Also listed in G4.)
2. **"Exclude from analysis"** — add the range to
   `annotations.json.excluded_ranges[]` as
   `{ start: isoTimestamp, end: isoTimestamp, reason: "manual" }`.
   Normalization skips events in excluded ranges during step suggestion
   and statistics. **Python side:** `step_suggest.py` and
   `stats_compute.py` filter out events whose timestamp falls within
   any excluded range.

### H7. Re-normalization confirm dialog (I7)

**Where:** `viewer/views/flow-view.js` (or wherever the "Run
normalization" button handler lives)

**What:** before spawning normalization, show a `confirmModal`:

```
Re-normalization will:
  • Regenerate [N] auto-detected steps
  • Keep your [M] manually confirmed steps
  • Clear undo history

Continue?  [Cancel] [Re-analyze]
```

Compute N and M from `currentSession.annotations.steps` by counting
`state === "auto_suggested" || state === "auto_matched"` vs the rest.

### H8. Rotating annotation backups (I65)

**Where:** `viewer/session.js` — the `saveAnnotations` path

**What:** before writing `annotations.json`, rotate existing file:
```js
for (let i = 4; i >= 1; i--) {
  const from = i === 1 ? 'annotations.json' : `annotations.json.${i}`;
  const to = `annotations.json.${i + 1}`;
  if (fs.existsSync(path.join(folder, from)))
    fs.renameSync(path.join(folder, from), path.join(folder, to));
}
```

Keeps 5 versions. Recovery is manual — the analyst copies a `.N` file
back to `annotations.json`. No UI needed; this is a safety net.

### H9. Mismatched taxonomy warning (I13)

**Where:** `viewer/views/aggregate-view.js`

**When:** loading multiple sessions, after all are loaded.

**What:** compare `stats.json.meta.taxonomy_version` (or
`meta.taxonomy_file` hash if version isn't stamped) across sessions.
If they differ, show a yellow banner: "Sessions were analyzed with
different taxonomy versions — variant comparison may be unreliable."

### H10. Step-level variants (I39)

**Where:** `normalization/stats_compute.py` + `viewer/views/aggregate-view.js`

**Python:** add a `step_variants` computation alongside the existing
`trace_variants`. Instead of the activity sequence, use the step name
sequence per case. Write to `stats.json.step_variants`.

**Viewer:** add a "Variants by: [Activity | Step]" toggle on the
variants table in Compare Sessions. When "Step" is selected, render
from `stats.step_variants` instead of `stats.trace_variants`.

---

## Phase I — Vocabulary, Polish, and Remaining Items

**Goal:** accumulated small items that didn't fit into earlier phases.

**Ref:** I5, I10, I23, I24, I25, I26, I43, I47, I57, I58, I72

---

### I1-spec. Step suggestion reason (I5)

**Where:** `normalization/step_suggest.py` + `viewer/step-editor.js`

**Python:** when generating an `auto_suggested` step, add a
`suggestion_reason` field:
```python
step["suggestion_reason"] = (
    f"Grouped {len(interactions)} interactions in {app_name}, "
    f"max gap {max_gap_s:.0f}s (threshold {threshold_s}s)"
)
```

**Viewer:** in `step-editor.js` `renderStepDetail()`, if
`step.suggestion_reason` exists, show it as a muted line below the step
name: "Auto-detected: grouped 8 interactions in SAP MM, max gap 4s."

### I2-spec. Screenshot perceptual hash grouping (I10)

**Where:** `normalization/normalize.py` (or new `screenshot_hash.py`) +
`viewer/views/flow-view.js` screenshot gallery

**Python:** during normalization, for each `.jpg` in `screenshots/`:
1. Open with Pillow, resize to 8×8, convert to grayscale
2. Compute mean pixel value
3. Generate a 64-bit hash: each pixel → 1 if above mean, 0 if below
4. Store in `stats.json.screenshot_hashes`:
   `{ "filename": "001.jpg", "hash": "a3b4c5d6e7f80011" }`

**Viewer:** in the screenshot gallery, for each consecutive pair of
screenshots, compute hamming distance between hashes. If distance < 5
(~92% similar), collapse them: show only the last screenshot with a
"(+N similar)" badge. Click the badge to expand.

**Dependency:** requires Pillow, which is already in the normalization
requirements (transitive via PM4Py).

### I3-spec. Idle at-desk detection (I23)

**Where:** `capture/tracker.js`

**What:** when the idle monitor fires (`powerMonitor.getSystemIdleTime`
exceeds threshold), check a module-level variable
`lastRecorderEventTime` — updated every time `recorder.js` forwards an
interaction event.

```js
const atDesk = (Date.now() - lastRecorderEventTime) < 30000; // 30s
```

Include `at_desk` in the idle-start system event:
```js
tracker.fireSystem("idle_start", { at_desk: atDesk });
```

**Viewer:** in `flow-view.js` timeline rendering, idle bands with
`at_desk: true` render with a dashed border or lighter fill. Tooltip:
"Idle (still at desk — mouse/keyboard activity detected)" vs
"Idle (away)."

### I4-spec. Pipeline error translation (I24)

**Where:** `viewer/main.js` — the normalization subprocess output
handler (where `stderr` from Python is forwarded to the renderer log
host)

**What:** a map of common Python exception patterns to plain-language
messages:

```js
const ERROR_TRANSLATIONS = {
  "KeyError: 'timestamp'": "Some events are missing timestamps — the capture may have been interrupted.",
  "KeyError: 'case_ids'": "Case assignment failed — check that markers are present in the session.",
  "InductiveMiner": "Process map mining timed out — try adding more apps to the ignored list to reduce complexity.",
  "FileNotFoundError.*events.jsonl": "The events file is missing — was the session folder copied completely?",
  "yaml.scanner.ScannerError": "The taxonomy YAML has a syntax error — check indentation.",
};
```

Before appending a stderr line to the log host, check against the map.
If a match is found, prepend the translation: "ℹ [plain-language
message]\n  Technical detail: [original error]".

### I5-spec. Storage threshold prompt (I25)

**Where:** `capture/session-storage.js` + `capture/main.js`

**When:** at session end, after writing the integrity file.

**What:** compute total size of
`%APPDATA%\process-discovery-tracker\sessions\` (already available via
`session-storage.js`). If above a configurable threshold (default 50 GB),
show a notification: "Session storage is at [N] GB. Consider running
the prune tool to free space." One notification per session, not
recurring.

### I6-spec. Viewer performance investigation (I26)

**This is an investigation, not a code change.** Before optimizing:

1. Open a real large session (8h, 25k events, 200 screenshots) in the
   viewer
2. Add `performance.mark('render-start')` / `performance.measure()`
   spans around `renderTimeline()`, the annotation edit path, and
   `loadSessionIntoView()`
3. Identify whether the bottleneck is DOM construction, layout, or
   data processing
4. If DOM: consider virtualizing the event table (now hidden by default
   per A1 — may be moot) and the screenshot gallery
5. If data: consider pre-computing timeline layout once and caching

**No implementation until the profiling identifies the bottleneck.**

### I7-spec. Multi-monitor indicator (I43)

**Where:** `capture/tracker.js` + `capture/main.js` +
`viewer/views/flow-view.js`

**Capture side:** `active-win` already returns `bounds: { x, y, width,
height }`. Include the bounds in the activity event's `data` object:
```js
data.bounds = { x: win.bounds.x, y: win.bounds.y,
                w: win.bounds.width, h: win.bounds.height };
```

At session start, write the display geometry to `manifest.json`:
```js
const { screen } = require('electron');
manifest.displays = screen.getAllDisplays().map(d => ({
  id: d.id, bounds: d.bounds
}));
```

**Viewer side:** in `flow-view.js` activity band rendering, if
`event.data.bounds` exists and `manifest.displays.length > 1`, compute
which display the window center falls on. Show a small "M1" / "M2"
badge on the activity band.

### I8-spec. appendFileSync → async with flush (I47)

**Where:** `capture/tracker.js` — `appendEvent()` or equivalent

**What:** replace `fs.appendFileSync` with an async write queue:

```js
const writeQueue = [];
let flushTimer = null;

function queueEvent(line) {
  writeQueue.push(line);
  if (!flushTimer) {
    flushTimer = setTimeout(flushQueue, 500);
  }
}

function flushQueue() {
  if (writeQueue.length === 0) return;
  const batch = writeQueue.splice(0);
  fs.appendFile(eventsPath, batch.join('\n') + '\n', (err) => {
    if (err) log.error('Write failed:', err);
  });
  flushTimer = null;
}

function flushImmediate() {
  clearTimeout(flushTimer);
  flushTimer = null;
  if (writeQueue.length === 0) return;
  const batch = writeQueue.splice(0);
  fs.appendFileSync(eventsPath, batch.join('\n') + '\n');
}
```

Markers and manual screenshots call `flushImmediate()`. Interaction
events and activity polls use `queueEvent()`. Session end calls
`flushImmediate()`.

### I9-spec. Frequency-ranked vocabulary bootstrap (I57)

**Where:** `normalization/app_vocab.py` — the bootstrap function

**What:** after collecting all unique `(automation_id, name,
control_type, app)` tuples, sort by frequency (descending). Add a
`# seen N times` comment per entry in the output YAML:

```yaml
# --- SAP.exe (87 interactions) ---
CustID_input:  # seen 34 times
  meaningful_name: ""
  screen_id: ""
AddressLine1:  # seen 28 times
  meaningful_name: ""
  screen_id: ""
# ... uncommon (seen ≤2 times) ...
# ToolbarBtn_7:  # seen 1 time
```

**Viewer side:** in `views/vocab-view.js`, when displaying a
bootstrapped vocabulary, collapse entries with `# seen ≤2` under a
"Show uncommon fields (N)" disclosure toggle.

### I10-spec. Vocabulary coverage metric (I58)

**Where:** `normalization/app_vocab.py` or `stats_compute.py`

**After** interaction enrichment, compute per app:
```python
coverage = {
    app: {
        "total_interactions": count,
        "enriched": count_with_meaningful_name,
        "coverage_pct": round(enriched / total * 100, 1)
    }
    for app, (total, enriched) in app_counts.items()
}
```

Write to `stats.json.meta.vocab_coverage`. The session summary panel
(Phase A) displays it: "App Vocabulary coverage: SAP 87%, Excel 12%."

### I11-spec. Command palette wiring (I72)

**Where:** `viewer/command-palette.js` + each view module

**Currently:** only `flow-view.js` registers commands via `setProvider`.

**What:** each view module registers its own commands in its `init*()`
call:

```js
// steps-view.js
function initStepsView({ ... }) {
  commandPalette.registerProvider('steps', () => [
    { label: 'Split step at cursor', action: () => splitAtCursor() },
    { label: 'Merge with next step', action: () => mergeWithNext() },
    { label: 'Hide step as noise', action: () => hideAsNoise() },
    { label: 'New manual step', action: () => addManualStep() },
  ]);
}
```

`command-palette.js` collects from all registered providers and filters
by the active view. Add a small "⌘K" label in the topbar (near the
theme toggle) as a discoverability hint.

---

## Dependencies and ordering

```
Phase A (summary + orientation) — no dependencies, start here
Phase B (capture confidence)    — independent, can parallel with A
Phase C (pipeline hardening)    — independent, can parallel with A/B
Phase D (report + PDD)          — depends on A for summary data;
                                  depends on C for reliable pipeline
Phase E (recorder quality)      — independent, C# work
Phase F (project layer)         — depends on A for summary panel
Phase G (8h prep)               — depends on C1, E1; G4 depends on A
Phase H (comparison + video)    — depends on A, C; I49 needs timeline core
Phase I (vocab + polish)        — independent, can run anytime
```

Phases A, B, C, E, and I can all proceed in parallel. D follows A+C.
F follows A. G picks up items from C and E. H follows A and C.

---

## Entry accounting

| Status | Count | IDs |
|--------|-------|-----|
| **In spec (Phases A-I)** | 61 | I1-I5, I7-I10, I12-I16, I19-I21, I23-I26, I28-I41, I43-I49, I51-I52, I54-I58, I60-I63, I65, I67, I69-I73, I78 |
| **Absorbed by another entry** | 3 | I6 (→I35), I64 (→I49+I12), I66 (→I7) |
| **Deferred (IMPROVEMENTS.md)** | 9 | I11, I17, I18, I22, I27, I42, I50, I53, I68 |
| **Deferred to Workflow B spec** | 8 | I59, I74-I81 |
| **Total** | **81** | |

---

## Testing approach

- **Python modules:** pytest in `normalization/test/`. Each new function
  gets a test with a minimal event list and expected output. Existing
  `pytest.yml` CI runs on push.
- **JS modules:** `node:test` in `viewer/test/` and `capture/test/`.
  Pure-logic functions (summary computation, overlap detection, path
  resolution) get unit tests. UI-level changes verified by running the
  app.
- **C# recorder:** manual testing — run the recorder against a test app,
  verify the NDJSON output has the expected fields. No automated test
  infrastructure currently exists for the C# side.
- **Integration:** load a real session folder in the viewer after each
  phase and verify the new surfaces render correctly. The bundled example
  sessions can serve as test fixtures.

---

*Implementation spec created 2026-05-17. Covers Workflow A improvements
(Phases A-I) and minimal Workflow B prep (Phase G). All 81 entries from
IMPROVEMENTS.md are accounted for: 61 specified, 4 absorbed, 9 deferred,
7 deferred to Workflow B spec. The analysis layer (waste classification,
time study, automation scoring) is deferred to a separate spec once
Workflow B requirements are confirmed from real 8-hour recording data.*
