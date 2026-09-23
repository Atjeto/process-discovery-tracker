# UI clarity audit: the light viewer, element by element (2026-09-23)

> **Status:** read-only audit, the first half of lane LUX (BA-helper cycle). Branch
> `track-audit` at master `24793a2`. Nothing in the app was changed.
> **Question (owner, 2026-09-23):** are we thinking about UI and information clutter,
> about how information is conveyed, and is every interface element necessary for the
> light version?
> **Yardstick:** the analyst path ([BA-HELPER-PLAN-2026-09-22.md](BA-HELPER-PLAN-2026-09-22.md)
> section 5) and its use gate (section 13): a surface stays only if, on a real session,
> it produces a PDD sentence, a map element, a recorded analyst decision, or an
> instruction to the SME.
> **Verdicts:** KEEP (on the path), DEMOTE (on demand: hover, a disclosure, a menu),
> MERGE (with a named element), DELETE. A few items are marked FIX: defects found on
> the way that are not subtraction but decide whether the deliverable is right.

**How it was checked.** The real viewer from this worktree, driven by Playwright on a
throwaway profile (the `e2e/throwaway-profile.js` launch pattern), against temp copies
of the demo session `sess-2026-0514-0900` (4 marked runs, 30 drafted steps), at
1366x768 (the work laptop) and 1500x950, in three states:

