# BA helper refocus: plan of record (2026-09-22, revised 2026-09-23)

> **Trigger:** owner decisions, 2026-09-22 and 2026-09-23, after a three-month
> pause and the restart review ([RESTART-POINT-2026-09-22.md](RESTART-POINT-2026-09-22.md)).
> **Status:** APPROVED 2026-09-23. The owner directed full implementation
> ("start implementing and don't stop until the whole plan is implemented and a
> light version is delivered") and handed the session full autonomy overnight.
> Owner-gated steps (the P1 real-recording probe, the P5 real-session gate, the
> QB formula) are built up to the point where the owner takes over.
> **Supersedes (on approval):** [APPROACHABILITY-REDESIGN-2026-07-03.md](APPROACHABILITY-REDESIGN-2026-07-03.md)
> as the operational plan. Its R5 sit-down is replaced by the real-session gate
> in section 11 (P5).
> **Unchanged authority:** the honesty rules (measured facts render as measured;
> nothing projected dresses up as measurement; gates gate whole composites) carry
> over as they are. This plan adds no new tiers or taxonomy.
> **Revision 2026-09-23:** D1 reversed from "the analyst marks every run by hand
> on the video" to "the recorder drafts, the analyst confirms run 1". The owner
> rejected manual marking: it reduces the recorder to a stopwatch and fails when
> there is no video. Light vocab and light template added (D6), privacy masking
> cut (D7), input modes defined (D8), transcript handling specified (section 7).

---

## 1. Why

PDT was built as a product for a buyer: a consultant hands a findings memo and
PDD to an operations leader, and the app is the assembly line behind a services
offering. The owner is not going to take a product to market. The goal now is a
tool that makes the owner's internal work (process manager / business analyst)
faster and produces documents that are actually used.

Evidence that the old shape did not serve that: in the 3.5 months after the
first real company session (2026-06-10) the app produced no real deliverable.
That session produced 8 defect reports; every later cycle was tuned against
demo data. The dread named in the approachability redesign came from naming
controls in a workbench, cutting machine fragments into cases, and a viewer
built for both.

## 2. The scenario

1. A process manager / BA gives the capture app to an SME.
2. The SME turns it on, performs the process a few times, and stops it,
   bracketing each run with the run hotkey. This happens either alone or during
   a call in which the SME describes the process.
3. **The recorder always runs.** It is the core input (section 4).
4. **Optionally, a video** from one of two sources:
   - the SME's own OBS recording of their screen (synced automatically by clock), or
   - an OBS or Teams recording of the meeting (synced by offset or by clicking a
     recognizable moment, as today; `annotations.json external_video.offset_ms`).
5. **Optionally, the meeting transcript** (Teams). It shares the meeting video's
   zero point; without a video it is synced the same way, by matching one
   sentence to one moment.
6. The analyst confirms the drafted steps and gets:
   - **a process map**, generated from the confirmed runs, finished in the map
     editor (As-Is, and a To-Be when wanted);
   - **a PDD**, tool-neutral, for any automation use case;
   - **business-case inputs** for the owner's existing QB project-management
     app, which holds the business-case formula (salary index). PDT does not
     compute money.

**Not recorded, therefore out of scope:** cases that are business-app
requirements or integrations. They go through the existing requirements
document, not PDT.

**Constraints (unchanged):** internal use only; no AI inside the product; no
network in the tool; raw `events.jsonl` immutable; analyst work lives in
`annotations.json` and survives re-analysis; two-machine model (SME laptop
records, analyst PC analyzes); releases ship unsigned (ADR-0026); assistants
never read real company captures (structure-only scripts only).

## 3. Decisions (2026-09-22 / 2026-09-23)

| # | Decision | Consequence |
|---|---|---|
| D1 | **The recorder drafts every run's steps; the analyst confirms run 1** against the video, or against the screenshots when there is none. Names and the run pattern are remembered and applied to the other runs and to later sessions of the same process. (Revised 2026-09-23; replaces manual marking.) | Step drafting becomes the central engine; its quality is the plan's load-bearing assumption (probe in P1) |
| D2 | **One active video per session**; when both an SME video and a meeting video exist, the meeting video is preferred (narration, transcript) | No dual-player work |
| D3 | **The business-case formula stays in QB**; PDT exports measured inputs. The input list is settled later with the owner | The in-app ROI module and the PDD ROI table go |
| D4 | **Phases are cut; the App Library and Process Template workbenches are cut** (their engines survive in light form, D6); other non-path features cut per section 8 | About half of the restart-point fix list becomes moot |
| D5 | **Transcript is a bonus**: read, align, show, pull into notes; no AI; built only after the core path passes its real-session gate | P6 |
| D6 | **Light vocab ("name it once") and light template ("run 1 is the pattern")** replace the workbenches (section 6) | Engines kept, editing screens cut |
| D7 | **Internal use: privacy masking is cut.** Values render as captured (real example values help a PDD). Password redaction in the recorder stays (credentials in files are a security issue regardless of audience). The consent screen stays configurable (`off` / `per_session` / `once` in `capture/config.js`) | `pii_masking`, masked tokens in labels, and the data-posture setting go; RP-08 and RP-35 become moot |
| D8 | **Two supported input modes**: recorder only, and recorder + video (+ transcript). Video only is a deferred fallback (section 4) | No video-only session type is built now |
| D9 | **v1.5.0 is shelved as the product edition after this plan is approved** | P0 |

"Cut" in this plan means removed from `master`. The complete product stays on
the `product-edition` branch and tag created in P0.

## 4. Input modes, and what the recorder is for

| Mode | Where steps come from | Timings | Field data (which field, which app, re-typed values) | PDD images | The "why" | Status |
|---|---|---|---|---|---|---|
| **Recorder only** | Drafted by the recorder; confirm run 1 against screenshots | Measured | Yes | Screenshots | Analyst notes | Supported |
| **Recorder + video (+ transcript)** | Drafted by the recorder; confirm run 1 against the video | Measured | Yes | Screenshots | SME narration; transcript sentences | Supported |
| **Video only** | Marked by hand | Only as precise as the marks | None | Frames at marks (not built) | SME narration | Deferred fallback: built only if real SMEs cannot run the recorder |

**What the recorder is for** (why it is always on):

1. It **is** the recording when there is no video: every click, field, window,
   with a screenshot.
2. It **drafts** the steps, so the analyst confirms instead of authoring.
3. It **measures**: time per step and per run, idle, switching. The QB business
   case needs these; a video cannot give them.
4. It **knows the field and the app**: the PDD's input-data section, and values
   re-typed between apps (the strongest automation evidence available).
5. It **remembers**: a name given once and the shape of a run carry into the
   next run and the next session (section 6).

The video is context: the SME's narration, the "why", and what happened off the
keyboard (phone, paper, waiting).

## 5. The analyst path

**In one sentence: open a recording, confirm the first run's drafted steps,
review how the other runs differ, finish the map, export the PDD.**

1. **Open** the session folder (arrives from the SME laptop as today).
2. **Attach video** if there is one; attach the transcript if there is one (P6).
3. **Confirm run 1.** The recorder has drafted run 1's steps. Proposed drafting
   rule, to be validated in P1: **one step per screen visit, ending at its commit
   action** (Save, Search, Submit, Enter). Rename, merge, split, drop; add a note
   or the waste flag. Check against the video, or against each step's
   screenshots. Every name given is remembered (light vocab). A missed run
   marker is added here by hand.
4. **Review runs 2..N.** They arrive drafted and named from run 1's pattern;
   only the differences need attention. Extra, missing, or reordered steps are
   the variants and exceptions the PDD needs.
5. **Check the map**: generated from the confirmed runs; differences show as
   branches.
6. **Finish the map** in the map editor (fork to As-Is / To-Be), which embeds in
   the PDD.
7. **Read the analysis**: facts and findings (where the time goes, switching,
   idle, repeated sequences, automation candidates).
8. **Export** the PDD (with the map), plus the QB inputs once D3 is specified.
   Optionally **"Save as this process"**, so the next session of the same process
   starts drafted and named.

Overview becomes the home: session summary, findings, and what is left to do on
this path. The current next-act rail is folded into that line.

**Cost model:** the first session of a new process costs one confirmed run plus
a review of the differences; a second session of the same process costs a review.

## 6. Light vocab and light template

The old versions failed on their editing screens, not on their engines. Keep the
engines, drop the workbenches.

**Light vocab: "name it once".** (Revised in implementation: see AD-7 in
"Implementation notes" below.)
- When the analyst renames a drafted step, the app stores the name keyed by
  that step's `draft_key` (a value-free identity the drafting rule already
  computes: `"<app>|<screen>|<commit>"`), in a remembered-names store
  (`<viewer userData>/pdt-library/remembered-names.json`), not in a per-app
  vocabulary YAML file. Step names are not control vocab entries; an exact
  `draft_key` lookup is simpler and cannot drift the way a re-derived
  signature can.
