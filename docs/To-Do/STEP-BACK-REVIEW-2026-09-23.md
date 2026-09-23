# Step back: what the app produces, and in whose words (2026-09-23)

> **Status:** lane LUX-2, read-only, both phases done. Phase 1 (the PDD, the capture app,
> the vocabulary) read the code at `210ddf8`; phase 2 (the viewer, walked as both roles) ran
> the real viewer at `bdda909` (LUX-A and LUX-B merged). Nothing in the app was changed.
> **Yardstick (owner, 2026-09-23):** every element either gives **M**eaningful info (the
> reader understands it and it bears on their task), **V**aluable info (it changes what the
> analyst writes, decides or asks the SME), **C**ontrol (it lets the user do something they
> need), or **is a F**eature of the path. "None" means it fails all four and goes.
> **Owner context added during the run:** the users are process managers who already know
> BPM, so outputs must be practical, in their words, with no method notes; the outputs should
> be able to replace what the team builds by hand today (ADONIS maps and process documents),
> as a question of focus, not of matching a template yet; and the capability is the point:
> a process manager and a developer who receives the session folder can go from the map and
> the steps back to the video, the transcript and the screenshots.

**In short.**

* The PDD opens with two pages of recording statistics; its reader reaches the purpose on
  page 3. Cut section 1 (keep the re-keyed data as a requirement), give every step its
  system, its time and a way back into the recording, and make the map readable on paper.
* The map files are valid BPMN 2.0 with layout, but each task carries its name only, and the
  map image prints its labels at about 3 pt.
* The session folder does not fully travel (F1, F3): an attached video is lost when the
  folder moves, and names on runs left unconfirmed come back as drafts on another machine.
  With every run confirmed, the developer's PDD was identical to the process manager's.
* The viewer's path works end to end, but the navigation the owner calls the core value
  stops at the map: a map box shows two counts and leads nowhere. Give it the steps behind
  it, their video moments, screenshots and what was said; put the video beside the steps.
* Two containers go: the "⋯ More" menu (each item moves to where it is used) and the
  "Analyze session" button (analysis runs by itself; one "apply marker changes" act stays).
* The SME's app is a developer's dashboard: make it a small recording bar with one way to
  start, and an end screen that says where the folder is. Its consent text promises card
  numbers are redacted; they are not (F2).
* One word per thing: recording, video, run, step, timeline, As-Is map; retire case, fork,
  reference map, pattern run, polling, interactions.

