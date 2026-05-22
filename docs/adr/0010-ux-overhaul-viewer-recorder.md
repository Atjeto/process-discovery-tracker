# ADR-0010: UX Overhaul -- Viewer Interaction Model + Recorder Usability

**Status:** Accepted — fully implemented 2026-05-22 (commits d9fbc13, ff9922d,
89417b5, b1464d8, 98e5a2b, 8e0c168, 8d667cf). Strategic framing in
[VALUE-CHAIN-REVIEW.md](../architecture/VALUE-CHAIN-REVIEW.md); note that A4 (and
the step-level map C1b) are tactical aids — the deeper segmentation fix is
intra-session repetition alignment, tracked separately.
**Date:** 2026-05-22
**Deciders:** Rasha (analyst/owner)

## Context

First real-data sessions (ATM ticket processing across TAMBA, SNFI, ES CALL
MANAGEMENT) exposed fundamental UX gaps in both the viewer and the recorder.
The tool works mechanically but is unintuitive to operate -- the analyst
cannot easily read, slice, or annotate what was captured, and the recorder
fights the operator during walkthroughs. Twelve issues grouped into four
areas below.

---

## Area A -- Viewer: Interaction Readability + Step Editing

### A1. Interactions are an undifferentiated text wall

**Current state.** `renderInteractionList()` in `step-editor.js:338` emits a
flat `<ol>` of `<li class="step-interaction">` elements. Each row has a
`.si-text` span (the `describeInteraction()` output) and a `.si-time` span.
There is no visual distinction between a value entry ("Typed X into Y") and an
action ("Clicked Search").

**Decision.** Colour-code interactions by kind:

| Kind bucket          | CSS class          | Left-border colour | Rationale |
|----------------------|--------------------|--------------------|-----------| 
| `value_changed`, `text_changed` | `.si-value` | amber/warm accent  | Data entry -- the "what" |
| `invoked`            | `.si-action`       | blue accent         | An explicit user action |
| `selection_changed`  | `.si-select`       | teal accent         | A choice from a list |
| `toggle_changed`     | `.si-toggle`       | purple accent       | On/off state change |
| Other / `focus_changed` | `.si-other`     | grey (muted)        | Navigational noise |

Implementation:
- In `renderInteractionList()`, derive a `kind` bucket from `ev.data.kind` and
  add it as a second class on the `<li>`: `<li class="step-interaction si-value">`.
- In `styles.css`, each `.si-*` class gets a 3px left border in the accent
  colour, a subtle tinted background (`rgba(accent, 0.06)`), and the `.si-text`
  colour changes to the accent. The `.si-time` stays `--fg-3`.
- Both themes (light Warm Editorial + dark) get the same accent set, just
  with light/dark luminance adjustments (theme.js tokens).
- The typed value inside `describeInteraction()` output is already quoted
  (`"X"`); consider wrapping it in a `<strong>` tag so it pops visually.

### A2. Split is blind -- always cuts at the midpoint

**Current state.** `splitStep()` in `steps-view.js:253` splits at the
interaction-count midpoint: `const mid = Math.ceil(ids.length / 2)`. The
analyst has no say in where the cut happens.

**Decision.** Let the analyst click an interaction to set the split point:

1. Add a clickable split-point indicator to each interaction row (a subtle
   vertical line or "split here" icon on hover).
2. Clicking it stores `State.setPendingSplitAfter(eventId)`.
3. When the "Split" button is pressed, if a pending split-after is set, split
   the interaction list at that index instead of the midpoint. If none is set,
   fall back to the current midpoint behaviour (so existing flow is unbroken).
4. Visual feedback: once a split-after is chosen, the rows above and below it
   get a faint separator line + "(split 1)" / "(split 2)" ghost labels.

Also wire this into the step timeline: right-click on a step block should
offer "Split at interaction..." which scrolls the detail pane's interaction
list open and prompts the analyst to click where.

### A3. Flags are stored but have no downstream effect

**Current state.** The four flags (`conditional`, `exception_path`, `waste`,
`automation_candidate`) are boolean fields saved to `annotations.json` on the
step. They appear as checkboxes in the detail pane (`step-editor.js:176-179`)
and survive a save. But:
- They do not surface in the step list (no icon/badge).
- They do not affect the aggregate view or the process map.
- They do not appear in the PDD or CSV export.
- Marking something as "waste" does nothing visible beyond the checkbox.

