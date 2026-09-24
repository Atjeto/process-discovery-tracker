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
cd e2e && node run-all.js                                 # the seven smokes, the real viewer
```

If any goes red, you broke something: fix it or revert. Never commit red,
never delete a guard to make it pass. CI (`pytest.yml`, `js.yml`, `e2e.yml`)
runs the same on `windows-latest`; check `gh run list --branch master` after
every push.

## Hard invariants, and the guard that fails for each

1. **The process map is one connected graph.** The map the Map level draws
   from the runs' steps has one component, one entry step and one final
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
   As-Is or To-Be map is a one-way copy the analysis never touches; the
   comparison with a saved process is a visible line with *Stop comparing*.
   *Guards:* `e2e/session-smoke.js` ("a Start marker inserted ... shows at
   once as pending", "the step-level BPMN it was forked from is untouched
   (one-way leaf)"), `e2e/runs-smoke.js` (Re-analyze keeps the confirmed and
   edited steps; Stop comparing), the pytest survival tests above.
6. **One rule, two languages.** The value-free labels, the system names and
   the run differences are one rule set in `shared/`, read by Python and by
   the viewer; the step flow's edges (contract C17: the live map and the
   step BPMN) are one rule written in both, pinned by one golden. *Guards:*
   the shared goldens (`process-label-golden.json`,
   `screen-label-golden.json`, `run-differences-golden.json`,
   `flow-links-golden.json`) pinned from both sides
   (`test_process_label.py`, `test_screen_label.py`,
   `test_run_differences_golden.py`, `test_flow_links_golden.py`,
   `test_app_names.py`; `process-map-levels.test.js`,
   `run-differences.test.js`, `system-names.test.js`).
7. **User-facing copy is plain business English, without dashes.** No
   internal vocabulary in rendered strings (the banned list and its
   replacements are in [DESIGN-SYSTEM.md](architecture/DESIGN-SYSTEM.md), UI
   copy style guide) and no em or en dash. *Guard:*
   `viewer/ui-copy-guard.test.js` (the viewer and the capture windows; runs
   in `cd viewer && node --test`).
8. **Verify UI in the real viewer, not only in unit tests.** Green units
   are not enough: that is this project's most recurring failure. Drive the
   viewer (below), screenshot, read the PNGs back.

## How to drive the viewer (entirely in-repo)

A fresh chip, even in a clean worktree, needs nothing outside the repo:
`e2e/` bundles `playwright-core` and drives the viewer's own Electron
(`npm install` in `viewer/` and `e2e/` once). The seven smokes are worked
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
     developer's saved names, saved processes, recent list or layout; the
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

A human can instead run `npm start` in `viewer/` (Ctrl+R reloads the
renderer).

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
  (Open project...) and the recent projects
  `#recent-menu-content .recent-menu-item[data-folder]`.
- Levels: `.view-mode-btn[data-level="overview"|"flow"|"steps"|"map"]`
  (the Timeline is `flow`); each shows `#session-layout-<level>`. The
  Overview is the default on load.
- Status line `#session-pills`: while the pipeline runs `#run-status` and
  `#btn-cancel-normalize`; else `#btn-apply-marker-edits` when marker
  changes wait.
- The save state `#save-state` (`role="status"`, focusable):
  `data-state="saved"|"saving"|"failed"`, its text *Saved*, *Saving...* or
  *Not saved*, the time, the folder or the reason in its `title`.
- Export: `#btn-session-export-menu` opens `#session-export-popup`:
  `#btn-session-pdd`, `#btn-session-map-svg`, `#btn-session-step-bpmn`,
  `#btn-session-zip` (Whole project (.zip); it reads "Making the zip..."
  and the Export button carries `aria-busy="true"` while the zip is made).
  Every export then shows its file in Explorer (step 3 above).
- `#btn-help` (below), `#btn-theme-toggle`.

**Shell:** the empty state `#session-empty` (`#btn-open-session-hero`,
`#recent-list-session li[data-folder]`, `#recent-clear-all`); the loaded
session `#session-loaded`; `#annotations-error-banner` (an unreadable
`annotations.json`); the analysis log `#log-host` (`#log-failure`,
`#normalize-log`), shown only after a failed run; `#toast`.

**Overview** (`#overview-content`, `views/overview-view.js`):
- Before the first analysis: `#ov-waiting` (`data-run` = the run state).
- The Checklist `#ov-next` (`data-next` = the next stage; stages
  `.ov-next-stage[data-stage="runs"|"pattern"|"review"|"document"|"export"]`,
  `.done` when done) and its one button `#btn-ov-next` (`data-next-act`).
- The project line `#ov-summary`: `[data-summary="runs"|"steps"|"video"|"transcript"]`,
  `#btn-attach-video`, `#btn-attach-transcript`, `#btn-remove-transcript`,
  the marker fixes `.summary-fix[data-fix]`.
