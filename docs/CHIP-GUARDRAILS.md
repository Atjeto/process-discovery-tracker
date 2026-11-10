# Chip and agent guardrails: read this first

You are likely a fresh session with no memory. This project has been bitten
by context-blind changes (a map that fell apart, an ADR number used twice,
two chips on one branch). The defense is **guards that fail on a regression
even if you don't know the codebase**, paired with the few invariants below.
Honor both.

## Run these before every commit (the commands are the contract)

```
# Full-deps pytest, from normalization/ (plain `python -m pytest` skips the
# pipeline tests and still looks green): see CLAUDE.md, Commands.
../viewer/python/python.exe -c "import sys; sys.path.append(r'C:\Users\rasha\AppData\Local\Python\pythoncore-3.14-64\Lib\site-packages'); import pytest; sys.exit(pytest.main(['test/', '-q', '-p', 'no:cacheprovider']))"

viewer/python/python.exe normalization/golden_check.py   # the session golden
cd viewer && node --test                                  # incl. the UI copy guard
cd capture && node --test
dotnet test capture/recorder/Recorder.Tests/Recorder.Tests.csproj   # when capture/recorder/ changed
cd e2e && node run-all.js                                 # every smoke, the real viewer
```

If any goes red, you broke something: fix it or revert. Never commit red,
never delete a guard to make it pass. CI (`pytest.yml`, `js.yml`, `e2e.yml`)
runs the same on `windows-latest`; check `gh run list --branch master` after
every push.

## Hard invariants, and the guard that fails for each

1. **The process map is one connected graph.** The live map the Map level
   draws from the runs' steps (how the transactions ran, its second view)
   has one component, one entry step and one final
   step, reads left to right, and draws every path. The pin counts the step
   boxes and the lines between them only: the Start and End circles join
   every first and last step, so they would hide islands. *Guard:*
   `e2e/session-smoke.js`, "the process map is one connected graph (1
   component, 1 entry step, 1 final step), every path drawn" and "the
   process map reads left-to-right". **History:** a value-laden key once
   fanned each run into its own disconnected piece. A box is a step's
   value-free name (`process-map-levels.js` `mapNodeLabel`); never put a
   per-record or per-value key into it. Not working on the map? Don't touch
   `process-map-levels.js` or `dfg-viewer.js`.
2. **Pipeline output is pinned by the session golden.**
   `normalization/golden_check.py` re-analyzes the 10 demo sessions in temp
   folders and compares a projection with `normalization/golden/`. *Guard:*
   `golden_check.py` itself, and `test_golden_projection.py` in the
   full-deps pytest and in CI. Unintended drift is a bug, not a
   `golden_check.py --update`; update only for an intended output change,
   and say so in the commit.
3. **ADR number = `max(existing) + 1`.** Never reuse a number, never fill a
   gap; add the row to [adr/README.md](adr/README.md) in the same commit.
   *Guard:* `normalization/test/test_adr_registry.py`.
4. **Raw data is immutable.** `events.jsonl` is append-only (the capture
   app appends); every analyst edit lives in `annotations.json`, and
   re-analysis keeps the analyst's steps. The pipeline reads the raw stream
   and works on a derived copy (left-out apps, marker edits, excluded
   ranges); the viewer never writes it (a project made without a recording
   gets an empty one). *Guards:* `test_normalize_contracts.py` and
   `test_step_identity.py` (confirmed, edited, added and hidden steps
   survive), `test_sessions_without_recording.py` (the analyst's additions
   and their files survive re-analysis), `test_transcript_import.py` (the
   import leaves `events.jsonl` and `annotations.json` byte for byte). No
   test yet asserts that `normalize.py` leaves `events.jsonl` byte for
   byte: a change that writes it must be stopped in review.
5. **Suggest, don't mutate.** The app proposes; the analyst accepts; the
   source stays intact. Drafts are replaced only while they are drafts; a
   marker change shows as pending until *Apply marker changes*; an edited
   As-Is or To-Be map is a one-way copy the analysis never touches.
   *Guards:* `e2e/session-smoke.js` ("a Start marker inserted ... shows at
   once as pending", "the step-level BPMN it was forked from is untouched
   (one-way leaf)"), `e2e/runs-smoke.js` (Re-analyze keeps the confirmed and
   edited steps), the pytest survival tests above.
6. **One rule, two languages.** The value-free labels, the system names and
   the run differences are one rule set in `shared/`, read by Python and by
   the viewer; the step flow's edges (contract C17: the live map and the
   step BPMN) and the maps a project holds (contract C19: one per
   sub-process, their traces and numbers) are rules written in both, each
   pinned by one golden. *Guards:* the shared goldens
   (`process-label-golden.json`, `screen-label-golden.json`,
   `run-differences-golden.json` (the stretches left out of the analysis
   too), `flow-links-golden.json`, `sub-process-maps-golden.json`) pinned
   from both sides (`test_process_label.py`, `test_screen_label.py`,
   `test_run_differences_golden.py`, `test_flow_links_golden.py`,
   `test_app_names.py` and the pipeline's test of the sub-process maps;
   `process-map-levels.test.js`, `run-differences.test.js`,
   `system-names.test.js`, `sub-process-maps.test.js`).
7. **User-facing copy is plain business English, without dashes.** No
   internal vocabulary in rendered strings (the banned list and its
   replacements are in [DESIGN-SYSTEM.md](architecture/DESIGN-SYSTEM.md), UI
   copy style guide) and no em or en dash. *Guard:*
   `viewer/ui-copy-guard.test.js` (the viewer and the capture windows; runs
   in `cd viewer && node --test`).
7a. **No text in `--fg-4`.** It is a decoration colour (about 2:1); a muted
   text is `--fg-3`, `--fg-2` on a fill, and a filled control's text sits on
   `--accent-fill` (DESIGN-SYSTEM.md, Contrast, focus, dialogs and
   messages). *Guard:* `viewer/fg4-guard.test.js` (a `color: var(--fg-4)`
   outside its named decorations fails; runs in `cd viewer && node --test`).