**How it was checked.** Temp copies of the demo `sess-2026-0514-0900` (4 runs, 30 drafted
steps), analyzed and exported with the bundled Python the way the viewer does:
**drafted** (no analyst work), **worked** (the pattern run confirmed, its 7 steps given plain
names, 3 step descriptions, 1 waste flag, 6 document fields written, the saved names passed
to the pipeline as the viewer passes them) and **one run** (the demo cut after run 1, same
work). The worked copy was also exported through the real viewer on a throwaway profile (map
forked and chosen as the As-Is map) to get the embedded map image. Each document was dumped in body
order, counted, and rendered page by page through Word. The capture app was launched on a
throwaway profile with recording from this machine switched off; notifications were
intercepted and recorded; the running state and the end summary were shown with a synthetic
status, so no real window or screen was read. Vocabulary: the string literals of
`viewer/index.html` and the viewer views, the capture windows and `capture/*.js`, and the
PDD text. Evidence: the session scratchpad, `step-back\` (listed at the end).

## 1. The PDD

**Measured.** The worked PDD is **10 pages** in Word, **1,513 words**, 6 numbered sections,
20 subsections, 12 tables, 3 screenshots (one in section 1, two in the steps; 4 images with
the map). The reader reaches Purpose on **page 3**: section 1 (338 words of recording
statistics) fills most of pages 1 and 2. About **35%** of
the words are method notes, recording statistics or notes about how the document was made.
The drafted PDD has 1,349 words and 9 "[To be completed: ...]" gaps; the worked one still has
4 gaps that no field in the app can fill. All 12 tables print without borders (python-docx's
default style). The demo's screenshots are 1x1 pixel placeholders, which print as blank
squares (about 2 of the 10 pages); screenshot legibility could not be judged.

### 1.1 Section by section (worked copy; drafted and one-run differences noted)

| Section | What it says | Verdict | Reason |
|---|---|---|---|
| Title | "Order intake: customer order to SAP sales order", subtitle "Process Definition Document" | KEEP | M |
| 1, header line | "Captured 2026-05-14 · 155 events (117 interactions) · 5m 42s span · 5 apps in the foreground top-5" | CUT | None: counts of the recording, not of the process |
| 1, "What the recording measured" | 7 cells: Active time 3m 01s, Idle time 0s, Top app "Google Chrome (browser) (40%)", App switches 16, Longest stretch in one app 20s, Values re-typed across apps 1, Repeated step sequences 4 | CUT | None: totals over four runs; 4.4 holds the one time the reader uses; "4 repeated sequences" restates that the SME repeated the process on purpose |
| 1, finding 1 | "Google Chrome (browser) accounts for 40% of measured foreground time (1m 13s of 3m 01s)." | CUT | None: it names the browser, not the system (Salesforce), and a share of foreground time changes nothing anyone builds; time per step answers "where the time goes" (missing item 2) |
| 1, finding 2 | "Focus moved between apps 16 times; the mean unbroken stretch in one app was 11s, the longest 20s." | CUT | None: a process that crosses four systems switches by design; the map shows the hand-offs |
| 1, finding 3 | "1 value was typed into more than one app; for example, "SKU-4471" was entered in Google Chrome (browser), Notepad, SAP GUI (10 times in total)." | MOVE to 4.6, per field | V: re-keying is the integration requirement. Said per field it becomes one: "Product code (Salesforce) is typed again as Material number (SAP) in every run" |
| 1, evidence and method lines | "Evidence: foreground ms 1m 13s · share 40% · active ms 3m 01s", "mean dwell ms 11s", "Evidence: rekey count 1", and one method sentence under each finding | CUT | None: internal key names; notes the reader will not act on |
| 1, evidence picture | a screenshot under the Chrome finding, captioned "★ screenshots/shot_04.png" | CUT | None: a file path under a picture of a statistic |
| 1, "Run-by-run analysis" | "4 runs were marked during the recording; 100% of the recorded actions fall inside a run.", the mean, fastest and slowest run, "The runs followed 3 different step sequences; the most common one was followed 2 times." | CUT | Repeats 4.4 and 6.1; "step sequences" counts variants the way a mining tool does |
| 1, "To say more" | "No idle time was measured: ..." and "Saying how much of the time added value needs an analyst to judge each step type first (Analysis → Waste by step); until then the memo makes no efficiency claim." | CUT | None for the reader: the analyst's to-do list, naming a screen and a document that no longer exist. One run: "recording one more run ... would show how long each run takes" is wrong (4.4 shows it) |
| 1, closing note | "Every number above was measured from the recording; the sentences are templated. The sections below document the process in full." | CUT | None |
| 2 Document control | Process, Engagement "demo-order-processing", Source recording "sess-2026-0514-0900", Recorded by "demo-worker", Captured, Runs recorded 4, Document generated, Version Draft | KEEP, trim | M. "Source recording" is the developer's way back into the folder: call it "Session folder". "Engagement" is the capture's project code: only when set. "Recorded by" prints the Windows login: print the SME's name. Add "Video: attached / none" |
| 3.1 Purpose, 3.2 Scope | the analyst's fields | KEEP | M, V |
| 3.3 Key contacts | a table "demo-worker, Process operator (recorded), Not recorded" above the analyst's field | KEEP the field, CUT the table | The table repeats the field with a login id and a "Not recorded" |
| 4.1 Overview | "This process was recorded on 2026-05-14 by demo-worker: 4 runs, in 5 applications (...)."; "Each run took between 40s and 53s of elapsed time (mean 46s); section 4.4 has the timings of every run."; "Steps: 30 in total (7 edited by the analyst, 23 drafted and not yet confirmed)."; "[To be completed: a short business description ...]" | KEEP sentence 1, CUT the rest | M for the first. The second repeats 4.4. The step count adds up every run (30 for a 7-step process) and prints authoring state. The gap has no field and Purpose already covers it |
| 4.2 Applications used | Application, "Interactions recorded" (47, 35, 20, 12, 3), "Role in process" (empty), "The role each application plays is to be completed by the analyst." | REWORK, absorb 5.3 | The reader needs the systems (Salesforce, not "Google Chrome (browser)"), the screens, the steps and the time per run in each. Click counts are not information; the empty column cannot be filled in the app |
| 4.3 As-is process map | the map image, captioned "The As-is process map, as exported from the viewer." (from the command line: "The process map is available in the viewer; the rendered diagram is not embedded in this document.") | KEEP, REWORK the image | F, M, but at 6 in wide the 4026x360 px image prints task labels at about 3 pt, and the loop and skip lines run through task boxes. The caption is a method note. One run: the viewer locks the map below 2 runs until LUX-B lands AD-18, so no image |
| 4.4 Measured timings | per-run table (Run, Steps, Active time, Elapsed time (wall clock)), a definition note, "Active time over 4 runs: mean 45s, minimum 40s, maximum 53s." and its Elapsed twin | KEEP the table, CUT the two lines | V: time per run is the business-case input. The two lines restate four rows |
| 4.5 Detailed process steps | "The steps below are those of Run 1: Order #10900, the pattern run: the analyst chose it as the pattern."; "All 7 steps of this run are confirmed by the analyst."; per step: name, the analyst's description, "Fields entered in this run:" with values, screenshot, "Flagged as waste." | KEEP (the core), CUT the two lines, ADD context | V, M: what a developer builds from. But a renamed step no longer says its system or screen ("Look up the customer" does not say Salesforce; the draft "va01: Check document" did), there is no time per step, and steps 2 and 5 print as bare headings |
| 4.6 Input data | 18 rows: Field, Step, Example value | KEEP as the one data table | V for integration work, but 17 of its 18 rows repeat 4.5's field tables word for word. Add system and screen, mark re-keyed fields; let 4.5 list field names only |
| 5.1 In scope, 5.2 Out of scope | two gaps | MERGE into one field | V (the recommendation), but no field exists, so every PDD ships with both gaps |
| 5.3 Automation candidates | "A candidate is a whole sequence of steps: an unbroken stretch of work in one application within one run, repeated in the recording. ..." and a table (Step sequence, Application, Times run, Total time, Average per run) | MERGE the times into 4.2, CUT the definition and the verdict | In a recording made of deliberate repeats every stretch repeats, so the "candidates" are the process cut by application. "Average per run" is per repetition (SAP: "Times run" 5 in 4 runs). One run: "No sequence of steps was repeated in this recording, so no candidate was identified from it." |
| 5.4 Proposed to-be process | image, "Analyst-authored proposed future-state process: drawn by hand, NOT mined from the recorded events." | KEEP, plain caption | F, V. "Proposed To-Be process, drawn by the analyst." says it |
| 6.1 Differences between runs | an intro sentence; "Extra step: ... (after Create the sales order in SAP)."; "Skipped: Send the order confirmation (step 7 of the pattern run)."; "No differences from the pattern run: Run 4: Order #10903." | KEEP, REWORK | V: the variations are what a PDD must describe. The variant step keeps its machine name (the Notepad step is named after its window, "Internal mappings.txt"); the line never carries the reason. Print the step's description and "in 1 of 4 runs"; drop the intro |
| 6.2 Business rules and exceptions | the analyst's two fields | KEEP | V |
| 6.3 Rework | "Run 2: Order #10901: Enter the sales order in SAP (2 times); Create the sales order in SAP (2 times)." | MERGE into 6.1 | V, but a repeat is one more kind of variation: one list |
| 6.4 Application errors | a gap | MERGE into the Exceptions field | No field exists |
| 7 Notes | only when written | KEEP | M |
| Footer | "Generated by the Process Discovery Viewer on 2026-09-23." | CUT | Repeats Document control |

### 1.2 What the reader needs that is missing

The reader is an automation or app-development lead who has to build or buy something.

1. **The system and screen of every step.** The recorder knows both (`grain_keys.app` and
   `screen`); renaming a step removes them from the document.
2. **Time per step, and in how many runs the step happened.** `stats.json` `step_stats` holds
   it and the PDD prints none of it. The step durations also count only from the first to the
   last action of a step, so run 1's steps add up to 34 s of its 43 s; measured from the end
   of the previous step, the steps would add up to the run.
3. **A way back into the recording.** One short line per step, "Run 1 at 0:19" (and the
   video time when a video is attached), plus the session folder name at the top, lets a
   developer who has the folder jump from the document to that moment, its screenshots and
   the transcript, without making the document heavier.
4. **Trigger and result** as named fields. The map's events are named "start" and "end".
5. **The reason for each variation**, next to the difference in 6.1.
6. **Volume**: how often the process runs, as the SME states it. The first number an
   automation lead asks for; its place (document or QB) is Q1.
7. **Readable output**: tables with a grid, and a map that fits a page.

**Found on the way (defects, not subtraction):**

* **F1, the names do not travel with the session** (the same class as AD-23's video path). A
  name given in the pattern run reaches the drafted steps of runs 2 to N in
  `annotations.json`, but every Analyze and every PDD export drafts those steps again, and
  only the analyst's own `pdt-library/remembered-names.json`, outside the session folder,
  brings the names back. Exported through the viewer on a throwaway profile, the same worked
  session printed drafted names in 5.3, 6.1 and 6.3, and its counts changed ("Repeated step
  sequences" 4 to 2; "3 different step sequences" to 4; the Outlook row left 5.3). A
  developer who exports or re-analyzes the folder, or the analyst on a second PC, gets a
  different document (and, with AD-22's automatic analysis, a different Steps list on open).
  The automation grouping keys on step names rather than `draft_key`, which is why the counts
  move. Phase 2 narrowed it: confirming a run makes its names the analyst's, so after the
  process manager confirmed all four runs the developer's export was identical to the
  process manager's (section 4.6). The defect remains for any run left unconfirmed.
* **F2, the consent text promises what the recorder does not do**: "Sensitive field values
  (passwords, card numbers, and similar) are redacted automatically." Only fields that
  Windows flags as password fields are redacted (`UiaSubscriber.cs`, `IsPassword`); D7 cut
  the rest of the masking.

### 1.3 Sentences that are analytics, jargon, or measurements the reader cannot act on

* **Analytics:** the header line; the 7-cell strip; findings 1 and 2; "4 runs were marked
  during the recording; 100% of the recorded actions fall inside a run."; "The runs followed
  3 different step sequences; the most common one was followed 2 times."; the two
  mean/minimum/maximum lines of 4.4; the "Interactions recorded" column; "Steps: 30 in total
  (7 edited by the analyst, 23 drafted and not yet confirmed)."
* **Jargon:** "foreground ms", "mean dwell ms", "rekey count", "★ screenshots/shot_04.png",
  "the pattern run: the analyst chose it as the pattern", "(step 7 of the pattern run)",
  "wall clock", "an unbroken stretch of work in one application within one run", "Analysis →
  Waste by step", "the memo", "the sentences are templated", "NOT mined from the recorded
  events", "as exported from the viewer".
* **Method notes:** "Time the app spent as the front window; ...", "A switch is counted each
  time a different app comes to the front; ...", "Counted when exactly the same typed text
  appears in two or more apps; ...", "Each repetition is timed from its first to its last
  recorded action; ...", "Each other run is compared with the pattern run ..., step by step.
  Only the differences that occurred are listed; ...", and on one run "Comparing runs (how
  long each run takes, the steps each run followed) needs at least 2 runs, so no comparison
  is reported."

**Tone.** The sentences are plain and the numbers are stated without hedging, which is right.
What is wrong is where the voice points: the document narrates its own making ("confirmed by
the analyst", "the analyst chose it", "to be completed by the analyst", nine times in all) and
defends its method ("measured from the recording; the sentences are templated") instead of
describing the process. Honest gaps ("[To be completed: ...]", "Not recorded") are right when
the analyst can close them in the app; four of them cannot be closed. "As-is" and "to-be" are
cased differently from the viewer's "As-Is" and "To-Be".

**A reader's order** would be: document control, purpose and scope (trigger, result),
the map, the steps (with system, time and the way back), variations with their reasons and
the rules, the data (re-keyed fields marked), time per run, improvement and automation scope
with the To-Be map, notes.

### 1.4 Could these outputs replace what the team builds by hand?

A question of focus, not of matching a template. Rows marked (team) depend on facts the owner
has not given yet (see the last section).

| Output | What it carries today | What a process manager still redoes by hand |
|---|---|---|
| PDD (.docx) | Title, purpose, scope, contacts, rules, exceptions (analyst fields); steps with fields, values and screenshots; per-run times; variations | The system per step, the map (unreadable in print), table formatting, the 4 gaps the app cannot fill; any Word edit is lost on re-export (R5); the team's headings (team) |
| Step BPMN, `process_map_step.bpmn` | Valid BPMN 2.0 with diagram interchange: 1 process, 8 tasks, 4 exclusive gateways, start and end events, 15 flows; every node has a shape and every flow an edge; no dangling references | Tasks carry a **name only**: no documentation, lanes, systems, times, data objects or conditions. Events are named "start" and "end", gateways and branches are unnamed, edges are straight two-point lines (the loop back and the skip cross task boxes), all on one long row. Lanes (roles or systems) and activity attributes (team) |
| As-Is and To-Be copies (`derived_maps/*.bpmn`) | At fork time a byte-identical copy of the step BPMN; then whatever is drawn in the editor | The same as above unless drawn by hand |
| Map image in the PDD | 4026x360 px (11 to 1), labels at about 3 pt at page width | Redrawn, or read on screen only |

Cheap steps that move the map toward hand-over: write each step's description into the
task's documentation; name the start and end events from Trigger and Result; label branches
"1 of 4 runs"; lay the map out to fit a page (wrapped rows or top to bottom) with routed
edges. Lanes wait for the team's convention.

## 2. The capture app (the SME's seat)

The SME is not technical and often records during a call while talking. Reviewed from the
code and 12 screenshots (the running state and the end summary with a synthetic status).
Not observable here: the native tray menu itself (read from `main.js` `buildMenu`) and a real
Teams screen share (judged from the window's size and level).

| Item | What the SME sees or does | Verdict | Reason |
|---|---|---|---|
| Tray status line and tooltip | idle: "Idle", "click to start a session" (a left click opens the menu); running: the exe name, "run open", "OBS", "idle", "recorder DEAD/OFF/SILENT" | REWORD | M only when plain: "Not recording", "Recording: Run 2", a problem in words |
| "Start capture session" (tray, idle) | starts a recording with **no run** open | REWORK: "Start recording" starts Run 1 | C. The key already does both; today the two ways to start differ |
| "Start next run" (Ctrl+Shift+S), "End run (Run 2)" (Ctrl+Shift+E), "Start a named run" (only when task shortcuts exist), "Manual screenshot" (Ctrl+Shift+P) | the run controls | KEEP | C, F |
| "Pause polling" / "Resume polling"; "End capture session" | pause and stop | KEEP, rename "Pause recording", "Stop recording" | C. "Polling" is a developer word |
| "Session setup...", "Run readiness check...", "Settings...", "Profile...", "Storage" (Recent sessions with Open in viewer, Reveal in folder, Delete; Open sessions folder; "On disk: N / size"; Prune sessions older than 30, 90, 365 days) | the analyst's and IT's controls, at the SME's top level | MOVE into one "Setup (analyst)" submenu; keep "Open recordings folder" at the top | C for the analyst, none for the SME. "Open in viewer" on the SME's laptop (no viewer there) opens a dialog asking to "Set PDT_VIEWER_EXE": CUT |
| "Live status" (Show Live Session window, Show hotkey overlay) | two views of the same state | MERGE: "Show recording bar" | C |
| "Help" (How to use..., Show welcome screen, "Per-session YAML: defaults (set PDT_CONFIG to override)") | | KEEP Help, CUT the YAML line | M |
| Live Session window, size and level | 460x720 dark panel, always on top at the screen-saver level | REWORK into a compact bar, full panel on demand | During a call it covers about a third of a laptop screen and shows in a full-screen share |
| Header | dot, "Idle / Tracking / Recording / Paused" ("Tracking" when OBS is not connected, "Recording" when it is), "recorder on" pill, timer | KEEP dot, one word "Recording", timer; pill only on a problem | M |
| Line under the header | the exe name and the window title (in the synthetic run "saplogon.exe" and "Create Sales Order: Initial Screen") | CUT | None; exe names, and window titles show in a screen share |
| Guidance line | "Recording: press Ctrl+Shift+S at the start of each run." | KEEP | M, C: the one instruction |
| "Start capture session" button (idle) | big green button; the guidance line above it says the key starts "recording and your first run" | REWORK: starts Run 1 | C. Today a click gives a recording with no run, the analyst's costliest repair |
| "Current run" and the counters | "Run 2"; EVENTS 412, RUNS 2, SHOTS 9, INTERACTIONS 238 | MERGE the run into the header, CUT the counters | None except the run |
| Run buttons, named runs, Pause, Screenshot | | KEEP | C |
| "Recent events" feed | focus_changed, activity, invoked, value_changed, screenshot file paths; the event name overflows into the value column | CUT | None: developer diagnostics |
| "End session" and its inline confirm ("Keep recording" / "End session") | | KEEP as "Stop recording" | C |
| End summary | "Session complete", Runs recorded, Duration, Interactions, Screenshots, "Name this session (optional)", Done | KEEP runs, duration, name; CUT interactions; ADD "Show the folder", "Send this folder to the analyst", a warning when no run was marked | F: the hand-off is the SME's last act and today it lives in the tray under Storage |
| Welcome (first launch, 147 words) | "Capture · Mine · Synthesize", "This is the worker-side capture app", "For guided walkthroughs (record + name + close in one panel), open the Live session window.", primary button "Set up your profile", an em dash (`&mdash;`) | REWRITE in three lines with the keys; primary "Start recording" | M |
| Consent (off by default; per session or once) | the text of F2 | KEEP, FIX the text | Truth |
| Profile, Session setup ("Takes effect at the next app launch."), Settings (hotkey "Record" buttons, OBS WebSocket URL, password, scene, JPEG quality, display, storage GB, auto-stop) | setup forms | MOVE to setup; rename the hotkey "Record" buttons "Change" | C for the analyst; "Record" next to a hotkey reads as "start recording" |
| Help window (1,568 words) | "Polls the foreground window every 5 seconds and writes a per-session JSONL", OBS WebSocket steps, `PDT_DEBUG`, `boot.log`, `config.yaml`, active-win, PM4Py and Graphviz, "Full design doc: process_discovery_tracker_design.md in the repo root" | REPLACE with one screen (the keys, what is recorded, how to stop, where the folder is); move the rest to `docs/architecture/CAPTURE.md` | M |
| Hotkey overlay (corner card, off by default) | the three keys | MERGE into the compact bar | M |
| Readiness dialog | "[ok] ...", "++ full / + good / ~ thin / X blocked", "conf 0.xx" | KEEP in setup | V for the analyst before the first recording |
| Alarms | "Recording may have stopped", "Interaction recorder stopped...", screenshots failing, write errors, dropped clicks, hotkey reassigned or conflicting, "Consent was declined." | KEEP; say "clicks and typing" for "interaction events" | C: each one asks for an action |
| App not recorded | browser: "... ask IT to enable the AccessibilityModeEnabled policy ..."; other apps: "may be running as administrator or may not expose UI Automation" | KEEP one plain line ("Clicks in Chrome are not being recorded; keep going and tell the analyst") | M; the IT fix belongs in the readiness check |
| Noise | "Check the recording setup: Engagement ID is still the default" (fires on **every** start with the default config, seen in this run); "Recording without OBS video" (tells the SME to install OBS Studio; SME laptops are locked down); "OBS not reachable at ws://127.0.0.1:4455"; "Preparing interaction recorder" ("Unpacking the recorder sidecar on first launch"); "Interaction recorder ready."; "Session storage is getting large" (names a "Prune old sessions" tool the tray calls "Prune sessions older than...") | CUT (the storage warning moves to setup) | None |
| Global keys | Ctrl+Shift+S, E, P, registered from app launch, not only while recording | KEEP; watch in P5 | Ctrl+Shift+S is Save As in some editors (Notepad among them), and here it starts a recording whenever the tray app runs |

**The three changes that would help the SME most**

1. **A compact recording bar for calls.** "Recording · Run 2 · 14:06 · Next run
   (Ctrl+Shift+S) · Stop", small and on top; the counters, the event feed, the exe and title
   line and the recorder pill go; a problem shows as one line on the bar. (M, C)
2. **One way to start.** "Start recording" in the window, the tray or the key starts Run 1;
   a recording without a run stops being a state the SME can reach. (C)
3. **End with the hand-off, and nothing else to read.** The summary says "Saved: 3 runs,
   21:40" with "Show the folder" and "Send this folder to the analyst" (and a warning when no
   run was marked); setup moves under "Setup (analyst)"; the noise toasts go; Help becomes one
   screen. (F, M)

## 3. The glossary

Where: **V** viewer (index.html and the views), **P** PDD, **C** capture app. The viewer
strings were read at `210ddf8`, before the LUX-B merge that was in progress while this was
written; LUX-B already changes a few of them (for example "Insert case from selection" now
reads "Insert run from selection"); 4.9 applies the glossary to the strings as they stand
at `bdda909`. The words must also work for a developer who was not on the call.

| Concept | Today's words, where | A BA says it? | Proposed | Why |
|---|---|---|---|---|
| The whole recorded thing | "session" (V: "Open session folder...", "Analyze session"; C: "Start capture session", "End session", "Session complete", "Session setup"), "recording" (V: "the recording in one line"; C: the "Recording" state; P: "Source recording", "This process was recorded") | "recording", "session" both | **recording**; the folder is the "recording folder" | The SME records and the developer receives a recording. In C "session" names three things: a recording, a setup form and a summary |
| The video | "Attach video..." (V More), "Link recording…" and "No recording linked" (V Flow), "Teams recording" (V tooltips), "OBS video", "screen recording" (C) | yes | **video** | One name, two meanings today: "recording" is the whole thing and the video |
| One pass through the process | "run" (V, P, C); "case" (V: "Case lanes", "Insert case from selection", "No case at the current playhead.", "The cases, steps and map use them after the session is analyzed.", the marker hint "applies to the cases") | "case" or "instance"; "run" is plain | **run** | Already on every surface including the SME's; retire "case" |
| The run confirmed first | "pattern run", "Pattern", "Use as pattern" (V: Help, the What is left line, Steps); "the pattern run: the analyst chose it as the pattern", "(step 7 of the pattern run)" (P) | no | **reference run** | Says what it is for (the others are compared with it) to a developer who was not on the call. Only once the map type "Reference" is gone (LUX-B plans it); otherwise "main run" |
| Unit of work | "step" (V, P); "task" in the BPMN file | yes ("step", "activity") | **step** | Keep |
| Step states | "Draft", "Confirmed", "Edited", "Added", "Hidden" (V); "step suggestions" (V Ignored apps tooltip), "Auto-detected: Drafted from 4 interactions ...; ended at the commit "Search"." (V step reason), "drop", "dropped drafts" (V probe line); "drafted and not yet confirmed", "confirmed by the analyst" (P) | yes for the five | the **five chip words** in V; the draft's reason kept in plain words ("Ends at Search", AD-23); none in P but one status line | Retire the extra names for the same states ("step suggestions", "drop", "commit"); the reader does not need authoring state |
| Start and end of a run | C: "Start next run", "End run"; V: "start marker", "End marker", "Markers" tab, "Marker bars" lane, "Insert Start marker here…"; also "Note markers" (a different thing: note pins); P 4.4: "from the run's start marker to its end marker" | "start", "end" | **run start**, **run end** | The SME and the analyst name the same mark differently, and "marker" also names note pins |
| Running the pipeline | "Analyze session" (V, tooltip "Build the timeline, classify activities, compute statistics, and discover a process map."), "Analyze to apply N marker changes", "Re-analyzes the session", "analysis log" | no | automatic (AD-22); where a button remains, **Update steps and map** | The tooltip is process-mining language; "analysis" also names the findings |
| Findings and their detail | "Findings: measured from the recording; review before sharing", "Evidence", "Show the evidence behind this finding" (V); "1. Findings", "Evidence: foreground ms ..." (P) | "observations", "pain points" | **observations** (only the ones kept); **details** for the evidence | "Findings" and "evidence" frame an audit; the reader is not auditing |
| Where time goes | "Time sinks" and "Where the time goes" (V, two names), "Top app" (P) | "time-consuming steps" | **Where the time goes**, per step and per application | One name; "time sink" is jargon |
| Switching apps | "Fragmented attention" (V), "App switches", "Longest stretch in one app" (P) | no | cut | An attention metric; no one decides anything from it |
| Data typed twice | "Re-typed values" (V), "Values re-typed across apps", "rekey count" (P) | "re-keying", "double entry" | **re-keyed data** | The BA term, and it states an integration requirement |
| Lean time split | "value-add", "business-required", "waste", "measured · not judged", "Business-required minutes (per instance)" (V); "Value-add share" (P, only when judged); "Flagged as waste." (P) | yes (VA, BVA, NVA) | keep **waste** as the step flag; cut the value-add and business-required editor | Known words, but the editor is a per-step-type ask whose one output is a percentage no one acts on |
| Automation candidates | "Automation candidates", "A candidate is a step sequence done at least twice." (V); "5.3 Automation candidates" and its definition (P) | "automation candidate", "opportunity" | **time per application** (fact) and the analyst's **automation scope** (judgment) | The machine "candidate" is the process cut by application; the recommendation is the analyst's |
| How runs differ | "differences", "Extra step", "Skipped", "Different order" (V, P 6.1), "Rework" (P 6.3), "different step sequences" (P 1) | "variants", "variations", "rework" | **variations** (extra, skipped, different order, repeated) | One list, one word |
| The map | "Map" level, "Process map", "Process map (image)", "Process map (BPMN)" (V); "4.3 As-is process map" (P); the fork's default name "Step Process diagram, reference 1" | yes | **process map**, **As-Is map**, **To-Be map** | Keep; retire "Step Process diagram"; one casing "As-Is", "To-Be" in V and P |
| Making the editable map | "⑂ Fork map", "Re-fork", "Reference maps", "Reference copy: decoupled from analysis", "mined map", "Decoupled from analysis: re-analyze never changes it (ADR-0019)." (V: the Map, the gallery, the editor, Help, the What is left line) | no | **Edit as As-Is map**, **Make a To-Be copy**, "edited maps" | "Fork", "mined", "decoupled" and an ADR number are developer words |
| The timeline level | "Flow" (level button, "Flow shortcuts") | "flow" means the process flow | **Timeline** | A false friend for a process manager: the level holds the video, screenshots and runs, not the flow |
| Text printed with a step | "Description" (V step pane); Help: "add a note where a step needs one", "A step's note is printed with it in the PDD"; the "Notes" tab (timed notes, never printed); the document's "Notes" (P 7) | yes | **step description**; **notes** only for the document's notes | "Note" names three things today, one of which never reaches the PDD |
| Names reused next time | "Remembered names...", the "remembered" tag (tooltip "Named from a name you gave before"), "Names are remembered" (V) | no | **saved names** (and F1: saved in the session too) | On a developer's machine the tooltip is wrong: they gave no name. "Saved" says where the name came from |
| Steps reused next time | "Save as this process", "Saved processes", "Stop comparing", "Compared with saved process" (V) | "template" | **Save as template**, "Compare with template" | "Save as this process" is not a sentence a process manager says |
| Apps left out | "Ignored apps...", "leave out of step suggestions", exe names in the dialog (V) | "excluded" | **Excluded apps**, readable names | Minor |
| The person recording | "worker", "operator" (C: "worker-side capture app"; P: "Process operator (recorded)"), "SME" (V Help), "Recorded by demo-worker" (P), "User ID" (C Profile) | "SME" | **SME** in V and P; "you" in C | The plan's word; the capture app speaks to the SME directly |
| What was captured | "events", "interactions", "activity", focus_changed, value_changed, invoked (C counters and feed); "155 events (117 interactions)", "Interactions recorded" (P) | no | **clicks and typing** where needed; no counts in P or C | Machine units |
| Time | "Active time", "Elapsed time (wall clock)", "Idle time", "span", "measured foreground time" (P); "idle" (C, V lane) | "handling time", "elapsed time", "waiting" | **handling time**, **elapsed time**, **waiting** | Process-management words; "wall clock" and "foreground" are the tool's |
| Project | "Engagement" (C setup legend, P Document control), "Project code", "Project name" (C), "Engagement ID" (C toast) | "project" | **project**, in setup only | Two names for one field, and a toast on every start |
| The document | "PDD (.docx)", "Process Definition Document" (V, P) | depends on the team | keep **PDD** until the owner names the team's document | An RPA-origin name |
| The SME's app | "Process Discovery Tracker" (C), "the capture tracker" (V empty state) | no | **Process Recorder** (suggestion) | "Tracker" reads as monitoring to an SME; low priority |

**Two names for one thing:** session and recording; run and case; run start and start
marker; time sinks and where the time goes; remembered names (a feature name) and saved
names; project code and engagement. **One name for two things:** "recording" (the whole thing
and the video), "note" (timed pins, step descriptions, document notes), "marker" (run marks
and note pins), "analysis" (the button and the findings), "Record" (start recording, and
capture a key in Settings).

## 4. The viewer (phase 2)

**How it was walked.** The real viewer at 1366x768 (the work laptop's size), on throwaway
profiles and temp copies of the demo, driven by scripts that click what a person clicks. The
video is a synthetic 5 min 50 s screen video made for this review (a canvas recorded to
.webm inside Electron; every frame shows the video clock, the session clock and the step the
recorded events say is happening), attached at offset 00:00:00. The transcript is
`e2e/fixtures/meeting-transcript.vtt`, synced on the smoke's sentence (offset about minus
30 s). **Process manager:** open the recording before any analysis, Analyze, attach the video
and the transcript, name run 1's 7 steps (3 descriptions, 1 waste flag), Watch one step,
confirm run 1, name run 2's extra step and confirm runs 2 to 4, Save as this process, open the
map and click a box, make the As-Is map, write the six document fields, export the PDD.
**Developer:** a copy of the finished folder, moved as it would be after a hand-over (the
video put inside the folder, the stored path still pointing at the process manager's disk),
opened on a fresh profile (no saved names, no saved processes), trying to understand the
process from the map. Zero page errors in both walks. Controls and words above the fold:
Overview 23 and 186, Timeline 21 and 80, step detail 23 and 193, Map 15, map editor 22,
Help 30 and 525.

### 4.1 What worked

* The path is complete: the What is left line tracked every stage, from "Confirm Run 1 in
  Steps" at the start to "Export PDD" at the end, and the PDD carried the As-Is map, the
  names, the descriptions and the document fields.
* One rename named the same drafts in the other runs at once ("Step saved. Renamed. 3
  matching drafted steps took the name too."); run 2's extra step and run 3's skipped step
  were listed where each run opens.
* Watch played exactly its step: the synthetic frame read "Run 1: Order #10900", "step: Look
  up the customer" at video 00:00:21.
* The step pane holds what a reviewer needs: a fact line with the draft's reason (duration,
  application, "4 interactions on" the screen, "ended at Search"), the description, what was
  said during the step with Add, the step's screenshots.
* "Edit as the As-Is map" analyzed first, so the copy carried the new names; one "Use in PDD
  as" control; Edit, Duplicate and Delete at hand.
* The transcript earns its place as a feature: "From the transcript (7)" under the document
  fields (speaker filter, search, "Add to"), "Said during this step" in the step pane.

### 4.2 The two containers the owner named

**"⋯ More"** holds Attach video..., Sync video... (with a video), Attach transcript... (then
Replace and Remove), Ignored apps... and Remembered names.... Verdict: **dissolve it**; each
item moves to where it is used.

| Item | Where it goes | Reason |
|---|---|---|
| Attach video... | the video band on the Timeline (already there as "Attach video...") and the Overview's recording line ("No video · Attach") | C where the video is missing |
| Sync video... | the video pane's header, beside expand and full screen, only while a video is attached | C where the video plays |
| Attach, Replace, Remove transcript | the Transcript lane label on the Timeline (it already carries "Sync...") and the recording line | C where the transcript shows |
| Ignored apps... | the Steps toolbar, as "Leave apps out..." | C where the drafts it changes are |
| Remembered names... | the Steps toolbar, as "Saved names..." | C where names are given |

Without More, the actions bar holds only the status pill and Export: fold it into the top
bar. One bar (Open, the four levels, the status, Export, Help, theme) replaces three bars
that take about 145 px of a 768 px window. [M]

**"Analyze session"** is the first act of every recording today: before it the Overview says
only "No analysis yet: click Analyze session above to compute the runs, the measured facts
and the findings this Overview shows." After it, the raw analysis log stays open at the foot
of every level for the rest of the sitting (pipeline lines such as "case quality: markers,
coverage 100%, tier2 unlocked" and full file paths), about 150 px of the Steps and Map
screens. The button's tooltip is "Build the timeline, classify activities, compute
statistics, and discover a process map."; once steps exist, a click asks "Re-analyze this
session?" and warns that it "regenerates the N auto-detected step(s) and clears the undo
history".

* **It runs by itself**: on open when there is no analysis or it came from an older version;
  after "Leave apps out" (it already does); inside Edit as the As-Is map and the PDD export
  (they already do). No run discards analyst work: confirmed, edited, added and hidden steps
  survive every analysis.
* **Meanwhile the user sees** one line in the bar, "Updating steps and map...", with Cancel;
  the page stays readable. The log opens only when an analysis fails, failure sentence first
  (the quiet mode already exists for the As-Is act).
* **One manual act stays**: applying marker changes, today's pill "Analyze to apply N marker
  changes", renamed "Apply N marker changes". It redrafts the changed runs and clears undo,
  so it stays deliberate, with its confirmation. No global Analyze button; a "Re-analyze"
  line in Help's Troubleshooting covers a stuck state.

### 4.3 Levels, bars, menus, Help

| Element | Today (`bdda909`) | Verdict | Reason |
|---|---|---|---|
| Level names | Overview, Flow, Steps, Map | KEEP three; "Flow" becomes "Timeline" | M: in BPM "flow" is the process flow; this level is the recording: timeline, video, screenshots, transcript |
| Level tooltips | "What is left to do, the recording in one line, the document sections and the findings (the default landing view)"; "Timeline of every captured event"; "Each run's drafted steps: confirm the pattern run first"; "The process map built from the runs' steps, and the editable As-Is and To-Be maps forked from it" | REWRITE: "What is left, the recording and the document"; "The recording: video, screenshots, runs and what was said"; "Each run's steps: confirm run 1, then review the others"; "The process map, and your As-Is and To-Be maps" | M |
| Open menu | "Open session folder...", recent entries named "demo-order-processing · sess-2026-0514-0900" | KEEP; name a recent entry by its document title once written | M |
| Export menu | "PDD (.docx)", "Process map (image)", "Process map (BPMN)" | KEEP | F |
| Run select on the Timeline | "Run: All runs"; a run band's right-click also offers "Scope view to this run" | KEEP the select, CUT the band item | C once |
| Lanes menu | Idle gaps (on), Marker bars (off), Screenshot dots (off), Runs (on), Per-step bands (off), Transcript (on once attached) | the steps lane ON by default, named "Steps"; CUT Marker bars | F: the steps lane is the Timeline's link to Steps (a click selects and seeks, a right-click offers "Open in Steps") and it is off; the Runs lane and the Markers tab carry the markers |
| Raw events drawer (Timeline only, closed) | "Raw events (155)": filter, 4 type boxes, rows with JSON details such as `{"kind":"session_start"}`, "jump", "+step", "+to step" | KEEP closed; rename "All recorded actions"; plain words for the detail | M for a developer checking exactly what was clicked or typed |
| Video attach | a prompt: "When did the recording start, relative to the session? Session started at 2026-05-14T09:00:00Z. Format HH:MM:SS, signed (-00:00:05 means recording started 5 sec before the session)." | REPLACE with the click-to-sync flow that exists as Sync video: click a moment in the video, then the same moment on the timeline | C: nobody knows a Teams recording's signed offset; anyone can find the moment run 1 starts |
| No-video band | "No video linked", "The timeline above is complete without one.", "Attach video..." | KEEP the link, CUT the middle sentence | M |
| In-app Help | "As-Is map. On the Map, fork the map into an editable As-Is copy..."; "Open the session folder and click Analyze session"; "attach it from the More menu" (twice); "Tick the findings the PDD should print"; "A step's note is printed with it in the PDD" (the field is "Description"); "What the step labels mean" lists five chips without saying they now show only where a row differs from its run | REWRITE those lines as the changes land | M. The other stale names on the list (Build process map, the density histogram, timestamped notes, the shortcuts overlay, the ISO time on Move) are gone from the app; they remain in `docs/FEATURES.md`, `docs/architecture/NORMALIZATION.md` and `VIEWER-TIMELINE.md` (the docs lane) |
| What is left line | six stages and one button | KEEP | The best element. Its last stage never shows done after an export; once every stage is done it can shrink to one line, so the home leads with the document (which the developer reads) |
| Summary line | "Order intake: customer order to SAP sales order · recorded by demo-worker · 5m42s · 4 runs · 30 of 30 steps confirmed" | KEEP; the SME's name instead of the Windows login; add the video and transcript state, each with Attach | M |

### 4.4 The Overview after the PDD verdicts

With PDD section 1 gone (1.1), the findings block has nothing left to choose for the
document, so the "include in PDD" ticks go (today all three are ticked by default and choose
which of the Chrome share, the 16 switches and the re-typed value the PDD prints). What stays
is one short "Observations" block whose items each print in their own PDD section:

| Today | Verdict | Printed in |
|---|---|---|
| Time sinks: "Google Chrome (browser) accounts for 40% of measured foreground time (1m 13s of 3m 01s)." | CUT | nowhere |
| Fragmented attention: "Focus moved between apps 16 times; ..." | CUT | nowhere |
| Re-typed values: "1 value was typed into more than one app; for example, "SKU-4471" was entered in ..." | KEEP as "Data typed twice", per field: "Product code (Salesforce) typed again as Material number (SAP)" | 4.6 |
| Where the time goes: "2m16s across 7 step types · most in Enter the sales order in SAP"; per step a count, a total over all runs and a dot strip; a business-required editor under each row | KEEP as time per step (average per run, "in N of M runs"); CUT the dot strip, the total over runs and the editor | 4.5 |
| Automation candidates: "Look up the customer → Open the customer record → Enter the order in Salesforce in Google Chrome (browser): ran 4 times, 1m7s in total, 16.8s on average" | MERGE into Where the time goes, as time per application | 4.2 |
| "ⓘ how this was measured"; an expanded finding ("foreground ms 1m13s · share 40% · active ms 3m1s", "★ screenshot") | CUT | none |
| Recording coverage (apps recorded with less detail) | MOVE to the summary line, as a warning when it applies | none |

The analyst's judgment (what to automate or change) goes into the new document field
"Improvement and automation scope", not into ticks on machine observations. The home becomes:
the What is left line, the recording line, the document fields with the transcript picker,
and two observations.

### 4.5 The navigation chain (AD-23)

| Link | Today | State |
|---|---|---|
| Map box to its steps | a click shows a tip, "Enter the sales order in SAP · step · entered 5× · left 5×"; a double click and a right click do nothing | dead end |
| Map box to video, screenshots, what was said | nothing | dead end |
| Steps to the step | open each run and scan its rows; no search; a step done in 4 runs is 4 rows | friction |
| Step to video | "Watch" in the row's right-click menu, or under More in the step pane; it switches the level to Flow, so the step pane disappears while the video plays: checking run 1 means one round trip per step | friction |
| Step to screenshots | shown in the step pane; only 2 of run 1's 7 steps had a screenshot in their time range | partial |
| Step to what was said | "Said during this step" in the step pane | works |
| Timeline to step | only through the Per-step bands lane (off by default) and its right-click "Open in Steps", or the timeline's right-click "Jump to step here" | hidden |
| Clocks | local time on the timeline, markers and screenshots ("11:00:19"), call time on transcript rows ("0:34"), video time in the player ("0:21") | three clocks |

For the developer, reaching the video moment of a map box took five acts (Steps, open the
run, find the row, right-click, Watch), after re-linking the video (4.6).

**The smallest form that closes the chain.** A click on a map box opens a panel beside the
map (the map stays): the step's name and description, "in 4 of 4 runs, about 8 s each", and
one row per occurrence, "Run 1 at 0:39 · ▶ · 1 screenshot · 1 sentence", where ▶ plays that
occurrence in a small video inside the panel and the row opens to its screenshots and what
was said; then "Open in Steps". The same panel serves a click on a timeline step band and a
selected row in Steps (one component, three doors), which puts the video beside the steps
where the process manager confirms run 1. One clock everywhere: the time since the
recording started ("0:39"), the same pointer the PDD prints (1.2, item 3).

### 4.6 What the developer sees differently

| # | On the developer's machine | Verdict |
|---|---|---|
| 1 | **F3, the video is gone.** annotations.json holds the process manager's absolute path, so the Timeline says "No video linked" although the video sits in the folder; re-linking asks for the offset again, always prefilled "00:00:00" (`renderer.js` `attachExternalVideo`), whatever offset was stored | FIX: store the path relative to the session folder when the video is inside it; keep the offset on re-link (AD-23 c) |
| 2 | Names: every run confirmed, so the map, the steps and the exported PDD matched the process manager's (the two PDDs' text identical line for line) | keep; F1 remains for runs left unconfirmed |
| 3 | Runs 2 to 4 show the "remembered" tag on every row, while the developer's Remembered names list is empty (the names live on the process manager's computer) | the per-row tag goes (4.7) |
| 4 | The home leads with the process manager's checklist: "What is left", all done, "Export PDD" | shrink it when done (4.3) |
| 5 | The Map leads with the map from the runs; the finished As-Is map is behind "Edited maps (1)", then Edit, inside the editor | show the chosen As-Is map first, read only, when one exists |
| 6 | Everything is editable, and an export analyzes again and writes annotations.json, stats.json and analysis.json into the received folder | a fact for the owner (last section) |
| 7 | The transcript travelled (it lives in the folder), and "Said during this step" worked as it did for the process manager | keep |

### 4.7 Other findings on the path

* **Steps.** After the 7 renames the run's chip read "Confirmed" while the orange "Confirm
  run" still showed (renamed steps already count as the analyst's), and every row carried
  "Edited". The waste flag draws a strikethrough plus a red "W", which reads as removed.
  Every row of runs 2 to 4 carries an italic "remembered" tag (7 to 10 per run). A draft's
  Description box is filled with the drafted narration ("Entered "customer@example.com" into
  To. Entered ...") that the PDD leaves out unless edited: a trap; show it as a hint.
* **The variant's reason is lost.** The description written on run 2's extra step ("Only for
  a new product code: ...") reaches no part of the PDD (checked in the export): 6.1 prints
  only "Extra step: Look up the material number (after Create the sales order in SAP)."
* **Map editor.** The tool palette covers the first task and the start event; the loop line
  runs through "Enter the sales order in SAP", as in the PDD image.
* **Timeline at 1366x768.** The video's lower part and its controls sit below the fold.

### 4.8 What the recording knows, and where it shows

The owner's question: can the viewer tell the whole story, with the data a process manager
(**PM**), an optimizer (**OPT**) and an automation developer (**DEV**) need? Below, every
kind of data the session holds, captured by the recorder (auto) or added by the analyst,
where it shows today, and whether it reaches the PDD and the BPMN. The last column names who
looks for it and cannot find it. Gaps are named, not designed.

| Data | Source | Viewer today | PDD | BPMN | Looked for, not found |
|---|---|---|---|---|---|
| Systems used | auto | timeline colours and legend ("Chrome", "notepad"), step fact line ("Google Chrome (browser)"), Leave apps out dialog (exe names) | 4.2, the browser rather than the web system; "Role in process" empty with no field | no | PM, DEV: the business system per step (Salesforce, not Chrome) and each app's role |
| Screens (window titles) | auto | step fact line; raw events | only inside drafted names, lost on rename | no | DEV: the screen or transaction per step ("va01") |
| Fields and their control types | auto | step pane, More: each action in words ("Typed ... into Quantity"; the type only as a verb); raw events | 4.5, 4.6 by field name; no type, no system | no | DEV: a data dictionary (field, type, system, screen) |
| Values typed, per run | auto | step pane, More, one run at a time; a draft's narration | run 1's values (4.5); one example per field (4.6) | no | DEV, OPT: the values of all runs side by side (Quantity 29, 9, 18, 19), the owner's reference data set; nowhere today, and no way to add one |
| Buttons that complete a step | auto | the fact line's reason ("ended at Search"); More | nowhere | no | DEV: the action that commits each step |
| Values typed again in another system | auto | Overview finding: one example value and the apps | section 1 finding | no | DEV, OPT: the field pairs ("Product code" in Salesforce, "Material number" in SAP) |
| Variations between runs | auto, from the runs | Steps ("1 difference", "Extra step: ..."), map branches | 6.1 | gateways, unnamed | PM, OPT: frequency and reason on the branch ("1 of 4 runs", why) |
| Repeated steps in a run | auto | Steps (the row twice), a loop on the map | 6.3 | a loop | OPT: how often, per run |
| Times | auto | runs list ("43.0s"), step rows, Overview "Where the time goes", arrow tooltips, idle lane | per run only (4.4) | no | OPT: time per step and its spread; the waiting between steps (outside every step today) |
| Screenshots | auto | Timeline tab and gallery, step pane | per step, only where one falls in the step's time range (2 of run 1's 7) | no | DEV: a picture of every screen used |
| Video | attached | Timeline, Watch | nothing points to it | no | DEV: each step's moment (the PDD pointer, 1.2) |
| Transcript | attached | Timeline lane, step pane, Overview picker | only sentences added to a description or field | no | PM: who said what, next to the step it explains |
| Run labels (the SME's) | auto | runs list, timeline ("Order #10900") | 4.4, 6.1 | no | OPT: the kind of case a run was (why run 2 differs) |
| Recording coverage | auto | Overview finding when it applies; identity warnings in More | section 1 caveat | no | DEV: which apps the recorder saw poorly (another integration route) |
| SME and date | auto (login) | summary line ("recorded by demo-worker") | Document control | no | PM: the SME's name and role |
| Step names | analyst | everywhere | 4.5, 4.6, 5.3, 6 | task names | |
| Step descriptions | analyst | step pane | pattern run only; a variant step's description nowhere (checked) | no | DEV, PM: each task's description in the map; the reason for each variation |
| Waste flag | analyst | step row (strikethrough and "W"), "Flagged: 1 waste" | "Flagged as waste." | no | OPT: waste on the map |
| Hidden steps | analyst | Show hidden steps | left out, counted in 4.1 | left out | |
| Confirmation | analyst | chips, What is left | counts in 4.1 and 4.5 | no | |
| Run starts, ends, labels | analyst | Markers tab, timeline | run labels | no | |
| Document fields | analyst | Overview | sections 2, 3, 6.2, 7 | no; the process has no name | PM: trigger, result, owner, volume as named fields |
| Business-required time | analyst | Overview editor | "Value-add share" when set | no | (cut, 4.4) |
| As-Is and To-Be maps | analyst | Map gallery and editor | 4.3, 5.4 as images | the copies are the BPMN | |
| Left-out apps | analyst | Leave apps out dialog | not mentioned | no | DEV: what was left out of the recording's steps |
| Saved names, templates | analyst | Steps dialogs, on the analyst's computer | no | no | DEV: they are not in the folder |

What each role cannot find today, in one line each:
* **PM:** trigger and result, the performer role per step, volume, the SME's name, each app's role.
* **OPT:** time per step with its spread, waiting between steps, how often each variation and repeat happens, waste on the map.
* **DEV:** system and screen per step, field types and identities, all runs' values as one data set, the field pairs typed twice, the completing action, the recording moment and a screenshot per step, what was left out.

### 4.9 The glossary on the viewer strings

| Today | Proposed |
|---|---|
| "Analyze session", "Analyze to apply N marker changes", "Re-analyze this session?", "the N auto-detected step(s)" | automatic; "Apply N marker changes"; "Update the drafts of the changed runs?"; "drafted steps" |
| "⋯ More" | gone |
| "Flow", "Timeline of every captured event", "Jump to in Flow" | "Timeline", "The recording: video, screenshots, runs and what was said", "Show on timeline" |
| "Align video to session", "When did the recording start, relative to the session?" | "Sync the video: click a moment in it, then the same moment on the timeline" |
| "Markers" tab, "Insert Start marker here…", "Insert End marker here", "Marker bars" | "Run starts and ends", "Start a run here…", "End the run here", lane cut |
| "Per-step bands", "Idle gaps", "Screenshot dots" | "Steps", "Idle", "Screenshots" |
| "Pattern", "Pattern run", "Use as pattern", "Confirm the pattern run first" | "Reference run", "Use as reference run", "Confirm run 1 first" |
| "remembered" (tag), "Remembered names...", "Names are remembered" | one line per run, "Names from saved names"; "Saved names..." |
| "Save as this process", "Saved processes" | "Save as template", "Templates" |
| "Ignored apps..." | "Leave apps out..." |
| "Findings: measured from the recording; review before sharing", "Time sinks", "Fragmented attention", "Re-typed values", "Evidence", "include in PDD" | "Observations", "Where the time goes", cut, "Data typed twice", cut, cut |
| "Document sections · 6 of 6 filled", "In the PDD: 7. Notes (added only when written)" | "Document · 6 of 6 written", "Printed as the last section when written" |
| "Edit a new copy", "Edited maps (1)" | "New To-Be copy", "As-Is and To-Be maps (1)" |
| step fact line "... interactions on ..., ended at Search" | "... actions on ..., ends at Search" |
| "recorded by demo-worker" | "recorded by" and the SME's name |
| "Open session folder...", "Recent sessions" | "Open recording...", "Recent recordings" |

## Consolidated change list

Four lanes that can run in parallel without touching the same files; the docs follow. Order
inside a lane is priority; brackets carry the four-part reason. Size is rough: S about a day
of one agent, M two to three, L four to six.

**Before the lanes start (coordinator, one short SCHEMA edit):** the new document keys
(`trigger`, `result`, `improvement_scope`) and the one clock (times shown and printed as
elapsed time since the recording started). **Seams between lanes:** three smokes
(`session-smoke`, `runs-smoke`, `transcript-smoke`) open "⋯ More" and click "Analyze
session" by id; V1 keeps the moved buttons' ids, changes those helper lines in all three, and
V2 rebases onto that change before touching its smokes. P's item 1 drops `pdd_findings`
from analysis.json and V1's item 3 drops the ticks that read it: merge them together. V1's
"data typed twice" per field shows what P computes; until P lands it rewords today's finding.

### Lane P: pipeline and PDD (L)

Files: `normalization/pdd_export.py`, `memo_export.py`, `step_suggest.py`, `stats_compute.py`,
`analysis_automation.py`, `bpmn_observed.py`, their tests, the golden.

1. Cut PDD section 1; the re-keyed fields move into 4.6 as "typed again in". [none for the rest; V]
2. Per step: system and screen, average time, "in N of M runs", "Run 1 at 0:19". [V, M]
3. F1: drafts also take names from the session's own analyst-named steps by `draft_key`; group repeats by `draft_key`. [V]
4. Step time measured from the end of the previous step, so the steps add up to the run. [V]
5. The map image readable on paper (wrapped or top to bottom, routed lines); tables with a grid. [F, M]
6. Print Trigger, Result and "Improvement and automation scope"; errors fold into Exceptions; no gap the app cannot close. [C]
7. 6.1 prints each variant step's description and "in N of M runs"; 6.3 merges into it. [V]
8. 4.2 "Applications and time" absorbs 5.3. [V]
9. One data table (4.6) with system, screen and re-keyed marker; 4.5 lists field names. [V]
10. Method and authoring sentences out; the glossary's words (handling time, variations, reference run); "As-Is" and "To-Be" cased once; the reader's order. [M]
11. BPMN: step descriptions as task documentation, start and end named from Trigger and Result, branches labelled "1 of 4 runs". [V]

### Lane V1: viewer shell and home (M)

Files: `viewer/index.html`, `renderer.js`, `styles.css`, `views/overview-view.js`,
`views/analysis-view.js`, `finding-cards.js`, `views/flow-view.js` (the analysis flow only),
`modals.js`; `e2e/overview-smoke.js`, `e2e/session-smoke.js`.

1. Analysis runs by itself; one status line with Cancel; the log only on failure; "Apply N marker changes" stays. [C, M]
2. "⋯ More" dissolves (4.2), including Leave apps out and Saved names in the Steps toolbar; one top bar instead of three. [C, M]
3. Overview: "Observations" (data typed twice, where the time goes) replace findings, evidence and the "include in PDD" ticks; the What is left line shrinks when done. [V, M]
4. Document fields Trigger, Result, "Improvement and automation scope". [C]
5. Video attach by click-to-sync; no typed offset. [C]
6. "Timeline" for Flow; the four tooltips; the Help lines of 4.3; the strings of 4.9 in these files, the lane names among them; the Marker bars lane item and the run band's "Scope view to this run" cut. [M, C]
7. Recent entries named by the document title; the summary line names the SME. [M]

### Lane V2: viewer navigation (L)

Files: `viewer/dfg-viewer.js`, `map-controller.js`, `refmap-ui.js`, `views/steps-view.js`,
`step-editor.js`, `runs-model.js`, `views/flow-view-timeline.js`, `views/flow-view-video.js`,
`views/flow-view-screenshots.js`, `views/flow-view-markers.js`, `views/flow-view-transcript.js`,
`transcript-model.js`, `main.js`, `session.js`, a new stylesheet for its own styles (linked in
`index.html` at merge); `e2e/runs-smoke.js`, `e2e/map-slim-smoke.js`, `e2e/transcript-smoke.js`.

1. The map box panel of 4.5, with the same panel for timeline step bands and Steps rows. [F, V: AD-23]
2. The video beside the steps: the panel's video plays a step without leaving Steps; Watch resident in the step pane. [F]
3. F3: the video path stored relative to the session folder when the video is inside it; the offset kept on re-link. [F]
4. One clock on the timeline labels, markers, screenshots, transcript rows and the step pane. [M]
5. Timeline: the steps lane on by default (its new name is V1's string). [F]
6. Map level: the chosen As-Is map first, read only, when one exists. [M, V]
7. Steps: no "Confirm run" once every step is the analyst's; waste as a tag, not a strikethrough; one saved-names line per run instead of a tag per row; the drafted narration as a hint. [M]

### Lane C: capture app (M)

Files: `capture/*.js`, `capture/ui/*`, `capture/test/*`.

1. A compact recording bar instead of the 460x720 always-on-top panel. [M, C]
2. One start: the button, the tray and the key all start the recording with Run 1. [C]
3. End summary with "Show the folder", "Send this folder to the analyst" and a no-run warning; no interactions count. [F, M]
4. F2: the consent text says what is redacted (password fields). [truth]
5. The noise toasts cut; the storage warning moves to setup. [none]
6. One "Setup (analyst)" submenu; "Open in viewer" and the YAML line cut; "Open recordings folder" at the top. [C]
7. Help on one screen; the Welcome in three lines. [M]
8. Words: "Pause recording", "Stop recording", "Recording" (never "Tracking"), "Change" for the hotkey buttons. [M]

### Gaps named, not planned (4.8; the coordinator decides)

The performer role per step; volume and frequency; all runs' values as one reference data
set, which the owner asks to import or add; field types and identities in the PDD; the
waiting between steps; waste and variation frequency drawn on the map.

### Then: docs (S)

`docs/FEATURES.md`, `docs/architecture/NORMALIZATION.md` ("Build process map"),
`VIEWER-TIMELINE.md` (the density histogram), `VIEWER.md`, `CAPTURE.md` (it receives the
capture Help's developer content), `shared/SCHEMA.md` (document keys, relative video path,
one clock). The queued L12b-2 lane can carry it.

## What should NOT change, and why

* The words **run**, **step**, **As-Is**, **To-Be**, **waste**: plain, and already shared by
  the SME, the analyst and the document.
* In the PDD: the per-run timings (the business-case input), the differences aligned by
  `draft_key` (pinned with the viewer by `shared/run-differences-golden.json`), the fields
  with example values, the step screenshots, the analyst's fields kept across exports,
  hidden steps never printed, and a failed stage saying it "could not run". BPMN 2.0 with
  diagram interchange as the map format: enrich it, do not replace it.
* In the viewer: the What is left line with its one button; Confirm run and Reopen run; the
  differences listed where a run opens; a rename carried to the same drafts; Hide and
  Unhide; undo on every edit; Edit as the As-Is map as one act that analyzes first; one "Use
  in PDD as" control; the step pane's fact line with the draft's reason (AD-23 d), its
  description, screenshots and "Said during this step"; "From the transcript" with "Add to";
  the edge tooltip in words.
* In capture: one key per run with runs that never nest, the recorder-stopped and silent
  alarms, password redaction at capture, consent off by default and configurable, nothing
  sent over a network, and the session folder as the one hand-off.

## Facts needed from the owner

1. What the team's BPMN lanes stand for (roles or systems), and which activity attributes they fill in today.
2. What the team calls its process document, and its fixed headings.
3. Whether a developer who receives the folder may change it, or should open it read only.

## Evidence

Session scratchpad `step-back\`. Phase 1: `exports\` (the three PDDs with PDFs and
`dump.txt`, `viewer\pdd-viewer-worked.docx` with the As-Is map, the map images, the forked
BPMN, page renders), `capture-shots\` (12 windows, `notifications.json`). Phase 2:
`walk\pm\` (every screen of the process manager's walk, its texts, `walk-log.json`,
`pdd-from-pm-walk.docx`), `walk\dev\` (the developer's walk, `pdd-from-dev-walk.docx`),
`walk\probe\` (the Overview below the fold), `videogen\` (`synthetic-demo.webm` and its
generator). Drivers: `drive_viewer_pdd.js`, `drive_capture.js`, `walk_lib.js`, `walk_pm.js`,
`walk_dev.js`, `walk_probe.js`; helpers `analyst_work.py`, `dump_pdd.py`, `bpmn_check.py`,
`vocab_scan.py`.
