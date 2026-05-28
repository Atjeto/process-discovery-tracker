# Deferred work — spec for a follow-up session

This document inventories every UX / functional improvement that was identified across recent design + critique sessions and has **not** yet landed in the working tree. It exists so a fresh session can pick up any single item without re-running the audit.

## Context — what's already done

> **Superseded — 2026-05-28.** This doc was written when v0.2.0 was the latest
> release; **v0.17.1 has now shipped on `master`** (the long-running
> `viewer-refactor` branch was merged in at v0.17.0). It is kept as a historical
> reference for the v0.3 UX-overhaul era. The **active backlog** is at
> [docs/To-Do/NEXT-SESSION-SPEC.md](To-Do/NEXT-SESSION-SPEC.md). Items below
> flagged **✅ SHIPPED** inline have landed; many others have shipped too but
> were never marked — verify against [CHANGELOG.md](../CHANGELOG.md) before
> picking anything up.

Before starting work on anything below, read [docs/UX-CHANGES.md](./UX-CHANGES.md) and the [CHANGELOG.md](../CHANGELOG.md) and verify the working tree state. The bullets below describe the v0.2.0 era and are kept as history:

- **v0.2.0 is shipped** on GitHub Releases (recorder noise filter, GitHub Releases distribution, recorder.zip auto-extract).
- **The UX overhaul is in the working tree** (uncommitted): close-then-open markers, themed confirm/prompt modals, multi-monitor screenshot, native toasts on failures, first-run welcome, hotkey overlay, Live Session window merge (operator + status), right-click discoverability hint, annotations undo stack, time-axis ticks, density histogram, per-case lanes, analysis progress streaming + cancel.
- **(historical)** True at v0.2.0; long since superseded — see the stale-frame note above.

If anything in this spec already appears in [`docs/UX-CHANGES.md`](./UX-CHANGES.md) (especially the "What did NOT land in this pass" or "Regression / coverage pass" sections), it's been resolved — verify before duplicating work.

---

## Priority tiers

- **P0** — Should land before the next release, or in the same release as the UX overhaul. High user-visible impact, low cost.
- **P1** — Next release after that. Worth doing but not blocking.
- **P2** — Roadmap. Either large scope or low ROI for the current audience.

---

# P0 — Land alongside or shortly after the UX overhaul

## P0.1 · Capture window palette alignment

**Rationale.** The viewer + the new Live Session window use the stratified-dark palette (`#08080A → #484854` ladder, `#D8D6CE` foreground, sage/slate accents). The other capture-side windows still use their own dark tokens inherited from earlier work (`#1a1a1a`-floor, blue `#3a86ff` accent). Mismatched palettes across the same app is jarring.

**Scope.** Half a day. Each window has a small embedded CSS block to swap.

**Files to touch.**
- `capture/help-window.js` — token block near the top of the embedded `<style>`.
- `capture/obs-settings-window.js` — same.
- `capture/session-config-window.js` — same.
- `capture/main.js` `buildPickerHtml()` — already partly aligned, but the `--accent: #3a86ff` (electric blue) clashes with the sage accent everywhere else. Should be `#6E8A66`.

