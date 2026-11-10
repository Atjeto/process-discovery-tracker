# End-goal review and plan (2026-11-10)

**Status: approved to start, 2026-11-10** (the owner: "let's start working";
facts 1 and 2 of section 8 answered, the others open). Work lands per item:
built by agents on a branch, reviewed, committed and merged; a release only
on the owner's word. Written at the owner's
request after 2.0.6: a review of the whole app for UX, accessibility and
purpose, an accessibility audit, a design critique, and one plan that follows
from them. Rewritten the same day around the process manager's starting
points, after the owner asked what happens when there is no recording at all
and to "go through the actual interaction with the app that a PM has today,
then through all the possible output of the app".

**How it was looked at.** The real viewer (2.0.6, master at `2484e2a`), at
1366x768 and 1280x720, in both themes:

- the demo project on every level, with a DOM audit run inside the page (the
  contrast of every visible text, names, sizes, pointer-only targets, the Tab
  order);
- **three walks as a process manager**, each act counted (a click, a key, a
  typed text, a file dialog) and each output opened and read: a project made
  from a call's video; a raw recording opened and handed off with no edit; an
  empty project built from notes;
- the capture app's windows read from their code; the code behind every
  claim.

**Not done:** a screen reader session (NVDA), a run of the capture app, a
real SME laptop, a real recording, a real call. The recording walked is the
committed synthetic one, so its counts show the path, not real-world sizes.

## 1. The goal, as read

The owner, 2026-11-10: "cover all the outcomes and points that a process
manager/developer might need for automation, while enabling the SME's to
easily use capture with minimum interaction, but gain the most thorough
details possible. Long story short, replacing the PM's so that in the end we
get 1 cohesive project documented, in 1 zip, and easily stored with all the
relevant information, in a readable format, and editing it is all in 1
space, easy to navigate, easy to control, and minimizes the need for
technical knowledge." The app runs locally on an employee laptop, for
internal use.

Four parts, used as the yardstick below:

1. **The SME** records with the least interaction, and the recording holds
   the most detail.
2. **Coverage:** the result holds what a process manager and an automation
   developer need.
3. **One zip:** one cohesive, documented project, readable and easy to store.
4. **One space:** editing in one place, easy to navigate and control, with
   little technical knowledge.

And the owner's rule for the path, the same day: come to the output "with
minimum interaction", whatever the process manager starts from. A helper
that asks them to work differently during the call (notes taken in the app
while listening) is the wrong direction: they write in Notepad, in Teams or
on paper, and the app takes what they have.

**Confirmed by the owner (2026-11-10): the handwork.** "Replacing the PM's" is read as replacing the work a
process manager does by hand today (the model, the document, the interview
notes), not as taking the person out: someone still confirms the steps and
writes what no recording knows. If the owner means that an SME or a developer
finishes a project with no process manager at all, lane C below moves to the
front; the rest holds.

## 2. What a process manager does today

### 2.1 The starting points

| | Starting point | What they hold when they sit down |
|---|---|---|
| S1 | The SME recorded alone with the capture app | The capture zip |
| S2 | The SME recorded during a call | The capture zip, the call's video, its transcript |
| S3 | A call with no recorder, a clean walkthrough | The video, perhaps a transcript |
| S4 | A call with no recorder, messy: back and forth, a long detour, apps that are not part of the process | The video, a transcript, their own notes |
| S5 | No recording at all | Their own notes, perhaps an older document |
| S6 | A change after a hand-off | The project |

### 2.2 The walks

**S3, a project from a call's video, three steps, to a hand-off: 49 acts.**

| Phase | Acts | What they were |
|---|---|---|
| Start | 4 | New, *New project from a video...*, pick the file, name and place the project |
| Mark the steps | 7 | Open the Timeline, then per step: go to the moment, press S |
| Write the steps | 13 | Open Steps, then per step: select it, type its name, its system, its description |
| A picture (one step) | 3 | Select the step, *Add screenshot*, *A frame of the video* |
| Confirm | 1 | *Confirm transaction* |
| The document | 12 | Open the Overview, open *Document*, ten fields typed |
| Export | 6 | Export and a save dialog, twice: the PDD, the Technical details |
| Hand off | 3 | Export, *Hand off...*, the note |

About ten acts a step with a picture each, twelve for the document, fifteen
that do not grow. A process of twenty steps is about 210 acts.

**S1, a raw recording, opened and handed off with no edit at all.** It
opened and analyzed in 5 s: four transactions, seven drafted steps in the
reference transaction. The hand-off made with nothing typed already holds
the systems, every step with its screen and fields, the differences between
the transactions, the re-keyed data, and a Technical details workbook with
28 control rows and 18 data fields across the four transactions. What it
lacks is what only a person gives: the steps' names (they read "va01: Check
document"), their descriptions, the ten document fields, and a picture for
five of the seven steps.

**S5, an empty project.** It opens on Steps. *+ Add step* asks for each
step's name in a dialog of its own (two steps, two dialogs; the field takes
one line). The Timeline says to attach a video.

**What the walks showed** (each seen in the app or in a file it wrote):