**Decision.** Make flags meaningful:

| Flag | Step list badge | Aggregate view | Export |
|------|----------------|----------------|--------|
| Conditional | `?` icon after name | Conditional-step count in session stats | PDD table column |
| Exception path | `!` icon (warn colour) | Exception count + time share | PDD table column |
| Waste | strikethrough name + waste-accent background | Waste time share in session stats; waste hotspot list in analysis sub-view | PDD table "Waste" column; findings report waste section |
| Automation candidate | robot icon | Automatable-share % in session stats | PDD table "Automate" column |

Implementation touches: `renderStepList()` in `step-editor.js` for badges;
`analysis_waste.py` / `analysis_automation.py` for aggregate stats;
`pdd_export.py` for the PDD columns; `report-md.js` / `report-html.js` for
the findings report.

### A4. Interaction grouping is too aggressive

**Current state.** `auto_suggest_steps()` in `step_suggest.py` groups by:
- Time gap > `step_split_idle_ms` (default 10s) -> new step
- Interaction count >= `step_max_interactions` (default 60) -> new step
- A completion-action boundary (invoked Button/Hyperlink with a completion
  word like "submit", "save", "search") -> flush step

It does NOT consider the element identity. So a long form-fill where the user
types into 12 text boxes with < 10s between keystrokes becomes one giant step.
Conversely, a rapid app-switch (which no longer splits -- removed to fix
fragmentation per ADR memory) lumps cross-app actions together.

The user's feedback: "If multiple interactions are performed on 1 element,
like a text box, then group those as a step. A click on a button should be
a standalone step. We are currently grouping a LOT of interactions that
should be standalone steps into one."

**Decision.** Add element-boundary splitting as a new rule in the step
segmenter, applied BEFORE the gap/count rules:

1. **Element identity key:** `(window_title, automation_id or name,
   control_type)`. Two consecutive interactions that share this key are part
   of the same element gesture.
2. **New split rule -- element change:** when the element key changes AND
   the prior gesture was a value entry (value_changed / text_changed), flush.
   This means: typing into TextBox A, then typing into TextBox B = two steps.
   Typing into TextBox A, then clicking Button B = two steps (the typing
   step flushes because the element changed). Clicking Button A, then
   clicking Button B in rapid succession = one step (unless a completion word
   fires the existing flush).
3. **Solo-action steps:** a single `invoked` interaction on a Button that is
   NOT a completion word but IS the only interaction in its element gesture
   still becomes a step (lower `step_min_interactions` to 1 for invoked
   actions, or exempt them from the min-interaction filter).
4. **Configurable.** Add `step_split_on_element: true` (default) to the
   normalization config so this can be toggled off for sessions where the old
   behaviour is preferred (backward compat).

The completion-word flush stays -- it fires even within a single element
gesture (e.g., typing a value then clicking "Submit" in the same form still
flushes on Submit).

### A5. Step timeline right-click context menu

**Current state.** The step timeline (`renderStepTimeline` in
`step-editor.js:237`) renders step blocks via `TimelineCore.renderMiniTimeline`.
There is no context menu on step blocks. Right-click context menus exist on
the Flow timeline (marker insert, case scope) but not on the Steps timeline.

**Decision.** Add a right-click context menu on step blocks in the Steps
mini-timeline:

| Menu item | Action |
|-----------|--------|
| **Split at interaction...** | Select this step, scroll the interaction list open, enter split-point mode (A2) |
| **Merge with next** | Same as the detail pane button |
| **Rename** | Enter inline rename mode on the step row |
| **Hide as noise** | Same as the detail pane button |
| **Jump to in Flow** | Switch to Flow view, seek to step start |
| **Watch** | Play the recording for this step's time range (if recording available) |
| --- | --- |
| **Flag as waste** | Toggle the waste flag |
| **Flag as automation candidate** | Toggle the automation-candidate flag |

Implementation: add a `contextmenu` event listener in `renderStepTimeline`
(or on the timeline host, checking `e.target.closest(".step-block")`). Reuse
the same HTML context-menu pattern from `flow-view.js:showMarkerInsertMenu`.

---

## Area B -- Viewer: Step Panel Layout

### B1. Selected step panel grows unboundedly, pushing the step list off-screen