* **A**, unmarked: every run marker stripped from `events.jsonl`, then analyzed.
* **B**, as drafted: the demo analyzed, no analyst work.
* **C**, after work: two pattern-run steps renamed ("Look up the customer", "Open the
  customer record"), the pattern run confirmed, Title and Purpose filled, the map
  forked and chosen as the PDD's As-Is map.
* A fourth state **S** (the demo cut after its first run, a one-run recording) was
  added to check the single-run path.

Every surface was screenshotted and read back. Counts come from an in-page
measurement: only elements that are displayed, not clipped by a scrolling parent and
not inside a closed disclosure. "Controls" are buttons, links, inputs, selects and
disclosure summaries; clickable data rows and bands are counted apart as "marks".
Targeted probes checked the Case select's effect, the forked map's contents, hover
colours and every video-dependent control without a video.

**Path steps used in the tables** (plan section 5): 1 Open, 2 Attach video, 3 Confirm
run 1 (including adding a missed run marker), 4 Review runs 2 to N, 5 Check the map,
6 Finish the map, 7 Read the analysis, 8 Export (and Save as this process). "Doc" is
the What is left stage for the document fields (AD-2). "Probe" is the owner's P1
draft probe. "none" means no path step.

## 1. Summary

The five changes that would reduce clutter most on the analyst path, in order:

1. **Strip the chrome that sits on every screen.** Delete the shortcuts overlay, the
   per-level hint line, the "VIEW:" label, the Steps count badge, and the Case select
   and Scope to playhead outside Flow; show Analyze session as a secondary button once
   the session is analyzed. Today 13 to 15 of the 21 to 31 controls above the fold on
   every level are chrome (on the Map 14 of 21), the overlay covers working controls
   at 1366x768 on both Flow and Steps, and three orange buttons compete on the Steps
   screen. Effect: 11 or 12 chrome controls per level instead of 13 to 15, one orange
   button per screen (the next act), nothing covering controls, the view bar back to
   one row on Steps.
2. **Make the Overview a path page first and a report second.** Move the Document
   sections under the summary line (they start 1602 px down a 723 px window), collapse
   the Evidence block to its two takeaway lines, delete the three meta captions, the
   duplicate totals, the "To say more" box and the Automation Confirm and Dismiss
   buttons (nothing reads them). Effect: resident words from 566 to about 260, the
   only typing on the home on its first screen.
3. **Give the Steps level to the runs list.** Delete the Step timeline strip (184 px of
   unlabeled blocks that push the runs list to y=404), show a state chip only where a
   row differs from its run, trim the step detail to name, one fact line, the note the
   PDD prints (Description, now hidden under "More"), waste, Save and Hide, and move
   Ignored apps and Remembered names into More. Effect: the runs list starts about
   200 px higher; 7 to 10 fewer repeated chips per open run.
4. **Make the As-Is map one act.** Fork becomes the Map's primary button, named for the
   act, and creates a copy already chosen as the PDD's As-Is map; one role control
   replaces four (type chip, PDD chip, PDD select, editor Type select); the rare-path
   slider and the zoom readout go, zoom keeps only "fit", Raw events stays on Flow;
   the map and Fork are allowed from one run. Effect: the Map's own controls from 7 to
   3 (fit, Fork, the list of edited maps), finishing the map from four actions to two,
   and one-run sessions can reach Export PDD.
5. **Remove what does nothing without a video.** The Notes tab never reaches the PDD
   and, without a video, stamps notes with the analyst's own clock; "+ Step", Scope to
   playhead, Sync video and the video shortcuts only answer with an error toast.
   Screenshots, the review medium without a video, becomes Flow's default tab.
   Effect: Flow loses five controls that do nothing useful without a video (the Notes
   tab, its field, its Save button, + Step, Scope to playhead) in the input mode the
   plan lists first.

Two defects decide whether the deliverable is right and should ride with the first
subtraction change (section 4, F1 and F2): a fork made after renames carries the old
draft names into the PDD's As-Is image, and the "include in PDD" boxes show nothing
ticked while the PDD prints the top five findings.

## 2. Per surface

### 2.1 Global chrome: top bar, actions bar, view bar (every level)

**The ideal light screen:** one slim bar with Open (folder plus recent sessions), the
four level buttons, More, Export and Help. It never carries counts, hints, scope
pickers or a second orange button; the page below owns the next act.

**Measured at 1366x768:** top bar 45 px, actions bar 41 px, view bar 39 px (61 px on
Steps, where the level hint wraps to a second row). Controls: 13 on the Overview, 15 on
Flow and Steps (Scope to playhead and the overlay's close are added), 14 on the Map.
Resident words: about 20, plus the level hint (13 to 22). Elements repeating a fact on the
same screen: 2 (the Steps badge, the level hint).

| Element | What it tells or does | Path step | How often needed there | Repeats on the same screen | Verdict | Reason |
|---|---|---|---|---|---|---|
| `.brand` logo, "Process Discovery" | Names the app | none | never read | no | KEEP | Identity at no control cost |
| `#btn-recent-menu` "Recent ▾" | Reopens a session | 1 | once per sitting | overlaps "Open another" | MERGE with `#btn-open-session` | One "Open ▾" menu: "Open session folder…", then the recent sessions |
| Recent rows "example · sess-2026-05…" (bundled examples, `recent.js`) | Offers the product's demo sessions | none | never in real work | no | DELETE | 10 of the 11 rows on a fresh profile are product-edition demos; they bury the real session |
| `#btn-theme-toggle` ☾ | Light or dark theme | none (support) | rarely | no | KEEP | The plan keeps themes; one icon |
| `#btn-help` "?" | Opens Help | none (support) | rarely | no | KEEP | The one door to Help once the overlay goes |
| `#topbar-meta` "v1.5.0 · 9/23/2026" | Version and today's date | none | never | the date is the computer clock | DELETE the date, DEMOTE the version to Help | Today's date is not a fact about the session |
| `#btn-open-session` "Open another" | Opens a folder | 1 | once per sitting | overlaps Recent | MERGE into "Open ▾" | See Recent |
| `#btn-normalize` "Analyze session" (orange, 120x29 px) | Runs the pipeline | 1 (first time), then after marker or app changes | once, then rarely | competes with the page's own orange next act | DEMOTE to secondary style once analyzed | One orange button per screen; marker changes already get their own call to action |
| `#btn-session-more-menu` "⋯ More ▾" | Occasional actions | none (support) | rarely | no | KEEP | Becomes the home of Ignored apps and Remembered names |
| `#session-pills` "Analyze to apply N marker changes" | Call to action after marker edits | 3 | when true | no | KEEP | An instruction with one button, shown only when it applies |
| `#btn-session-export-menu` "Export ▾" | Exports | 8 | once per deliverable | the What is left last act (two doors, one verb) | KEEP | |
| `.view-mode-label` "VIEW:" | Labels the level buttons | none | never | the buttons label themselves | DELETE | |
| `.view-mode-btn[data-level]` Overview, Flow, Steps, Map | Switch level | all | constantly | no | KEEP, FIX hover (3.7) | The spine of the app |
| `#steps-badge` "30" | Total steps in the session | none | never acted on | the Overview summary ("0 of 30 steps confirmed"), the run rows (7, 10, 6, 7) | DELETE | A count nobody acts on, said three ways |
| `.view-mode-desc` ("facts & findings", "raw event timeline"…) | Hidden by CSS, still in the DOM | none | never | no | DELETE | Dead markup |
| `#case-scope-select` "Case: All cases" | Dims the other runs on the Flow timeline | 3 (Flow only) | occasionally on Flow | no | DELETE outside Flow; on Flow rename "Run" | Probe: scoping to a run left the Map identical (8 nodes, 8 edges), Steps still listed 4 runs, the Overview line was unchanged. In state A its only option reads "(no cases yet: click Analyze session first)" on an analyzed session |
| `#btn-scope-to-playhead` "Scope to playhead" | Picks the run under the video playhead | 2 | rarely | no | DELETE | Without a video: toast "No video to anchor to playhead."; with one, the run bands and the Case select do the same in one click |
| `#view-mode-help` hint and its "×" | One sentence per level | none | first use only | Overview: the What is left line and section titles; Steps: the run guide; Map: the Fork tooltip | DELETE | Wraps to a second row on Steps at 1366; its "×" has no way back |

### 2.2 Menus: Export, More, Recent

**The ideal light screen:** Export lists the PDD and the finished As-Is map (image and
BPMN). More holds the occasional verbs: Attach video, Sync video (only when a video
exists), Ignored apps, Remembered names. Open lists the folder picker and real recent
sessions.

**Measured at 1366x768:** Export adds 3 controls and 9 words, More 3 controls and 7
words, Recent 11 controls (1 real session and 10 bundled examples) and 35 words. No
repeated facts (the PDD item is a second door to the What is left last act).

| Element | What it tells or does | Path step | How often needed there | Repeats on the same screen | Verdict | Reason |
|---|---|---|---|---|---|---|
| `#btn-session-pdd` "PDD (.docx)" | Writes the PDD | 8 | once per deliverable | the What is left last act | KEEP | The deliverable |
| `#btn-session-map-svg` "Map as SVG" | Saves the map drawn on the Map level | 6 | rarely | no | KEEP, re-point | It saves the mined map (`exportMapSvg` reads `#session-map-dfg-host`), not the As-Is copy the analyst finished; the plan names map exports as the editor's output |
| `#btn-session-step-bpmn` "Step map as BPMN" | Saves `process_map_step.bpmn` | 6 | rarely | names the same map differently | KEEP, re-point, rename | Same as above; "step map" is the retired level vocabulary |
| `#btn-attach-video` "Attach video..." | Links a video | 2 | once | Flow's "Link recording…" (same verb, other name) | KEEP | Path step 2 |
| `#btn-sync-video` "Sync video..." | Aligns the video | 2 | once per video | no | DEMOTE: only when a video is attached | Without a video: toast "No video is linked to this session." |
| `#cb-mine` "Build process map" (ticked) | Writes the step BPMN at Analyze | none | never | no | DELETE (always build) | Unticking it only breaks Fork ("Nothing to fork yet… Run Analyze with Build process map checked"), and with it the As-Is map and the PDD image |
| Recent: current session row | Reopens it | 1 | once | no | KEEP | |
| Recent: example rows | see 2.1 | none | never | no | DELETE | |

### 2.3 Overview (the home), including the Document panel

**The ideal light screen:** the What is left line with its one button, the recording in
one line, then the Document fields (the only typing the home asks for), then the
findings to tick for the PDD, with ticks that match what the PDD will print, then the
evidence collapsed to one takeaway line per module. Everything else one click away.

**Measured at 1366x768 (state B):** 29 controls above the fold (13 chrome, 16 page),
250 words above the fold. The whole surface holds 43 controls and 566 words: chrome and level hint 38,
What is left 17, summary 12, findings 184, evidence 248, To say more 56, the closed
Document panel 9. The Document panel starts 1602 px down the scroll (the window shows
723 px). State A: 27 controls above the fold, 593 words. State C: the same as B.
Elements repeating a fact on the same screen: 6 above the fold (Steps badge, "4 runs"
next to the done Runs stage, the level hint, three "measured" chips under a
"measured" title); 18 on the whole surface (add a fourth chip, the "3 findings" count,
7 duplicate totals in the time rows, the To say more judgment item, the "already in
the findings" sentence, the Evidence title). Facts that disagree on this screen: 4
(section 3.1).

| Element | What it tells or does | Path step | How often needed there | Repeats on the same screen | Verdict | Reason |
|---|---|---|---|---|---|---|
| `#ov-next` "What is left": `.ov-next-stage` ×6 and `#btn-ov-next` | The path's stages done or not, and one button for the next act ("Confirm Run 1 in Steps", "Review Run 2 in Steps", "Mark runs in Flow") | all | every visit | no | KEEP | Leads with the next act: the best element in the app. The stages look like tabs but are plain list items; keep them plain |
| `.ov-next-say` (state A) "This recording has no runs marked. In Flow, add a start marker…" | Instruction | 3 | when unmarked | the same sentence on Steps and the Map, on purpose | KEEP | An instruction with its verb |
| `#ov-summary .ov-summary-line` "demo-order-processing · recorded by demo-worker · 5m42s · 4 runs · 0 of 30 steps confirmed" | The recording in one line | 1 | every visit | "4 runs" restates the Runs stage; "30" the Steps badge | KEEP | Once the badge goes this is the only home of the counts; show the document Title here once written (P3) |
| Findings title "Findings: measured from the recording; review before sharing" | Section title | 7 | every visit | no | KEEP | |
| `.ov-finding-group-head` titles (Time sinks, Fragmented attention, Repeated sequences, Re-typed values) | Group the findings | 7 | every visit | no | KEEP | |
| `.ov-group-count` "3 findings" | Counts the cards under it | none | never | the three cards | DELETE | Says what the eye sees |
| `.ov-finding-method-btn` "ⓘ how this was measured" (4) | Method note on demand | 7 | rarely | no | KEEP | Already on demand |
| `.ov-finding-tier` chips "measured", "case-based" (every card) | Honesty tier per card | none | never acted on | "measured" restates the section title | DELETE | With runs marked both tiers are measured facts. In state A (0 runs) three "case-based" cards still show with an include box, yet the PDD leaves run-based findings out when no runs are marked (`memo_export._select_findings`): gate those cards instead |
| `.ov-finding-claim` | The finding | 7 | every visit | no | KEEP | A candidate PDD sentence |
| `.ov-finding-expand` ▸ and `.ov-finding-body` (evidence line, screenshot chip, Show on timeline) | Evidence on demand | 7 | rarely | no | KEEP | Already on demand |
| `.ov-memo-check` "include in PDD" (one per card) | Chooses what PDD section 1 prints | 8 | once per deliverable | no | KEEP, FIX the state (F2) | Every box shows unticked, yet with nothing ticked the PDD prints the top five findings (`memo_export.DEFAULT_TOP_FINDINGS`) |
| "Repeated sequences" group (3 cards) | Step sequences done 4 or 5 times | 7 | every visit | the same three sequences are 3 of the 4 Automation candidates, which prints a sentence to say so | MERGE into Automation candidates | One home for one fact. In a BA session the runs are deliberate repeats, so "repeated 4 times" restates the recording protocol; the time per repeat is the news, and the candidate card carries it |
| Evidence title "Evidence: the measured detail behind the findings" | Section title | 7 | rarely | restates the findings title | DEMOTE: the whole block collapsed by default, each module's takeaway line visible | 248 of the 566 words; no PDD sentence unless business-required time is judged |
| `.analysis-caption` "Estimates: these figures come from rules of thumb set before any real recording data existed…" | Caveat | none | never | no | DELETE | It sits above measured durations and calls them estimates; the caveat belongs inside the judgment editor only |
| "Where the time goes" summary line "2m16s across 8 step types · most in va01: Check document" | Takeaway | 7 | every visit | no | KEEP (the line) | The takeaway is the news |
| Caption "Summary statistics (mean/stdev/percentiles) render once a step type reaches 10 instances…" | Explains a hidden statistic | none | never | no | DELETE | A session of 3 to 5 runs does not reach it (the demo's largest step type has 5); it explains a gate that never opens |
| `.ts-axis` "PER-INSTANCE DURATION 0s … 10.0s", `.ts-row` (name, `.ts-n` "5×", `.ts-total` "40.0s", dots) | Time per step type across runs | 7 | rarely | no | KEEP inside the collapsed module | |
| `.ts-judgment` "40.0s measured · not judged" (7 rows) | Repeats the row total; says "not judged" | none | never | `.ts-total` on the same row; the To say more item | DELETE until a judgment exists | 7 duplicate totals and 7 "not judged" labels; show "20s business-required" once set |
| `.ts-judge-expand` ▸ and `.ts-judge-body` (value-add, business-required, waste legend; "adjust") | Records business-required time per step type | 7 | rarely | no | KEEP (on demand, as now) | A recorded decision that reaches PDD 4.4 ("Value-add share…") |
| Row "va01: Create sales order 5× 0ms" | A zero-length step as a time row | none | never | no | DELETE rows with no measured time (P3) | Nothing to read |
| "Automation candidates" summary "4 candidates ranked by automation priority" | Takeaway | 7 | every visit | disagrees with the one card shown | KEEP (the one home after the merge) | Plan: kept as confirmed useful |
| Automation caption "A candidate is a contiguous run of work in one application within one case… a robot clicks one button… frequency × mean time × automatable share." | Definition | none | once | no | DELETE (one plain sentence behind an ⓘ at most) | "case" and "robot" (the plan wants tool-neutral wording); "automatable share" is one constant for every candidate, so it ranks nothing; the PDD orders by total time |
| `.auto-card[data-rank]` rank prefix "4" | Rank | none | never | no | DELETE | An unexplained number; the only card shown is rank 4 |
| `.auto-decision` Confirm, Dismiss | Writes `automation_confirmed` | none | never | no | DELETE | Nothing downstream reads it: `pdd_export.py` 5.3 lists every repeated candidate by total time. If the owner wants PDD 5.1 "In scope" filled from the app, wire Confirm there in the same change instead |
| `.auto-in-findings` "3 more candidates are already in the findings above…" | Explains the duplicate | none | never | exists because of the duplicate home | DELETE with the merge | |
| `.ov-saymore` "To say more, this analysis needs" (idle; judge each step type; in state S, one run) | Missing inputs | none | never | the judgment item restates the 7 "not judged" labels | DELETE | Idle: nothing to do about it. Judgment: an optional per item ask. One run: an SME instruction with wrong reasoning ("would show how long each run takes": the one run's time is on its run row). A corrected one-run sentence belongs in What is left |
| `#ov-doc` "Document sections · 0 of 6 filled", 7 fields (Title, Purpose, Scope, Key contacts, Business rules, Exceptions, Notes) | The PDD's document-level fields | Doc | once per session | the Document stage of What is left | KEEP, MOVE under the summary line | The only typing the home asks for sits 1602 px down; the What is left button scrolls there, a reader of the page never does |
| `.ov-doc-where` "In the PDD: 3.1 Purpose" (7 lines) | Where each field lands | Doc | once | no | DEMOTE into the field's tooltip or placeholder (P3) | Seven resident lines for a fact read once |
| `details.event-table-host` "RAW EVENTS (155)" | Raw event table | none | never here | no | DELETE on the Overview (Flow only) | The machine layer at the foot of the home |

### 2.4 Flow (timeline, side tabs, lanes menu, timeline menu, Raw events drawer)

**The ideal light screen:** the timeline with runs and activity, the video (or a one
line "no video" band with Attach video), and one side panel that opens on Screenshots
(the review medium without a video) next to Markers (run repair). No control that
needs a video when there is none, no notes that go nowhere, nothing floating over
controls.

**Measured at 1366x768 (state B):** Notes tab 27 controls above the fold (15 chrome,
12 page) and 21 clickable bands, 126 words (the page does not scroll); Markers tab 25
controls and 25 marks, 162 words. Without a video, three controls answer only with an
error toast (+ Step, Scope to playhead, More's Sync video) and two advertised keys do
nothing (Space, the arrow keys). The shortcuts overlay
(1172 to 1352 px across, 624 to 754 px down) covers the note field, Save note and the
Raw events summary; on the Markers tab it covers the first marker row's Move and
Delete buttons (probe: both at y=650 under the overlay). Elements repeating a fact:
3 on the Notes tab (the minimap at zoom 1, the header span, the overlay's zoom row), 5
on the Markers tab (add the marker labels that repeat the run band labels and the "8
markers" count).

| Element | What it tells or does | Path step | How often needed there | Repeats on the same screen | Verdict | Reason |
|---|---|---|---|---|---|---|
| `.timeline-header` "Timeline", `#timeline-summary` "11:00:00 AM → 11:05:42 AM · 5m42s" | Title and span | 3 | every visit | the axis shows the span | KEEP | The duration is the one new number |
| `#btn-add-step` "+ Step" | Adds a step at the video playhead | 3 (with video) | occasionally | no | DELETE while no video is attached | Without a video: "No video timing: can't place a step at the playhead"; Steps "+ Add step" works without one |
| `#btn-lanes` "Lanes ▾" and 8 lane boxes | Show or hide lanes | 3 | rarely | no | KEEP the menu; DELETE Activity density, Window-title strip, Note markers; rename Case lanes "Runs" (P3) | The deleted lanes are discovery-era or tied to the Notes tab |
| `#btn-zoom-out`, `#btn-zoom-reset` ⊙, `#btn-zoom-in` | Zoom | 3 | sometimes | the overlay's "+ −" row | KEEP | |
| `#timeline-minimap` | Whole-session strip | 3 | only when zoomed in | at zoom 1 it is the timeline again | DEMOTE: only when zoomed in (P3) | |
| `#timeline` run bands ("Order #10900"…) and activity bands | The recording | 3 | every visit | no | KEEP | |
| `#timeline-legend` app colours | Legend | 3 | first visits | no | KEEP | |
| `#timeline-legend` "marker", "screenshot" | Legend for lanes that are off by default | none | never | no | DELETE unless their lane is on (P3) | Explains marks the screen does not draw |
| `#video-pane.no-recording` band: "No recording linked · The timeline below is complete without one. · Link recording…" | No video; offers to attach one | 2 | once | "Link recording…" is More's "Attach video..." | KEEP, fix words (P3) | The timeline is above the band, not below; one name for the verb |
| Notes tab (default): `.anno-tab[data-anno="notes"]`, `#annotations-list`, `#anno-note`, `#btn-save-note` "Save note at current time" | Pins a note to the playback time | none | never | no | DELETE, with the Note markers lane | Notes never reach the PDD (`pdd_export.py` reads only `document.notes`). Without a video the note is stamped with the analyst's clock: the probe stored 2026-09-23T10:56:14Z and listed it at 10:56:14, a time the recording (11:00 to 11:05 local) does not contain. The notes that do reach the PDD are the step Description and the document Notes field. (This departs from plan 8.3, which keeps Flow notes; the fact that would reverse it: the owner wants a list of timed notes printed in the PDD) |
| Screenshots tab: `.anno-tab[data-anno="screens"]`, `#btn-open-gallery` "Open gallery...", `#screenshots-grid` | Screenshots in time order | 3 (recorder only) | every run 1 check without video | no | KEEP, make it the default tab, FIX the time base (F4) | Thumbnails are stamped "09:00:19" (UTC) while the timeline and markers say "11:00:19" (local) |
| Markers tab `.anno-tab[data-anno="markers"]` | Run markers | 3 | when a marker is missed | no | KEEP | |
| `#marker-filter-text` "Filter markers...", `#marker-filter-meta` "8 markers" | Filter | none | never | the count restates the rows | DELETE (P3) | Two markers per run; nothing to filter |
| Marker hint "Double-click a Start to rename it… applies to the cases when you analyze the session." | How to edit markers | 3 | first use | no | DEMOTE to a tooltip, in run words (P3) | 40 resident words |
| Marker rows: time, ▶ or ■, label, `.depth` "L0", `[data-act="adjust"]` ◷, `[data-act="delete"]` ✕ | Marker list with Move and Delete | 3 | when repairing | the run band labels | KEEP rows, Move, Delete; DELETE "L0"; "End" instead of "(unlabeled)" (P3) | "L0" is nesting depth (the plan drops nesting); every End row says "(unlabeled)"; without a video ◷ asks for "New time (ISO 8601)" |
| `#shortcuts-overlay` "Flow shortcuts" (Space, ← →, + −, Shift-drag) and its "×" | Shortcut card | none | never after day one | Help's Shortcuts, the zoom buttons | DELETE | Covers controls at 1366; two of its four keys need a video; its "×" tooltip sends the analyst to "Help → Show shortcuts overlay", which does not exist |
| `#tl-ctx-menu` "Insert Start marker here…", "Insert End marker here", "Jump to step here" | Right-click menu | 3 | when marking | no | KEEP | The mark-runs verb |
| `details.event-table-host` Raw events (filter, 4 type boxes, per row "jump", "+step", "+to step") | Machine layer | none | rarely | no | DEMOTE: Flow only, closed | Opened, it adds 454 controls and about 2000 words to the level |

### 2.5 Steps (toolbar, runs list, step detail pane, step menu, dialogs)

**The ideal light screen:** the runs list starts right under a short toolbar; the
pattern run is open with Confirm run as the only orange button; a row shows the name,
the duration and a chip only when it differs from its run; the right pane shows the
selected step's name, one fact line, the note the PDD prints, the waste flag, Save and
Hide, with split, merge, jump and the interactions one click away; other runs open on
their differences.

**Measured at 1366x768:** state B arrival 25 controls above the fold (15 chrome, 10
page) and 7 step rows, 220 words; with a step selected 30 controls, 194 words; state C
arrival 31 controls, 190 words. Dialogs: Remembered names 2 controls when empty (6
with two names), Ignored apps 8, the Save as this process prompt 4. The view bar is 61 px (two rows), the toolbar ends at
y=204, the Step timeline strip takes y=212 to 396 (184 px), and the runs pane starts
at y=404. The shortcuts overlay covers the step detail's "More" summary and, once it is
open, the Description field. Elements repeating a fact: 10 on arrival (the level hint
and the run guide give the same instruction; the Steps badge; 7 "Draft" chips under a
"Draft" run; "⌨ shortcuts" next to the overlay), 12 with a step selected (the run
guide gives way to the Duration, Run and App / Screen tiles, all three repeats).

| Element | What it tells or does | Path step | How often needed there | Repeats on the same screen | Verdict | Reason |
|---|---|---|---|---|---|---|
| `#btn-add-manual-step` "+ Add step" (orange) | Adds a step the draft missed | 3 | occasionally | no | KEEP, DEMOTE to secondary style | Three orange buttons on one screen (Analyze session, + Add step, Confirm run); the next act is Confirm run |
| `#btn-ignored-apps` "Ignored apps..." | Leaves an app out of drafting | 3 | once per process | no | DEMOTE into More | Its dialog lists exe names ("chrome.exe", "SAPGUI.exe") and says "step suggestions" |
| `#btn-remembered-names` "Remembered names..." | Rename or forget a remembered name | 3 | rarely | no | DEMOTE into More | The plan asks for "a small list", not a resident button |
| `#steps-summary` "Flagged: N waste" | Waste count | 7 | rarely | no | KEEP | Empty unless something is flagged |
| `.kbd-hint` "⌨ shortcuts" (hover only) | Shortcut list in a tooltip | none | never | the overlay and Help | DELETE | A third home for one list |
| `.link-help` "What is a step?" | Opens Help at Steps | 3 | first use | no | KEEP | One quiet link |
| `.mini-timeline-pane` "Step timeline", span, zoom ×3, unlabeled blocks | Steps as blocks in time | none | rarely | the runs list (same steps); the Flow steps lane | DELETE | 184 px of unlabeled blocks push the runs list to y=404; the Flow steps lane shows steps in time |
| `.editor-pane-title` "Runs · 4" | Count | 3 | every visit | no | KEEP | |
| `.run-row`: "Run 1", `.run-label` "Order #10900", `.run-pattern-badge` "Pattern", `.run-status` "Draft", `.run-meta` "7 steps · 43.0s · 1 difference" | The run in one line | 3, 4 | every visit | no | KEEP | Leads with status and differences |
| `[data-act="confirm-run"]` "Confirm run" | Accepts the remaining drafts | 3, 4 | once per run | no | KEEP (the one orange button) | |
| `.run-fixes` "Boundary fixes so far: 0 (merge 0, split 0, add 0, drop 0)" | The live P1 probe counter | Probe | never for the deliverable | the probe line replaces it on confirm | DELETE | The owner's report needs only the final probe line; it also says "drop" where the button says "Hide" |
| `.run-probe` "Run 1: 7 drafted steps, 0 boundary fixes (…)" and `[data-act="copy-probe"]` "Copy" | The P1 probe line after confirm | Probe | once | no | KEEP until the P1 probe closes, then DELETE; say "hide", not "drop" | The instrument the owner copies for P1; it has no use after that |
| `[data-act="reopen-run"]` "Reopen run" | Inverse of Confirm run | 3 | rarely | no | KEEP | The inverse |
| `[data-act="save-process"]` "Save as this process" | Stores the confirmed pattern | 8 | once per process | no | KEEP | Prefill the name from the document Title (P3); no way to forget a saved process later (3.5) |
| `[data-act="use-pattern"]` "Use as pattern" | Picks another pattern run | 3 | rarely | no | DEMOTE into a run menu (P3) | Resident on every open run for a once-a-session choice |
| `.run-diffs` ("Extra step: … (after va01: Create sales order)", "Skipped: … (step 7 of the pattern run)") | The run's differences | 4 | every review | the run meta counts them | KEEP | Leads with the answer |
| `.run-show-hidden` "Show hidden steps (N)" | Lists hidden steps | 3 | rarely | no | KEEP | Inverse of Hide |
| `.step-row` tick box on every row | Multi-select for merge or hide | 3 | rarely | no | DEMOTE: on hover or after Ctrl+click | A per item control on every row |
| `.step-row` name, "remembered" tag, duration | The step | 3, 4 | every visit | no | KEEP | |
| `.step-row` state chip "Draft", "Confirmed", "Edited" | Step state | 3 | every visit | the run's status chip, for every row that matches it | MERGE into the run status: a chip only where the row differs (Edited, Added) | 7 to 10 repeated chips per open run; edited rows (RP-11) stand out better when only they carry a chip |
| `#step-ctx-menu` (Split at interaction…, Merge with next, Rename, Hide step, Jump to in Flow, Flag as waste) | Step verbs | 3 | when fixing | the detail pane's buttons | KEEP | The fast path for boundary fixes |
| Run guide (no step selected): "Confirm this run first… then click Confirm run." and "A merge carries…" | Instruction | 3 | first runs | the level hint | KEEP (delete the hint instead) | |
| Run guide line "Its differences from the pattern run are listed above its steps." | Points at the list | none | never | the list | DELETE (P3) | |
| `.step-stat-tiles` Duration, Start, End, App / Screen, Run | Facts about the step | 3 | rarely | Duration is the row's time; Run is the open group; App / Screen repeats the draft name's prefix | DELETE Start, End, Run; MERGE Duration and App / Screen into one line with the readable app name | Five tiles for one new fact; the tile says "chrome" where the findings say "Google Chrome (browser)" |
| `#step-name`, `#btn-step-save` "Save" | Rename | 3 | often | inline rename in the list | KEEP | |
| `#flag-waste` "Waste" | Waste flag | 3 | occasionally | no | KEEP | Reaches the PDD ("Flagged as waste."); its tooltip still promises "waste hotspots" in the cut aggregate view (P3) |
| `#btn-step-hide` "Hide step" or "Unhide" | Take a step out | 3 | occasionally | the context menu | KEEP | |
| `details.step-detail-more` "MORE" | Discloses the rest | 3 | often | no | KEEP | See Description |
| `.step-suggestion-reason` "Auto-detected: Drafted from 4 interactions on …; ended at the commit "Search"." | Why the draft ended there | none | never | no | DELETE | Internal ("commit") |
| `#step-desc` Description | The step note the PDD prints once edited (C7) | 3 | for steps that need a note | no | KEEP, MOVE out of More | Plan step 3 says "add a note"; the one note that reaches the PDD hides under a disclosure the overlay covers at 1366 |
| `.evidence` interactions list (Value entry, Action, Other) and "N screenshots" | What the step is made of | 3 | when checking a boundary | no | KEEP in More | The step's screenshots show only as a count (3.4) |
| `#btn-step-jump` "Jump to in Flow", `#btn-step-watch` "▶ Watch" (video only), `#btn-step-split` "Split", `#btn-step-merge` "Merge with next", `#btn-step-delete` (added steps only) | Step verbs | 3 | when fixing | the context menu | KEEP in More | |
| `#shortcuts-overlay` "Steps shortcuts" | Shortcut card | none | never after day one | Help, "⌨ shortcuts" | DELETE | Covers the "More" summary and the Description field at 1366 |
| `#remembered-names-dialog`: intro, rows (name, "4 steps in this session", Rename, Forget), Close | Light vocab list | 3 | rarely | no | KEEP (opened from More) | Clear, with its inverse |
| Ignored apps dialog: `#ia-list` (exe name, "N interactions"), `#ia-cancel`, `#ia-save` "Save & re-analyze" | Leave apps out | 3 | once per process | no | KEEP (opened from More), fix words (P3) | "Google Chrome", not "chrome.exe"; "drafted steps", not "step suggestions" |
| Save as this process prompt `.modal-prompt` ("Name the process", explanation, input, Cancel, Save) | Names the saved process | 8 | once per process | no | KEEP | Prefill with the document Title (P3) |

### 2.6 Map (process map, reference-map gallery, editor)

**The ideal light screen:** the process map drawn from the runs and one orange act,
"Edit as the As-Is map", which makes a copy already chosen as the PDD's As-Is map;
below it the edited maps, each with one control for its role in the PDD. It works
from one run. Marks are explained in tooltips; nothing filters or rescales a map of
3 to 5 runs.

**Measured at 1366x768:** 21 controls above the fold, 14 of them chrome (the Map's own:
7); 58 words. Gallery open (state C): 25 controls, 99 words. Editor (state C): 30
controls, 159 words. The Fork button is 83x23 px in 11 px type (`.icon-btn.xs`), the
smallest control on the screen whose next act it is, under an orange Analyze session.
Elements repeating a fact: 0 on the bare map (but the Case select and Scope to
playhead do nothing here); 4 with the gallery open in state C (the PDD role said three
times: "REFERENCE" chip, "in PDD · As-Is" chip, the PDD select; the meta line
restating the panel's hint); 2 in the editor (Type next to Use in PDD; the provenance
line restating the name).

| Element | What it tells or does | Path step | How often needed there | Repeats on the same screen | Verdict | Reason |
|---|---|---|---|---|---|---|
| Title "PROCESS MAP" | Title | 5 | every visit | no | KEEP | |
| `#session-map-zoom-pct` "95%" | Zoom level | none | never | no | DELETE | |
| `#btn-session-map-zoom-out`, `#btn-session-map-zoom-fit` "fit", `#btn-session-map-zoom-in` | Zoom | 5 | sometimes | scroll zoom (the host's tooltip says so) | KEEP "fit", DEMOTE − and + (P3) | |
| `#session-hide-rare-wrap` "All paths" and `#session-rng-rare` | Hides paths taken fewer times | none | never | no | DELETE | At 3 to 5 runs it can only hide the exception branches the PDD needs (the Notepad branch in the demo) |
| `#btn-fork-refmap` "⑂ Fork map" | Copies the map into the editor | 6 | once per session | no | KEEP; MERGE the two follow-up choices into it | Name it for the act, make it the Map's one orange button, create the copy as As-Is with "Use in PDD: As-Is" when none is chosen; today every copy starts as "Reference" and "Use in PDD: No" |
| `#btn-toggle-refmaps` "Reference maps (1)" | Shows the edited maps | 6 | once per session | no | KEEP, rename to match (P3) | |
| `#session-map-dfg-host` nodes and arrows | The map | 5 | every visit | no | KEEP | A map element |
| Arrow labels "25s", "46s", "39s" | The time from entering one step to entering the next, summed over runs | none | never read correctly | no | DEMOTE into the arrow's tooltip | Unexplained; reads as a hand-off wait although it is mostly the earlier step's own time |
| Orange border on start and end nodes | Where runs start and end | 5 | sometimes | no | KEEP | The node tooltip names the role |
| Lock message (states A and S) "The process map is not shown because it draws how the runs flow…" with "Mark runs in Flow" | Why no map | 3 | when locked | What is left, the Steps note | KEEP for no runs; DELETE the 2 run and 70% coverage condition | For one run it tells the analyst to mark more runs in a recording that has one; Fork is refused ("Nothing to fork yet…"), so the As-Is stage and the PDD map cannot be done |
| `#refmap-panel` head "Reference maps · Hand-edited, standalone copies: decoupled from analysis. Re-analyze never changes them." | Explains copies | 6 | once | the row meta, the editor badge | DEMOTE to a tooltip (P3) | |
| `#refmap-empty` "No reference maps yet. Click ⑂ Fork map…" | Empty state | 6 | once | no | KEEP | |
| `.refmap-kind-chip` "REFERENCE" | The copy's type | none | never | the PDD chip and select | MERGE into one role control | |
| `.refmap-row-name` "Step Process diagram, reference 1" | Default name | 6 | once | the meta line | KEEP the name, default to "As-Is map" | "Step Process diagram" is the retired notation and level vocabulary |
| `.refmap-pdd-chip` "in PDD · As-Is" | The PDD role | 8 | once | the PDD select beside it | MERGE | |
| `.refmap-row-meta` "forked from Step Process diagram · <date> · hand-edited, not updated by analysis" | Provenance | none | never | the panel head | DELETE except the date | |
| `[data-rm-pdd]` "PDD: As-Is map ▾" | Chooses the PDD role | 6, 8 | once | the chips | KEEP as the one role control | |
| `[data-rm-act="edit"]` Edit, `[data-rm-act="dup"]` Duplicate | Open; copy (how a To-Be starts) | 6 | sometimes | no | KEEP | |
| `[data-rm-act="del"]` Delete | Removes the copy (Ctrl+Z restores it) | 6 | rarely | no | KEEP, FIX the label (F3) | Unreadable at rest: dark orange text (rgb 160, 90, 58) on red (rgb 192, 64, 64) |
| `[data-rm-act="refork"]` Re-fork and the "source changed" chip | New copy after the map changed | 6 | after an Analyze | no | KEEP until F1 lands | |
| Editor `#refmap-editor-badge` "⑂ Reference copy: decoupled from analysis" | Honesty badge | none | never | the gallery hint | DELETE | The PDD's caption carries the honesty rule |
| Editor `#refmap-editor-name` | Name | 6 | once | no | KEEP | |
| Editor `#refmap-editor-kind` "Type: Reference, As-Is, To-Be" | Type | none | never | "Use in PDD" | MERGE into "Use in PDD" | Two selects for one concept |
| Editor `#refmap-editor-pdd` "Use in PDD" | Role | 6, 8 | once | no | KEEP | |
| Editor `#refmap-editor-prov` "Forked from Step Process diagram · <date>" | Provenance | none | never | the name | DELETE | |
| Editor `#btn-refmap-editor-close` "Close ✕", the bpmn-js palette and canvas | Edit and leave | 6 | every edit | no | KEEP | The plan's map editor |
| `#case-scope-select`, `#btn-scope-to-playhead` on the Map | Nothing here | none | never | no | DELETE (2.1) | Probe: no effect on the map |
| Raw events drawer on the Map | Machine layer | none | never here | no | DELETE on the Map | |

### 2.7 Help window (`#help-modal`)

**The ideal light screen:** it opens on the six path stages in the words the What is
left line uses, keeps the Steps section and the shortcut table, and keeps the capture
hotkeys as the one thing the analyst tells the SME. No developer instructions.

**Measured:** 7 controls (six sections and Close). Words per section: Getting started
136, Session view 510, Steps 978, Capture workflow 128, Shortcuts 206, Troubleshooting
198. The shortcut table also lives in the overlay and in the Steps tooltip.

| Element | What it tells or does | Path step | How often needed there | Repeats | Verdict | Reason |
|---|---|---|---|---|---|---|
| "Getting started" | The product's end-to-end flow and the session folder's file list | 1 | first day | no | KEEP the section, rewrite it as the six path stages; DELETE the file list | It never mentions confirming run 1, the differences, the document fields or the As-Is map; "Annotate: rename markers, add timestamped notes" is the old flow |
| "Session view" | Layout guide and marker editing | none | never | no | DELETE most; keep a short "Working with markers" in run words | Wrong layout ("Video pane (top left)", "Timeline (top right)"), "localStorage", "re-normalization (§9.3)", "nested markers forming a case tree" |
| "Steps" | Runs, drafts, confirming, differences, saved processes, names, labels, noise, flags | 3, 4, 8 | first days | no | KEEP, trim (P3) | The one section written for the light path |
| "Capture workflow" | OBS WebSocket, `PDT_CONFIG`, "npm start in capture/", tray, hotkeys | instruction to the SME (hotkeys only) | once | no | KEEP the hotkey table; DELETE the rest | Developer steps; the hotkeys are what the analyst passes on |
| "Shortcuts" | Keys and clicks | none (support) | rarely | no | KEEP; drop "in-flight Python child (graceful first, hard kill 500ms later)" (P3) | |
| "Troubleshooting" | normalize.py path, `PDT_PYTHON`, "pip install … pm4py", "bpmn-js … nice-to-have", hotkeys, Citrix and active-win | none (support) | rarely | no | DELETE the developer items; keep hotkeys and Citrix in plain words | "pip install" advice breaks the rule that the work laptop gets no installs; the editor is a core tool now, not a nice-to-have |

### 2.8 Shortcuts overlay (`#shortcuts-overlay`, Flow and Steps)

**Measured at 1366x768:** a card 180 px wide (130 px tall on Flow, 176 px on Steps)
at the bottom right on Flow and Steps
(none on Overview or Map). It covers the note field, Save note and the Raw events
summary on Flow; the first marker row's Move and Delete on the Markers tab; the step
detail's "More" summary and the Description field on Steps. On Flow two of its four
keys (Space, ← →) do nothing without a video. It repeats Help's Shortcuts and the
Steps "⌨ shortcuts" tooltip. Its "×" tooltip says "re-enable from Help → Show
shortcuts overlay"; Help has no such item. **Verdict: DELETE** (P1.1).

## 3. Cross-cutting

### 3.1 Facts that disagree on the same screen

1. **"include in PDD":** every box on the Overview is unticked, yet with nothing ticked
   the PDD prints the top five findings (`memo_export.py`, `DEFAULT_TOP_FINDINGS = 5`).
2. **Three totals, none explained (Overview):** "5m42s" (the recording's span, summary
   line), "1m 13s of 3m 01s" (measured foreground time, Time sinks), "2m16s across 8
   step types" (Where the time goes).
3. **One step, two counts (Overview):** the time row for the Outlook Send step says
   "3× 15.0s"; its automation card says "ran 2 times, 12.0s in total, 6.0s on average".
4. **Automation:** the takeaway says "4 candidates ranked by automation priority"; one
   card shows, with rank "4". The viewer ranks by frequency × mean time × a constant
   share; the PDD orders the same list by total time.
5. **Two clocks on Flow:** screenshot thumbnails (and notes) show UTC ("09:00:19");
   the timeline, markers and raw events show local time ("11:00:19").
6. **After renames, before Analyze:** Steps and the live map say "Look up the
   customer"; the Evidence rows and the finding sentences still use the draft names,
   and the renamed rows lose their dots (probe); a fork made then carries the draft
   names (3.6).
7. **State A:** "0 runs" in the summary above three "case-based" findings about
   repeats and "4 candidates ranked".

### 3.2 Wording (the banned list itself never appears; the copy guard holds)

* **"case" for run**, in: the Case select and "All cases", the "case-based" chip and its
  tooltip ("needs confirmed cases"), the marker hints ("applies to the cases when you
  analyze the session"), "Insert case from selection", "Scope view to this case", the
  automation captions ("within one case", "2+ cases"), Help ("Markers are not cases…
  case tree").
* **"robot"** in the automation caption; the plan asks for tool-neutral wording.
* **Files and systems in analyst copy:** "annotations.json", "events.jsonl",
  "analysis.json" (Help, and the Evidence correction note "run Analyze again to bake
  them into analysis.json and the PDD export"), "localStorage", "re-normalization
  (§9.3)", "npm start", `PDT_CONFIG`, `PDT_PYTHON`, "pip install", "pm4py",
  "active-win", "Python child", "hard kill".
* **Map words:** "Fork", "forked from", "mined map" (Re-fork tooltip), "decoupled from
  analysis", "Reference copy", "Step Process diagram".
* **Steps words:** "commit" (the Auto-detected reason), "drop" (probe line),
  "step suggestions" (Ignored apps), "L0" (markers), "New time (ISO 8601)" (marker Move
  without a video).
* **References to things that are gone:** "Load more sessions" (state S automation
  note; Compare is cut), "waste hotspots" in "the aggregate" (Waste tooltip), "Help →
  Show shortcuts overlay" (overlay "×"); the step pane's empty text in
  `step-editor.js` still names "(Analysis)", "segments" and "variants" (not reached in
  this walk).
* **Wrong words:** "The timeline below is complete without one." (the timeline is
  above); "(no cases yet: click Analyze session first)" on an analyzed, unmarked
  session; the one-run Map lock asks for "a start marker at the beginning of each
  run"; To say more's "would show how long each run takes".
* **Numbers without an explanation where they appear:** the map's arrow labels,
  "95%", rank "4", "L0", the three totals of 3.1.
* **A caveat on the wrong numbers:** "Estimates: these figures come from rules of
  thumb…" sits above measured durations.

### 3.3 One concept, several names

| Concept | Names on screen |
|---|---|
| A run | "Run 1", "run", "case", "Order #10900" (the SME's label), "pattern run" |
| The editable map | "Fork map", "reference map", "Reference copy", "As-Is map" and "To-Be map", "Step Process diagram, reference 1" |
| The process map as a file | "Map as SVG", "Step map as BPMN", "process diagram" (level tooltip), "Process map" (title) |
| Linking a video | "Attach video..." (More), "Link recording…" (Flow band), "OBS recording" (Help) |
| Taking a step out | "Hide step" (buttons, menu), "drop" (probe line), "hidden drafts" (Help) |
| A drafted step | "Draft", "drafted steps", "step suggestions" (Ignored apps), "Auto-detected" |
| A note | "Notes" (tab), "No annotations yet. Anchor a note…" (empty text), "Annotations (right column)" (Help) |
| An application | "Google Chrome (browser)" (findings), "Chrome" (legend), "chrome" (step tile), "chrome.exe" (Ignored apps, raw events), "Chr…" (bands) |

### 3.4 Dead controls on this path (each verified)

* **Case select and Scope to playhead** on Overview, Steps and Map: no effect (probe).
* **Without a video:** Flow "+ Step" ("No video timing: can't place a step at the
  playhead"), Scope to playhead ("No video to anchor to playhead."), More's "Sync
  video..." ("No video is linked to this session."), the Space and arrow keys, and the
  overlay rows that advertise them.
* **"Build process map":** its only effect on the path is to make Fork fail.
* **Automation Confirm and Dismiss:** nothing reads the decision.
* **Flow Notes:** nothing reads them; without a video they carry the analyst's clock.
* **"Filter markers...":** two markers per run.
* **"⌨ shortcuts":** a hover-only copy of a list shown twice elsewhere.
* **Hidden `.view-mode-desc` spans.**
* **State A:** "include in PDD" on "case-based" cards (the PDD leaves them out when no
  runs are marked).
* **A gap on the path, not a dead control:** the step pane shows the step's
  screenshots only as a count ("N screenshots"), although screenshots are the review
  medium for recorder-only sessions (plan sections 4 and 5, step 3). Today the analyst
  has to switch to Flow's Screenshots tab, where thumbnails have no step and use the
  other clock. (The demo's screenshots are 1x1 placeholder images, so thumbnail
  legibility could not be judged.)

### 3.5 Missing inverses

* **Save as this process:** only the toast's Undo; afterwards a saved process can be
  neither renamed nor forgotten (`processes-store.js` exports save and undo only). The
  smallest inverse sits where the saved process shows up: "Forget this saved process"
  on the `.runs-compare` line ("Compared with saved process …").
* **Shortcuts overlay "×":** no way back (the Help item it names does not exist). Moot
  once the overlay is deleted.
* **Level hint "×":** persisted in local storage with no way back. Moot once deleted.
* **Present and working:** Confirm run and Reopen run, Hide and Unhide, fork Delete
  and Ctrl+Z, include and untick, document fields and Ctrl+Z, Remembered names Forget,
  Ignored apps untick, marker insert and delete, the gallery toggle.

### 3.6 Controls whose effect never reaches the map or the PDD, or reaches it wrong

1. **Automation Confirm and Dismiss:** written to `analysis_overrides[].automation_confirmed`,
   read back into `analysis.json`, printed nowhere (`pdd_export.py` 5.3 lists every
   repeated candidate by total time).
2. **Case select** outside Flow: nothing.
3. **Flow Notes:** nothing (the PDD's section 7 reads `document.notes`).
4. **Step renames and the As-Is copy (F1):** a rename reaches the Steps list, the live
   map and the PDD's step section at once, but not `process_map_step.bpmn`, which is
   written only by Analyze. Fork copies that file, so a copy made after renames carries
   the draft names (probe: the copy's XML had "Salesforce … Search", not "Look up the
   customer"). After an Analyze the file has the new names, but the existing copy keeps
   the old ones and only gains a "source changed" chip; Re-fork makes a new copy and
   leaves the edited one behind. The PDD embeds the chosen copy as its As-Is image, so
   its map can contradict its own step list. The What is left line never mentions
   Analyze.
5. **One-run sessions:** the Map and Fork are gated at 2 runs and 70% coverage, so a
   one-run session gets no map, Fork is refused, the What is left line cannot pass its
   As-Is stage and its button never becomes "Export PDD" (from `overview-view.js`
   `pathState` and `refmap-ui.js` `onFork`; the refusal toast was seen in state A, the
   lock in state S).
6. **Export's map items:** they save the mined map; the As-Is copy the analyst finished
   has no export outside the PDD.
7. **"include in PDD":** unticked means "top five by default", not "left out".
8. **Waste:** reaches the PDD ("Flagged as waste.") and the value-add analysis, but its
   tooltip promises a view that is gone.

### 3.7 Legibility seen in the screenshots

* **Active level button under the mouse:** the background turns light (rgb 240, 235,
  226) while the label stays near white (rgb 250, 248, 244), so the current level's
  name disappears right after every level click (visible in the Flow, Steps and Map
  shots). `button:hover:not(:disabled)` outranks `.view-mode-btn.active` for the
  background.
* **Gallery Delete:** unreadable at rest (2.6).
* **Fork:** the Map's main act in 11 px type inside a 23 px button.

## 4. Prioritized change list for the subtraction lane

Deletions first; demotions and merges next; additions only where the path lacks
something essential. Expected effects are measured at 1366x768 unless marked "about"
(an estimate).

### P1: main-path clutter

| # | Element | Change | Expected effect |
|---|---|---|---|
| P1.1 | `#shortcuts-overlay` (Flow, Steps) and `.kbd-hint` "⌨ shortcuts" | DELETE | Uncovers the note field, Save note and Raw events on Flow, the first marker row's Move and Delete, the step "More" and Description on Steps; no advertised keys that need a video; Help keeps the list |
| P1.2 | View bar: `.view-mode-label`, `#steps-badge`, `#view-mode-help` and its "×"; `#case-scope-select` outside Flow; `#btn-scope-to-playhead` everywhere | DELETE | 2 to 4 fewer controls and about 20 to 30 fewer words on every level; the view bar stays one row on Steps (61 px to 39 px) |
| P1.3 | Steps `.mini-timeline-pane` (strip, span, three zoom buttons) | DELETE | The runs list moves up 184 px, about 200 px with P1.2 (from y=404); 3 fewer controls |
| P1.4 | Overview: the "Estimates" `.analysis-caption`, the "Summary statistics" caption, the automation caption, `.ts-judgment` text until a judgment exists, `.ov-group-count`, `.ov-saymore` | DELETE | About 180 fewer resident words; no caption calls measured times estimates; no duplicate totals |
| P1.5 | `.auto-decision` Confirm and Dismiss, the `.auto-card` rank prefix | DELETE | Two controls per candidate that reach nothing, and an unexplained number, are gone |
| P1.6 | Flow Notes tab: `.anno-tab[data-anno="notes"]`, `#annotations-list`, `#anno-note`, `#btn-save-note`, the Note markers lane | DELETE; Screenshots becomes Flow's default tab (departs from plan 8.3; the reason and the reversing fact are in 2.4) | A dead-end verb with a wrong time goes; the panel opens on the review medium |
| P1.7 | Step detail: the Start, End and Run tiles; `.step-suggestion-reason` | DELETE; MERGE Duration and App / Screen into one line; MOVE `#step-desc` out of More | The pane shows what the analyst edits: name, note, waste |
| P1.8 | The 2 run and 70% coverage condition on the Map and on Fork (`mapLockHtml`, `onFork`) | DELETE the condition (keep the "no runs marked" lock) | One-run sessions get a map, an As-Is copy and a What is left line that ends at Export PDD |
| P1.9 | Step row chips `.step-chip` | MERGE into the run status: a chip only where the row differs | 7 to 10 fewer repeated chips per open run; edited rows stand out |
| P1.10 | `#ov-doc` Document sections; the Evidence block | MOVE the Document sections under the summary line; DEMOTE Evidence to collapsed with the takeaways visible | The only typing on the home is on its first screen; resident words from 566 to about 260 (with P1.2 and P1.4) |
| P1.11 | `#btn-normalize` "Analyze session", `#btn-add-manual-step` "+ Add step" | DEMOTE to secondary style once the session is analyzed | One orange button per screen: the next act |
| P1.12 | `#btn-fork-refmap` | MERGE the role choice into Fork: name it for the act, make it the Map's orange button, create the copy as As-Is with "Use in PDD: As-Is" when none is chosen | Finishing the map goes from four actions (Fork, pick Use in PDD, maybe pick Type, Close) to two |

**Found on the way (FIX, not subtraction; ship with P1):**

| # | Element | Change | Expected effect |
|---|---|---|---|
| F1 | Fork after renames (`refmap-ui.js` `onFork` copies `process_map_step.bpmn`) | Fork from the current step names, or run Analyze inside Fork | The PDD's As-Is image and its step section use the same names |
| F2 | `.ov-memo-check` | When `memo_selection` is empty, tick the findings the PDD will print | The screen tells the truth about the deliverable |
| F3 | Active `.view-mode-btn` hover; gallery `[data-rm-act="del"]` | Fix the colours | Both labels legible |
| F4 | Screenshot thumbnails (`flow-view-screenshots.js`) and note times | Local time, like the timeline and markers | One clock per screen |

### P2: secondary surfaces

| # | Element | Change | Expected effect |
|---|---|---|---|
| P2.1 | More's `#cb-mine` "Build process map" | DELETE (always on) | Nobody can switch off the As-Is path by accident |
| P2.2 | Recent's bundled example rows; `#btn-open-session` | DELETE the examples; MERGE Open another and Recent into one "Open ▾" | 10 fewer rows; one fewer control on every level |
| P2.3 | Map `#session-map-zoom-pct`, `#session-hide-rare-wrap` | DELETE | One control and one unexplained number fewer on the Map toolbar (7 own controls to 3 with P2.10 and P3.12); no filter that can hide the variants |
| P2.4 | Map arrow time labels | DEMOTE into the arrow's tooltip | No unexplained numbers on the map |
| P2.5 | `.refmap-kind-chip`, `.refmap-pdd-chip`, `#refmap-editor-kind`, `#refmap-editor-badge`, `#refmap-editor-prov`, `.refmap-row-meta` | MERGE the role into one "Use in PDD as" control; DELETE badge, provenance and meta (keep the date); default names "As-Is map" and "To-Be map" | The role is said once; a row reads in one line |
| P2.6 | The "Repeated sequences" findings and `.auto-in-findings` | MERGE into Automation candidates, in the viewer and in the PDD (section 1 and 5.3: both renderers) | One home for one fact; both "already in the findings" sentences go |
| P2.7 | `.ov-finding-tier` chips | DELETE; hide run-based findings when no runs are marked, as the PDD does | Four fewer chips; screen and PDD agree in the unmarked state |
| P2.8 | `#btn-ignored-apps`, `#btn-remembered-names` | DEMOTE into More | Two fewer toolbar controls on Steps |
| P2.9 | `.run-fixes` live counter | DELETE (keep the probe line with Copy until the P1 probe closes, then DELETE it; "hide", not "drop") | The pattern run shows its steps, not the probe instrument |
| P2.10 | Raw events drawer on Overview, Steps and Map | DELETE there (Flow only, closed) | The machine layer leaves three levels |
| P2.11 | Video-only controls while no video is attached: Flow `#btn-add-step`, More's `#btn-sync-video` (Watch is already hidden) | DELETE (hide) until a video is attached | No control that can only answer with an error |
| P2.12 | Export's map items | Re-point to the As-Is copy chosen for the PDD when one exists; one name, "Process map (image)" and "Process map (BPMN)" | The analyst can export the map they finished |
| P2.13 | Help: Getting started, Session view, Capture workflow, Troubleshooting | Rewrite Getting started as the six stages; DELETE the developer content (2.7) | Help teaches the path it ships |
| P2.14 | `.step-row` tick box | DEMOTE to hover or Ctrl+click | One fewer control per row |
| P2.15 | "case" in the strings of 3.2 | Say "run" | One name for the unit the whole path uses |
| P2.16 | Step detail (the one addition: plan section 5, step 3) | Show the step's screenshots in the pane (today a count) | Run 1 can be checked without a video where the step is, not across two tabs and two clocks |

### P3: polish

| # | Element | Change |
|---|---|---|
| P3.1 | `#topbar-meta` | DELETE the date; move the version to Help |
| P3.2 | `.view-mode-desc` spans | DELETE |
| P3.3 | Markers: `#marker-filter-text` and its count, `.depth` "L0", "(unlabeled)", the hint | DELETE the filter, the count and "L0"; "End" on End rows; the hint to a tooltip in run words; Move without a video asks for a time of day, not ISO 8601 |
| P3.4 | Timeline legend entries for lanes that are off; `#timeline-minimap` | DELETE the entries; show the minimap only when zoomed in |
| P3.5 | Lanes: Activity density, Window-title strip | DELETE; "Case lanes" becomes "Runs" |
| P3.6 | `.ov-doc-where` | DEMOTE into tooltips or placeholders |
| P3.7 | Time rows with no measured time | DELETE |
| P3.8 | `[data-act="use-pattern"]` | DEMOTE into a run menu |
| P3.9 | Save as this process prompt; summary line | Prefill the name with the document Title; show the Title in the summary once written |
| P3.10 | Copy: "The timeline below…" (above); "Link recording…" (one name with Attach video); "(no cases yet: click Analyze session first)"; the one-run lock text; "Load more sessions"; the Waste tooltip's "aggregate"; Ignored apps' exe names and "step suggestions"; the step pane's empty text | Rewrite as noted in 3.2 |
| P3.11 | Saved processes | Add "Forget this saved process" on the `.runs-compare` line: the one inverse still missing after the deletions |
| P3.12 | Map zoom − and + | DEMOTE (keep "fit") |
| P3.13 | Run guide "Its differences … listed above its steps." | DELETE |
| P3.14 | Help: Shortcuts' "Python child … hard kill"; the Steps section | Rewrite; trim |

## Not verified in this audit

* **Video mode:** no video was attached, so the video pane, the playback bar, Watch,
  Sync video's real flow and the video shortcuts were not exercised.
* **The PDD file:** no export was run; every claim about what the PDD prints comes from
  `pdd_export.py` and `memo_export.py`.
* **Screenshot legibility:** the demo's screenshots are 1x1 placeholder images.
* **Dark theme, the 1024x768 size, the capture app and the transcript lane** (P6, not
  built) were out of scope.
* **Real sessions:** demo data only; use-gate verdicts are judged against the plan's
  path and the code, which a real session under the P5 gate would settle.

## Where the evidence is

The driver, the probes and every screenshot (with a JSON of the measured controls and
visible text per shot) live outside the repo in this session's scratchpad:
`C:\Users\rasha\AppData\Local\Temp\claude\D--Game-Development-Process-Mining-process-discovery-tracker\674c64b0-0233-46c8-9099-117b92d7576a\scratchpad\ui-audit\`
(`drive.js`, `probe.js`, `probe2.js`, `probe3.js`; `shots\A-1366x768`, `B-1366x768`,
`C-1366x768`, `S-1366x768`, `A-1500x950`, `B-1500x950`, `C-1500x950`, `probes`).