**Acceptance criteria.**
- All capture windows use `--bg: #14141A → --bg-5: #484854`, `--fg: #D8D6CE`, `--accent: #6E8A66`, `--accent-2: #5A7488`. Sage + slate, not electric blue.
- Token names stay window-local (don't centralize until #P2.1).
- `node --check` passes on every file; manual spot-check at `npm start` confirms no visual breakage.

**Dependencies.** None.

## P0.2 · Update README + help window with new features

**Rationale.** The README still describes a tool without per-case lanes, time-axis ticks, density histograms, undo, the hotkey overlay, first-run welcome, marker close-then-open semantics, multi-monitor screenshot, or analysis cancel. The capture help window still describes the marker workflow as "Ctrl+Shift+S to start, Ctrl+Shift+E to end innermost" without mentioning that consecutive starts now close-then-open by default. Anyone reading the docs to learn the tool will be operating on a wrong mental model.

**Scope.** Half a day.

**Files to touch.**
- `README.md` — add a "What's new in v0.3" section near the top; update the "UI / UX in this pass" bullet list at the bottom.
- `capture/help-window.js` — Marker section, Hotkeys section, "Per-session config" section. Add a "Live Session window" sub-section. Mention the hotkey overlay.
- `viewer/index.html` — help modal (sections start, session, stepsphases, capture, shortcuts). Document Ctrl+Z / Ctrl+Y. Document right-click on timeline bands. Document analysis Cancel button.
- `CHANGELOG.md` — Add `## [0.3.0] - YYYY-MM-DD` entry summarizing the whole UX overhaul. Use the existing v0.2.0 entry as a template.

**Acceptance criteria.**
- A first-time reader of the README + help can discover undo (Ctrl+Z), the hotkey overlay, and the new marker semantics without launching the app.
- CHANGELOG.md has a complete v0.3.0 entry suitable for `publish-release.ps1 -NotesFromChangelog`.

**Dependencies.** Should land at the same commit as the UX-overhaul commit so docs match reality.

## P0.3 · Retire status-window's window.confirm

**Rationale.** `capture/status-window.js:278` still uses `window.confirm("End the capture session?")`. The window is marked deprecated but functional, and as long as it surfaces in the tray as "Show status window (legacy)" the user can hit a raw browser dialog. Easy 5-minute fix; convert to the same inline-confirm-row pattern used in the new operator-panel.

**Scope.** ~30 minutes.

**Files to touch.**
- `capture/status-window.js` — replace the `confirm()` call with an inline confirm row. Mirror the pattern at `capture/operator-panel.js:355-365`.

**Acceptance criteria.**
- No `window.confirm` or `window.prompt` remains in `capture/status-window.js`.
- Visual + flow matches the new operator-panel's end-session confirm.

**Dependencies.** None.

## P0.4 · Filter clear-X button + hidden-count

**Rationale.** Every filter in the viewer (steps, phases, markers, raw events, aggregate) shows "X of Y matched" but offers no way to clear the filter without deleting characters one at a time. Hidden items aren't surfaced as a count anywhere either — when a user has 30 steps and only 3 match their filter, they don't see "27 hidden" until they manually clear.

**Scope.** Half a day. Touch ~5 input components.

**Files to touch.**
- `viewer/index.html` — wrap each `<input>` in a relative-positioned div with an absolutely-positioned `×` button that's hidden when input is empty.
- `viewer/styles.css` — `.filter-input-wrapper` + `.filter-clear-btn` styles.
- `viewer/renderer.js` — wire the X buttons (clear value, dispatch input event, focus input).
- Existing meta-text spans ("X of Y matched") already exist; verify they show "27 hidden" or similar when filter active.

**Acceptance criteria.**
- Every filter input has a visible × when non-empty.
- Hidden-count is surfaced inline.
- Escape inside a filter input clears it (in addition to the X click).

**Dependencies.** None.

## P0.5 · Aggregate filter date-range format hint

**Rationale.** The "From" and "To" date inputs at the top of the Aggregate view have no help text. The user has to discover the format (browser-native date input on most platforms). When a corporate environment renders these as text inputs, the format is anyone's guess.

**Scope.** 15 minutes.

**Files to touch.**
- `viewer/index.html` — add small `.hint` text below the date inputs; ensure `type="date"` is set on both inputs.
- `viewer/styles.css` if needed.

**Acceptance criteria.**
- Visible hint says "YYYY-MM-DD" or similar.
- The inputs use the native date picker when available.

**Dependencies.** None.

---

# P1 — Next release after the UX overhaul

## P1.1 · Range selection on the timeline — ✅ SHIPPED (v0.4.0)

**Rationale.** Drag across the timeline to select a range; the events list, screenshot grid, and marker list filter to events in that range. A "selection stats" mini-panel shows duration, event count, top apps, markers contained. This is how an analyst answers "what happened during the email-sending part?" in one motion.

**Scope.** 2-3 days. Requires new state (`_selectionRange = { startMs, endMs }`), new mouse handlers on the timeline host (mousedown → mousemove → mouseup), new visual treatment (a darker overlay rectangle), and filter-propagation through `renderAnnotations`, `renderRawEvents`, and `renderScreenshots`.

**Files to touch.**
- `viewer/renderer.js` — add `_selectionRange` module state. New `installRangeSelection()` setup. Plumb the range through `eventsInScope()` helper that all renderers use. Add a small `#selection-stats` panel rendered in the side annotations column.
- `viewer/styles.css` — `.tl-selection-overlay` style.
- `viewer/index.html` — empty `<div id="selection-stats">` placeholder in the annotations panel.

**Acceptance criteria.**
- Mouse-down on empty timeline area + drag highlights a range.
- Release commits the range; clicking outside or Escape clears it.
- The annotations panel shows a stats summary while a range is active.
- Range survives view-mode switch (Flow / Steps / Phases) but clears on session change.

**Dependencies.** Should land after P0.4 (filter X buttons) so the selection-stats panel has a "Clear selection" affordance consistent with other filters.

## P1.2 · Screenshot thumbnails on hover

**Rationale.** Today a screenshot dot opens a modal on click. Hovering should pop a 200×150 thumbnail inline near the dot. "What was on screen at this moment?" answered without losing context. Standard pattern in profilers (Chrome DevTools Performance tab).

**Scope.** Half a day.

**Files to touch.**
- `viewer/renderer.js` — `renderTimeline()`'s screenshot-dots loop. On `mouseenter`, create a positioned `<img>` with the screenshot path; on `mouseleave`, remove. Throttle so rapid mouse-overs don't thrash.
- `viewer/styles.css` — `.tl-screenshot-thumb` style (absolute positioned, drop shadow, 200×150 max).

**Acceptance criteria.**
- Hovering a dot pops the thumbnail within ~100ms.
- Thumbnail follows the cursor or sits adjacent to the dot.
- No visible flicker on rapid mouse movement.
- Click still opens the full modal as today.

**Dependencies.** None.

## P1.3 · Mini-map overview above the timeline — ✅ SHIPPED (v0.4.0)

**Rationale.** When the user zooms the timeline (e.g. 5x for a long session), they lose the sense of "where am I in the session." A 30px-tall strip above the timeline shows the whole session compressed, with a rectangle indicating the visible region. Click anywhere in the mini-map to jump. Drag the rectangle to scroll. Premiere Pro / DaVinci Resolve / Logic / GoLand all converged on this UX.

**Scope.** 1-2 days.

**Files to touch.**
- `viewer/index.html` — new `<div id="timeline-minimap">` above `#timeline`.
- `viewer/renderer.js` — new `renderMinimap()` rendering activity bands at scale; new viewport rectangle synced with `#timeline-scroll`'s scrollLeft + zoom.
- `viewer/styles.css` — `.timeline-minimap` styles.

**Acceptance criteria.**
- Visible whenever Flow timeline is rendered.
- Rectangle position matches the visible region.
- Click outside rectangle jumps; drag inside scrolls.

**Dependencies.** None.

## P1.4 · Per-step duration band when Steps exist — ✅ SHIPPED (v0.4.0)

**Rationale.** Steps view computes step boundaries; the Flow view doesn't surface them. Once Steps have been computed, show each step as a labeled band beneath the activity band on the Flow timeline. Width = duration. Connects the two views visually.

**Scope.** Half a day.

**Files to touch.**
- `viewer/renderer.js` `renderTimeline()` — new lane between activity and density (or below density). Reads `currentSession.annotations.steps`. Step bands click → select the step + switch to Steps view.

**Acceptance criteria.**
- New lane only renders when steps exist.
- Step bands respect the same color palette as the Steps editor.
- Hover shows step name + duration; click navigates to Steps view with that step selected.

**Dependencies.** None.

## P1.5 · DFG drill-down precision

**Rationale.** Clicking a node in the DFG goes to "first activity event matching the label." When an activity appears multiple times in a session (common — "View customer record" appears 5x in a sales process), the drill-down picks the first one with no indication that 4 others exist.

**Scope.** Half a day.

**Files to touch.**
- `viewer/renderer.js` (or `viewer/dfg-viewer.js`) — node-click handler. Instead of seeking immediately, open a small popup listing every matching event across loaded sessions with timestamps + session name. Pick the one you want.
- `viewer/styles.css` — `.dfg-drill-popup` style.

**Acceptance criteria.**
- Clicking a node opens the picker.
- Each row shows session label + ISO timestamp + matching activity title.
- Click a row → switches to Session view of that session + seeks.
- "Take me to the first one" shortcut (Enter on the picker, or single-result auto-pick).

**Dependencies.** None.

## P1.6 · Recent sessions: batch "Remove N missing"

**Rationale.** When localStorage carries entries for folders that no longer exist (corp profile migration, deleted sessions, etc.), the user must × each one individually. With 8 entries all missing, that's 8 clicks. A single "Remove 8 missing" link is right next to "Clear all" and does the bulk action.

**Scope.** 1 hour.

**Files to touch.**
- `viewer/renderer.js` `renderRecent()` — count `missing` flags; if >1, add a "Remove N missing" link.
- `viewer/styles.css` — match the "Clear all" button style.

**Acceptance criteria.**
- Link visible only when ≥2 missing entries exist.
- Click removes all entries flagged missing.
- Surviving entries stay in their original order.

**Dependencies.** None.

## P1.7 · Aggregate temporal context — bar-chart sparklines

**Rationale.** `charts.js`'s activity-frequency and case-duration bar charts show their data without showing when in the session it happened. A session that started slow and ended busy vs vice versa renders identically.

**Scope.** 1 day.

**Files to touch.**
- `viewer/charts.js` — for each bar in `renderHorizontalBars`, optionally append a 10-bucket sparkline computed from per-event timestamps. Sparkline data must be passed in; renderer prepares it.
- `viewer/renderer.js` — bar-chart data prep in the aggregate view path.

**Acceptance criteria.**
- Each activity row in the freq chart has a tiny sparkline showing time distribution.
- Case duration chart shows date range of cases included.
- Sparklines toggled via a small "show sparklines" link if cluttery.

**Dependencies.** None.

## P1.8 · Auto-clean stale recents on session-folder list refresh

**Rationale.** Today's recents list rendering reads `fs.existsSync()` on every render. Cheap, but means we silently keep dead entries forever. After 30 days of repeated launches without clicking the dead entries, they should age out automatically (or after first detection, mark with a 7-day grace period before auto-removal).

**Scope.** 1 hour.

**Files to touch.**
- `viewer/renderer.js` — recents-list reader stores a `firstMissingAt` timestamp on the entry when first detected as missing; entries with `firstMissingAt` more than 30 days old are auto-skipped + persisted-removed.

**Acceptance criteria.**
- Missing entry showing today is still visible (with the "missing" tag).
- After 30+ days of being missing, it disappears silently.
- Surviving entries don't get false-positive removed when on a temporarily-unplugged drive.

**Dependencies.** None.

## P1.9 · Annotation lane on the timeline

**Rationale.** Notes today live in the side panel disconnected from time. The note has a timestamp internally; making it appear as a numbered marker on a dedicated timeline lane would tie analyst commentary back to the moment it describes.

**Scope.** 1 day.

**Files to touch.**
- `viewer/renderer.js` `renderTimeline()` — new lane between density and cases. Each note from `currentSession.annotations.notes` renders as a small numbered dot; click → opens the note in the side panel + switches the panel tab to Notes.
- `viewer/styles.css` — `.tl-note-dot` style.

**Acceptance criteria.**
- Notes lane only renders when notes exist.
- Numbered dots match the note ordering in the side panel.
- Click syncs both ways (side-panel note row click pulses the dot too).

**Dependencies.** P0.2 (help should mention).

## P1.10 · Persistent timeline zoom + scroll per session — ✅ SHIPPED (v0.4.0)

**Rationale.** Reload a session you were just navigating — your zoom is back to 1 and your scroll is back to 0. Annoying. Persist zoom + scroll into localStorage keyed by sessionFolder.

**Scope.** 1 hour.

**Files to touch.**
- `viewer/renderer.js` — wrap `zoomFactor` set + `#timeline-scroll.scrollLeft` change with persistence; restore on `loadSessionIntoView`.

**Acceptance criteria.**
- Open session A, zoom to 3x, scroll to mid-session.
- Open session B.
- Open session A again — zoom and scroll position restore.

**Dependencies.** None.

---

# P2 — Roadmap

## P2.1 · Project / engagement concept unifying the four viewer tabs

**Rationale.** The four tabs (Session / Aggregate / Process Template / Vocabularies) are independent worlds. There's no concept of a "project" that ties them together. Open session A in Session, navigate to Aggregate to compare with B, switch to Template to test a design — state doesn't carry. Recent sessions is a flat list; there's no "recent engagements" or "saved comparisons."

A project object would hold:
```
{ engagementId, sessions: [...], templatePath, vocabularies: [...], settings, recentSelections }
```

Tabs become views of the project. Recent sessions becomes recent projects. Multi-tab navigation remembers where you've been within the project.

**Scope.** 2-3 weeks. Touches state management, IPC, and persisted state across all four tabs. Migration of the existing localStorage-recents shape. Backward compat with sessions opened standalone.

**Files to touch.** Most of `viewer/`. New `project.js` data layer. `main.js` IPC for project-save / project-load. `renderer.js` significantly restructured.

**Acceptance criteria.**
- A user can "Save current as project."
- A project save includes: sessions in aggregate view, current template path, current case scope, current view mode, vocabulary edits in progress.
- Project re-open restores everything.
- Old-style standalone session opens still work.

**Dependencies.** None blocking; could be greenfield. Worth a design pass before implementation.

## P2.2 · Variant heat overlay on the timeline

**Rationale.** If the user opens multiple sessions in aggregate, overlay how many sessions reached each "step boundary" at this position. Where do paths diverge? Where do they converge? Process-mining tools sometimes call this a "fingerprint."

**Scope.** 1-2 weeks. Requires:
1. Aggregate analysis to produce per-step variant data (already partly there via PM4Py mining).
2. A new viewer mode that overlays variant data on a "merged" timeline view.
3. UI for picking which sessions to overlay.

**Files to touch.** New `viewer/variant-viewer.js`. Integration into the Aggregate view's process-map panel.

**Acceptance criteria.**
- With ≥3 loaded sessions, a "Variant overlay" mode shows where they diverge.
- Hover any divergence point to see which sessions take which path.

**Dependencies.** Better understood after P2.1 (project concept) so multi-session comparisons have a home.

## P2.3 · Connect Flow / Steps / Phases viewport state

**Rationale.** Today the three view-modes have independent mini-timelines (zoom / scroll / case scope). Switch from Flow to Steps and you lose your position. A unified viewport state would carry zoom + scroll + playhead + case scope across mode switches.

**Scope.** 2-3 days. Affects step-editor.js and phase-editor.js viewport state + their internal mini-timeline rendering.

**Files to touch.**
- `viewer/renderer.js` — promote `zoomFactor` + scroll position to a session-scoped object that all three views read/write.
- `viewer/step-editor.js`, `viewer/phase-editor.js` — pull viewport state from the shared object instead of computing their own.

**Acceptance criteria.**
- Zoom Flow to 3x, scroll to mid-session, switch to Steps — view stays at the same zoom + position.
- Same for Steps → Phases.
- Independent state per session.

**Dependencies.** None.

## P2.4 · Mode-specific shortcuts overlay

**Rationale.** Each view has its own shortcuts (Steps has J/K/S/M/N; Phases has its own; Flow has Space and ←/→ for video). The user has no visual hint about which keys do what here. A small persistent bottom-right card listing the current view's 3-4 most-used shortcuts solves it.

**Scope.** Half a day.

**Files to touch.**
- `viewer/index.html` — new `<div id="shortcuts-overlay">`.
- `viewer/renderer.js` — re-render when view-mode changes.
- `viewer/styles.css`.

**Acceptance criteria.**
- Always visible while a session is loaded, view-specific content.
- Dismissable via a small × in the overlay (state persisted).

**Dependencies.** Should mention in P0.2's help update.

## P2.5 · YAML validation in Template + Vocabularies tabs

**Rationale.** Both tabs let the user save unparseable YAML; downstream normalization will then fail mysteriously. A live YAML parser in the editor catches issues at save time.

**Scope.** 1 day.

**Files to touch.**
- `viewer/renderer.js` — add `js-yaml` as a direct dependency (already in capture's deps but not viewer's). On save, parse first; reject + highlight the line on failure.
- `viewer/package.json` — add the dep.

**Acceptance criteria.**
- Saving malformed YAML shows a themed error modal naming the line.
- The save doesn't write to disk.

**Dependencies.** None.

## P2.6 · Phase drag-reorder visual feedback

**Rationale.** Phase editor's "drag a step row to reorder" has no visual indicator during the drag. Standard HTML drag-drop with no styling — users can't tell it's drag-droppable until they accidentally pick up a row.

**Scope.** Half a day.

**Files to touch.**
- `viewer/phase-editor.js` — add a drop indicator line that follows the cursor; highlight the source row while dragging.
- `viewer/styles.css` — `.phase-drag-indicator` etc.

**Acceptance criteria.**
- Picking up a row gives clear visual cue.
- A drop indicator shows where the row will land.

**Dependencies.** None.

## P2.7 · Screenshot gallery view

**Rationale.** The current screenshots tab is a thumbnail grid; the modal is per-screenshot. For a session with 50+ screenshots, the analyst clicks through modals one at a time. A full-pane gallery view (open via a tray-like button) with keyboard arrow navigation and "show only marker-fire screenshots" filter would speed up review.

**Scope.** 1-2 days.

**Files to touch.**
- `viewer/index.html` — new gallery view (could be a tab within the Session view or a full-screen overlay).
- `viewer/renderer.js` — gallery state + keyboard handling.
- `viewer/styles.css`.

**Acceptance criteria.**
- "Open gallery" button on the screenshots tab.
- Arrow keys navigate; Escape closes; Space toggles play (auto-advance 1s).
- Filter by trigger reason (marker / app-switch / idle-resume / manual).

**Dependencies.** None.

## P2.8 · Case scope dropdown deduplication + "scope to playhead" action — ✅ SHIPPED (v0.4.0)

**Rationale.** When markers share labels ("Finished sending email" appears 3x), the dropdown shows 3 indistinguishable entries. Also, "scope to the marker my video playhead is inside" is a common request — currently requires manual case selection.

**Scope.** Half a day.

**Files to touch.**
- `viewer/renderer.js` `populateCaseScope()` — append a short suffix to duplicate labels (e.g. `Finished sending email [0:12:30]`).
- Add a "Scope to marker at playhead" button next to the dropdown — finds the innermost case at `videoStartTs + video.currentTime`.

**Acceptance criteria.**
- Dropdown entries are uniquely identifiable.
- Scope-to-playhead button activates the matching case.

**Dependencies.** None.

## P2.9 · "Snap to event" when seeking via timeline click

**Rationale.** Clicking a random position in the timeline jumps to that exact timestamp, which often isn't an event boundary. Snapping to the nearest event within ~250ms makes the seek feel intentional.

**Scope.** 1 hour.

**Files to touch.**
- `viewer/renderer.js` — `host.addEventListener("click", ...)` handler. Find the nearest event timestamp within 250ms / span * pixel-tolerance and seek there instead.

**Acceptance criteria.**
- Click near an event → seek to that event's exact timestamp.
- Click in genuine empty space (e.g. middle of a long idle) → seek to the literal point.

**Dependencies.** None.

## P2.10 · Auto-detect hotkey conflicts at startup

**Rationale.** Today, if another running app has registered `Ctrl+Shift+S`, the global-shortcut registration silently returns false and the user discovers the conflict by pressing the hotkey and seeing nothing happen. We log this to `boot.log` if `PDT_DEBUG=1` but the user doesn't know that.

**Scope.** 1-2 hours.

**Files to touch.**
- `capture/main.js` — after `globalShortcut.register(...)`, if any of the four hotkeys failed, show a `notifyUser()` toast ("Hotkey Ctrl+Shift+S is in use by another app. Use the tray menu or change the binding in Session config.").
- Optionally surface in the Live Session window header.

**Acceptance criteria.**
- A user with a hotkey conflict gets a single notification on session start.
- Tray + live-session window indicate which hotkeys are unregistered.

**Dependencies.** None.

## P2.11 · Aggregate "Analyze all" progress reporting

**Rationale.** The aggregate Analyze-all now supports cancellation but doesn't show progress. For 30 sessions × ~10 sec each, that's 5 minutes of "Analyze all sessions" disabled with no indication. Worth showing "Analyzing 7 of 30..." in the button label or a small progress strip.

**Scope.** 1 hour.

**Files to touch.**
- `viewer/renderer.js` btn-normalize-all click handler — update the button label per-iteration ("Analyzing 7 / 30...").

**Acceptance criteria.**
- Button label updates every iteration.
- Cancel still works mid-loop.

**Dependencies.** None (the cancel button already exists).

## P2.12 · Window-title strip on the timeline — ✅ SHIPPED (v0.4.0)

**Rationale.** Activity bands show app name; the *window title* changes within a single app run ("Outlook: Inbox" → "Outlook: Compose..." → "Outlook: Sent"). A small strip below the activity band showing window-title text (compressed) makes "what was the user doing in Outlook" answerable at a glance.

**Scope.** 1-2 days. Tight info-density problem; might end up squeezing labels too small.

**Files to touch.**
- `viewer/renderer.js` `renderTimeline()` — new lane between activity and density (or replace the activity-band inline title with a dedicated lane).

**Acceptance criteria.**
- Window titles appear as text bands.
- They don't visually compete with the activity bands; collapse or hide intelligently when zoomed out.

**Dependencies.** Probably needs P1.4 (per-step lane) done first to anchor on a known lane geometry.

## P2.13 · Capture-side tray menu reorganization

**Rationale.** The capture tray currently has 15+ flat items. Grouping into sub-sections (Session controls / Live status / Storage / Help) would speed up navigation. Currently the Recent sessions submenu is nested but everything else is flat.

**Scope.** Half a day.

**Files to touch.**
- `capture/main.js` `buildMenu()` — restructure into 4 groups separated by separators or sub-menus.

**Acceptance criteria.**
- Right-clicking the tray icon opens a menu that fits the visible portion of the screen even at small DPI.
- Recently-used items (Fire Start, End marker, Pause) stay in the top-level for muscle memory.

**Dependencies.** None.

## P2.14 · Live-session window keyboard control

**Rationale.** The live-session window has a lot of buttons; advanced operators could benefit from keyboard shortcuts within the window (S for start marker, E for end, P for pause, etc.) that don't conflict with the global hotkeys.

**Scope.** Half a day.

**Files to touch.**
- `capture/operator-panel.js` — keydown listener on the window.

**Acceptance criteria.**
- Operator can run a whole session via keyboard with the live-session window focused.
- Conflicts with the input field (typing label) are handled — shortcuts only fire when no input is focused.

**Dependencies.** None.

## P2.15 · Capture-side test suite (Playwright)

**Rationale.** There are zero JS tests on either app today. The Python normalization layer has pytest coverage. A small Playwright suite — open a session, fire markers, click around, verify events.jsonl — would catch regressions in the capture-side UX changes we keep making.

**Scope.** 1-2 weeks.

**Files to touch.** New `capture/test/` directory. New Playwright dev dep. New `npm run test:e2e` script. Headless mode with fixtures.

**Acceptance criteria.**
- `npm run test:e2e` runs a small suite that exercises: launch → start session → fire marker via picker → fire marker via operator panel → end session.
- CI integration optional (mentioned below).

**Dependencies.** None.

## P2.16 · GitHub Actions CI for the JS

**Rationale.** Python has CI already (`.github/workflows/pytest.yml`). The JS side has nothing. After P2.15 adds Playwright, wire it into CI. Run `node --check` on every JS file as a syntactic sanity check too — would have caught my CSS-class collision faster than runtime testing.

**Scope.** Half a day.

**Files to touch.** New `.github/workflows/electron-syntax.yml`.

**Acceptance criteria.**
- Every push runs node --check on all .js + the new Playwright suite.
- Failures block merge.

**Dependencies.** P2.15.

## P2.17 · Code-signing for the .exes

**Rationale.** `docs/Security-QA.md` flags this as the right thing to do for production. Without it, Windows SmartScreen shows "Windows protected your PC" on first launch on a fresh machine. The user dismisses it once, but it's a credibility hit for SMEs.

**Scope.** Variable. EV certificate is ~$300/year. Build script change is small (one `signtool` invocation). Procurement may take time.

**Files to touch.**
- `scripts/build-distribution.ps1` — sign the two `.exes` after electron-packager output.
- `capture/build-package.js`, `viewer/build-package.js` — alternatively, sign at packager level via `osxNotarize` equivalents.

**Acceptance criteria.**
- Both `Process Discovery Tracker.exe` and `Process Discovery Viewer.exe` show a valid publisher on `Properties → Digital Signatures`.
- SmartScreen accepts them without "Run anyway" on fresh machines (after the cert builds reputation).

**Dependencies.** Acquire an EV cert first.

## P2.18 · Auto-extract for viewer's bundled Python embeddable

**Rationale.** We already auto-extract `recorder.zip` on first capture launch. If the viewer's bundled Python ever becomes too large for in-repo storage (today it's gitignored entirely; doesn't matter), the same pattern would apply. Not needed unless distribution model changes.

**Scope.** Half a day if/when needed.

**Files to touch.**
- `viewer/python-runner.js` — extend `resolvePython()` with a zip-fallback mirror of `capture/recorder.js:resolveRecorderPath()`.

**Acceptance criteria.**
- If `python.exe` is missing but `python.zip` is present, extract it in place via Win10 `tar.exe -xf`.

**Dependencies.** None (defer until distribution model changes).

---

## Bookkeeping items (not features, not deferred — just hygiene)

These don't fit the P0/P1/P2 frame but should be on someone's list:

- The unused `escapeHtml` stub in `capture/welcome-window.js:148-150` is dead code with awkward escape handling. Delete it.
- `capture/status-window.js` will eventually retire (when the live-session window proves out in the field). Mark a tracking issue.
- `docs/UX-CHANGES.md` should be merged into `CHANGELOG.md` at v0.3 release time (it duplicates content the changelog will carry).
- `docs/BUILD-AND-DIST.md` should mention the new welcome window, hotkey overlay, multi-monitor screenshot config field in its config section.
- The `scripts/generate-icons.ps1` script's hardcoded hex tokens (`#6E8A66`, `#5A7488`, `#08080A`) should reference `viewer/styles.css` directly via a regex parser rather than duplicate the values. Currently if the palette changes, icons drift.

---

## How to use this spec

A future session picking up any single item should:

1. Verify the working-tree state matches the "Context" section. If the UX overhaul has been shipped, item references like "the new operator-panel" map to committed code.
2. Pick one item; check its **Dependencies** section.
3. Read the named files before changing anything.
4. Implement against the **Acceptance criteria**.
5. Add a one-line entry to `CHANGELOG.md` under `## [Unreleased]`.
6. Don't bundle items unless they're explicitly grouped here (e.g. P0.2 docs and P0.3 status-window retire are independent — separate commits).

The point of having tiers is to defend P0+P1 from gold-plating: P2 items should never block a release.