**Current state.** The Steps view layout (HTML id `session-layout-steps`) uses
a CSS grid. Both the list pane (`.editor-list-pane`) and the detail pane
(`.editor-detail-pane`) have `overflow: auto` and `min-height: 0`.
The grid rows are implicit, so the detail pane grows with its content
(interactions list, description textarea, action buttons). When a step has
many interactions and the details section is expanded, the detail pane pushes
the whole grid taller, and the step list column stretches to match.

The user's feedback: "the same max-size the selected step panel currently has
should be the default for the steps field. When the selected step grows by
expanding interactions, it always grows to the size as the steps on the left
is. That interaction needs to be smooth."

**Decision.** Fix the layout so both panes share a common height and scroll
independently:

1. Set `session-layout-steps` to a CSS grid with `grid-template-rows: 1fr`
   and `grid-template-columns: 1fr 1fr` (or a named ratio). Both columns
   sit in the same grid row, so they are always the same height.
2. Both `.editor-list-pane` and `.editor-detail-pane` get `overflow-y: auto;
   max-height: 100%;` so they scroll within their cell.
3. The outer container (`#session-layout-steps`) gets a fixed height:
   `calc(100vh - <header+timeline+toolbar heights>)` -- this anchors the
   two-column area and prevents unbounded growth.
4. When interactions are expanded inside the detail pane, only the detail
   pane scrolls. The step list stays put.
5. Smooth interaction: add `scroll-behavior: smooth` on the detail pane, and
   a CSS transition on the interactions `<details>` open/close (a
   `max-height` transition with `overflow: hidden` on the wrapper, animated
   via JS toggling a class).

---

## Area C -- Process Map: Depth + Application Classification

### C1. Process map shows only Start -> End for real sessions

**Current state.** The process map is mined from `events.xes` via PM4Py
(`normalization/mining.py`). The XES log is built from activity events
(app-switch polls), each classified by `classification.py` using
`taxonomy.yaml` rules. For the user's ATM-ticket sessions (TAMBA, SNFI, ES
CALL MANAGEMENT), there are zero taxonomy rules matching those apps, so every
activity event is classified as "Unclassified -- <app>". PM4Py's inductive
miner with noise filtering collapses all "Unclassified" variants into a
trivial Start -> End graph. The DFG shows the edges but they are all between
"Unclassified" nodes.

Additionally, the Flow timeline's activity lane shows zero application bars
because the activity events have no taxonomy match -- the bars are keyed on
the `activity_class` field, which is "Unclassified -- <app>" for every event.
The bars DO render but they all show as the same grey "Unclassified" colour,
which visually reads as "nothing".

**Decision.** Two changes:

**C1a. Taxonomy is the fix, not the code.** The user needs to add rules for
their apps to `taxonomy.yaml`. The tool should make this obvious and easy:

- When normalization produces > 50% "Unclassified" activities, show a warning
  banner in the Flow view: "Most activities are unclassified. Add rules to
  your taxonomy to get a meaningful process map. [Open taxonomy editor]".
- Add a "Classify this app..." right-click action on unclassified activity
  bands in the Flow timeline. This opens a small dialog pre-filled with the
  app name and title pattern, and appends a rule to `taxonomy.yaml` (or the
  session-level `classification_overrides.json`).
- The reclassify action already exists on DFG nodes in the aggregate view
  (`aggregate-view.js:1105`) -- extend it to the Flow timeline activity bands.

**C1b. Depth-level control for the process map.** The current map is always
at the activity (application) level. Add a dropdown in the map panel:

| Level | What it maps | Source |
|-------|-------------|--------|
| **Application** (default) | One node per classified app | Activity events from `events.xes` |
| **Step** | One node per step name | Steps from `annotations.json` |
| **Phase** | One node per phase | Phases from `annotations.json` |

For the Step-level DFG: build edges from the step sequence
(step[i].name -> step[i+1].name) with frequency counts. No PM4Py needed --
this is a simple adjacency count done in JS at render time.

For the Phase-level DFG: same approach, phase sequence.