| # | Finding |
|---|---|
| W1 | **The Checklist does not know what kind of project it is.** A project just made from a video, and an empty one, are told to "Confirm the reference transaction" and "Review the other transactions"; the button reads "Open the transactions in Steps". Adding the steps, the real first act, is not on it |
| W2 | **A confirm with nothing to confirm.** *Confirm transaction* has to be clicked in a project where no step was drafted, or the Checklist never moves on |
| W3 | **A project made from a video opens on the Overview**, one click from where its work starts |
| W4 | **Mark here, write there.** Steps marked on the Timeline are "Step 1", "Step 2", "Step 3"; the panel does not open, and a name can be typed only in Steps, one selected step at a time |
| W5 | **A picture is three clicks a step**, and a step marked at a moment of the video gets none by itself |
| W6 | **A dialog per step** when steps are added by hand |
| W7 | **Three export trips** (the PDD, the Technical details, the hand-off), though the hand-off makes the other two |
| W8 | **Nothing checks before the zip.** The untouched recording was handed off with its PDD saying "The analyst has not yet confirmed these 7 steps" and nine "[To be completed: ...]" gaps; the video project with two steps without a picture |
| W9 | **The outputs of a project without a recording speak the recorder's language** (2.3) |

### 2.3 What comes out

| Output | From a recording (S1, S2), untouched | From a video or from notes (S3 to S5) |
|---|---|---|
| PDD (.docx) | Complete in structure. Gaps where a person writes: the title ("Not named yet"), nine fields, step names and descriptions | The same structure, with lines that only describe recordings: "Recorded by: Not recorded", "Transactions recorded: One transaction (not marked)", "One transaction (not marked), so every step is listed in order", a section 4.1 saying there are no transactions to compare. Section 5 says "Information entered: none" for each system, which reads as a fact where it is only unknown |
| Technical details (.xlsx) | Controls, data fields with the values of every transaction, re-keyed values, applications | **Four empty sheets**, and the file goes into the hand-off zip all the same |
| Process map (image, BPMN) | Tasks, systems, decisions from the differences | Tasks and systems in a row; the trigger and the result on its ends; decisions only where a flow was set |
| Hand-off zip | The project, the PDD, the Technical details | The same, with the empty workbook. In both, the zip also carries the four backup copies of the working file and the analysis log, and no map file at its root |
| Whole project (.zip) | The folder | The folder |
| As-Is and To-Be maps | Edited by hand in the map editor | The same |

### 2.4 Where 2.0.6 stands against the goal

