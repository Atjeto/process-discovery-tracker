# UX overhaul (post-v0.2.0)

> **Product-era history.** This is the log of one UX pass on the product
> edition, shipped in v0.3.0 (2026-05-15), kept as it was written. Most of
> the surfaces it names have since changed or gone (the Live Session window,
> the hotkey overlay, phases, the density lane). What the app does now:
> [FEATURES.md](FEATURES.md); every release since: [CHANGELOG.md](../CHANGELOG.md).

This document describes the UX changes made in a single pass following
a thorough audit. They live in the working tree (not yet committed,
built, or released) so a follow-up session can review, test, and ship.

## What changed at a glance

| # | Change | Surface | User-visible effect |
|---|---|---|---|
| 1 | Themed `confirmModal` / `promptModal` | Viewer | No more raw browser dialogs; everything matches the app theme |
| 2 | Multi-monitor screenshot follows foreground | Capture | Screenshots capture the right display in 2+ monitor setups |
| 3 | Marker workflow defaults to close-then-open | Capture | No more "4 starts, 0 ends, 3 overlapping bars" sessions |
| 4 | Native Windows toast on recorder / OBS failure | Capture | Failures become visible instead of silently breaking the session |
| 5 | First-run welcome window | Capture | New SMEs land on a clickable onboarding instead of a tray tooltip |
| 6 | Hotkey overlay (persistent corner widget) | Capture | The three primary hotkeys stay in the user's peripheral vision |
| 7 | Operator + Status windows merged into Live Session window | Capture | One window with all status + actions; status-window deprecated |
| 8 | Right-click discoverability hint on timeline bands | Viewer | A faint `⋯` on hover + context-menu cursor advertise the action |
| 9 | Annotations undo stack (Ctrl+Z / Ctrl+Shift+Z) | Viewer | All step / phase / marker edits are reversible |
| 10 | Time-axis ticks with HH:MM:SS labels | Viewer | Position-on-timeline → wall-clock time, no hover required |
| 11 | Event-density histogram lane | Viewer | "Active vs idle" stretches readable at a glance |
| 12 | Per-case lanes for dangling / overlapping bands | Viewer | No more visually merged case stripes |
| 13 | Analysis progress streaming + cancel button | Viewer | Long analyses show what they're doing and can be aborted |
| 14 | Sweep of `window.confirm` / `window.prompt` call sites | Viewer | 7 call sites moved to themed modals |

Below: per-item detail with the files touched.

---

## 1 · Themed `confirmModal` / `promptModal`

`promptModal()` already existed for cases where Electron's broken
`window.prompt()` silently returned undefined. We added a matching
`confirmModal()` next to it, sharing CSS and keyboard handling:

- `viewer/renderer.js`: new `confirmModal(opts) → Promise<boolean>` with
  `title`, `message`, `detail`, `okLabel`, `cancelLabel`, `danger`
  options. `danger:true` styles the OK button red and defaults focus
  to Cancel so accidental Enter doesn't blow things up.
- `viewer/styles.css`: new `.modal-confirm` token group mirroring
  `.modal-prompt`, plus a `button.danger` style.

Keyboard: Enter confirms (unless `danger`), Escape cancels, click on
backdrop cancels. Returns a Promise; callers `await` it.

## 2 · Multi-monitor screenshot follows the foreground display

Previously `screen.getPrimaryDisplay()` was hard-coded. Now the screenshot
follows the user.

- `capture/screenshots.js`: rewritten. New `mode` option:
  - `"active"` (default) — uses `screen.getDisplayNearestPoint()`
    on the foreground window's bounds.
  - `"primary"` — legacy behaviour.
  - `"all"` — captures every display; emits one screenshot event
    per file with `_d<displayId>.jpg` suffixes.
- `capture/tracker.js`: foreground window bounds are now captured
  from `active-win` and stored on `currentRun.bounds`. Surfaced via
  `getStatus().currentBounds` so `screenshots.js` can read it.
- `capture/main.js`: `fireScreenshot()` reads `config.screenshots.display`
  and passes the most recent foreground bounds via `foregroundBounds`.
  Also handles the `"all"` mode which now emits one
  `tracker.fireSystem("screenshot", { path })` per file.
- `capture/config.js` / `capture/sample-config.yaml`: new
  `screenshots.display` config key with the three options.