- The document `#ov-doc` (a `<details>`): the fields `[data-doc="title"|"purpose"|"scope"|"trigger"|"result"|"contacts"|"business_rules"|"exceptions"|"improvement"|"notes"]`
  (saved on change), who fills it `#ov-doc-who`, `#ov-doc-status` (the
  count, and the empty fields by name); the attachments `#ov-attach`
  (`#btn-ov-attach`, `.att-row[data-att-id]` with `.att-label-input` and
  `[data-att-act="open"|"remove"]`); the transcript `#ov-tr` (`#ov-tr-list`,
  `.tr-add-to[data-seg]` opens `#ov-tr-add-menu [data-doc-target]`).
- Observations `#ov-observations details[data-module="retyped"|"time"]`,
  who fills them `#ov-observations .ov-block-who`, the tables `table.ov-time`
  (headers Average time, Happened in).

**Timeline** (`#session-layout-flow`; [VIEWER-TIMELINE.md](architecture/VIEWER-TIMELINE.md)):
- Header: `#timeline-summary`, the Transaction select `#case-scope-select`,
  `#btn-add-step` (only with a video), `#btn-lanes` opening `#lanes-popup`
  (`input[data-lane="idle"|"screenshots"|"cases"|"steps"|"transcript"|"notes"]`),
  `#btn-zoom-out`, `#btn-zoom-reset`, `#btn-zoom-in`.
- The timeline `#timeline` inside `#timeline-scroll`; `#timeline-minimap`
  (only while zoomed); the legend `#timeline-legend` (`#legend-apps`).
- Lanes: `.tl-case-band` (runs), `.tl-activity` (`.tl-act-app` names the
  system), `.tl-idle`, `.tl-marker.tl-marker-pending`, the transcript
  `.tl-tr-block[data-seg]` and its label `.tl-tr-label` (`.tl-tr-sync`,
  `.tl-tr-replace`, `.tl-tr-remove`), notes `.tl-note[data-note-id]`,
  screenshots `.tl-screenshot`, steps `.tl-step-band[data-step-id]`, the
  playhead `#tl-playhead`. A blank project shows `#tl-empty` with
  `#btn-tl-attach-video`.
