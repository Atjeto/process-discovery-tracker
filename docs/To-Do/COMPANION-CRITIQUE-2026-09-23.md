# Companion critique: the light viewer as it stands, screen by screen (2026-09-23)

> **Status:** coordinator's design critique (Fable), written after the owner asked for
> a real judgment of content, screens, fields, wording and how the parts fit. Grounded in
> the screenshots of the walked viewer at `bdda909` (the step-back review's evidence), the
> exported PDD text and the code. Verdicts, not options; each item names the lane that
> applies it. The two gates: is it true, and who does what differently after seeing it.
> The frame is the owner's: a business process companion. The analyst prepares the map
> and the PDD the way they always did, with every piece of context in one place.

## 1. How the parts fit

**The inversion to name.** The levels are organized by artifact (Timeline, Steps, Map),
while the analyst works by step: for one step they want its moment in the video, its
screenshot, what was said, the fields typed, and to write its name and description. Today
one step is spread over two levels (name, description, said and a thumbnail in Steps; the
video and the timeline in Flow) and checking run 1 is a round trip per step. The review's
panel (one component opened from a map box, a timeline band or a Steps row, with a small
video that plays the occurrence) closes this without merging levels. Verdict: build the
panel (V2); keep the Timeline level for run repair and browsing; do not merge levels.

**Ceremony on the path.** "What is left" is the best element and it should not ask for
acts that change nothing:
- Confirming runs 2 to N. Run 1 is the reference and its confirmation carries meaning
  (names, the PDD's steps). For the other runs the analyst fixes what is wrong and moves on;
  a Confirm click per run is a per-item ask with no consequence in the document (6.1 prints
  the differences either way). Verdict: no Confirm on runs 2 to N; the "Other runs" stage
  reads "3 runs differ from the reference" and completes once each run's differences have
  been opened (V2, with the smokes that confirm runs 2 to 4).
- The As-Is map as a mandatory stage. A PM who is happy with the map from the runs should
  not have to fork it to export. Verdict: the PDD embeds the edited As-Is copy when one
  exists, else the map from the runs; the stage leaves the line, the button stays (V1 for
  the line, P and the export path for the image).

**One vocabulary of systems.** The timeline legend says Chrome and notepad, the step fact
line says "Google Chrome (browser)", the map says "va01: Check document", the PDD's table
says Google Chrome (browser). The system is Salesforce, SAP, Excel, Outlook; the browser is
where it ran. Verdict: one rule from app and screen to system name, shared between Python
and the viewer as a JSON file next to the label patterns, used by the legend, the fact
line, the map boxes, the Applications section and the data table (P moves app_names.py's
rules into shared; V2 reads them). Two lists would drift.

## 2. Overview

| Element | Verdict | Reason |
|---|---|---|
| What is left | KEEP; drop the As-Is stage; "Reference run" | The one line that leads |
| Summary line "5m42s · 4 runs · 0 of 30 steps confirmed" | FIX: "4 runs · 7 steps in run 1" | 30 sums every run's steps; the process has 7 |
| Document fields (10 with trigger, result, improvement) | KEEP | Each prints in its own PDD place |
| Findings, evidence, ticks | GO (V1 is doing it) | Nothing a PM acts on |
| "From the transcript" under the fields | KEEP | Feature |
| Analysis log at the foot of every level | GO (V1) | Machine layer |

## 3. Steps

| Element | Verdict | Reason |
|---|---|---|
| Fact line "6s · Google Chrome (browser) · 4 interactions on Salesforce - Account lookup, ended at Search" | REWRITE: "Salesforce · Account lookup · 6 s · ends at Search" | System first, then the screen; "interactions" is a machine word |
| Fields typed in the step | SHOW in the pane as a compact list (field, value), not under More | The PDD prints them; the PM describes the step from them |
| Save button | GO: name saves on Enter or blur, description on blur, waste on click; Undo stays | A form with Save is friction times seven steps; the document fields already autosave |
| Description prefilled with the drafted narration | HINT, not content (V2 already) | The PDD leaves it out unless edited: a trap |
| Probe line "Run 1: 7 drafted steps, 0 boundary fixes (merge 0, split 0, add 0, hide 0)" with Copy | DEMOTE to the reference run's menu until the P1 probe closes | An instrument in the main pane |
| "Pattern", "remembered", "Edited" chips | "Reference"; one line per run for names; chips only where a row differs (V2) | Glossary; noise |
| "+ Add step", "What is a step?" | KEEP | Control; help on demand |
| Right pane when nothing is selected | KEEP the one sentence | Instruction |

## 4. Timeline

| Element | Verdict | Reason |
|---|---|---|
| Bands by app, legend "Chrome, notepad, idle" | Systems, one vocabulary (section 1) | The same name everywhere |
| Time axis in time of day | Elapsed since the recording started (V2) | One clock with the PDD's pointers |
| Video pane | KEEP; controls above the fold at 1366x768 (V2) | Feature |
| Screenshots tab default, Markers tab | KEEP | Review medium; run repair |
| Lanes menu, zoom, Raw events (closed) | KEEP as the review left them | Occasional controls |

## 5. Map

| Element | Verdict | Reason |
|---|---|---|
| Boxes with step names | ADD the system on each box (owner's ask) | The map annotated with where each step happens |
| Node tap "step · entered 5× · left 5×" | GO; the panel instead (V2) | Mining words; a dead end |
| "Edit as the As-Is map", "Edited maps" | KEEP; "As-Is and To-Be maps" | One act; glossary |
| The editor's palette over the first task | FIX (V2) | Legibility |

## 6. PDD (the export)

The step-back review's verdicts stand and LUX-P applies them. Two additions:
- The timings table says in one line that the runs were recorded during a walkthrough.
- The map embedded is the edited As-Is copy when one exists, else the map from the runs.

## 7. What was mine

The confirm-every-run flow and the Save model came from my own briefs (L7a, L7b); the
notes deletion (AD-17) was my call and is reversed; the 30-step count is the summary line
I asked for. The critique above indicts those first.

## 8. The instrument

The first real session settles the rest: time from receiving the folder to a PDD draft,
and which screens and fields the PM touched on the way. Every element nobody touched in
two real sessions is a candidate for the next cut.