This gives the analyst a process map even when taxonomy is empty (Step and
Phase levels work off the analyst's own annotations, not the classifier).

### C2. Application bars missing on the Flow timeline

Addressed by C1a above. The bars are rendering but are all "Unclassified"
grey. Once taxonomy rules exist, they will colour-code properly. The
"Classify this app" right-click flow is the usability fix.

Additionally: the unclassified bars should use a more visible fallback style
-- currently they blend into the timeline background. Give unclassified bars
a diagonal-stripe pattern or a distinct muted colour per unique app name
(hash-based palette) so the analyst can at least see that activity IS
happening, even before classifying.

---

## Area D -- Recorder Usability

### D1. Recorder hides behind other applications

**Current state.** The operator panel (`operator-panel.js:48`) is
`alwaysOnTop: true`, which keeps it above normal windows. However, on
Windows, `alwaysOnTop` at the default level is overridden by any other
always-on-top window (fullscreen apps, some corporate tools, Windows
notification centre). The window is also a standard size (460x720) with
`skipTaskbar: false`, so it shows in the taskbar but is easy to lose on a
busy desktop.

**Decision.** Multiple improvements:

1. Set `alwaysOnTop` level to `"screen-saver"` (the highest Electron level):
   `win.setAlwaysOnTop(true, "screen-saver")`. This keeps the recorder above
   everything short of a true fullscreen exclusive app.
2. Add a "mini mode": a small floating toolbar (200x40, no frame,
   transparent background, draggable) that replaces the full panel when
   minimised. Shows: session timer + stop button + screenshot button +
   marker button. Click to expand back to full panel. This is the surface
   the operator actually needs during a walkthrough -- fire markers and stop.
3. Add a tray-icon single-click handler that brings the recorder window to
   front (`win.show(); win.focus();`) -- currently the tray only opens a
   context menu.
4. Show a toast notification when the recorder window loses focus: "Recorder
   is still running. Click the tray icon or press [hotkey] to bring it back."
   (One-time, dismissable.)

### D2. Hotkey configuration UI

**Current state.** Hotkeys are defined in `config.js:30-34` as defaults
(`Control+Shift+S`, `Control+Shift+E`, `Control+Shift+P`,
`Control+Shift+Y`). They can be overridden via the YAML config file
(`sample-config.yaml`). There is no UI to change them -- the session-config
window (`ui/session-config.html`) edits engagement metadata, labels, and
idle thresholds, but not hotkeys.

**Decision.** Add a hotkeys section to the session-config window:

1. Four rows in the form: Start marker, End marker, Screenshot, Sync marker.
   Each row has a label, the current binding displayed as a
   keyboard-shortcut badge, and a "Record new shortcut" button.
2. Clicking "Record" puts the field in capture mode -- the next key
   combination pressed is captured as the new binding (like VS Code's
   keybinding editor). Display the captured combo, validate it's not
   taken by the OS, and show a warning if it conflicts.
3. On save, write the hotkeys to `quick-config.yaml` alongside the other
   session config. Takes effect on next launch (same as other config
   changes).
4. Show the current effective hotkeys in the operator panel header so the
   operator always knows what to press.

### D3. Marker screenshot captures the recorder, not the target app

**Current state.** `captureScreenshot()` in `screenshots.js:69` uses
`desktopCapturer` to grab the screen. The `resolveTargetDisplays()` function
(line 45) captures the display containing the foreground window. When the
analyst clicks a marker button in the operator panel, the operator panel
IS the foreground window -- so the screenshot captures the display where
the operator panel lives, which shows... the operator panel.

When the hotkey fires the marker, the same problem occurs if the user has to
type a label in the operator panel -- focus moves to the operator panel,
and the screenshot fires after focus transfer.

**Decision.** Decouple the screenshot from the marker-fire moment:

1. **Pre-capture:** when the marker hotkey is pressed (before the label
   picker opens), immediately capture a screenshot of the current foreground
   window/display. Store it in memory as a pending screenshot.
2. **On marker confirm:** attach the pre-captured screenshot to the marker
   event, not a new capture.
3. **For button-click markers (operator panel):** the operator panel should
   capture the screenshot of the LAST foreground window before focus moved to
   the panel. Track `lastForegroundBounds` in `tracker.js` (it already polls
   active-window info) and pass those bounds to `captureScreenshot` instead of
   the current foreground.
4. **Fallback:** if no foreground bounds are available, capture the primary
   display (existing behaviour).

This also fixes the hotkey case: the hotkey handler fires in the background
(globalShortcut), captures the screenshot immediately (foreground is still the
target app), then opens the label picker.

### D4. Session name not persisting

**Current state.** The session-config window writes `engagement_name` to
`quick-config.yaml` (`ui/session-config.html:153`). The session creation
flow in `session.js` reads this config. However, `session.js` does not
reference `engagement_name` anywhere (grep confirms zero matches). The name
entered in the setup dialog is saved to the YAML but never read into the
session metadata written to `session.json`.

**Decision.** Wire `engagement_name` through to the session:

1. `createSession()` in `session.js` should read `config.engagement_name`
   and write it into `session.json` as `session_name` (or `engagement_name`).
2. The viewer should display this name in the session header (currently shows
   the folder name or session ID).
3. Also surface it in `listRecentSessions()` so the welcome window's recent
   list shows meaningful names.

---

## Consequences

### What becomes easier
- Analyst can read interactions at a glance (colour-coding).
- Analyst can precisely control where steps split (click-to-split).
- Flags have visible downstream effects, making annotation worthwhile.
- Step grouping matches the analyst's mental model (element-level).
- Recorder stays visible and screenshots capture the right screen.
- Hotkeys are discoverable and configurable without editing YAML.
- Process maps are useful even without taxonomy (step-level maps).
- Taxonomy gaps are surfaced and fixable in-place.

### What becomes harder
- Step segmentation has a new rule; existing sessions will get different
  auto-suggested steps on re-analyze (backward-compat: `step_split_on_element`
  config flag).
- The recorder's screenshot flow is more complex (pre-capture + deferred
  attach).