- Menus: every timeline right-click menu is `#tl-ctx-menu` (items by their
  text: "Start a transaction here…", "End the transaction here", "Add note
  here…", "Jump to step here"; on a step band "Open in Steps"). A Shift-drag
  range shows `#tl-selection-stats` (`#tl-selection-case`,
  `#tl-selection-exclude`, `#tl-selection-clear`).
- Video: `#video`, `#no-video` with `#btn-link-recording` (Attach video),
  `#btn-sync-video` (only with a video), the sync card `#video-sync-card`
  (`.vs-mark`, `.vs-cancel`; the transcript's is `#transcript-sync-card`),
  `#btn-video-expand`, `#btn-video-fullscreen`.
- Side panel: `.anno-tab[data-anno="screens"|"markers"]`; `#screenshots-grid`,
  `#btn-open-gallery` (the gallery `#screenshot-gallery`); `#markers-list
  .marker-row` with `[data-act="adjust"|"delete"]` (double-click a Start to
  rename it).
- Raw events: `.event-table-host` (a `<details>`, shown on the Timeline
  only), `#event-table`, `#event-filter`.

**Steps** (`#session-layout-steps`, `views/steps-view.js`):
- Toolbar: `#btn-add-manual-step`, `#btn-delete-selected-steps` and
  `#btn-merge-selected` (shown with two or more ticked rows), `#steps-summary`,
  `#btn-ignored-apps` (the dialog: `#ia-list`, `#ia-save`, `#ia-cancel`),
  `#btn-remembered-names` (the dialog `#remembered-names-dialog`,
  `[data-act="rename-name"|"forget-name"|"close"]`).
- The list's title `#runs-pane-count` and the line under it that says what
  a transaction is, `#runs-pane-note`.
- The transactions `#step-list .run-group[data-case-id]`: the head
  `.run-row` (a click opens the transaction; a right-click opens
  `#run-ctx-menu`: "Use as reference transaction" on another transaction,
  the probe line `[data-act="copy-probe"]` on the confirmed reference
  transaction); `.run-pattern-badge` (Reference),
  `.run-status`; `.run-actions [data-act="confirm-run"|"reopen-run"|"save-process"]`;
  `.run-diffs li[data-kind]`; `.run-names-note`; `.run-show-hidden`. The
  comparison with a saved process: `.runs-compare [data-act="stop-comparing"|"forget-process"]`.
- The step rows `.step-row[data-step-id]` (double-click renames; right-click
  opens `#step-ctx-menu`).
- The step pane `#step-detail` (focus it before Ctrl+V): `.step-fact`,
  `#step-name` (Enter or leaving it saves), `#step-system` (with
  `#step-system-list`), `#step-desc` (leaving it saves), `#step-said`,
  the Flow line `#step-flow` (contract C17: `#step-flow-line`,
  `#btn-flow-only-when`, `#btn-flow-go-to`; the condition `#step-only-when`
  with `#btn-flow-remove-condition`; the links `.flow-links
  .flow-link[data-i]` (`data-i="new"` for the row being added), each with
  `.flow-link-text`, the dropdown `select.flow-link-to`
  (`#flow-link-to-<i>`, its options the transaction's steps and `end`),
  `input.flow-link-when` (`#flow-link-when-<i>`) and `.flow-link-remove`),
  `#flag-waste`, `#btn-step-watch` (only with a video), `#btn-step-hide`;
  `#step-shots-sect` (`#btn-step-add-shot` opens `#shot-src-menu
  [data-src="video_frame"|"paste"|"file"]`; `.step-shot-card[data-ref][data-kind]`
  with `[data-shot-act="pdd"|"remove"]`, and `[data-shot-act="unhide"]`);
  `#step-notes-sect` (`#btn-step-add-note`, `.step-note [data-note-act="edit"|"delete"]`);
  `#step-atts-sect` (`#btn-step-attach`, `[data-att-act]`); under
  `.step-detail-more` (a `<details>`): `#btn-step-jump`, `#btn-step-split`,
  `#btn-step-merge`, `#btn-step-merge-selected`, `#btn-step-delete` (added
  steps only).

**The step panel** (`#step-panel`, `views/step-panel.js`; hidden until a
door opens it): `#sp-name`, `#sp-about` (`.sp-system`, the flow line
`#sp-flow` when one is set, `.sp-count`; `.sp-missing` alone for an As-Is
task no step stands for), `#sp-video`, `#sp-body .sp-occ[data-step-id]`
(`.sp-play`, `.sp-at`, `.sp-shot`), the foot `#btn-sp-steps` or
`#btn-sp-timeline`, `#btn-sp-close`.

**Map** (`#session-layout-map`):
- The map host `#session-map-dfg-host`; its cytoscape instance is
  `host.__cy`, the edge tip `.dfg-edge-tip`; `#btn-session-map-zoom-fit`
  (it fits the As-Is map while that shows). The Start and End circles are
  nodes with `data("kind") === "event"` and `role` `start-event` or
  `end-event` (their ids start with the character `\u0001`, so no step
  name takes them); a box is any other node. An edge carries `observed`
  (false for a path set in Steps that no transaction took: dashed),
  `label` (the condition as drawn, cut short) and `fullLabel`. While the
  map cannot be drawn the host holds the message, with
  `[data-map-cta="mark-runs"]` when no transaction is marked.
- The chosen As-Is map first: `#session-map-asis` (`#map-asis-title`,
  `#btn-map-asis-edit`, `#btn-map-show-runs`) and `#btn-map-show-asis` to
  come back to it. The map itself is `#map-asis-canvas`, a bpmn-js
  navigated viewer (`host.__bpmnViewer`; shapes
  `.djs-element[data-element-id]`, the ones a click opens marked
  `.pdt-link`, the legend `TextAnnotation_legend` marked `.pdt-inert`); a
  note opens the popover `#map-asis-note` (`.map-asis-pop-text`,
  `.map-asis-pop-close`).
- The edit act `#btn-fork-refmap`; `#btn-toggle-refmaps` (`#refmap-count`)
  shows `#refmap-panel`: `#refmap-list .refmap-row` with
  `[data-rm-act="edit"|"dup"|"refork"|"del"]` and, under a copy the
  process map changed after, `.refmap-row-note` (what Copy again gives);
  or `#refmap-empty`.
- The editor overlay `#refmap-editor-overlay`: `#refmap-editor-name`,
  `#refmap-editor-pdd` (None, As-Is map, To-Be map), `#refmap-editor-host`
  (bpmn-js shapes `.djs-element[data-element-id]`),
  `#btn-refmap-editor-close`.

**Help** `#help-modal`: `.help-nav-item[data-section="start"|"stepsphases"|"markers"|"capture"|"shortcuts"|"trouble"]`,
`.help-section[data-section]`, `#btn-help-reanalyze` (Troubleshooting),
`#help-version`, `#btn-help-close`.

**Dialogs:** a prompt is `.modal-backdrop.modal-prompt` (`.modal-input`,
`.modal-ok`, `.modal-cancel`); a confirmation `.modal-backdrop.modal-confirm`
(`.modal-ok`, `.modal-cancel`). The playback bar is `#playback-bar`
(`#pb-play`, `#pb-scrub`).

**Gone with the product edition** (a script that still looks one up must
fail): the tab row and the Compare, Template and App Library views; the More
menu; the command palette; the Analyze button; the Phases and Analysis
levels; the map's notation tabs, level select, rare-path slider and Expert
drawer; the data posture and Copy for LLM; the Flow Notes tab; the
shortcuts overlay. Replaced since: the As-Is picture `#map-asis-img` (now
the linked `#map-asis-canvas`) and `dfg-viewer.js` `exportSvg` (Export's
map image draws the step BPMN); *New from a video* and *New without a
recording* in the Open menu are the New menu's two items.

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