- In later sessions, drafts whose `draft_key` matches arrive named (the
  pipeline reads the store via the `--names` flag on every Analyze).
- UI: a small list of remembered names to rename or forget one. No workbench,
  no YAML, no signature fields, no coverage or dead-rule lists, no discovery.

**Light template: "run 1 is the pattern".** (Revised in implementation: see
AD-8 in "Implementation notes" below.)
- Within a session: runs 2..N are compared with confirmed run 1 by draft key
  (a merged step by its members' keys, a step added by hand by its label;
  contract C3), the one rule the viewer's differences view and the PDD share
  (`shared/run-differences-golden.json`). A rename carries to the same drafts
  in the other runs, a merge in run 1 is repeated on the same drafts, and a
  draft hidden in run 1 can be hidden in every run; steps that do not match
  are shown as differences. (Revised in implementation: the plan named the
  existing alignment engine, `viewer/step-alignment.js` `alignCases`; lane L7b
  removed it.)
- Across sessions: "Save as this process" stores run 1's confirmed pattern
  (its steps' `draft_key`s, names, descriptions, and waste flags) in a
  saved-process store (`<viewer userData>/pdt-library/processes.json`). On
  opening a session with no confirmed pattern run, the **viewer** matches it
  against saved processes by `draft_key` overlap and offers the closest one
  as the comparison pattern; the pipeline never reads this file. Canonical
  matching (`normalization/canonical_match.py`) is cut, not reused.
- UI: the save action and the differences view. No template editor, no YAML
  drawer, no version compare, no import-from-session panel.

**One engine per job (intended design, confirmed in P1):** within a session,
names propagate by draft key in the viewer; across sessions, light vocab
propagates through the pipeline's `--names` flag at draft time, and light
template propagates through viewer-side matching only. The viewer-side
advisory vocab matcher (`viewer/vocab-match.js`) is then no longer needed,
which also removes the JS vs Python regex drift (RP-17).

## 7. Transcript (bonus, P6)

Nothing interprets the transcript. The tool reads it, aligns it, and shows it;
the analyst does the thinking.

1. **Read:** parse the Teams `.vtt` or `.docx` into timestamped sentences with
   speaker names. The original file is kept untouched in the session folder;
   the parsed form is a derived file.
2. **Align:** shift every sentence by the video's existing sync offset; without a
   video, sync by matching one sentence to one moment.
3. **Show:** a transcript lane on the timeline; the sentences spoken during a
   step appear next to that step; filter by speaker.
4. **Pull:** select a sentence and it lands in the step's note, editable
   (auto-transcription garbles names and numbers). Notes flow into the PDD step
   descriptions. Talk outside the runs (purpose, scope, pain points, rules,
   exceptions) is pulled the same way into the PDD's document-level sections
   (see Q5). Stated volumes feed the QB inputs later, labeled as stated by the
   SME, never as measured.

Optional helpers, no AI: search; highlight sentences that contain a number or a
condition word ("if", "unless", "except", "only when") as a hint, never a change.

**AI is not part of the app.** If an approved internal AI exists (for example
Teams' own meeting recap, if licensed), the analyst uses it outside the tool and
pastes what is useful into notes. In-app AI is reconsidered only if an internal
AI is approved for this data **and** real use shows manual picking is the
bottleneck.

**Earns its place** only if the owner finds himself quoting the SME in real PDDs;
otherwise it is dropped.

## 8. Feature verdicts

Verdicts: **Keep (path)** is visible on the path; **Keep (support)** is
machinery the path depends on, invisible; **Rework** keeps the capability and
changes it; **Cut** removes it from master.

### 8.1 Capture (SME side)

| Feature | Verdict | Why |
|---|---|---|
| UI-interaction recorder (C# sidecar) | Keep (support) | The core input: drafts, timings, fields (section 4) |
| Foreground-window tracking, idle detection | Keep (support) | App time, idle, switching |
| Screenshots | Keep (path) | The review medium in recorder-only mode; PDD step images |
| Process markers + hotkey + guidance line | Rework | SME-facing wording becomes runs (start run / end run, one hotkey); nesting not needed |
| OBS video | Keep (path) | Optional SME-side video (Q2: can OBS run on SME laptops) |
| Live Session window | Keep (path) | The SME's only screen; trimmed to the path |
| Consent gate | Keep (support) | Configurable, `off` allowed (D7) |
| Worker close-out wizard | Rework | Becomes a one-screen end summary (runs, duration, events); the observed-value questions go |
| Readiness check, dead-man alert, watchdog, orphan recovery, storage manager, config | Keep (support) | Reliability on machines the analyst does not control |
| Capture-confidence signals; password redaction | Keep (support) | Inside the recorder; OCR stays opt-in and off |
| Sync markers (cross-machine) | Cut | No multi-worker correlation in the scenario |
| App-vocabulary prep sessions | Cut | Light vocab learns from naming instead |

### 8.2 Pipeline

| Feature | Verdict | Why |
|---|---|---|
| Case assignment from markers | Keep (path) | Runs are the cases; RP-01 must be fixed first |
| Step suggestion | Rework | Becomes the drafting rule (section 5 step 3); the plan's central engine; probed in P1 |
| Value-free screen labels | Keep (support) | Drafts are keyed and named by screen; identical steps group across runs |
| Canonical matching | Rework | Light template across sessions (D6) |
| App Vocabularies | Rework | Light vocab: engine kept for remembered names (D6) |
| Unbracketed-session recovery (suggested markers, anchor candidates) | Cut | A missed run marker is added by hand |
| Platform recognition | Keep (support) | Evidence labels |
| Structural PII masking | Cut | D7 |
| Statistics | Keep (support) | Step and run durations feed the PDD and the QB inputs |
| Non-destructive re-runs | Keep (support) | Analyst work is the core asset; RP-01 and RP-04 first |
| Activity classification, overrides, team taxonomy | Cut (UI) | Kept internally only if drafting or analysis needs it; decided in P1 (Q4) |
| Analysis: facts, findings, automation candidates | Keep (path) | Confirmed useful by the owner |
| Analysis: ROI | Cut | D3 |
| Process mining | Rework | The map mined from confirmed runs (step level); activity-level, per-case, and auto BPMN cells cut |
| Exports: PDD | Rework | Tool-neutral wording (today it says "robot" and follows the UiPath layout); no ROI table; QB inputs block later |
| Exports: map BPMN / SVG | Keep (support) | Map editor output, PDD embed |
| Exports: memo, findings report (HTML), XES, CSV | Cut | Not among the outputs |

### 8.3 Viewer

| Feature | Verdict | Why |
|---|---|---|
| Flow: video-synced timeline, playhead, range selection, minimap | Keep (path) | Where drafts are checked against video and screenshots |
| Flow: notes / screenshots / markers panel, "+ Step at playhead" | Keep (path) | Notes, marker repair, adding a step the draft missed |
| Optional timeline lanes | Keep (support) | Trimmed; a transcript lane arrives in P6 |
| Steps view | Rework | Becomes runs and steps: confirm run 1, then a differences view for runs 2..N; name, note, waste flag, split, merge, drop |
| Case tree / work items | Rework | Folded into the runs and steps view |
| Aligned reading | Rework | Becomes the differences view (light template within a session) |
| Detail slider (grain) | Cut | One drafting unit, no roll-up levels |
| Phases | Cut | D4 |
| Suggested markers, anchor candidates | Cut | See 8.2 |
| In-view process map | Keep (path) | Built from the confirmed runs |
| Reference maps (fork, editor, As-Is / To-Be, PDD embed) | Keep (path) | The map editor |
| Advanced map drawer, notation x level matrix | Cut | One map, one editor |
| Analyze (re-normalize in app) | Keep (support) | |
| Analysis findings | Keep (path) | |
| Overview | Rework | Home: session summary, findings, what is left on the path |
| Next-act rail | Rework | Folded into Overview |
| ROI panel | Cut | D3 |
| Compare Sessions view (all of it) | Cut | One session with several runs covers the scenario |
| Process Template editor | Cut | Engine survives as light template (D6) |
| App Library workbench, vocab semantics, discovery autofill, viewer-side matcher | Cut | Engine survives as light vocab (D6) |
| Copy for LLM + reviewed import, data posture | Cut | No AI path; D7 |
| Team taxonomy, project layer, command palette | Cut | Not on the path |
| Themes, keyboard shortcuts, recent sessions | Keep (support) | Cheap infrastructure |

### 8.4 New

| Feature | Phase | Shape |
|---|---|---|
| Drafting rule (screen visit ending at its commit action) | P1 | Pipeline; probed on a real recording before anything else is built |
| Runs and steps view (confirm run 1, differences for runs 2..N) | P4 | Viewer; compares runs by draft key (the alignment engine the plan named was removed in L7b) |
| Remembered names + small list | P4 | Light vocab (D6) |
| "Save as this process", applied on open | P4 | Light template (D6); today's "Save as reference for this process" |
| Transcript import, lane, pull into notes | P6 | Section 7 |
| Document-level sections for the PDD | P6 or earlier (Q5) | Purpose, scope, contacts, rules, exceptions as fields that survive re-export |
| QB business-case inputs | Later | A block or CSV row in the exact field order the QB formula expects |

## 9. Fix list, re-scored against this path

IDs refer to [RESTART-POINT-2026-09-22.md](RESTART-POINT-2026-09-22.md).

**Still required:**

| ID | Why it matters now |
|---|---|
| RP-01 | Critical. Marker cases get new IDs on every re-analyze while analyst-owned steps keep their old `case_id` (`step_suggest.py`, the preserved-steps merge restamps only label and grain keys). Every Analyze would strand confirmed runs in ghost cases |
| RP-04 | annotations.json durability: confirmed runs are the asset |
| RP-06 | Dropped (hidden) steps still rendered in the PDD |
| RP-09, RP-10 | Failed export or stage presented as success |
| RP-18 | Only if the viewer still computes screen keys after P1 |
| RP-20, RP-21, RP-22, RP-23, RP-24 | Capture reliability on SME machines |
| RP-27 | The structure-only inspection script still prints automation ids (assistant data rule) |
| RP-32 | Only if the viewer writes the remembered names (vocab files written non-atomically) |
| RP-34 | Unescaped case id in the Flow case dropdown |
| RP-36 | e2e shares the dev profile |
| CI-1, CI-2, CI-3 | CI green; CI-3 is the map editor's blocked Edit button, now a core tool |
| Deliverable-audit gaps 2-10 | Whichever still apply to the reworked PDD |

**Moot once the cut and rework land:** RP-02, RP-03, RP-05, RP-08, RP-11 to
RP-17, RP-19, RP-25, RP-26, RP-28 to RP-31, RP-33, RP-35, deliverable-audit gap
1. Two design lessons from them carry into P4: a keyboard shortcut must never act
on a selection the analyst cannot see (RP-12), and an accepted draft name must be
distinguishable from an analyst-given one wherever the difference matters
(RP-11). RP-07 (idle counted as active time) is re-checked against the timings
the QB inputs will use (see risk R2).

## 10. Risks

| # | Risk | Handling |
|---|---|---|
| R1 | **Draft quality** (the premise of D1). The June company session drafted labels like "TAMBA: Enter .19" | P1 probe with a kill/tune rule, before any rework is built |
| R2 | **Runs recorded during a call are slower than normal work**: the SME explains while working, so measured handling time is inflated | Timings for the business case come from runs recorded alone, or are labeled "recorded while explaining" (Q6) |
| R3 | **Old capture format**: the June session was captured with capture v0.9.0 and may not load cleanly (restart point G-2 history) | Probes use a fresh recording made with the current capture build |
| R4 | **SME machines are locked down**: only released builds run; OBS may not be installable | Q2; every probe that runs at work needs an owner-approved build |
| R5 | **Re-export vs Word edits**: editing the exported PDD in Word and then re-exporting loses the edits | Q5 |

## 11. Phases

Each phase: branch off `master`, fast-forward back, delete the branch. Tests,
e2e pins, and goldens are updated deliberately in the same change that alters
them, never left red. Every phase ends with the owner's go.

| Phase | Content | Gate |
|---|---|---|
| **P0 Shelve** | Commit the restart point and this plan; create the `product-edition` branch and tag at that commit; refresh CLAUDE.md "START HERE" to point here (doc edit, approved with the plan) | Owner approval of this plan |
| **P1 Draft probe** | Implement the drafting rule as a pipeline option; check it on the demo; then an owner-approved lab build is run by the owner on a fresh real recording at work (one process, 3 runs, markers). The owner reports numbers only: drafted steps per run, and boundary fixes needed in run 1 (merge, split, add, drop; renames are expected and not counted). Also settle Q4 | **Kill/tune rule:** more than 2 boundary fixes per 10 drafted steps means the rule is tuned and re-probed before P2. If it cannot get there, D1 is revisited with the owner |
| **P2 Cut** | Remove the section 8 "Cut" items from master in whole-feature slices (UI, pipeline stage, tests, e2e smokes, doc registry entries together). Update the session golden and e2e pins deliberately where outputs change; move the map-connectivity pin to the step-level map | Suites green on the smaller app; the viewer shows only the path |
| **P3 Fix** | The section 9 survivors; CI back to green on GitHub | CI green on all three workflows; no open survivor |
| **P4 Rework** | Runs and steps view (confirm run 1, differences for runs 2..N); light vocab and light template; Overview home; map from confirmed runs; capture end summary and run wording; tool-neutral PDD | e2e covers the path end to end on the demo |
| **P5 Real-session gate** | The owner takes real SME sessions through the whole path, timed: one recorded alone and one recorded during a call; then a second session of the same process to test that it arrives drafted and named | A map and a PDD the owner would actually send; the second session needs only a review. Demo data never closes this gate |
| **P6 Transcript (bonus)** | Section 7 | Earns its place only if the owner quotes the SME in real PDDs; otherwise dropped |
| **Later** | QB business-case inputs, after the formula is specified | |

## 12. Open questions

| # | Question | Needed by |
|---|---|---|
| Q1 | The QB formula: which inputs, and which come from the recording (for example handling time per run) versus typed in QB | Later phase |
| Q2 | Can OBS run on SME laptops (locked-down machines)? If not, the meeting recording is the only video source | P4 |
| Q3 | Does the tenant allow downloading Teams transcripts as `.vtt` or `.docx`? | P6 |
| Q4 | Does drafting or the analysis still need activity classification, viewer-side screen keys, or the viewer-side matcher? | P1 (investigation) |
| Q5 | PDD document-level sections (purpose, scope, contacts): fields in the app that survive re-export, or written in Word after the final export? | P4 |
| Q6 | Which runs feed the business-case handling time: runs recorded alone, runs recorded during a call, or both with a label? | Later phase (with Q1) |

## 13. What carries over from earlier plans

- Real-session acceptance: no phase that claims usefulness closes on demo data.
- The use gate, restated for this path: a surface stays only if, on a real
  session, it produces a PDD sentence, a map element, a recorded analyst
  decision, or an instruction to the SME. Anything else is cut.
- Every new verb ships with its inverse and a real-run check (COHERENCE-AUDIT).
- Suggest, never mutate; raw data immutable; honesty rules unchanged.
- Probe the load-bearing assumption first (P1), before building on it.

## Implementation notes (2026-09-23)

Decisions made while implementing this plan: autonomously while the owner
was asleep, or on the owner's word where a quote says so (the full record
and reasoning: `.claude/agent-findings/2026-09-23_ba-helper-cycle-resume-state.md`).
AD-7 to AD-15 are consolidated in
[ADR-0029](../adr/0029-ba-helper-refocus.md), which this section points to
rather than duplicates; AD-16 to AD-28 and what the owner parked are
recorded here.

- **AD-7.** Light vocab is a remembered-names store keyed by a drafted
  step's `draft_key`, not app-vocab YAML entries (revises section 6).
- **AD-8.** Light template is a saved-process store matched in the viewer
  by `draft_key` overlap; `canonical_match.py`, the Process Template editor,
  and `viewer/canonical-author.js` are cut, not reused (revises section 6).
- **AD-9.** The detail (grain) slider, the map matrix and its expert
  drawer, and activity-level mining (XES/CSV) are cut together with the map
  lane that replaces them.
- **AD-10.** "Save as reference for this process" and "Match Process
  Template" are cut with the template engine; "Save as this process" (AD-8)
  replaces them.
- **AD-11.** Map SVG / step-BPMN export moves from the cut Compare view
  into the Session Export menu.
- **AD-12.** The Markdown session report and starred screenshots were
  planned to go with the HTML findings report; in the PDD rework (P4/L10)
  starred screenshots ended up embedded in the PDD's findings section
  instead of being cut. AD-24 then cut that section, so
  `starred_screenshots` is a legacy key nothing reads (see
  [shared/SCHEMA.md](../../shared/SCHEMA.md)).
- **AD-13.** The Overview CTA becomes "Export PDD"; "include in memo"
  becomes "include in PDD" (`memo_selection` fed the PDD's section 1).
  AD-24 cut that section and lane V1 removed the ticks, so `memo_selection`
  is a legacy key too.
- **AD-14.** A session with no run markers shows an instruction to mark
  runs on the Timeline (then called Flow), replacing the anchor hero and
  the anchor-based lock copy (anchors are cut).
- **AD-15.** Canonical matching is cut with its drift markers and
  `--canonical`; activity classification and `--taxonomy` stay until open
  question Q4 is settled (AD-16).
- **AD-16 (Q4 settled).** Drafting uses no activity classification; the
  analysis stages do (statistics, waste, efficiency, the findings), fed by
  the bundled `taxonomy.yaml` the viewer always passes. Classification stays
  an internal engine with no editing UI. The viewer's screen keys and
  `recognition.js` stay, both in use. Why: keep the engines that create
  value, cut the editing screens.
- **AD-17.** The UI clarity audit
  ([UI-CLARITY-AUDIT-2026-09-23.md](UI-CLARITY-AUDIT-2026-09-23.md)) became
  the scope of the subtraction lanes, LUX-A (the Overview and the chrome)
  and LUX-B (Flow, Steps and the Map). It departed from section 8.3 by
  deleting the Flow Notes tab, whose notes never reached the PDD. AD-27
  reversed the notes half: notes pinned to a step or a moment are back as
  `annotations.analyst_notes` (contract C16), which the pipeline keeps and
  the PDD does not print; the viewer does not show them yet.
- **AD-18.** The map and its As-Is copy work from one run. The plan's gate
  (two runs, 70% coverage) left a one-run session with no way to a PDD. A
  session with no runs marked still has no map, and says how to mark them.
- **AD-19.** Forking is one act: "Edit as the As-Is map" analyzes first
  when the steps changed since the map file was written, so the copy
  carries the current step names, and makes the copy the PDD's As-Is map
  when none is chosen. Why: the PDD's As-Is picture contradicted its own
  step list after renames.
- **AD-20.** The "repeated sequences" findings merged into the automation
  candidates, ordered by total time, in the viewer and in the PDD's section
  1: one fact, one home, and the runs are deliberate repeats anyway. AD-24
  then cut section 1, and lane V1 replaced the Overview's findings with two
  observations (data typed twice, where the time goes), in which the time
  per application takes the candidates' place.
- **AD-21.** The docs were split to use a free agent slot: the top-level
  docs (L12b-1: SCHEMA, CLAUDE.md, README, OVERVIEW, DATA-MODEL,
  NORMALIZATION, the docs index, the CHANGELOG) beside the transcript UI,
  the rest later. On 2026-09-24 a docs lane brought the capture, pipeline,
  schema, deploy, troubleshooting and ADR docs up to date; the viewer docs,
  FEATURES, CHIP-GUARDRAILS, the e2e README, the in-app Help and CLAUDE.md
  are still to be updated after the viewer lanes.
- **AD-22.** A concept-level step back (lane LUX-2) ran before the release,
  with the owner's test: an element must give meaningful or valuable
  information, give control, or be a feature. Its two phases are in
  [STEP-BACK-REVIEW-2026-09-23.md](STEP-BACK-REVIEW-2026-09-23.md). Two
  outcomes change section 8.3: the analysis runs by itself (on open when it
  is missing or older, after the changes it depends on, before a PDD
  export; no Analyze button), and the More menu is gone.
- **AD-23.** The integrated navigation is core value, not only the outputs
  (owner): a process manager matches steps to the video and the
  transcript; a developer opens the folder and goes from the map to the
  video, the transcript and the screenshots instead of juggling files. The
  plan did not name this. It is lane V2's scope (one step panel opened from
  a map box, a timeline band or a Steps row, with a small video; the video
  stored relative to the folder so the session travels); not landed yet.
  The draft's reason ("ended at Save order") stays in the step pane's fact
  line (landed in LUX-B).
- **AD-24.** The step-back review's first phase was adopted for the PDD and
  the pipeline (lane LUX-P): the findings section is cut (re-keyed data
  moved into the data section, as requirements); a context line per step;
  names travel with the session (a draft takes the session's own names
  before the remembered-names store); grid tables and a map printed on a
  page of its own; the document fields trigger, result and improvement;
  Applications and time in place of the application and candidate tables;
  one data table; variations with their descriptions and run counts; the
  reader's order; BPMN tasks carry descriptions, and the start and end
  events take the trigger and the result. Why: the owner wants outputs a
  process manager can hand over, practical over analytical. Deferred: step
  time measured from the end of the previous step.
- **AD-25.** Sessions without a recorder are built before the release,
  reversing D8 (owner: "We ship when it's ready, there is no value in
  shipping something that... has no value"). A session can start from a
  video or from nothing (`manifest.source`, contract C16), with one implicit
  run until runs are marked, and steps placed by hand. The pipeline half
  has landed (lane V3-P); the viewer half (New from video, a timeline on the
  video clock, frames as step screenshots) has not. The release has no
  date: it ships when every lane is in and checked.
- **AD-26.** The step-back review became lanes: P (the PDD, AD-24), V1
  (the viewer shell and home), V2 (navigation), C (the capture app), then
  docs. Landed: P; V1 (the analysis runs by itself, one top bar, no More
  menu, two observations on the Overview, the trigger, result and
  improvement fields, a video synced by clicking, Recent named by the
  document title, Flow renamed the Timeline); C (a small recording bar in
  place of the Live Session window, one start that begins with Run 1, an
  end summary with a local zip for the analyst, consent text version 2).
  V2 has not landed. Exceptions: the step time from the end of the previous
  step stays deferred with the parked timing items. One clock: times are
  shown and printed as the time since the recording started (m:ss,
  h:mm:ss), the time of day only where the date matters; the PDD and the
  recording bar use it, the viewer's time labels do not yet. Open owner
  fact: whether a developer who receives the folder may change it.
- **AD-27.** Owner correction ("I feel you are overcomplicating it
  again... creating a product again"): the proposal for telling the whole
  process story was withdrawn, except what the owner named (the system on
  steps and map boxes; the application list and the data table in the PDD,
  both in AD-24). Dropped: recorded versus stated marks, error detection,
  value matching, open-question lists, search, roles. The new direction is
  a business process companion that holds all the context in one place and
  lets the analyst add what the recording lacks. Lane V3, "companion
  basics", replaced the story lane and absorbed the video-only lane: a
  project from a video or from nothing; screenshots added by hand (a video
  frame, a pasted image, a file) and the one the PDD prints; notes pinned to
  a step or a moment; attachments of any file on the project or a step,
  kept in the folder and listed in the PDD; the system of a hand-added
  step. The pipeline half (V3-P, contract C16) has landed; the viewer half
  has not.
- **AD-28.** The companion critique
  ([COMPANION-CRITIQUE-2026-09-23.md](COMPANION-CRITIQUE-2026-09-23.md)) was
  adopted. Landed: the As-Is map is no longer a stage of What is left (the
  PDD prints the edited As-Is copy when one exists, else the map from the
  runs); one shared rule for system names (`shared/system-names.json`) in
  the pipeline and the PDD; the summary line counts the reference run's
  steps; the PDD says the runs were recorded as a walkthrough. Not landed
  (lane V2): no Confirm on runs 2 to N (the Other runs stage completes once
  each run's differences were opened); the system names on the viewer's
  legend, fact line and map boxes; a step pane led by the system, with the
  fields typed and no Save button; the probe line moved to the reference
  run's menu.
- **Parked by the owner (2026-09-23)**, "practical, but no current value.
  We'll see how the adoption goes": a project link and a document status or
  sign-off; optional timed runs with a measured handling time (the business
  case data comes from the QB intake form and is only validated; recordings
  are full of stops and explanations); stable step ids; the time saved
  derived from the To-Be map; a before and after comparison; deep links from
  the PDD; a list of documented processes; merging several SMEs'
  recordings; a test scenario export.