Fallback chain when the foreground bounds aren't available: cursor
position → primary display.

## 3 · Marker workflow: close-then-open by default

The single largest UX issue we found. The picker only fired Start
markers, and a second Start while one was open silently nested.
Result: sessions accumulated "4 starts, 0 ends" pathologies, which is
why the user's case bands kept overlapping into a single stripe.

- `capture/main.js`:
  - `fireStartMarker(label, opts)` accepts `opts.nest`. Default
    behaviour: close every currently-open marker (innermost first)
    before opening the new one. `auto_close_for_sibling` is recorded
    as the close reason in events.jsonl so the analyst can spot
    auto-closes.
  - When a marker is already open, the tray gains two extra
    submenus: "Fire Start (nest under current)..." and "Quick start
    (nested)" so the user can opt into nesting from the tray.
  - The label picker now shows a banner explaining which marker
    will close (or nest under), plus an explicit "Nest under
    current" button. Shift+Enter flips the choice on the fly.
  - `pdt:fireStart` IPC accepts a second `{nest}` arg so the
    operator panel and label picker can choose semantics per-fire.
- `capture/operator-panel.js` (rebuilt — see #7): the live-session
  window gets a "Nest under current" checkbox above the Fire button.
  Toggling it updates a hint line: "will keep X open" vs "will close
  X." Defaults back to unchecked after each fire so the user is
  explicit each time.

## 4 · Native Windows toast on recorder / OBS failure

- `capture/main.js`:
  - New `notifyUser(title, body, options)` helper that creates an
    Electron `Notification`. Falls back to a `bootLog` no-op if
    `Notification.isSupported()` is false.
  - `recorder_dead_permanent` path now fires a high-urgency toast:
    "Interaction recorder stopped. Session continues without UIA
    events..."
  - OBS connect failure (non-strict mode) fires a low-urgency toast
    so the user knows video isn't being recorded.

The existing `dialog.showErrorBox()` for `obs.required: true` failures
is preserved — that's the right tool for a session-blocking
condition.

## 5 · First-run welcome window

- `capture/welcome-window.js` (new): renders a 560×540 window with
  three CTAs (operator panel / help / dismiss), the three primary
  hotkeys, and a one-line app summary. State stored in
  `userData/welcome-shown.json` so subsequent launches skip it.
  Reopenable via tray → Help → Show welcome screen.
- `capture/main.js`:
  - Loaded as `welcomeWin` module.
  - `whenReady` fires `welcomeWin.showWelcomeWindow()` when
    `shouldShowOnLaunch()` returns true.
  - New `pdt:welcomeAction` IPC handler dispatches the three CTAs.
  - Tray "Help" menu rebuilt as a submenu: "How to use..." +
    "Show welcome screen."

## 6 · Hotkey overlay (persistent corner widget)

- `capture/hotkey-overlay.js` (new): an always-on-top, click-through,
  220×110 frameless window that sits bottom-right by default and
  lists Start / End / Screenshot hotkeys. Visible-on-fullscreen so
  it survives Citrix sessions. Persistent state in
  `userData/hotkey-overlay.json` (so it reappears on next launch if
  it was last visible).
- `capture/main.js`:
  - Tray gains "Show hotkey overlay" / "Hide hotkey overlay" entry.
  - `whenReady` restores the overlay if the persisted state says
    `visible: true`.

The window uses `webPreferences.nodeIntegration: false` and
`contextIsolation: true` (no IPC needed for a read-only display) so
it's the safest of the bunch.

## 7 · Operator + Status windows merged into Live Session window

The two windows were 70% duplicates with two different palettes and
two slightly different sets of affordances. The Live Session window
unifies them; the legacy status window stays in the tray for one
release as a fallback.

- `capture/operator-panel.js`: rewritten as the canonical surface.
  - Migrated to the new stratified-dark palette so it matches the
    viewer.
  - Added counter grid (events / markers / shots / interactions).
  - Added recent events feed (last 8, reverse chronology).
  - Added "Nest under current" checkbox with live hint.
  - `Sync` button replaces its `window.prompt()` with an inline
    sync-ID input that appears below the action row.
  - "End session" replaces its `window.confirm()` with an inline
    "Keep recording / End session" confirm row.
  - Window grew from 420×520 to 460×720 to fit the new lanes.
- `capture/status-window.js`: deprecation notice in the header.
  Functional, still listed in the tray as "Show status window
  (legacy)."
- `capture/main.js`:
  - Tray entry "Show operator panel" → "Show live session window."
  - Tray entry "Show status window" → "Show status window (legacy)."

## 8 · Right-click discoverability hint

Currently right-click on a timeline band opens an Insert-marker menu.
Nothing in the UI advertised this.

- `viewer/styles.css`: `.tl-activity` and `.tl-marker` get
  `cursor: context-menu` on hover. A faint `⋯` (HORIZONTAL ELLIPSIS)
  fades in at the top-right of activity bands on hover, opacity
  0 → 0.7. No layout impact.

## 9 · Annotations undo stack

All editing operations on `annotations.json` (step / phase / marker /
note / drift flag / matched template) now route through a wrapper
that snapshots the previous state. Ctrl+Z reverts; Ctrl+Shift+Z
(or Ctrl+Y) redoes.

- `viewer/renderer.js`:
  - New `saveAnnotationsWithUndo(annotations, label)`,
    `performUndo()`, `performRedo()`. Stack capped at 50, in-memory
    only, reset on session switch.
  - `persistAnnotations(anno, undoLabel)` reused for the marker /
    note operations — 13 call sites annotated with their action
    labels so the undo toast says e.g. "Undone: split step."
  - Direct `viewer:saveAnnotations` IPC calls in the synthetic
    marker insert and notes saving converted to the wrapper.
  - Keyboard handler in the main `keydown` listener gates Ctrl+Z /
    Ctrl+Shift+Z / Ctrl+Y to fire the undo/redo functions, with
    `tag === "input" || tag === "textarea"` guard.

Snapshots are deep-cloned via JSON. State is in-memory so it doesn't
survive viewer restart — that's intentional; the alternative is
journaling to disk, which complicates session migration. Per-action
labels reduce the cost of a wrong undo (you see what's about to
revert in the toast).

## 10 · Time-axis ticks

- `viewer/renderer.js`:
  - `pickTickStep(spanMs)` picks a sensible interval from
    `{1s, 2s, 5s, 10s, 15s, 30s, 1m, 2m, 5m, 10m, 15m, 30m, 1h,
    2h, 4h, 6h, 12h, 1d}` aiming for ~12 ticks across the visible
    span.
  - `formatTickLabel(d, stepMs)` produces HH:MM:SS for sub-minute
    steps, HH:MM for sub-day, M/D for day+.
  - `renderTimeline()` emits a thin `.tl-tick` vertical line + a
    9px monospace `.tl-tick-label` at each tick position.
- `viewer/styles.css`: token styles for ticks.

Ticks render above the activity band so they don't compete with the
data. They scale with zoom only structurally — the labels stay legible
at default zoom; very high zoom may overlap labels but the ticks
themselves stay correct.

## 11 · Event-density histogram lane

A 12px-tall lane below the activity band shows event count per
~1/120th of the span. Bookkeeping events (pause/resume, idle markers,
recorder lifecycle) are filtered out so the histogram reflects user
activity, not session metadata.

- `viewer/renderer.js`:
  - `isUserActivityEvent(ev)` — returns true for activity,
    interaction, marker, and `screenshot`/`screenshot_manual`
    system events.
  - In `renderTimeline()`: 120 buckets, each a `.tl-density-bar`
    whose height is normalized to the max bucket. A faint
    `.tl-density-base` strip behind makes the lane readable when
    sparse.
- `viewer/styles.css`: token styles for histogram bars.

## 12 · Per-case lanes

The old renderer drew all open cases in one shared 26px-tall row,
offsetting their `top` by depth × 3px. With 4 dangling cases at the
same end timestamp, the bands all collapsed visually. New design uses
a sweep-line lane assignment.

- `viewer/renderer.js`:
  - `layoutCaseLanes(evs, first, last)` walks the marker stream,
    builds case objects (closed and dangling), and assigns each a
    `lane` index such that no two cases overlap in the same lane.
    Returns `{ cases: [...], lanesNeeded }`. Sweep order is by
    `startMs`; first lane whose previous occupant ended ≤ new
    case's start gets reused.
  - Timeline height grows with `lanesNeeded` — each case row is
    22px tall. A two-case timeline is shorter than a five-case
    one; users get a visual cue when their marker structure is
    deeply nested or overlapping.
  - Dangling cases keep the `.dangling` class for the dashed
    right-edge treatment.
  - New right-click context menu on case bands: "Scope view to this
    case" / "Jump to start" / "Jump to end." Scope-to-case matches
    by `startMs` proximity to handle the deduplicated dropdown
    labels.

## 13 · Analysis progress streaming + cancel

Streaming logs already existed via `viewer:normalizeLog`. Cancellation
is new.

- `viewer/python-runner.js`:
  - `runNormalize({onProc, ...})` calls back with `{kill()}` once
    the child is spawned. `kill()` sends SIGTERM, then SIGKILL
    after 500ms. The close handler detects cancellation via a
    flag and resolves the promise with `{cancelled: true}`
    instead of rejecting.
- `viewer/main.js`:
  - `_normalizeHandle` module-scope variable holds the kill
    handle while normalize is running.
  - `viewer:cancelNormalize` IPC handler fires `handle.kill()`.
- `viewer/index.html`:
  - Log host (`#log-host`) gains a Cancel button in its summary.
  - Default state is `open` so the log panel is expanded while
    running; the user doesn't have to click "Analysis log" to see
    progress.
- `viewer/renderer.js`:
  - `setAnalysisRunning(true/false)` shows / hides the Cancel
    button and disables the Analyze button.
  - Cancel click fires `viewer:cancelNormalize` and toasts
    "Cancelling analysis...".
  - The result handler now distinguishes `r.cancelled === true`
    (silent toast) from `r.ok === false` (red error).

## 14 · Sweep of `window.confirm` / `window.prompt`

Seven user-visible call sites converted to `confirmModal()` /
`promptModal()`. All adopt the new themed chrome and respect the
stratified-dark palette.

- `renderer.js` clearAll Recents confirm — now describes what happens
  to bundled examples vs real recents.
- Delete step confirm — names the step + reminds user that Ctrl+Z
  restores.
- Delete phase confirm — same.
- "App vocabulary name" prompt — `promptModal` with explanatory
  detail.
- "Label for the new Start marker" prompt — `promptModal` with hint
  about re-running normalization.
- Delete marker confirm — names the marker type + reminds about
  Ctrl+Z.
- Unsaved vocab changes confirm — themed.

Capture's `operator-panel.js` also lost its two `window.confirm` /
`window.prompt` sites (sync ID, end session) as part of the merge in
#7.

---

## Files added

```
capture/welcome-window.js
capture/hotkey-overlay.js
docs/UX-CHANGES.md  (this file)
```

## Files modified

```
capture/config.js
capture/main.js
capture/operator-panel.js
capture/sample-config.yaml
capture/screenshots.js
capture/status-window.js
capture/tracker.js
viewer/index.html
viewer/main.js
viewer/python-runner.js
viewer/renderer.js
viewer/styles.css
```

## Files NOT changed but adjacent

- `capture/help-window.js` — content is OK, but the "primary hotkeys
  are buried in a modal" problem is addressed by the new
  hotkey-overlay widget rather than by editing this file. Worth a
  pass to mention the overlay in the help text on the next
  documentation sweep.
- `capture/status-window.js` — only a deprecation notice added; the
  rest of the file is intentionally left functional as a fallback.

## What did NOT land in this pass

- **Project / engagement concept that unifies the four viewer tabs**
  (#13 from the original critique). This is a multi-week refactor
  that touches state management, IPC, and persisted view state across
  all four tabs. It belongs in a v0.3 design pass, not a single-pass
  UX push.
- **Capture-side window palette alignment for help / OBS settings /
  session config windows.** They still use their own dark tokens
  (`#1a1a1a` etc.) inherited from earlier work. Operator panel was
  migrated to the stratified-dark palette as part of the merge in
  #7. The other windows are individually small and worth one
  unified pass.

## Validation done

- `node --check` syntax-passed on every JS file touched:
  `capture/{main,tracker,screenshots,operator-panel,welcome-window,hotkey-overlay,status-window}.js`,
  `viewer/{renderer,main,python-runner}.js`.
- No builds were run, no commits made, no release upload. The
  working tree is the only place these changes exist.
- The previously-shipped v0.2.0 release on GitHub is untouched.

## Regression / coverage pass (after the implementation burst)

A second pass walked through every change looking for gaps and bugs.
Found and fixed:

- **CSS selector collision: `.tl-tick` / `.tl-tick-label`.** I added
  Flow-timeline-specific tick styles using the same class names that
  step-editor.js and phase-editor.js already used for their
  mini-timeline axes. The old definition had `top:0; bottom:0`; my
  override dropped both, which would have made the mini-timeline
  ticks invisible. Renamed Flow ticks to `.tl-flow-tick` /
  `.tl-flow-tick-label` so both surfaces have their own geometry.
- **Analysis cancel coverage was 1-of-4.** Cancellation only worked
  for `viewer:runNormalizeExtended` (single-session Analyze + Match
  template). The other three call sites — `viewer:runNormalize`
  (used by aggregate Analyze-all), `viewer:testCanonicalMatch` (used
  by the Process Template tab), `viewer:bootstrapAppVocab` (used by
  Save-as-vocabulary) — all called `runNormalize()` without
  `onProc`, so they couldn't be killed. Now all four register the
  same `_normalizeHandle`, the cancel IPC reaches whichever is in
  flight, and the aggregate "Analyze all" loop additionally has its
  own Cancel button + early-exit check on `r.cancelled`. All four
  paths surface a clean `{cancelled: true}` result.
- **Undo stack could write null to disk.** If
  `currentSession.annotations` was null when redo fired, the
  redo-snapshot was null and the IPC handler would have written
  null. Hardened via a `snapshotAnnotations()` helper that always
  returns the empty-annotations shape if the input is falsy.
- **Dangling case bands had no click handler.** Closed cases
  click-to-seek; dangling cases just sat there. Unified — both
  fire `seekToTimestamp(c.startMs)` on click. Right-click still
  opens the scope/jump menu, with "Jump to end" hidden for dangling
  cases.

Audit items checked and clean (no fix needed):

- `pdt:fireStart` callers — both pass `opts` (operator panel, label
  picker IPC).
- `fireScreenshot()` correctly handles array (multi-display) vs
  string (single) result from `captureScreenshot()`.
- Foreground-bounds → multi-monitor flow: tracker captures bounds,
  exposes via getStatus(); main.js threads through to screenshots.js;
  screenshots.js falls back from bounds → cursor pos → primary
  cleanly.
- All operator-panel IPC channels exist in main.js (pdt:fireStart,
  pdt:fireEnd, pdt:fireSync, pdt:togglePause, pdt:manualScreenshot,
  pdt:endSession, pdt:status).
- Welcome window `pdt:welcomeAction` handler registered at
  module load; dispatches `toggleOperatorPanel()` and `showHelp()`.
- Hotkey overlay's `focusable:false` + `setIgnoreMouseEvents` is
  the canonical Electron pattern for click-through HUDs; window
  loads cleanly.
- New timeline geometry: ticks 4-24, activity 28-88, density 90-102,
  cases 108-onwards. Marker labels (top 30) and screenshot dots
  (top 84) fit cleanly inside the activity lane.
- No `window.confirm` / `window.prompt` remains in viewer/renderer.js
  (only in deprecated `capture/status-window.js`, which the tray
  surfaces as "Show status window (legacy)" — replacing the legacy
  confirm is deferred until that window is retired).
- Python test suite in `normalization/test/` not affected — none
  of my changes touch normalization code.

## Recommended commit ordering

If splitting into small commits:

1. Themed `confirmModal` + sweep of confirm/prompt sites.
2. Multi-monitor screenshot (capture).
3. Marker workflow close-then-open default (capture).
4. Native Windows toast on failure modes (capture).
5. First-run welcome + hotkey overlay (capture).
6. Operator panel merge / Live Session window (capture).
7. Right-click discoverability hint (viewer).
8. Annotations undo stack (viewer).
9. Time-axis ticks + density histogram + per-case lanes (viewer
   timeline overhaul — these three changes touch the same
   `renderTimeline()` rewrite so they should land as one commit).
10. Analysis progress streaming + cancel (viewer).

Or as one fat commit: "UX overhaul: close-then-open markers, themed
modals, undo, time-axis + density + lanes, multi-monitor screenshot,
analysis cancel, hotkey overlay, first-run welcome, native toasts."