8. **Verify UI in the real viewer, not only in unit tests.** Green units
   are not enough: that is this project's most recurring failure. Drive the
   viewer (below), screenshot, read the PNGs back.

## How to drive the viewer (entirely in-repo)

A fresh chip, even in a clean worktree, needs nothing outside the repo:
`e2e/` bundles `playwright-core` and drives the viewer's own Electron
(`npm install` in `viewer/` and `e2e/` once). The smokes are worked
examples; [e2e/README.md](../e2e/README.md) says what each covers.

1. **Work on a temp copy, never on the committed demo.** The viewer analyzes
   a folder by itself when it opens without a current analysis, so opening
   `sessions/example-aggregate/...` in place can rewrite it. Copy
   `events.jsonl`, `manifest.json`, `annotations.json` and `screenshots/` of
   a demo session into a temp folder (the smokes' `freshSession()`), and
   analyze it there or let the viewer do it on open.
2. **Launch through `e2e/throwaway-profile.js`:**
   ```js
   const { _electron: electron } = require("playwright-core");
   const { launchViewer } = require("./throwaway-profile.js");       // from e2e/
   const v = await launchViewer(electron, {
     executablePath: require("<repo>/viewer/node_modules/electron"),
     args: [".", "--session=" + TEMP_SESSION],
     cwd: "<repo>/viewer",
   });
   const page = await v.app.firstWindow();
   page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
   page.on("pageerror", (e) => errors.push(e.message));
   await page.waitForSelector("#session-loaded", { state: "visible" });
   // ... drive, screenshot, assert ...
   await v.close();   // quits the app and removes the throwaway profile
   ```
   - **Throwaway profile.** Each launch gets its own Electron user-data
     folder (`--user-data-dir`), so no run reads or overwrites the
     developer's recent list or layout; the
     launch fails if Electron is not on it.
   - **Window size.** The window's content is 1500x950, or what
     `PDT_E2E_WINDOW` names (`PDT_E2E_WINDOW=1366x768`); each launch logs
     the display, the content size and the page size it really got. CI's
     display is 1024x720, and Windows refuses a window larger than the
     display: check small sizes locally.
   - **Launch diagnostics and one retry.** A launch that fails logs the
     viewer process's exit and its last output lines, then retries once.
   - `--session=<folder>` is read once, when the page first loads: a
     `page.reload()` opens nothing. Relaunch instead.
   - **One viewer per profile** (lane MW). A second start on the same
     `--user-data-dir` ends at once and opens a window in the running
     viewer, so two viewers need two profiles (two `launchViewer` calls
     have them). A window a flow opens arrives as
     `v.app.waitForEvent("window")` (set it up before the click); the main
     process's stubs cover every window; `page.evaluate(() => window.close())`
     closes one (`e2e/windows-smoke.js`).
3. **Stub the main process's dialogs** when a flow opens one, and Explorer:
   ```js
   await v.app.evaluate(({ dialog }, f) => {
     dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [f] });
   }, FILE);
   await v.app.evaluate(({ dialog }, f) => {
     dialog.showSaveDialog = async () => ({ canceled: false, filePath: f });
   }, OUT);
   // Every export ends by showing its file in Explorer: no window, and the
   // file it showed is readable afterwards.
   await v.app.evaluate(({ shell }) => {
     shell.showItemInFolder = (f) => { global.__shown = f; };
   });
   ```
4. **Theme:** `page.evaluate(() => require("./theme.js").setTheme("dark"))`.

A human can instead run `npm start` in `viewer/`. The app has no reload
key: after a code change, quit it and start it again.

### The DOM handles of every surface

If a selector misses, grep `viewer/index.html` and the module named, and
make the missing selector fail loud in your script, never skip a surface
silently.

**Top bar** (the levels, the status line, the save state and Export show
once a project is open, `.app.has-session`; opening one menu closes the
others):
- New: `#btn-new-menu` opens `#new-menu-popup`: `#btn-new-from-video`
  (New project from a video...), `#btn-new-blank` (New empty project...).
- Open: `#btn-recent-menu` opens `#recent-menu-popup`: `#btn-open-session`
  (Open project...), `#btn-open-new-window` (Open in a new window..., lane
  MW: the folder dialog, then the project in a new window), `#btn-open-handoff`
  (Open a zip...: a hand-off zip opened
  read only; also `#btn-open-handoff-hero` on the empty state: stub
  `dialog.showOpenDialog` to answer the zip's path) and the recent projects
  `#recent-menu-content .recent-menu-item[data-folder]`, each in a
  `.recent-menu-row` with, when its folder is there, the button that opens
  it in a new window `.recent-menu-newwin[data-folder]`.
- Levels: `.view-mode-btn[data-level="overview"|"flow"|"steps"|"map"]`
  (the Timeline is `flow`); each shows `#session-layout-<level>`. The
  Overview is the default on load.
- Status line `#session-pills`: while the pipeline runs `#run-status` and
  `#btn-cancel-normalize`; else `#btn-apply-marker-edits` when marker
  changes wait.
- The save state `#save-state` (`role="status"`, focusable):
  `data-state="saved"|"saving"|"failed"|"readonly"`, its text *Saved*,
  *Saving...*, *Not saved* or (a hand-off opened read only, or a project
  open in another window) *Read only*, the time, the folder, the reason or
  the version in its `title`.
- New, Open and Export each close on Escape (the keyboard back on the
  menu's button).
- Export: `#btn-session-export-menu` opens `#session-export-popup`, in
  this order under three `.project-menu-heading` divs (text, not focusable,
  12 px, `var(--fg-3)`; hidden in a read-only page): "For the developers
  and the archive", `#btn-session-handoff` (Hand off...: a `.modal-prompt`
  asking what changed, OK disabled while it is blank, its `.modal-detail`
  saying what the zip holds; lane B-V2: with something a reader will miss,
  `.modal-pick` after the detail (`.modal-pick-lead` "A reader of version N
  will miss:", one `.modal-pick-go` link per entry, at most six lines,
  `.modal-pick-more` "and N more"; a link cancels and goes where it leads)
  and OK reads "Hand off anyway"; the item reads "Handing off..."
  and Export carries `aria-busy="true"` while the hand-off is made; the zip
  `<project> v<N>.zip` lands beside the project folder, and a smoke waits
  for Explorer's stub to show it; at its root the PDD, the Technical
  details when written, `<project> v<N> map.svg`, `<project> v<N>
  map.bpmn` and `Start here.txt`; its project folder without
  `annotations.json.2` to `.5` and `normalize.log`); "For another
  analyst", `#btn-session-zip` (below); "Single files", `#btn-session-pdd`,
  `#btn-session-tech` (Technical details (.xlsx), contract C20; where
  nothing was recorded it writes no file and says so in a toast),
  `#btn-session-map-svg`, `#btn-session-step-bpmn`. `#btn-session-zip` (Whole project (.zip);
  it reads "Making the zip..." and the Export button carries
  `aria-busy="true"` while the zip is made). In a hand-off opened read only
  the writing items are hidden and `#btn-handoff-open-pdd` (PDD of this
  version) and `#btn-handoff-open-tech` (not when the zip came without
  the Technical details: `.app.handoff-no-tech`) show, each opening its file with
  `shell.openPath` (stub it). Every export then shows its file in Explorer
  (step 3 above).
- `#btn-help` (below), `#btn-theme-toggle`.

**A hand-off opened read only** (contract C20, lane HV): the project comes
from a folder under `<userData>/handoffs/<project> v<N>/`, or is a hand-off
unzipped by hand (its PDD and Technical details beside the project folder)
(`State.getSession().readOnly === true`), the page carries `.app.read-only`,
and every editing control is hidden (`styles.css`, beside
`.annotations-unreadable`); the step pane's and the document's fields are
`readOnly` (a tick or a list `disabled`). The Checklist `#ov-next` is not
drawn. A smoke that checks "nothing is written" snapshots the extracted
folder (names, sizes, times, hashes) before and after
(`e2e/handoff-smoke.js`).

**A project open in another window** (lane MW): the same read-only page
(`.app.read-only`), with `State.getSession().openElsewhere === true` and
`.app.open-elsewhere` (the Export menu's two hand-off items hidden too); the
project line's first line is `#ov-elsewhere` ("Open in another window:
read only here") in place of `#ov-handoff`, and the window's title ends
"(read only) · Process Discovery Viewer". The main process refuses a write
from that window (`{ ok: false, code: "READ_ONLY" }`) and takes the
editing window's (`e2e/windows-smoke.js`).

**Shell:** the empty state `#session-empty` (`#btn-open-session-hero`,
`#recent-list-session li[data-folder]`, `#recent-clear-all`); the loaded
session `#session-loaded`; `#annotations-error-banner` (an unreadable
`annotations.json`) with, when a backup can be read, its act
`#btn-restore-annotations` (Restore the newest backup: a `.modal-confirm`
naming the backup's time, then the unreadable file kept as
`annotations.unreadable-<YYYYMMDD-HHMMSS>.json` and the project opened
again); the analysis log `#log-host` (`#log-failure`, `#normalize-log`),
shown only after a failed run; `#toast` (a live region: `role="status"`,
an error `role="alert"`; an error stays and carries `#toast .toast-close`,
named Dismiss; an offer's or an Undo's button is `#toast .toast-action`).
Every dialog's box (`.modal`, from `modals.js` `holdFocus`) carries
`role="dialog"`, `aria-modal="true"` and `aria-labelledby` (its title): read
the focus with `document.activeElement` against it. A menu's button carries
`aria-expanded`; the level shown, `aria-current="page"`.

**Overview** (`#overview-content`, `views/overview-view.js`):
- Before the first analysis: `#ov-waiting` (`data-run` = the run state).
- The Checklist `#ov-next` (`data-next` = the next stage; stages
  `.ov-next-stage[data-stage="runs"|"steps"|"written"|"pattern"|"review"|"document"|"asis"|"handoff"]`
  (a recording: runs, pattern, review, document, handoff; without a
  recording: steps, written, review only with two or more transactions,
  document, handoff),
  `.done` when done; `asis`, *Check the As-Is map*, is listed only while the
  As-Is map the PDD prints was made before the steps changed, lane FX2;
  `handoff` is done once a version is handed off) and its one button
  `#btn-ov-next` (`data-next-act`: the stage, except `steps-timeline` and
  `steps-list` for Add the steps with and without a video; `handoff`
  clicks `#btn-session-handoff`). Once only the hand-off is left the line
  is `#ov-next.ov-next-ready` (`data-next="handoff"`) with
  `.ov-next-ready-text` ("Everything before the hand-off is done.", or
  "Version N was handed off on <date>. Hand off again after a change.").
- Lane B-V2: right after `#ov-next`, only once the Checklist is ready or a
  version was handed off, and only with an entry (never in a read-only
  page), `details#ov-miss` (closed by default, its open state kept while
  the project is on screen): `#ov-miss-line` ("A reader of the next
  version will miss N things") and one `.ov-miss-go` link per entry
  (`data-miss` = the entry's key: `drafts`, `names`, `descriptions`,
  `pictures`, `systems`, `conditions`, `document`, `asis`). The entries are
  `require("./views/overview-view.js").missingOf(session)` (rule:
  `readiness.js`). A closed details keeps its links laid out: test their
  visibility with `checkVisibility()`, not `getClientRects()`.
- Steps: `[data-act="confirm-run"]` and the draft status
  (`.run-status-draft`) show only while the reference transaction holds a
  drafted step at some level; Ctrl+Enter acts only where the button is.
- The project line `#ov-summary`: in a hand-off opened read only its first
  line `#ov-handoff` ("Version 2, handed off <date> by <name> · Read only",
  what changed in its `title`);
  `[data-summary="runs"|"steps"|"video"|"transcript"|"request"]` (the
  request: the document's, 2.0.1, else the capture's),
  `#btn-attach-video` (Attach, or Replace; `data-clip` names the video a
  Replace acts on), `#btn-remove-video` (only for a video the analyst
  attached; a `.modal-confirm` first), `#btn-add-video` (2.0.6, contract
  C23: Add another, or Add with several videos, when the line reads "2
  videos"), `#btn-attach-transcript`, `#btn-remove-transcript`,
  `#btn-add-transcript` (Add another with two or more videos, or Add with
  several transcripts), the marker fixes
  `.summary-fix[data-fix]`. Remove video, Replace and Remove transcript
  take their files out of the folder and Ctrl+Z brings them back (lane CC;
  a smoke waits for the reload after the undo: the video's
  `State.getSession().recordingPath` or `.videos`, the transcript's
  `.transcript` or `.transcripts`). The videos are
  `annotations.external_videos` (C23; a project of 2.0.5 has
  `external_video`, read as one clip): read the first with
  `(a.external_videos || [])[0] || a.external_video`.
- The document `#ov-doc` (a `<details>`): the fields `[data-doc="title"|"request"|"purpose"|"scope"|"trigger"|"result"|"contacts"|"business_rules"|"exceptions"|"effort"|"improvement"|"notes"]`
  (saved on change), who fills it `#ov-doc-who`, `#ov-doc-status` (the
  count, "N of 10 written": `request` and `notes` are optional and not
  counted; and the empty fields by name); the attachments `#ov-attach`
  (`#btn-ov-attach`, `.att-row[data-att-id]` with `.att-label-input` and
  `[data-att-act="open"|"remove"]`); the transcript `#ov-tr` (`#ov-tr-list`,
  `.tr-add-to[data-seg]` opens `#ov-tr-add-menu [data-doc-target]`).
- No Observations since 2.0.1: the PDD's sections are the document's
  alone, and opening the Overview never starts an analysis.

**Timeline** (`#session-layout-flow`; [VIEWER-TIMELINE.md](architecture/VIEWER-TIMELINE.md)):
- Header: `#timeline-summary`, the Transaction select `#case-scope-select`,
  `#btn-add-step` (only with a video), `#btn-lanes` opening `#lanes-popup`
  (`input[data-lane="idle"|"screenshots"|"cases"|"steps"|"videos"|"transcript"|"notes"]`),
  `#btn-zoom-out`, `#btn-zoom-reset`, `#btn-zoom-in`. Lane FX3: a project
  with no recording and no video draws no timeline, so `#case-scope`,
  `#lanes-menu` and the zoom buttons are not shown there, nor the video
  band (`#lower-workspace.no-timeline`): `#tl-empty` carries Attach video.
- The timeline `#timeline` inside `#timeline-scroll`; `#timeline-minimap`
  (only while zoomed); the legend `#timeline-legend` (`#legend-apps`).
- The lanes' header column `#tl-lane-names` (hidden when nothing is drawn):
  a cell per lane `.tl-lane-name[data-lane]` (its tooltip the lane's `title`;
  inside it the key `.tl-lane-key` and the name `.tl-lane-label`, whose box
  is centred on the lane's marks); the dividers `.tl-lane-sep`, in the
  column and at the same heights in `#timeline`; while the pointer is on a
  cell, its lane lit in `#timeline` as `.tl-lane-hover`.
- Lanes: `.tl-case-band` (runs; 2.0.3: drawn from the markers as they now
  are, `.pending` while the last analysis has not seen it, `data-start-key`
  and `data-end-key` the markers at its sides, `data-start-ms` and
  `data-end-ms` its span), `.tl-activity` (`.tl-act-app` names the
  system; `.tl-app-left-out`, hatched, for an app among the Apps outside
  the process, lane FX2), `.tl-idle`, `.tl-marker.tl-marker-pending` (2.0.3:
  only a marker deleted, or any change while the Transactions lane is off), the videos
  `.tl-clip[data-clip]` (C23, 2.0.6: `.trimmed-start`, `.trimmed-end`,
  `.missing`; a side within 6 px of the pointer shows `.tl-edge-hot`, a real
  mouse drag trims it on release; its right-click opens `#tl-ctx-menu`), the
  transcript `.tl-tr-block[data-seg][data-file]` and its label
  `.tl-tr-label[data-file]` (one per transcript; `.tl-tr-name` with several;
  `.tl-tr-sync`, `.tl-tr-replace`, `.tl-tr-remove`), notes `.tl-note[data-note-id]`,
  screenshots `.tl-screenshot` (`.tl-screenshot-added` for one the analyst
  added at a moment, lane FX2), steps `.tl-step-band[data-step-id]` (a
  one-click step too, at the lane's smallest width; `.placed` on a step
  placed elsewhere in the process, contract C22, with the legend's
  `.lg-placed`; the
  level the Steps list shows; inside a sub-process its lane's name
  `.tl-lane-name[data-lane="steps"]` reads "Steps in <name>"), the
  playhead `#tl-playhead`. A blank project shows `#tl-empty` with
  `#btn-tl-attach-video`.
- Dragging a side (2.0.3, `wireEdgeDrag`): a press within 6 px of a
  draggable side of a `.tl-case-band`, or of a `.tl-step-band` whose step's
  time is the analyst's, moved 3 px or more (a real mouse: `page.mouse.down`,
  `move` in steps, `up`); the side under the pointer shows `.tl-edge-hot`,
  the page `body.tl-edge-dragging` while one is dragged, the time
  `.tl-drag-time` in `#timeline`. Esc during the drag puts it back. A
  transaction's move is a marker change (pending until
  `#btn-apply-marker-edits`); a step's saves at once.
- Times typed in Steps (2.0.3): an open transaction's
  `.run-group.open .run-times` holds `input.time-field[data-side="start"]`
  and `[data-side="end"]` (`.pending` while its change waits, then
  `.run-times-note` "Not applied yet" and `.run-times-apply`); the selected
  step's `#step-start` and `#step-end` in `#step-facts .step-facts-rest`
  (a step without a time: `#step-start`, and `#step-end` disabled until a
  start is typed; the step being marked, nothing after it yet: `#step-end`
  empty with the placeholder "open", its band `.tl-step-band.open`). A field saves on Enter or when left; set it with a
  click, Ctrl+A, Backspace, the text, Enter. In a project made from a video
  or from nothing a marker change applies itself about 1.2 s after the
  analyst stops (no Apply button there): wait for no pending change, no
  `#run-status` and `analysisBusy()` false instead of clicking.
- Menus: every timeline right-click menu is `#tl-ctx-menu` (items by their
  text: "Start a transaction here…", "End the transaction here", "Add note
  here…", "Add a step here", "Jump to step here"; the transaction and step
  items start at a step's start or the playhead within 8 px of the click,
  2.0.3; a step's or a transaction's band gives the same items first, then
  its name as `.tl-ctx-head` and its own: "Open in Steps", "Select + seek
  here", "Delete step" or "Hide step"; "Jump to start", "Jump to end"; on a
  stretch left out "Include again", "Go to its start"). A Shift-drag
  range shows `#tl-selection-stats` (`#tl-selection-case`,
  `#tl-selection-exclude` "Leave out of the analysis", only with a
  recording, asking with a `.modal-confirm`; `#tl-selection-clear`). A
  Shift-drag starts only on the timeline's own background: find a point
  where `document.elementFromPoint(x, y) === #timeline`.
- The stretches left out of the analysis (lane CC): `.tl-left-out` over the
  Systems lane (`data-start`, `data-end` the `excluded_ranges` entry's; a
  click or a right-click opens its menu), its label `.tl-left-out-label`
  where it fits, the legend's `#timeline-legend .lg-left-out`. Leave out,
  Include again and an undo or a redo of either each run an analysis: wait
  for `require("./views/flow-view.js").analysisBusy()` to be false.
- Video: `#video`, `#no-video` with `#btn-link-recording` (Attach video),
  `#btn-sync-video` (only with a video), `#btn-video-remove` (Remove video,
  only for a video the analyst attached), the sync card `#video-sync-card`
  (`.vs-mark`, `.vs-cancel`; the transcript's is `#transcript-sync-card`),
  `#btn-video-expand`, `#btn-video-fullscreen`.
- Side panel: `.anno-tab[data-anno="screens"|"markers"]`; `#screenshots-grid`,
  `#btn-open-gallery` (the gallery `#screenshot-gallery`); `#markers-list
  .marker-row` with `[data-act="adjust"|"delete"]` (double-click a Start to
  rename it).
- Raw events: `.event-table-host` (a `<details>`, shown on the Timeline
  only, and only when the project has events), `#event-table`,
  `#event-filter`.

**Steps** (`#session-layout-steps`, `views/steps-view.js`):
- Toolbar: `#btn-add-manual-step`, `#btn-delete-selected-steps`,
  `#btn-merge-selected` and `#btn-group-selected` (Group into a
  sub-process..., contract C19; shown with two or more ticked rows), `#steps-summary`,
  `#btn-ignored-apps` (the dialog: `#ia-list`, `#ia-save`, `#ia-cancel`;
  lane FX3: not shown in a project without a recording, disabled with its
  reason in a recording without a click or a field typed).
- The list's title `#runs-pane-count` and the line under it that says what
  a transaction is, `#runs-pane-note` (inside a sub-process, what a block
  is).
- The level shown (contract C19, `State.getMapPath()`, `[]` the main
  level): inside a sub-process the breadcrumb `#steps-crumbs` (hidden at the
  main level) holds the crumbs `button.crumb[data-depth]` (each goes up), the
  current `.crumb.crumb-here` and `#btn-dissolve-level`; the blocks are
  `#step-list .run-group.run-visit[data-case-id][data-visit]` (`data-visit`
  is `<case_id>#<n>`, n counting that transaction's visits from 0; titled
  "Transaction 2" or "Transaction 2, again"), the reference transaction's
  first visit `.pattern` with its badge, status and `[data-act="confirm-run"]`,
  and once confirmed Undo confirm `.run-row [data-act="reopen-run"]` in its
  head.
- The divider between the list `#steps-list-pane` and the step pane:
  `#steps-splitter` (`role="separator"`, `pane-splitter.js`; drag it, or
  focus it for Left, Right, Home and End; a double-click or Enter resets it;
  its share is `--split-share` on `.editor-split` and
  `localStorage["pdt.stepsSplit"]`; hidden at 1100px wide or less, where
  the panes stack).
- The transactions `#step-list .run-group[data-case-id]`: the head
  `.run-row` (a click opens the transaction; a right-click opens
  `#run-ctx-menu`: "Use as reference transaction" on another transaction,
  the probe line `[data-act="copy-probe"]` on the confirmed reference
  transaction); `.run-pattern-badge` (Reference),
  `.run-status`; on the open, confirmed reference transaction Undo confirm
  in the head, right after the status: `.run-row [data-act="reopen-run"]`
  (`.run-undo-confirm`); `.run-actions [data-act="confirm-run"]`;
  `.run-notes li[data-kind="left_out"]` (a stretch left out of the
  analysis, no difference); `.run-show-hidden`. 2.0.1: the differences are
  on the rows: `.step-row .step-diff.step-diff-<kind>` (`extra`, `order`,
  `repeated`; its title the line the PDD's 4.1 prints) and a greyed row
  `.step-ghost[data-ghost="skipped"|"not_done"]` (not a `.step-row`) where a step of
  the reference is missing (run-differences.js `rowMarks`).
- The step rows `.step-row[data-step-id]` (double-click renames the row its
  first click landed on; right-click opens `#step-ctx-menu`; `.step-time`
  is when the step starts, m:ss on the one clock, 2.0.1; the tick
  `.multi-check`, a checkbox a keyboard reaches: Space ticks it). A
  sub-process row carries `data-sub-process="true"` and `.step-sub-open`
  ("▸ N sub-steps", a click opens its level).
- The Steps toolbar's verbs on the selected step (2.0.1, `#step-verbs`,
  hidden while none is selected or two or more are ticked; a verb that
  cannot act is disabled with its reason in its title): `#btn-step-split`
  (Recorded opens and its first scissors take the focus), `#btn-step-merge`,
  `#btn-step-hide` (Hide step, or Unhide), `#btn-step-make-sub` (Open as a
  sub-process, on a step of a transaction; disabled on a recorded step with
  fewer than two actions, a sheet's cells filled one after another counting
  as one) or on a sub-process `#btn-step-open-sub` and `#btn-step-dissolve`,
  and `#btn-step-delete` (added steps only). With two or more ticked:
  `#btn-merge-selected`, `#btn-delete-selected-steps`, `#btn-group-selected`.
- The step editor `#step-detail` (focus it before Ctrl+V; 2.0.1, one
  column): the head `.step-head`: `#step-name` (the title; Enter or leaving
  it saves; contract C21: a click, typing or Down opens the library's
  activities of the step's system under it, `#step-activity-list
  .step-activity` (`.step-activity-name`, `.step-activity-code`,
  `.step-activity-desc`; `.current` the step's own, `.active` the keys'
  row), a click or Enter picks one; with none, the quiet line
  `#step-lib-note`, shown only while the name has the focus), `.step-state`
  (the step's chip), `#step-code` (the library activity's code, C21, when
  the step is named from one), the line of facts `#step-facts`: `#step-system`
  (with `#step-system-list`), `.step-facts-rest`, `#btn-step-watch` (Play,
  only with a video: the step in the step panel) and `#btn-step-jump`; what
  you write `#step-doc`: `#step-desc` (leaving it saves), `#step-said` (the
  sentences that start in the step's window, the step before bounding its
  lead),
  the Flow line `#step-flow` (contract C17: `#step-flow-line`,
  `#btn-flow-only-when`, `#btn-flow-go-to`, and C22's `#btn-flow-place`
  with, on a placed step, `#step-placed-line` and `#btn-flow-back-to-time`;
  a placed step's row carries `.step-placed`; the condition `#step-only-when`
  with `#btn-flow-remove-condition`; the links `.flow-links
  .flow-link[data-i]` (`data-i="new"` for the row being added), each with
  `.flow-link-text`, the dropdown `select.flow-link-to`
  (`#flow-link-to-<i>`, its options the transaction's steps and `end`),
  `input.flow-link-when` (`#flow-link-when-<i>`) and `.flow-link-remove`),
  `#flag-waste`;
  `#step-shots-sect` (only when the step has screenshots;
  `.step-shot-card[data-ref][data-kind]` with `[data-shot-act="pdd"|"remove"]`,
  and `[data-shot-act="unhide"]`); Recorded `details#step-recorded` (a
  click on its summary opens or closes it on every step, kept in
  `localStorage` `pdt.recordedOpen`; its line `summary .step-part-hint`):
  the actions `.step-interaction` (`.si-text`, `.si-control`, `.si-time`;
  their `.si-split-btn` scissors split after an action; none on a step with
  fewer than two, nor on a sub-process); what is attached:
  `#step-atts-sect` (`[data-att-act]`) and `#step-notes-sect`
  (`.step-note [data-note-act="edit"|"delete"]`), each only when it has
  some, then `.step-adds`: `#btn-step-add-shot` (opens `#shot-src-menu
  [data-src="video_frame"|"paste"|"file"]`), `#btn-step-add-note`,
  `#btn-step-attach`.

**The step panel** (`#step-panel`, `views/step-panel.js`; hidden until a
door opens it): `#sp-name`, `#sp-about` (`.sp-system`, the flow line
`#sp-flow` when one is set, `.sp-count`, without "about ... each" when the
mean is under a second; `.sp-missing` alone for an As-Is
task no step stands for), `#sp-video`, `#sp-body .sp-occ[data-step-id]`
(`.sp-play`, `.sp-at`, `.sp-shot`), `#sp-video-note` (the one line when the
video has no moment of the row: not covered, or no time; lane FX2), the
foot `#btn-sp-steps` or
`#btn-sp-timeline` and, for a sub-process, `#btn-sp-open-sub`, `#btn-sp-close`.
Lane E-1, on the Timeline and the Map only: `#sp-name-edit` holds the name
field `#sp-name-input` (its picker `#sp-activity-list`, its quiet line
`#sp-lib-note`; `#sp-name` keeps the name, `.sr-only`), and `#sp-fields`
holds the System field `#sp-system` (in `.sp-system`, the screen
`.sp-screen` after it) and the description `#sp-desc`; the editor's ids
(`#step-name`, `#step-system`, `#step-desc`) are never the panel's. *Use the
video at m:ss* is `.step-use-video` in `#sp-body .sp-occ.focus`, and
`#btn-step-use-video` in the editor's `#step-shots-sect`.

**Map** (`#session-layout-map`; lane MV: the map the PDD prints first, how
the transactions ran one click away):
- The one header line `#map-view-bar` (hidden while the live map says why
  it draws nothing): `#map-view-title` ("Process map", the As-Is copy's
  name, or "How the transactions ran"), `#map-view-note` ("(the PDD prints
  this map)", "(edited; the PDD prints this map)"), `#btn-map-asis-edit`
  (the chosen copy's Edit), `#map-view-stale` and `#btn-map-asis-recopy`
  (lane FX2: shown while the chosen As-Is copy was made before the steps
  changed, the line and *Copy again*), `#btn-map-show-runs` (Show how the
  transactions ran) and `#btn-map-show-map` (the way back: Show the process
  map, or Show the As-Is map). `#map-view-why` is the one line saying why the map the PDD
  prints does not show. The Map analyzes first when that map is
  `process_map_step.bpmn` and older than the steps:
  `require("./refmap-ui.js").mapBusy()` is true while it runs and
  `require("./views/flow-view.js").analysisBusy()` while any run is queued or
  running; wait for both false before reading the map. The view chosen holds
  per project in a window: a smoke that reads cytoscape clicks
  `#btn-map-show-runs` first.
- How the transactions ran: the host `#session-map-dfg-host`, drawn while it
  shows; its cytoscape instance is
  `host.__cy`, the edge tip `.dfg-edge-tip`; `#btn-session-map-zoom-fit`
  (it fits the picture the PDD prints while that shows). The Start and End circles are
  nodes with `data("kind") === "event"` and `role` `start-event` or
  `end-event` (their ids start with the character `\u0001`, so no step
  name takes them); a box is any other node. An edge carries `observed`
  (false for a path set in Steps that no transaction took: dashed),
  `label` (the condition as drawn, cut short) and `fullLabel`. While the
  map cannot be drawn the host holds the message, with
  `[data-map-cta="mark-runs"]` when no transaction is marked.
- The level shown (contract C19, `State.getMapPath()`): with a sub-process,
  the picker `#map-picker` (hidden without one): `#btn-map-picker` reads
  "Map: " and `#map-picker-name`, and opens `#map-picker-popup` with one
  `.map-pick[data-map]` per map (`data-map` its path as JSON; `.map-pick-num`,
  `.map-pick-name`, the depth in the `--map-depth` style, the one shown
  `.current`). A sub-process's box carries `data("sub") === true` (the +);
  a `dbltap` on it opens its map. At a level the chosen As-Is copy has no
  plane for, the picture is the process map's plane and `#map-view-why`
  says so.
- Beside `#btn-session-map-zoom-fit`: `#btn-session-map-reset-layout`
  (Reset layout, lane CC), shown only while how the transactions ran shows
  with a box dragged (a key `pdt.dfgLayout.<hash>` in `localStorage`); a
  click forgets that level's arrangement and draws the map again.
- The map the PDD prints first: `#session-map-asis`, the chosen As-Is copy,
  else `process_map_step.bpmn` (`#map-view-title` says which). The map
  itself is `#map-asis-canvas`, a bpmn-js
  navigated viewer (`host.__bpmnViewer`; shapes
  `.djs-element[data-element-id]`, the ones a click opens marked
  `.pdt-link`, the system labels marked `.pdt-inert`: 2.0.1,
  `TextAnnotation_system_<k>` above a task or a map's one
  `TextAnnotation_system`, "System: <name>", `Sub<n>_` inside a plane;
  the legend `TextAnnotation_legend` of a copy made before 2.0.1 is inert
  too); a note (a step's notes are `TextAnnotation_<n>`, under its task)
  opens the popover `#map-asis-note` (`.map-asis-pop-text`,
  `.map-asis-pop-close`). C19: the plane shown is
  `__bpmnViewer.get("canvas").getRootElement()` (a sub-process's id plus
  `_plane`; the ids inside it start `Sub<n>_`); bpmn-js's crumbs above a
  plane are `.bjs-breadcrumbs .bjs-crumb a`, its drill arrows
  `.djs-overlays[data-container-id="<id>"] .bjs-drilldown`. Wait for the
  canvas with `.djs-container > svg`: the arrows' icons are svgs that come
  first in the page.
- The edit act `#btn-fork-refmap` (disabled with its reason in its title
  while the Map withholds the process map or no transaction has a visible
  step, lane FX3): the editor opens on a new copy, kept at
  its first change (a change in the map, its name or its role; a smoke that
  needs the copy makes one, for example moves a system label, the first
  element whose id starts `TextAnnotation_system`, with
  `modeling.moveElements`, and waits for the 600 ms delayed write); closed
  without one, nothing is kept (no `reference_maps` entry, no file in
  `derived_maps/`). `#btn-toggle-refmaps` (`#refmap-count`)
  shows `#refmap-panel`: `#refmap-list .refmap-row` with
  `[data-rm-act="edit"|"dup"|"refork"|"del"]` (Delete asks with a
  `.modal-confirm`, then the row and its file in `derived_maps/` go; Ctrl+Z
  brings both back) and, under a copy the process map changed after,
  `.refmap-row-note` (what Copy again gives); or `#refmap-empty`.
- The editor overlay `#refmap-editor-overlay`: `#refmap-editor-name`,
  `#refmap-editor-pdd` (None, As-Is map, To-Be map), `#refmap-editor-host`
  (bpmn-js shapes `.djs-element[data-element-id]`),
  `#btn-refmap-editor-close`. While it shows, `page.keyboard.press("Control+Z")`
  (and `Control+Y`) undoes (redoes) a map edit there; the viewer's own
  shortcuts do nothing underneath.

**Help** `#help-modal`: `.help-nav-item[data-section="start"|"stepsphases"|"map"|"markers"|"capture"|"handoff"|"shortcuts"|"trouble"]`,
`.help-section[data-section]`, `#btn-help-reanalyze` (Troubleshooting),
`#help-version`, `#help-library` (contract C21: the app's library, "Library
1: 9 applications, 0 activities", its file in the tooltip), `#btn-build-library`
(Steps section), `#btn-help-close`.

**The Library builder** `#library-builder` (contract C21, Help, Build the
library...; `views/library-builder-ui.js`): `#lb-intro`, `#btn-lb-add-projects`
(a folder dialog) and `#btn-lb-add-zips` (a zip dialog; stub
`dialog.showOpenDialog` for both), `#lb-read`, the list `#lb-list` of
`.lb-app[data-app]` sections, each of `.lb-cluster` blocks (`.conflict` with
`.lb-conflict-note` when the same screens are named differently), each of
`.lb-row[data-key]` rows (`.lb-tick`, `.lb-name`, `.lb-code`, `.lb-desc`,
`.lb-meta`), `#lb-error`, `#lb-count`, `#btn-lb-save` (stub
`dialog.showSaveDialog`; its `defaultPath` is the app's library file). The
test library: set `PDT_LIBRARY` before the launch (`e2e/library-smoke.js`).

**Dialogs:** a prompt is `.modal-backdrop.modal-prompt` (`.modal-input`,
`.modal-ok`, `.modal-cancel`); a confirmation `.modal-backdrop.modal-confirm`
(`.modal-ok`, `.modal-cancel`); a choice from a list (C22's *Place after a
step...*) `.modal-backdrop.modal-choose` (the list box `select.modal-list`,
its values `after:<step_id>` and `first:<case_id>`, `.modal-ok`). The playback bar is `#playback-bar`
(`#pb-play`, `#pb-scrub`).

**Gone with the product edition** (a script that still looks one up must
fail): the tab row and the Compare, Template and App Library views; the More
menu; the command palette; the Analyze button; the Phases and Analysis
levels; the map's notation tabs, level select, rare-path slider and Expert
drawer; the data posture and Copy for LLM; the Flow Notes tab; the
shortcuts overlay. Replaced since: the As-Is picture `#map-asis-img` (now
the linked `#map-asis-canvas`) and `dfg-viewer.js` `exportSvg` (Export's
map image draws the step BPMN); lane MV: `#map-asis-title`,
`#btn-map-show-asis` and `#map-asis-missing` (now `#map-view-title`,
`#btn-map-show-map` and `#map-view-why`), and the live map as the Map's
first view (now the second, how the transactions ran); *New from a video* and *New without a
recording* in the Open menu are the New menu's two items. Gone since
2026-09-24 (owner: a process is recorded once): the saved processes (C5),
with *Save as this process*, the "Compared with saved process" line
(`.runs-compare`, *Stop comparing*, *Forget this saved process*) and
`processes-store.js`. Gone since 2026-09-25 (lane CC): the Raw events
row's *+ to step* (Split, Merge and + Add step set a step's boundaries); the
identity line's marker (the ⚠ and ? glyphs, `.si-marker`, `.si-idrow`: a
project is recorded once); the Observations' *Data typed twice* and *Where
the time goes* (`data-module="retyped"`, `table.ov-time`, `.ov-retyped`),
now the PDD's own rows; *Exclude from analysis* on the selection card, now
*Leave out of the analysis* (same id). Gone since 2026-09-25 (lane FX1): the
analysis layer nothing read (`analysis.json` `facts`, `findings`,
`pdd_findings` and the step-based blocks; the coverage warning reads
`coverage_caveat`, format 4), a draft's `suggestion_reason`, and the
unused `dfg-viewer.js` `exportPng`, `bpmn-viewer.js` `exportSvg`,
`asis-view.js` `hasLevel` and `modals.js` `formModal`. A run of
`normalize.py` stages its outputs as `*.pdt-staged` and moves them in as
its last act: a smoke that reads the outputs waits for the run to end.
Gone since 2026-09-25 (contract C21): the remembered step names (the
store `pdt-library/remembered-names.json`, the Remembered step names dialog
`#btn-remembered-names` and `#remembered-names-dialog`, `--names`), and the
datalist on the step pane's name (the library's picker took its place; a
row's rename keeps the names used in the project). Gone since 2026-09-26
(2.0.1, the PDD for its readers): the Overview's Observations
(`#ov-observations`, `table.ov-rows`, `.ov-rekeyed`, `#ov-rows-freshness`,
`views/analysis-view.js`), the rows refresh as the Overview opens
(`rows-freshness.js`, `session.js` `setBeforeWrite` and
`beforeProjectWrite`, `flow-view.js` `cancelAnalysisQuietly`) and
`analysis.json` `pdd_data`, `pdd_time` and `steps_signature` (format 5).
Gone since 2026-09-27 (2.0.1): the step map's colours (`bioc:fill`,
`bioc:stroke`) and its legend `TextAnnotation_legend` ("Colour by system",
"Hand icon: done outside the systems", "Waste: a step that should not be
needed"), now the system labels `TextAnnotation_system_<k>` and a map's
one `TextAnnotation_system` (an As-Is copy made before keeps its own); the
capture app's Recording setup (`session-config-window.js`,
`ui/session-config.html`, `pdt:sessionConfigGet`, `pdt:sessionConfigSave`,
Setup (analyst)'s *Recording setup...*) and its named transactions (the
bar's caret, `pdt:namedRunMenu`, the tray's *Start a named transaction*);
and the Steps row's duration (the row's `.step-time` is when the step
starts).

**Clipping check** (labels have drifted before): a visible element with
`scrollWidth > clientWidth + 2` and text is clipped, **unless** it has
`text-overflow: ellipsis`, where that is true by design whenever the
ellipsis elides. For ellipsized labels assert the box against its container
instead, and eyeball to be sure.

### UI-verification pitfalls

Each of these shipped or nearly shipped once (full case register:
[To-Do/AGENT-DELEGATION-POSTMORTEM-2026-07-02.md](To-Do/AGENT-DELEGATION-POSTMORTEM-2026-07-02.md)):

1. **Doubled disclosure markers.** A `<summary>` with its own chevron needs
   the native `<details>` marker suppressed (`list-style: none` and
   `::-webkit-details-marker`); check every new disclosure in a screenshot.
2. **"Mirror pattern X" means the real X.** Open X's markup and CSS and put X
   and the new instance side by side in the eyeball pass. DOM compliance is
   not visual compliance.
3. **Removing a component includes its styles.** Grep the removed class
   names for dead CSS in the same commit.
4. **The viewer analyzes by itself.** Opening a folder without a current
   analysis rewrites its outputs: eyeball on temp copies (step 1 above).
5. **Look at the small sizes.** Run once at `PDT_E2E_WINDOW=1366x768` and
   `1024x720` (the CI display); wrapping and crowding hide at 1500x950.
6. **A multi-candidate action needs a selection rule** in the spec (which
   run? which row?); "the first one" is an accident, not a decision.

## Concurrency (we've collided before)

- **One distinct, named branch off `master` per chip**, in its own worktree.
  Never commit to `master` directly; the coordinator fast-forwards it.
- **A distinct ADR number** per concurrent chip (invariant 3).
- If your task touches the **same layer** as another running chip, go
  sequential.
- Reconcile diverged branches in a verify-and-merge sweep; don't let them
  race.

## Discipline

- Commit style (an imperative subject, **no Co-Authored-By**, the message
  from a file with `git commit -F`) and the rest of the conventions:
  [CLAUDE.md](../CLAUDE.md) and [CONTRIBUTING.md](../CONTRIBUTING.md).
- If a precondition is unmet (no live app or login to drive, a decision only
  the owner can make), **stop and report**: do not fabricate data or guess.
  An honest handoff beats a confident wrong.