| Part | Works today | Missing |
|---|---|---|
| 1. The SME | One start, one key per transaction, a bar that stays out of the way and out of screen shares, an end summary that makes the zip, alarms in plain words | The SME is asked nothing: the document's twelve fields are all written later by someone else, and six of them (trigger, result, volume and effort, rules, exceptions, contacts) are things only the SME knows. No video unless OBS is installed, which SME laptops do not have. No way to hand over an example file (the e-mail, the sheet) |
| 2. Coverage | A recorded project gives a great deal with no edit (2.2) | A project made from a video or from notes holds no data fields at all: nothing was recorded and there is nowhere to type them. Who does each step is printed nowhere (the SME's role and team sit in the capture Profile). Which steps the automation takes is one free-text field and a Waste tick |
| 3. One zip | *Hand off...* makes `<project> v<N>.zip`: the project, the PDD and the Technical details, numbered, opened read only | Nothing checks it (W8). It carries files nobody reads and lacks the map (2.3). Export lists six things flat, two of them zips. The SME's zip must be extracted by hand before *Open project...* |
| 4. One space | Four levels, one step panel with three doors, every change saved and undoable, times typed as well as dragged, a demo project, Help in the How-to's words | W1 to W7. On a messy call there is more: the transcript cannot be read beside the video, a detour cannot be put aside, and a step written first cannot be pointed at its moment (lane E) |

## 3. Accessibility audit

**Standard:** WCAG 2.1 AA, with WCAG 2.2's 24 px target size (2.5.8) in place
of the 44 px touch size: this is a mouse and keyboard desktop app.
**Date:** 2026-11-10. **Scope:** the viewer (running), the capture windows
(code only).

### Summary

**Issues found: 22. Critical 2, Major 10, Minor 10.** The dark theme passes
contrast almost everywhere; the light theme, the default, does not. The
keyboard reaches Steps and the Overview well and the Timeline hardly at all.

### Findings

#### Perceivable

| # | Issue | WCAG | Severity | Recommendation |
|---|---|---|---|---|
| A1 | Light theme: the primary button and the active level tab put `--accent-text` on `--accent`: 3.34:1 at 12 px (hover 4.26:1). *Open project...*, *Export PDD*, *Confirm transaction* and the current level are the least readable labels | 1.4.3 | Major | A fill for filled controls that carries text at 4.5:1 or more: the `--link` value `#99591c` gives 5.25:1 |
| A2 | `--fg-4` used as a text colour: 2.0:1 light, 2.1:1 dark ("TRANSACTION:", the count on *Edited maps*, "No recent projects yet.", "No edited maps yet.", the playback bar's key hint) | 1.4.3 | Major | Text never uses `--fg-4`; a stylesheet guard test like `ui-copy-guard` keeps it so |
| A3 | Timeline step names: 10 px, on a band at opacity 0.55: 2.08:1 light, 2.61:1 dark, in a 14 px lane | 1.4.3 | Major | Full opacity, 12 px, a taller lane (plan A7) |
| A4 | Type size: 9 to 11 px in well over a hundred rules (tick labels 9 px, chips 10 px, link actions and meta lines 11 px) on a 13 px base, with no zoom (A12) | 1.4.4 | Major | A floor of 12 px for anything read; 11 px only for mono timestamps |
| A5 | Other Timeline text on colour: system names 10 px white on green and orange 3.95:1, on amber 3.50:1; tick and transaction labels 4.32:1 | 1.4.3 | Minor | With A4; darker fills or dark text on the lighter fills |
| A6 | Field edges: a text field is a fill 1.19:1 against its card with a 1.35:1 border (the Overview's twelve fields, the Flow inputs) | 1.4.11 | Minor | `--field-border` (3.5:1) on every field, as the step editor's title and system already have |
| A7 | What a control does is often said only in its `title`: 112 titled elements on the Timeline, 35 of them longer than 90 characters. A tooltip needs a mouse and a wait | 1.3.1, 3.3.2 | Minor by the letter, Major in use | Nothing is said only in a tooltip: a short visible line where the act is not obvious, the rest in Help |
| A8 | No `forced-colors` support; the map stays a light island in the dark theme | 1.4.11 | Minor | Leave the map; add a `forced-colors` block for borders and focus |
| A9 | The video has no captions; the transcript lane is its text alternative when a transcript is attached | 1.2.2 | Minor (internal recordings) | None; noted |

#### Operable

| # | Issue | WCAG | Severity | Recommendation |
|---|---|---|---|---|
| A10 | The Timeline is mouse only. No band (transaction, step, video, note, screenshot) takes focus, and its acts live in right-click menus made of plain `div`s: *Start a transaction here*, *End the transaction here*, *Add note here*, a video's trim, a note's edit and delete have no keyboard path. Only S (a step at the playhead) and the typed times in Steps do | 2.1.1 | Critical | Visible marking buttons at the playhead beside *+ Step* (plan A6), bands that take focus with arrow keys and Enter, menus that open from the Menu key and move with arrows |
| A11 | Dialogs (`promptModal`, `confirmModal`): Tab leaves the dialog after two presses and walks the page behind the backdrop | 2.4.3 | Major | One dialog helper: focus kept inside, given back on close |
| A12 | No text zoom. The app menu is removed (`Menu.setApplicationMenu(null)`) and Ctrl with plus does nothing (zoom factor 1 before and after) | 1.4.4 | Critical | Ctrl with plus, minus and 0 as the app's zoom, remembered; layouts checked at 150% on 1366 px |
| A13 | Help opens without taking the focus: it stays on the button behind, and Tab walks the page under the guide | 2.4.3 | Major | Help uses the dialog helper of A11 |
| A14 | Messages and refusals are a toast that goes after 3.5 s | 2.2.1 | Major | See A18 |
| A15 | The focus mark differs by control and is weakest where typing happens: text fields, the Transaction select and the Flow selects show a 1 px border colour change only (`outline: none`); link actions a 1 px dotted line | 2.4.7 | Minor | One rule: a 2 px outline for every control |
| A16 | Target size: link actions are 17 px high (*Replace*, *Remove*, *Add file...*, *Only when...*, *Decision...*), ticks 13 px, the panel's play 27x19, the top bar's buttons 23 px | 2.5.8 (2.2) | Minor | 24 px minimum height by padding |
| A17 | The map: a task (and a box of how the transactions ran) opens its step by click only. The same step is reachable in Steps | 2.1.1 | Minor | Leave; say in Help that Steps is the keyboard path |

#### Understandable

| # | Issue | WCAG | Severity | Recommendation |
|---|---|---|---|---|
| A18 | A refused entry is explained only in the toast, then the field silently shows its old value ("The start of this step can be from 0:00 to 0:22.2: a step does not run over the steps beside it." for 3.5 s) | 3.3.1 | Major | The reason stays beside the field until the next edit; an error toast stays until dismissed |
| A19 | No `lang` on any page: the viewer's `index.html` and the capture app's seven pages | 3.1.1 | Minor | `lang="en"` |
| A20 | One act, several names: *Play*, *Watch* and *Select + seek here* play a step; *Show on timeline*, *Jump to step here* and *Open in Steps* move between levels | 3.2.4 | Minor | One name per act (plan A11) |

#### Robust

| # | Issue | WCAG | Severity | Recommendation |
|---|---|---|---|---|
| A21 | Roles and names: the prompt and confirm dialogs have no `role="dialog"`, `aria-modal` or label; the menus (New, Open, Export, the step, transaction and Timeline menus) no menu roles or `aria-expanded`; glyph buttons are named by their glyph (✕, ☾, ?, −, ⊙, +) with the meaning in the `title` | 4.1.2 | Major | The dialog helper; `aria-expanded` and menu roles; `aria-label` on glyph buttons |
| A22 | Status messages: `#toast` is no live region, so a screen reader hears no message at all. (The save state and the status line are `role="status"` already.) In capture, the bar's state and its problem line are not announced either | 4.1.3 | Major | `role="status"` on the toast, `role="alert"` for errors and for the bar's problem line |

### Colour contrast check

| Element | Foreground | Background | Ratio | Required | Pass |
|---|---|---|---|---|---|
| Body text, light | `#2c2418` | `#faf8f4` | over 14:1 | 4.5:1 | yes |
| Secondary text `--fg-2` | `#635848` | `#ffffff` | 6.95:1 | 4.5:1 | yes |
| Muted text `--fg-3` on a card | `#786c5a` | `#ffffff` | 5.13:1 | 4.5:1 | yes |
| Muted text `--fg-3` on a fill (`--bg-3`) | `#786c5a` | `#f0ebe2` | 4.32:1 | 4.5:1 | no |
| Faint text `--fg-4` | `#c0b5a5` | `#ffffff` | 2.02:1 | 4.5:1 | no |
| Link `--link` | `#99591c` | `#ffffff` | 5.53:1 | 4.5:1 | yes |
| Primary button, light | `#fff8f0` | `#c07830` | 3.34:1 | 4.5:1 | no |
| Primary button, dark | `#0a2020` | `#2dd4bf` | 9.10:1 | 4.5:1 | yes |
| Step band name, light | `--bg` at 0.55 | `--accent-2` at 0.55 | 2.08:1 | 4.5:1 | no |
| Step band name, dark | `--bg` at 0.55 | `--accent-2` at 0.55 | 2.61:1 | 4.5:1 | no |
| System name on the Systems lane | `#f5f9f7` | `#3f8a5c` | 3.95:1 | 4.5:1 | no |
| Faint text, dark `--fg-4` | `#4e5670` | `#1e2436` | 2.12:1 | 4.5:1 | no |
| Field edge, light | `#e5ddd0` | `#ffffff` | 1.35:1 | 3:1 | no |
| Capture: muted text | `#8E8C82` | `#14141A` | 5.44:1 | 4.5:1 | yes |
| Capture: primary button | `#11140F` | `#6E8A66` | 4.86:1 | 4.5:1 | yes |
| Capture: field edge | `#424250` | `#14141A` | 1.86:1 | 3:1 | no |

### Keyboard navigation

| Surface | Tab order | Enter and Space | Escape | Arrow keys |
|---|---|---|---|---|
| Top bar | New, Open, the four levels, Saved, Export, Help, theme: in reading order, each with a ring | Open the menus; a menu's items are buttons | Closes a menu | None in menus |
| Overview | The next act, the project line's links, the Document, each field, attachments | As expected | None needed | None |
| Timeline | The Transaction select, + Step, Lanes, zoom, the transcript's links, the video's buttons, the tabs. **No band, no lane** | S adds a step at the playhead; Space plays | Clears a selection | Left and Right move the video |
| Steps | Transaction rows (`role="button"`), their time fields, each row's tick, the splitter, the name, the system, Play, the description, the Flow, the screenshots, Recorded, the adds, then the panel | Enter renames; Ctrl and Enter confirms | Leaves a field as it was | Up, Down, J and K move the selection; Alt with Up or Down moves a step; S and M split and merge |
| Map | The map picker, Fit, the edit buttons, the view links. **No task** | As expected | None | None |
| Dialogs | Field, Cancel, OK, **then the page behind** | Enter confirms | Cancels | None |
| Right-click menus | **None** | **None** | Closes | **None** |

### Screen reader

Not tested with a screen reader. From the DOM, what one would say:

| Element | Announced as | Issue |
|---|---|---|
| A level tab | "Overview, button" | No pressed or current state for the level shown |
| Close buttons | "✕, button" or a symbol name | The name is the glyph (A21) |
| A prompt | Its field only | No dialog, no title (A21) |
| A toast | Nothing | No live region (A22) |
| The Timeline | A run of unlabelled text | Bands are `div`s with a `title`; no structure, no focus (A10) |
| A time field | "Start of Transaction 1, edit" | Good: every time field is labelled |
| The save state | "Saved" when it changes | Good |

### Priority fixes

1. **The Timeline by keyboard, with its acts in sight** (A10): blocks anyone
   who cannot use a mouse from marking a project, and hides the main acts
   from everyone else behind a right-click.
2. **Text zoom and the type floor** (A12, A4): the only way a reader on a
   small laptop gets larger type.
3. **The light theme's contrast** (A1, A2, A3): the default theme's main
   buttons and the Timeline's step names.
4. **One dialog helper and messages that stay** (A11, A13, A14, A18, A21,
   A22): six findings, two small pieces of code.
5. **The small ones in one pass** (A6, A15, A16, A19, A20): names, edges,
   rings, `lang`.

## 4. Design critique

### Overall impression

A calm, consistent app whose parts are individually honest and well worded.
The largest opportunity is not on any one screen: it is at the two ends.
The SME's seat collects only what a machine can see, and the last act hands
over a zip nobody checked. In between, the work is split across two levels
(mark on the Timeline, write in Steps) at a size that a laptop barely holds.

### Usability

| # | Finding | Severity | Recommendation |
|---|---|---|---|
| D1 | The SME is asked nothing. The end summary takes an optional name and makes a zip; the questions only the SME can answer are asked later, by a person | Critical (goal part 1) | Ask them at the end summary, in the document's own words (plan C1) |
| D2 | A step is marked in one place and written in another. On the Timeline a new step is "Step 3"; its name, system and description can be typed only in Steps. The step panel beside the Timeline shows them and cannot change them | Critical (goal part 4) | The panel edits the name, the system and the description wherever it opens (plan D1) |
| D3 | Without OBS there is no video, so a recording made by the SME alone gives the process manager screenshots and no way to watch the work | Major (goal part 1) | The capture app records the screen itself, on the recording's own clock (plan C3) |
| D4 | The Checklist says "the PDD is ready to export" from four facts and never looks at the steps: in the demo a reference step has no description | Major (goal part 3) | A readiness list on the Checklist and in *Hand off...* (plan B1) |
| D5 | Steps on a laptop: three columns at 1366 px, and the step shows twice. Its name, system, flow, screenshots and what was said are in the editor and again in the panel; the editor is left about 520 px and a Flow condition is cut ("the customer's credit is bloc") | Major | On Steps the panel keeps only what the editor lacks, the video and the other occurrences, and under 1440 px it opens on demand (plan D2) |
| D6 | The Timeline's hierarchy is upside down for the work done on it. The Systems lane is the hero (60 px, saturated); the steps lane, the thing being made, is 14 px of 10 px text at 2:1 | Major | The steps lane taller and legible, right under the transactions (plan A7) |
| D7 | The main marking acts are hidden in a right-click menu | Major | Buttons at the playhead: *+ Transaction*, *End transaction*, *+ Step*, *+ Note* (plan A6) |
| D8 | Export: six items in one flat list, two of them zips (*Hand off...*, *Whole project (.zip)*), nothing saying which is the deliverable | Moderate | Three groups, the hand-off first (plan B3) |
| D9 | The playback bar shows on every level and drives a video that is on screen only on the Timeline; it takes 38 px of a 768 px screen | Moderate | On the Timeline only (plan A8) |
| D10 | A transaction is renamed (a double-click) and deleted only in the Markers tab under the video, while its times are typed in Steps | Moderate | Its name and *Delete transaction* on its row in Steps; the Markers tab goes (plan D3) |
| D11 | The project line is a run-on sentence with five 11 px links, *Replace* and *Remove* twice side by side | Moderate | One row per source: the video, the transcript, each with its acts (plan D5) |
| D12 | The SME's zip cannot be opened: extract it by hand, then open the folder | Moderate | *Open project...* takes the zip (plan B4) |
| D13 | "Pending" and *Apply marker changes* are the most technical idea a process manager meets, and only in a recording since 2.0.4 | Minor | Apply by itself everywhere, if an analysis is fast enough on a long recording (plan D4, fact 6) |
| D14 | A long field shows three lines with a scroll bar inside (Business rules, Exceptions) | Minor | Fields grow with their text |
| D15 | A toast with an action sits over the page's content for 8 s (it covered the attachments on the Overview) | Minor | With A18 |
| D16 | The Checklist is the same for every project: one made from a video, or an empty one, is told to confirm a reference transaction and to review the other transactions, and has to click *Confirm transaction* with nothing drafted (W1, W2) | Major | A Checklist per kind of project (plan B6) |
| D17 | The outputs of a project without a recording speak of a recording: the PDD's recorder lines, "none" where the answer is unknown, an empty workbook in the zip (W9) | Major | Outputs that fit the project (plan B7, B2) |
| D18 | Steps from notes cost a dialog each, and a picture three clicks a step (W5, W6) | Moderate | Paste the notes; a step takes its picture from the video (plan E1, E2) |
| D19 | A messy call: the transcript is a row of grey blocks beside the video and a readable list away from it; a detour cannot be put aside; a step written first cannot be pointed at its moment | Major | Lane E (plan E3 to E5) |

### Visual hierarchy

- **What draws the eye first.** Overview: the amber Checklist line with its
  one button. Correct. Timeline: the green and orange Systems blocks.
  Wrong for a video project, where they are empty of meaning, and arguable
  in a recording. Steps: the step's title in the editor. Correct, but the
  same title heads the panel beside it. Map: the map. Correct.
- **Reading flow.** Left to right on Steps works (transactions, the step,
  its evidence). On the Timeline the eye has to cross the whole lane stack
  to reach the steps at its foot.
- **Emphasis.** Filled amber is spent well: one primary act per screen.
  Small grey mono capitals label too many things at once (lane names, pane
  titles, the Transaction select), at sizes that fail A2 and A4.

### Consistency

| Element | Issue | Recommendation |
|---|---|---|
| Type scale | 9, 10, 11, 12, 13 and 14 px all in use, the smallest three for most labels | Three sizes: 12, 13, 16 |
| Focus | Four styles: a 3 px outline, a 2 px outline, a 1 px dotted line, a border colour | One |
| Menus | Three constructions: popups of buttons (New, Open, Export), inline-styled `div` menus (Timeline, steps, transactions), a native select | One menu helper, with A21's roles |
| Buttons | Boxed buttons, tool buttons, link buttons; a link button carries destructive acts (*Remove*) next to harmless ones (*Open*) | Keep the three; *Remove* asks or is undoable (it is), so only the size changes (A16) |
| Names | One act, several names (A20) | One |
| The step | Rendered by two components (the editor, the panel) | One set of fields (plan D1) |

### What works well

- One start and one key for the SME, and a recording without a transaction
  is not a state they can reach.
- The folder is the project: the video, the transcript, screenshots,
  attachments and edited maps travel in it, and a hand-off opens read only.
- Every change saves itself and every edit can be undone, verbs included.
- One clock everywhere, and a length never reads like a moment.
- A time can be typed wherever it can be dragged: the keyboard path exists.
- The Checklist with one button for the next act, and a demo project that
  shows every part finished.
- The dark theme: almost every text pair passes.
- The copy: plain, consistent words (transaction, project, step), guarded
  by tests.

### Priority recommendations

1. **Fit the path to the project.** A Checklist, a first screen and outputs
   that are true of a project made from a video or from notes, where the
   process managers work today.
2. **Take what they have in one act.** A zip, a video with its transcript,
   pasted notes; a picture from the video by itself.
3. **Check before the zip.** A readiness list turns "ready" from a count of
   fields into what a reader will miss.
4. **Ask the SME, and record the screen.** The largest gains for a recorded
   project cost the SME one screen at the end and nothing during the work.
5. **One step editor, with the marking acts in sight.** Name a step where
   you mark it; mark without a right-click.

## 5. The plan

**The rule.** Take what the process manager already has, as it is, in one
act. Never ask for an act the app can do by itself. Say only what is true of
this project. What stays is the work only a person can do: marking the
moments, and typing the names, the descriptions and the document.

### 5.1 The path after, by starting point

| | Today | After | By which items |
|---|---|---|---|
| S1, S2: a recording | Extract the zip by hand, open the folder; name and describe each step; confirm; open every other transaction; ten fields; three export trips | Open the zip; name and describe each step; confirm; the fields the SME answered are one click each; one hand-off that says what is missing | B4, C1, B6, B3, B1 |
| S3: a clean call | 49 acts for three steps (2.2) | About 33: start, per step a moment, S and three typed texts beside the video, the picture by itself, the document, one hand-off | B4, B6, D1, E2, B3 |
| S4: a messy call | The same, after finding the useful parts by scrubbing | Paste the notes as steps; read the transcript beside the video; put the detour aside; point each step at its moment | E1, E3, E4, E5 |
| S5: notes only | A dialog per step, then each step written in turn | One paste; then the descriptions and the document | E1, B6 |
| S6: a change | Edit, hand off again: three acts | The same | none |

The "after" counts are estimates from the walks, not measurements. In every
row the typing stays: no AI ships inside, so nothing writes a name, a
description or a document field for the process manager.

### 5.2 The lanes

Five lanes. Each item has a size (S, M, L) and what "done" means. A lane
ships when it is done; there are no dates. Per the standing mode, agents
build and the coordinator briefs, reviews and gates.

#### Lane B: start and finish in one act each

| # | Item | Size | Done when |
|---|---|---|---|
| B1 | **Readiness.** A list computed from the project: steps without a name of their own ("Step 3", or a drafted name), without a description, without a picture, without a system; steps still drafts; a decision without its condition; empty document fields; a stale As-Is map. On the Checklist as its own line, and in *Hand off...* as "N things a reader will miss", each a link to its place. It never blocks | M | The untouched recording of 2.2 lists its seven steps and nine fields; a complete project lists nothing |
| B2 | **The hand-off zip** holds what a reader needs and nothing else: at its root the PDD, the Technical details when it has a row, the process map as an image and as BPMN, and a short *Start here* text file saying what each file is and how to open the project; without the working file's backups, the analysis log and staged files | S | Unzipped by hand, the root reads as a complete package |
| B3 | **Hand off is the one export.** The Export menu opens with it; under it, for another analyst, *Whole project (.zip)*; under that the single files (the PDD, the Technical details, the map image, the map BPMN) | S | A project goes from done to delivered in three acts, and the menu names the deliverable first |
| B4 | **One start.** *Open project...* takes a folder or a zip (the SME's zip is extracted where the process manager says and opened; a hand-off zip opens read only, as today). *New project from a video...* takes the videos and their transcripts in one pick. The page shown while no project is open takes the same files dropped on it. A project made from a video opens on the Timeline | M | From a zip, or from a video with its transcript, to the place where the work starts in one act and its file dialog |
| B5 | **The PDD says who recorded it in full:** the name, the role and the team from the capture Profile | S | Document control reads "Recorded by Maria Keller, sales assistant, Operations" |
| B6 | **A Checklist per kind of project.** With a recording: as today, and a transaction with no differences needs no opening to count as reviewed. Without one: add the steps, write the steps, write the document, hand off. *Confirm transaction* is asked for only while a step is a draft | S | The first screen of a new video project and of an empty one names its real first act; W1 and W2 are gone |
| B7 | **Outputs that fit the project.** Without a recording the PDD drops the lines that only describe one ("Recorded by: Not recorded", the transactions row and sentence, section 4.1), and section 5 says what a system is used for only when it is known, never "none". The Technical details is not written, and not zipped, when it would hold no row | S | The video project of 2.2 exports a PDD with no recorder wording and a zip with no empty workbook; the goldens of recorded sessions do not change |

#### Lane E: from a call or from notes

| # | Item | Size | Done when |
|---|---|---|---|
| E1 | **Paste your notes.** One box on Steps: a line is a step, the text after a colon its description; a line that starts with a document field's name ("Trigger:", "Volume:") goes to that field; list marks and numbers are dropped. It says what it will make ("12 steps, 4 document fields") before it does, as one undoable edit | M | Twenty steps typed in Notepad during a call are twenty steps in the project after one paste |
| E2 | **A step takes its picture from the video.** A step marked at a moment gets that frame as its screenshot, replaceable like any other; a step with no picture offers *Use the video here* in one click | S | The three steps of 2.2 print three pictures with no act |
| E3 | **The transcript beside the video.** A third tab next to Screenshots: the transcript as text, following the playhead, searchable, by speaker. A click on a sentence goes there. From a sentence: add a step here, add it to the selected step's description, add it to a document field | M | The useful part of a ninety minute call is found by reading and searching, not by scrubbing |
| E4 | **Not part of the process.** In a project without a recording, a selected stretch can be put aside (today's *Leave out of the analysis*, offered only with a recording): hatched, skipped when playing, its sentences left out of the transcript tab; *Include again* is the inverse | S | A thirty minute detour is one drag and is never played or read again |
| E5 | **Show the selected step here.** With a step selected, one button at the playhead gives it that moment; its place in the list stays (its place in the process is its own since 2.0.5) | S | Steps written first, from notes, each get their moment in two acts |
| E6 | **The Overview's transcript list shows everything** in a project with one unmarked transaction (today it opens on "(0)", because every sentence is inside that transaction) | S | The list is never empty while a transcript is attached |

Lane E leans on **D1** (name a step where you mark it) and **D6** (the
information a hand-added step uses), which stay in lane D.

#### Lane A: readable and reachable

Everything in section 3, plus the two critique items that are the same work.

| # | Item | Size | Done when |
|---|---|---|---|
| A1 | Zoom: Ctrl with plus, minus and 0 changes the app's zoom and is remembered | M | Every level holds at 150% on 1366 px without a cut-off control; a smoke checks it |
| A2 | Tokens: a fill for filled controls at 4.5:1 or more in the light theme; `--field-border` on every field; `--fg-4` never a text colour | S | A stylesheet guard test fails on a `--fg-4` text colour; the audit script reports no failing pair on text a person reads |
| A3 | Type floor: 12 px for anything read | S | No rule under 11 px; 11 px only for mono timestamps |
| A4 | One dialog helper (role, label, focus kept inside and given back) used by the prompt, the confirm, the chooser and Help | S | Tab never leaves an open dialog; the smokes that drive dialogs pass unchanged |
| A5 | Messages: the toast is a live region; an error stays until dismissed; a refused time or field keeps its reason beside it | S | The refusal of `timeline-edit-smoke` is still on screen after 5 s |
| A6 | Marking in sight and by keyboard: *+ Transaction*, *End transaction*, *+ Step* and *+ Note* at the playhead, beside today's *+ Step*; bands take focus (arrows along a lane, Enter opens the panel, the Menu key its menu); menus move with arrows | M | A project made from a video is marked from start to end without the mouse; the right-click menus stay as the shortcut |
| A7 | The steps lane is the Timeline's main lane: under the transactions, about 28 px, 12 px names at full contrast; the Systems lane lower once steps exist | S | Step names read at 1366 px on the demo; the audit's step-band pair passes |
| A8 | The playback bar shows on the Timeline only | S | It is absent on the Overview, Steps and Map |
| A9 | `lang`, glyph button names, `aria-expanded` on menus, a 24 px minimum for link actions, one focus ring | S | The audit reports none of A15, A16, A19, A21 |
| A10 | Tooltips: nothing is said only in a `title`; the long ones are cut or moved to Help | M | No `title` over 90 characters; each act that needed one has a visible line or a Help entry |
| A11 | One name per act: *Play* (not *Watch* or *Select + seek*), *Show on timeline*, *Open in Steps* | S | The copy guard lists the retired names |
| A12 | Capture: `lang`, the bar's state as a status, its problem line as an alert, the field edge | S | The same audit run on the capture pages reports none |

#### Lane C: the SME gives more, with less

| # | Item | Size | Done when |
|---|---|---|---|
| C1 | **Four questions at the end summary**, each one line, each optional, in the document's own words: what starts this work; what you have when it is done; how often you do it and how long one takes; what goes differently sometimes and what you do then. Saved on the recording. In the viewer each answer shows under its document field as "The SME wrote: ..." with *Use* | M | A recording answered by the SME opens with four fields one click from written |
| C2 | **Example files at the end summary:** *Add an example* (the e-mail, the sheet, the form) copies files into the recording's attachments | S | They are listed as attachments in the viewer and travel in the PDD's zip |
| C3 | **The capture app records the screen itself.** **Shelved** (the owner, 2026-11-10: "Video recording functionality should be optional in a future build. Document and shelf for now."). Its design is kept in section 10 | L | Not in this cycle |
| C4 | **A note at a moment** from the bar (*Note*, one line, for the analyst), shown on the Notes lane | S | Open: with C3 shelved there is no voice, so this is the one way an SME alone can say why at a moment. Decide with C1 and C2 |

#### Lane D: one editing space, and what the developer still asks for

| # | Item | Size | Done when |
|---|---|---|---|
| D1 | **The step panel edits** the name, the system and the description wherever it opens, with the editor's own handlers; a step added on the Timeline opens it with the name ready to type | M | A video project is marked, named and described without leaving the Timeline (W4) |
| D2 | **On Steps the panel keeps only what the editor lacks** (the video, the other occurrences); under 1440 px it opens on *Play* instead of standing as a third column | S | At 1366 px the editor has the width of two columns and nothing shows twice |
| D3 | **A transaction's name and *Delete transaction* on its row in Steps**, beside its times; the Markers tab goes | M | No act needs the Markers tab |
| D4 | **Marker changes apply by themselves in a recording too**, and "pending" leaves the vocabulary (the owner, 2026-11-10: apply by itself) | S | A transaction moved or added in a recording is in Steps a moment later with no Apply click, as in a video project; a change made while it updates is never refused |
| D5 | **The project's sources as rows** (the video, the transcript), each with its acts | S | No two *Replace* links side by side |
| D6 | **Information on a step added by hand:** a short list of what the step uses or enters (a name, an example, where it goes), typed by the analyst; printed in the PDD's systems and information section and in the Technical details. A recorded step shows its recorded fields in the same list | M | A project made from a video hands the developers a data list, and B7's workbook has its rows |
| D7 | **The automation's scope by step**, one choice in place of the Waste tick: not decided, the automation does it, stays with a person, no longer needed (today's Waste). The PDD's improvement section lists the steps by choice. On the map the choice is the box's corner icon, as the team's notation has it (manual or automated work; fact 5) | M | A developer reads from the PDD and from the map which steps to build |
| D8 | **Done by**, a role or an employee per step, defaulting to the recording's role, printed on the step's context line and as a label under the step's box on the map. No lanes: the team's notation has none (fact 5) | M | The PDD and the map say who does each step |

### 5.3 Order

1. **B6, B7, B3, B2, B1:** the app stops saying things that are not true of
   the project, and the zip is checked and clean. Small, and every starting
   point gains.
2. **E1, E2, D1, B4:** the acts go out of the video and notes paths (S3 to
   S5), where the process managers work today.
3. **E3 to E6:** the messy call (S4).
4. **Lane A** beside any of the above: its files (the stylesheet, the
   dialogs, the Timeline's keys) are apart from the rest.
5. **C1, C2, B5:** the SME's answers and files.
6. **D2 to D5,** then **D6 to D8.** (C3 is shelved: section 10.)

If the assumption in section 1 is wrong, lane C comes first. If most
projects start from a recording and not from a call (fact 1), 5 comes
before 2.

## 6. Cut or fold

| What | Verdict | Why |
|---|---|---|
| *Confirm transaction* where nothing is a draft | Cut (B6) | An act with nothing to confirm |
| The empty Technical details | Cut (B7) | A file with headings and no row |
| The backups and the log in a hand-off zip | Cut (B2) | Nobody who receives it reads them |
| The playback bar off the Timeline | Cut (A8) | A control whose video is not on screen |
| The Markers tab | Cut after D3 | Its acts move to the transaction's row; it is the only home of "pending" rows |
| *Select + seek here*, *Jump to step here* | Cut | A click on the band already does it; fewer names (A11) |
| The Waste tick | Folded into D7 | One choice carries it and three more |
| The dialog per step of *+ Add step* | Kept for one step; E1 for many | A paste replaces twenty dialogs |
| OBS (settings, the scene, the sync file) | Keep (the owner, 2026-11-10: "why not keep the OBS as well?") | It costs under 1 MB and works where it is installed; if C3 is ever built, one rule keeps a recording to one video (section 10) |
| "Pending" and *Apply marker changes* | Cut (D4; the owner: apply by itself) | The most technical idea on the path |
| Raw events | Keep, titled for developers | A developer's view; it costs a process manager nothing closed |

## 7. Keep as is

The folder as the project; hand-offs as numbered zips opened read only; one
start and one key for the SME; one clock; the step panel's three doors; save
as you go with undo; the Checklist's one next act; the reference transaction
confirmed and the others reviewed, in a recording; the map the PDD prints
shown first; the demo project; Help in the How-to's words; no network and no
AI inside. And what the recorder already gives with no edit (2.2): the plan
adds to it, it does not rework it.

## 8. Facts needed from the owner

1. **Which starting point is the common one** for the process managers
   today: a recording, a call's video, or notes? It sets the order (5.3).
   **Answered: a call's video, with no recorder.** The order of 5.3 stands.
2. **"Replacing the PM's":** the handwork, or the person? (section 1.)
   **Answered: the handwork.**
3. **May the capture app record the screen as video, and the SME's voice,**
   on a work laptop? **Answered: not a concern when it is optional; the
   feature itself is shelved for a future build (section 10).**
4. **How long is a typical recording, and a typical call?** Still open,
   and only for E3 now (a real transcript's length); C3 is shelved.
5. **Do the team's ADONIS models use lanes for roles on every model?**
   **Answered: no lanes.** The team's notation: a box is a step; an icon in
   its corner says manual or automated work; a label on top names the
   application the step is in; a label at the bottom names the role or the
   employee. The map already puts the application above the box; D7 gives
   the icon its meaning and D8 adds the label under it.
6. **How long does an analysis take on a real, long recording?**
   **Answered as a decision: marker changes apply by themselves** (D4). The
   time is still worth a look at the P5 session.
7. **What has a developer asked for after a hand-off** that the zip did not
   hold? Real misses outrank the lists in D6 to D8.

## 9. Not in this plan

Notes taken in the viewer during a call (the owner, 2026-11-10: impractical
for someone listening and trying to understand the process; they write in
Notepad, in Teams or on paper, and E1 takes that). Speech to text, or
anything that interprets what was said or writes for the process manager
(no AI inside). A 44 px touch size (a mouse and keyboard app). Comparing
recordings of the same process (the product edition's line). A screen
reader rewrite of the Timeline beyond focus, names and menus: the Steps
level stays the structured way through a project. The activity library's
contents (the owner's own work).

## 10. Shelved: the capture app records the screen itself (C3)

**Status: shelved by the owner, 2026-11-10**, as an optional feature of a
future build. Nothing of it is built. What was worked out, so that build can
start from here:

- **Why.** Without OBS a recording has no video, and SME laptops have no
  OBS. A process manager then gets screenshots and no way to watch the
  work, or has to record a Teams call and line it up by hand.
- **What it is.** The capture app records the screen with Chromium's own
  capture (the API `capture/screenshots.js` already uses for screenshots)
  and its built-in encoder, started, paused and stopped with the recording,
  written into the recording's folder on the recording's own clock. The
  viewer then has the video with no attach and no sync, and a step can take
  its picture from it (E2).
- **The build does not grow.** Electron already holds the capture and the
  encoder; this is the app's own code, no bundled program. A recording's
  folder does grow, by its video: unmeasured. Before fixing the frame rate
  and the size, record 30 minutes on a work laptop and read the file's size
  and the machine's load. The work is clicks and forms, so a low frame rate
  should do.
- **Optional, by two switches in Setup (analyst):** screen video, and the
  microphone (it picks up whoever is near or on a call, so it is its own
  choice). The owner: it is not a policy concern when it is optional. Which
  default each has is a decision for that build. With the optional consent
  window on, its text must say that video is recorded.
- **OBS stays** (the owner). One rule keeps a recording to one video: OBS
  connected, OBS records as today; not connected, the app records. The SME
  sees no difference.
- **What it has to handle:** more than one monitor (the screenshots'
  `display` rule is the model), a pause, a crash without losing the file
  (write in pieces), the storage limit, and the recording bar staying out
  of the picture (it already asks Windows to leave it out of captures).
- **Size:** large; the largest single item this plan had.
- **Goes with it:** C4, a typed note from the bar, matters more while this
  is shelved, since an SME recording alone has no voice.

## Evidence

The audit and the three walks ran from scripts kept outside the repo, with
their screenshots, counts and the files the app wrote, in this session's
scratch folder (temporary):
`C:\Users\rasha\AppData\Local\Temp\claude\4e5be0311df43307\674c64b0-0233-46c8-9099-117b92d7576a\scratchpad\`
(`ux-audit.js` with `audit1366\` and `audit1280\`; `walk-video.js` with
`walk\`; `walk-rec.js` with `walkrec\`). The ten most severe findings of the
audit were also reported through the code review of the same day. The
capture windows were read in `capture/ui/`; the earlier reviews this builds
on are [STEP-BACK-REVIEW-2026-09-23.md](STEP-BACK-REVIEW-2026-09-23.md),
[COMPANION-CRITIQUE-2026-09-23.md](COMPANION-CRITIQUE-2026-09-23.md) and
[UI-CLARITY-AUDIT-2026-09-23.md](UI-CLARITY-AUDIT-2026-09-23.md).