### What we will need to revisit
- The element-boundary segmenter needs tuning with real multi-app sessions;
  the element identity key may need fuzzing for apps with dynamic automation
  IDs (TAMBA AG-Grid -- see recorder precision memory).
- The step-level DFG is a new concept; need to see if it produces meaningful
  maps or just a hairball when step count is high.
- Mini-mode recorder is a new window type; needs testing on the locked-down
  work laptop for always-on-top behaviour.

---

## Implementation Sequencing

| Priority | Item | Effort | Risk |
|----------|------|--------|------|
| P0 (ship-blocking) | D3 screenshot fix | Small | Low -- self-contained change in screenshots.js + main.js |
| P0 (ship-blocking) | D4 session name fix | Tiny | Low -- one-line wire-through |
| P0 (ship-blocking) | D1 recorder visibility | Medium | Low -- Electron window levels are well-documented |
| P1 (high value) | A1 interaction colour-coding | Small | Low -- CSS + minor HTML change |
| P1 (high value) | A4 element-level grouping | Medium | Medium -- needs real-data validation |
| P1 (high value) | B1 step panel layout fix | Small | Low -- CSS-only |
| P1 (high value) | C1a taxonomy warning + classify action | Medium | Low |
| P2 (meaningful) | A2 click-to-split | Medium | Low |
| P2 (meaningful) | A3 flag semantics | Medium | Low -- many small touches |
| P2 (meaningful) | A5 step timeline context menu | Small | Low |
| P2 (meaningful) | C1b depth-level process map | Medium | Medium -- new DFG builder |
| P2 (meaningful) | D2 hotkey config UI | Medium | Low |

---

## Action Items

1. [ ] D3: Pre-capture screenshot on hotkey press; use lastForegroundBounds for button-fired markers
2. [ ] D4: Wire engagement_name from config into session.json and viewer header
3. [ ] D1: Set alwaysOnTop level to "screen-saver"; build mini-mode toolbar; tray single-click to front
4. [ ] A1: Add kind-bucket classes to interaction list items; add CSS colour accents for both themes
5. [ ] A4: Add element-boundary split rule to step_suggest.py with step_split_on_element config flag
6. [ ] B1: Fix CSS grid to shared-height two-column layout with independent scrolling
7. [ ] C1a: Add unclassified-activity warning banner; add "Classify this app" right-click on activity bands
8. [ ] A2: Add click-to-set-split-point in interaction list; modify splitStep() to use it
9. [ ] A3: Surface flag badges in step list; plumb flags through to aggregate stats, PDD, and reports
10. [ ] A5: Add right-click context menu on step timeline blocks
11. [ ] C1b: Add step-level and phase-level DFG generation in the viewer; add depth-level dropdown
12. [ ] D2: Add hotkey configuration section to session-config window with live capture
