# BA-helper cycle: resume state (started 2026-09-23)

Read this first if you are resuming this cycle (fresh session or after context
compaction). Plan of record: `docs/To-Do/BA-HELPER-PLAN-2026-09-22.md` (approved
2026-09-23). Baseline: `docs/To-Do/RESTART-POINT-2026-09-22.md`.

## Goal (owner, 2026-09-23, verbatim)

"start implementing and don't stop until the whole plan is implemented and a light
version is delivered." The owner is asleep; the session is fully autonomous.

## Goal update (owner, 2026-09-23 night, verbatim)

"Going to sleep. /goal continue building until everything is covered. If limit is reached, recover once it resets." Queue: LUX-P and V1 (running), V2 (Steps and map per AD-26/AD-28), C (capture), V3 companion basics (AD-27: projects from a video or from nothing, hand-added screenshots, notes pinned to steps or moments, attachments, systems for hand-added steps), docs (L12b-2 plus the review's docs items), then a validated packaged build (publish only when ready; the owner said there is no rush). Spend-limit recovery: after a 429 kill, diff the trees, wait for the reset with a background sleep, then resume the same agents with their inventories. No narration.

## Operating mode

- Coordinator (main session) plans, briefs, reviews, verifies, commits. Agents
  build. At most two agents in parallel, disjoint lanes.
- Coordinator-commits mode for every lane: agents never commit; the coordinator
  reviews the diff and commits by explicit path.
- Commit style: bare imperative subject, no prefixes, no Co-Authored-By trailer,
  no em or en dashes anywhere, message written from Bash and passed with
  `git commit -F`; verify the subject with `git log --oneline -1`.
- Branch per lane off master, fast-forward master, delete the branch.
- Two tracks: Track V (viewer + capture) works in the main checkout; Track P
  (Python pipeline) works in a separate worktree so e2e runs in the main
  checkout never read half-edited pipeline code.

## Autonomous decisions (owner may revisit)

| ID | Decision | Why |
|---|---|---|
| AD-1 | Execution order: P0 shelve, P2 cut, P3 fix, P1 drafting rule, P4 rework, P6 transcript, docs, release | The P1 probe needs the owner at work with a real recording; building the rule on the smaller codebase is cheaper; the probe instrument ships with the lab build |
| AD-2 | Q5 answered as: PDD document-level sections are fields in the app (they survive re-export); Word edits after the final export stay possible | Needed for transcript pulls and for re-export safety |
| AD-3 | The light version is 2.0.0 | Breaking cut of many features |
| AD-4 | P6 transcript is built now, ahead of the P5 gate | Owner directive covers the whole plan; flagged to drop if P5 shows no value |
| AD-5 | QB business-case inputs stay deferred | Owner: "We can work through the formula later" |
| AD-6 | Delivery = packaged zips in dist/release plus a GitHub pre-release | P5 real-session gate still pending, so not marked Latest |
| AD-7 | Light vocab = remembered-names store keyed by `draft_key` (contracts C4) | Step names are not control vocab entries; exact-key lookup cannot drift |
| AD-8 | Light template = saved-process store matched in the viewer (C5); canonical_match, the Template editor and canonical-author.js are cut | Simpler than template matching; no second segmentation path |
| AD-9 | Detail slider (V9), map matrix + expert drawer (V11) and activity-level mining + XES/CSV (P6) are cut in the map lane (L9) together with their replacement | They carry the Fork source, the golden's dfg block and the connectivity pin |
| AD-10 | "Save as reference" and "Match Process Template" are cut with the template engine (L1b/L3); "Save as this process" arrives in L8 | AD-8 |
| AD-11 | Map SVG / step-BPMN export moves from Compare into the Session Export menu | Plan keeps map exports; Compare is cut |
| AD-12 | Markdown session report and starred screenshots go with the HTML findings report | Not among the outputs; use gate |
| AD-13 | Overview CTA becomes "Export PDD"; "include in memo" becomes "include in PDD" (memo_selection keeps feeding PDD section 1) | The memo is cut; the PDD is the deliverable |
| AD-14 | A session without run markers shows an instruction to mark runs in Flow (replaces the anchor hero and the anchor-based lock copy) | Anchors are cut |
| AD-15 | Canonical matching goes with its drift markers and `--canonical`; classification and `--taxonomy` stay until Q4 is settled | AD-8; Q4 open |
| AD-16 | Q4 settled: drafting (step_suggest, case_assignment) uses no classification; the analysis stages (efficiency, waste, stats, PDD section 1 findings) do, fed by the bundled taxonomy.yaml the viewer always passes. Classification stays an internal engine with no editing UI; viewer screen keys (steps-view screenType) and recognition.js (step-editor interaction text) stay, both in use. Any remaining category display is judged by the UI clarity audit | Keep engines that create value, cut editing screens (owner lesson 2026-09-23) |
| AD-17 | The UI clarity audit (docs/To-Do/UI-CLARITY-AUDIT-2026-09-23.md) is adopted as the subtraction lane's scope: P1, F1 to F4, P2, P3. This includes deleting the Flow Notes tab, which departs from plan 8.3 | Notes never reach the PDD and without a video are stamped with the analyst's clock; the step Description and document Notes reach the PDD and the transcript pulls into them. Reversing fact: the owner wants timed notes printed in the PDD |
| AD-18 | The map and Fork are allowed from one run (the 2 run / 70% gate goes; the "no runs marked" lock stays) | A one-run session could never reach Export PDD |
| AD-19 | Fork is one act: it runs Analyze first so the copy carries the current step names (F1) and creates the copy as the PDD's As-Is map when none is chosen | The PDD's As-Is image contradicted its own step list after renames |
| AD-20 | "Repeated sequences" findings merge into Automation candidates in the viewer and in PDD section 1; candidates are ordered by total time in both | One fact, one home; the runs are deliberate repeats, so the repeat count restates the protocol |
| AD-21 | Docs split: L12b-1 (SCHEMA, CLAUDE.md rewrite, README, OVERVIEW, DATA-MODEL, docs index, CHANGELOG catch-up) runs beside L11b; L12b-2 (VIEWER, VIEWER-TIMELINE, FEATURES, CHIP-GUARDRAILS handles, e2e README, Help content) after the subtraction lane | Uses the free agent slot; the viewer-facing docs wait for the final UI |
| AD-22 | A concept-level step back (lane LUX-2) runs after LUX-A and LUX-B merge and before the release, with the owner's test (2026-09-23): "Interface needs to either provide meaningful info, valuable info, or provide control, or be a feature." Scope: the whole path as a BA walks it; containers and internal steps (the More menu dissolves, Analyze session becomes automatic: on open when the analysis is missing or stale and after changes it depends on); the four levels; findings, evidence and value-add content (still analytical?); one plain vocabulary and verbosity; the PDD and the map from the reader's side; the SME capture app. Coordinator decides; one lane applies | The audit trimmed inside the existing structure; the owner asked for a step back |
| AD-23 | The integrated navigation is core value, not only the outputs (owner 2026-09-23): PMs match steps to the video and transcript and see what each step refers to and why; developers load the session folder in the viewer and go from the map to the video, transcript and screenshots instead of juggling an image, a video and a Word file. LUX-2 therefore (a) walks both roles, (b) adds navigation from a map node to its steps, their moments in the video, their screenshots and what was said (today a node click only highlights it), (c) makes the session portable: an attached video is stored as an absolute path on the PM machine, so a developer opening the folder elsewhere loses it (transcript and screenshots already travel inside the folder), (d) keeps the draft why ("ended at Save order") visible. LUX-B told to delete no navigation path and to fold the draft why into the step fact line | Owner direction on what the app is for |
| AD-25 | Video-only sessions are built before the release (owner 2026-09-23, answering Q-VIDEO: "It's for personal use. We ship when it's ready, there is no value in shipping something that... has no value"). Lane LUX-V after the step-back viewer lane: New from video (the video copied into a new session folder), a timeline on the video clock when there are no recorded events, the pipeline accepting an empty events.jsonl, steps and runs placed by hand, frames captured as step screenshots. The release has no date: it ships when every lane is in and checked | Owner decision |
| PARKED | Owner 2026-09-23, "practical, but no current value. We'll see how the adoption goes": project link and document status/sign-off; optional timed runs with a measured AHT (the business case data comes from the QB intake form and is only validated; recordings are full of stops and explanations); stable step IDs; the To-Be-derived time saved; before and after comparison; deep links from the PDD; a list of documented processes; merging several SMEs' recordings; test scenario export (devs test) | Owner decision |
| OPEN-STORY | Owner question 2026-09-23: how the viewer tells the whole business process story (data captured automatically or added by hand) for process/project management, process optimization and automation development; examples: applications annotated on the map, a list of apps in the PDD, input data defined in the PDD or an imported reference data set in the viewer. Coordinator proposal given in chat; phase 2 review asked for a data inventory | Discussion |
| AD-26 | The step-back review (docs/To-Do/STEP-BACK-REVIEW-2026-09-23.md, both phases) is adopted as lanes: P (running as LUX-P per AD-24), V1 shell and home, V2 navigation, C capture, then docs. Exceptions: review item P4 (step time from the end of the previous step) stays deferred with the parked timing items; the new document keys are trigger, result and improvement (C6 as LUX-P writes it). One clock: labels in the viewer and pointers in the PDD use the time since the recording started (m:ss or h:mm:ss); the time of day shows only where the date matters. pdd_findings stays written until V1 removes the ticks, then a small cleanup drops it. The owner's story items (OPEN-STORY) follow V1 and V2 as lane V3 once the owner answers. Open owner fact: whether a developer who receives the folder may change it | Review adopted |
| AD-27 | Owner correction 2026-09-23 ("I feel you are overcomplicating it again... creating a product again"): the OPEN-STORY proposal is withdrawn except what the owner named (systems on steps and map tasks; the app list and data table in the PDD, both in LUX-P). Dropped: recorded vs stated marks, error detection, value matching, open-question lists, search, roles. New direction: a business process companion that holds all context in one place and lets the analyst add what the recording lacks. Lane V3 "companion basics" replaces the story lane and absorbs LUX-V: start a project from a video or from nothing; add screenshots by hand (a video frame, a pasted image, a file) to any step and pick the one the PDD prints; notes pinned to a step or a moment, shown where that step or moment shows (reverses the notes half of AD-17); attachments of any file (example email, input spreadsheet, SOP, form) on the project or a step, kept in the folder and listed in the PDD; the system of a hand-added step set by hand | Owner direction |
| AD-28 | The companion critique (docs/To-Do/COMPANION-CRITIQUE-2026-09-23.md) is adopted: no Confirm on runs 2 to N (the Other runs stage completes once each run's differences were opened); the As-Is map stage leaves What is left (the PDD embeds the edited copy when one exists, else the map from the runs); one shared rule for system names (app and screen to Salesforce, SAP, Excel, Outlook) used by the legend, the fact line, the map boxes and the PDD; the step pane leads with the system, shows the fields typed, and saves without a Save button; the probe line demotes to the reference run's menu; the summary line counts the reference run's steps; the map shows the system on each box. Routing: V1 (summary line, What is left stage), V2 (Steps and map items), P (shared system-name rules, walkthrough note, map fallback) | Fable critique 2026-09-23 |
| AD-24 | The step-back review phase 1 (docs/To-Do/STEP-BACK-REVIEW-2026-09-23.md, uncommitted until phase 2) is adopted for the PDD and pipeline: cut section 1 (re-keyed data kept as requirements), a context line per step (system, screen, average time, in N of M runs, Run 1 at 0:19), F1 names travel with the session (session-local names by draft_key before --names; groupings by draft_key), grid tables and a printable map, document fields trigger/result/improvement (C6), Applications and time replaces 4.2 and 5.3, one data table, 6.1 with descriptions and 6.3 folded in, method sentences cut, reader order, BPMN tasks carry descriptions and named start/end, the glossary. The step-time definition (from the end of the previous step) waits for the viewer decision. pdd_findings and memo_selection stay until the viewer lane removes the ticks | Owner: practical over analytical; outputs a PM can hand over |

Shared files: contracts `.claude/agent-findings/2026-09-23_ba-helper-contracts.md`; cut map `.claude/agent-findings/2026-09-23_ba-helper-cut-map.md`.

## Lanes and status

| Lane | Track | Content | Status |
|---|---|---|---|
| P0 | coord | Commit restart point + plan, product-edition branch + tag, CLAUDE.md pointer, push | DONE 73f3bbf (pushed; tag product-edition-v1.5.0) |
| M1 | explore | Read-only cut map across layers | DONE (cut-map file) |
| L1a | V | Viewer cut part 1: Overview + globals (V4, V6, V7, V10, V12, V13, V14, identity-line move, Export-PDD CTA, mark-runs instruction) | DONE 957167d on track-v (after a spend-limit kill and resume) |
| L1b | V | Viewer cut part 2: V1, V2 (+C2 viewer), V3 (+Save as reference, Match template), V5, V8, tab row, delete vocab/workbench/flywheel smokes, map export move (AD-11), L1a leftovers | DONE 9cf822d on track-v |

**Merge point A (DONE):** L3 cherry-picked onto track-v as ff9ec75; gates on the
combined tree: full-deps pytest 385/0/0, golden 10/10, capture 126 pass, viewer 210
pass, overview 15/15, map-slim 9/9, workitems 6/6, session-smoke 32/33 (known CI-3).
master fast-forwarded to f55a668 and pushed.

| L5 | V | Viewer fixes: CI-3, RP-36 (throwaway e2e profile), CI-4, RP-04 viewer, RP-09/10 viewer (C12/C13), pending-marker feedback, Export PDD level sync, em/en dash copy guard, RP-34; optional cleanup + busy state | DONE cbda839 on track-v (session-smoke 40/40 x3; viewer 252) |
| L3 | P | Pipeline cut (P1, P2, P3, P4 minus XES/CSV, P5, P7, canonical) + CI-1 + golden update | DONE d908132 on track-p (385 passed / 0 skipped; golden 10/10 after removing 5 keys per session) |
| L2 | V | Capture: cut C1/C2, fixes RP-20..24 + CI-2, rework (run wording, end summary) | DONE 1042c94 on track-v |
| L4 | P | Pipeline fixes RP-01 (C9), RP-04 (C13 code 2), RP-09 (C13 code 3), RP-10 (C12), RP-06, RP-07, remove --step-bpmn-out + bpmn_step.py; RP-27, stale wording, dev scripts | DONE 5ad74a8 on track-p (rebased onto master f55a668; 411/0/0; golden unchanged); not yet on track-v (merge after L5) |
| L6 | P | Drafting rule (C1), draft_key/name_source/end_reason, --names (C4), draft_summary probe numbers, golden update, viewer impact report | DONE d34c22a on track-p (430/0/0; demo 611 steps -> 280 drafts; golden updated) |

**Merge point C (DONE):** L10 and L11a cherry-picked onto track-v as ca79f11 and 43d307b;
gates: full-deps pytest 473/0/0, golden 10/10, session 41/41, overview 15/15, map-slim 9/9,
runs 25/25. master fast-forwarded and pushed.

**Merge point B (DONE):** L4 and L6 cherry-picked onto track-v as 4451e76 and 12669d1;
gates on the combined tree: full-deps pytest 430/0/0, golden 10/10, session-smoke 40/40,
overview 15/15, map-slim 9/9, workitems 6/6. master fast-forwarded and pushed.

CI on master ec701a3: ALL THREE WORKFLOWS GREEN (runner display 1024x720).

Open items for LUX / cleanup (from L9): map and Fork gated on 2+ runs and 70% coverage, so a single-run session gets no map or As-Is image (decide: allow from 1 run); steps-view _applyRename sets process_label via the value-tail rule; Case select shown on the Map with no effect; Automation Confirm/Dismiss reaches nothing in the PDD; bpmn-viewer drill path and some dead CSS; refmap editor dark-theme labels unverified.
Open items for LUX / cleanup (from L7b): no delete for a saved process (missing inverse);
label-key fallback over-matches via the value-tail rule (both languages); equal-start
tie order differs viewer vs PDD; makeStep writes retired flags; dead empty-selection
branch in the step editor; the shortcuts overlay covers controls at 1024x768.

CI on master f55a668: JS + unit GREEN, pytest GREEN (first green since June); e2e pending (CI-3 expected until L5).
Worktree py-track now also has junctions viewer/node_modules and e2e/node_modules (read-only; unlink before removing the worktree).

Merge procedure while both tracks are busy: when the Track V lane lands, cherry-pick
the committed Track P commits onto track-v in the main checkout, run the full gates,
fast-forward master, push. A later rebase of track-p onto track-v skips the
cherry-picked commits by patch id.
| L7a | V | Runs and steps view: pattern run, confirm run, draft-fix counter (C3), rename writes remembered names (C4) and propagates in session, name reuse list, pass --names on Analyze; case tree and aligned reading UI replaced | DONE a386c99 on track-v (runs-smoke 25/25; viewer 289) |
| L5b | V | CI e2e 36/40 on 8ac239f (click timeouts: 2 CI-4 checks + 2 pending-marker checks): reproduce at the runner's small screen (1024x768, 1366x768), fix real small-screen layout defects and make smokes reachable; verify on CI | DONE bbe8605 (root cause: open Session summary squeezed the Overview; all smokes pass at 1500x950, 1366x768, 1024x768) |
| L7b | V | Differences view for runs 2..N vs the pattern (alignment by draft_key), Save as this process + saved-process comparison on open (C5), remembered-names list (rename/forget) | DONE 7419664 on track-v (runs-smoke 40/40; viewer 314; pytest 484; shared golden fixture) |
| L9 | V | Map from the runs (step level), Detail slider + map matrix + expert drawer removed (AD-9), fork source = process_map_step.bpmn, connectivity pin moved; Overview home with "what is left"; document sections panel (C6) | DONE d2c410b in map-track, cherry-picked onto track-v as 5488b36 (one ipc.js export conflict resolved); merged gates: unit 302, session 41, runs 40, overview 24, map-slim 12 |
| L10 | P | PDD rework: tool-neutral, document sections (C6), pattern-run steps with descriptions (C7) and screenshots, one timings table, run differences (6.1), DA gaps 2-10, confirmed/hidden in step_state_breakdown | DONE 6559fef on track-p (rebased on master 8ac239f; 434/0/0; golden +confirmed/hidden keys); not yet on track-v |
| L9b | P | P6: activity-level mining, dfg.json, process_map.bpmn, per-case maps, XES/CSV + xes_export/csv_safe removal; golden dfg block re-pointed | DONE bc09ec7 in py-track, cherry-picked onto track-v as d98b583 (480/0/0; golden pins step BPMN task names + start/end; runs never nest; end event fixed); merged gates: session 41, map-slim 12, runs 40, overview 24 |
| L11a | P | Transcript parser (C8, stdlib only) + CLI; follow-ups: edited-draft process_label, candidate labels (readable names, no dash), PDD 7. Notes, drafted narration not duplicated in 4.5, record values out of commit identities | DONE b74dede on track-p (473/0/0; golden unchanged; transcript CLI exit 0/1/2/3) |
| LUX | V | UI clarity pass (owner 2026-09-23: clutter, how info is conveyed, is every element needed in the light version): read-only audit of every level at 1366x768 with use-gate verdicts, then a subtraction lane applying them | AUDIT DONE (docs/To-Do/UI-CLARITY-AUDIT-2026-09-23.md; evidence in the session scratchpad ui-audit/). LUX-S (subtraction, AD-17 to AD-20) runs in the main checkout after L11b lands |
| LUX-B | V | Audit items on Flow, Steps, Map, the More menu, the shortcuts overlay, marker pairing without nesting, dead code | DONE 7d57c4b in map-track, merged onto track-v as bdda909 (renderer.js and session-smoke header conflicts; the steps badge, Scope to playhead and onboarding lookup leftovers removed at merge). Merged gates: unit 342; e2e both sizes session 52, overview 29, runs 42, map-slim 13, transcript 12; pytest 488; golden 10/10. Pushed. Left for LUX-2: Help and view-mode button titles still name removed things (Build process map, notes, density, ISO time on Move, chip legend, scope view to the case, shortcuts overlay, Fork); no path from a map node to its steps or the video |
| LUX-A | V | Audit items on the Overview, the top bar and view bar, Recent, Export, Help, AD-20 (viewer and PDD section 1), F2 | DONE f239a71 on track-v (unit 340; e2e both sizes: session 43, overview 29, runs 40, map-slim 12, transcript 12; pytest 488; golden 10/10). Merge notes: #steps-badge left (steps-view.js:317 sets it; remove both at merge); flow-view.js leftovers scopeToMarkerAtPlayhead and the #onboarding-card lookup; session-smoke RP-04 check types into Save note (LUX-B deletes it); overview-smoke d7 picks "As-Is map" in the editor select (LUX-B changed Fork). Follow-ups: analysis_automation.py still reads automation_confirmed; memo_export _to_say_more names the removed "Analysis > Waste by step"; analysis.json gains pdd_findings; localStorage pdt.analysis.<module>="1" means open |
| LUX-2 | V | Concept-level step back (AD-22): review, decisions, applying lanes | REVIEW DONE (both phases; the doc is committed). Lanes per AD-26: LUX-P running; V1 next in worktree map-track; V2 after LUX-P; C after; V3 story items after the owner answers; then LUX-V video-only, docs, release |
| LUX-P | P | PDD and pipeline per AD-24 | RUNNING in worktree py-track, branch track-pdd at bdda909 (opus) |
| V1 | V | Review lane V1 (AD-26): automatic analysis, More dissolved into place, one top bar, Observations replace findings and ticks, trigger/result/improvement fields, click-to-sync attach, Timeline and glossary words, recent entries by title | RUNNING in worktree map-track, branch track-v1 at df4b0fb (opus). Next: C (capture) when LUX-P finishes; V2 after V1 merges; V3 story items after the owner answers |
| L11b | V | Transcript import UI, timeline lane, sentences beside steps, pull into step notes and document sections | DONE 3e2e7c2 (viewer 329; run-all 5/5 at default and 1024x720: session 41, overview 24, runs 40, map-slim 12, transcript 12; PDD export carries pulled sentences). Pre-existing bug seen: styles.css "\22EF" literal on the activity band (given to LUX-B) |
| L12a | docs | ADR-0029, SCHEMA, NORMALIZATION.md, CAPTURE.md, two normalization READMEs, P1 probe + P5 gate runbooks, plan implementation notes, CHANGELOG Unreleased draft (sonnet) | DONE 11d4173 (ADR-0029; registry guard 6/6; double hyphens rewritten) |
| L12b | docs | Viewer docs (VIEWER.md, FEATURES.md, CHIP-GUARDRAILS.md, e2e/README.md, README.md, CLAUDE.md rewrite, user guide) after the viewer settles | pending |
| L12b-1 | docs | SCHEMA, CLAUDE.md rewrite, README, OVERVIEW, DATA-MODEL, NORMALIZATION, CONTRIBUTING, docs index, CHANGELOG catch-up | DONE bf32e24 (0 dashes; 229 links, 0 broken; ADR guard 6/6) |
| L12b-2 | docs | After LUX-A and LUX-B merge: VIEWER.md, VIEWER-TIMELINE.md, FEATURES.md, CHIP-GUARDRAILS.md (smoke list, DOM handles), e2e/README.md, viewer/README.md, normalization/README.md, normalization/golden/README.md, corpus/README.md, DEPLOY.md, TROUBLESHOOTING.md (XES and DFG references); ADR-0015 status (step-alignment.js removed in L7b; ADR-0029 and plan section 6 still name it), ADR-0026 registry row (scope narrowed by ADR-0029); delete the 9 docs judged product-only (SELF-SERVICE-VOCAB-DISCOVERY-SPEC, SEGMENTATION-CALIBRATION-FINDINGS, R5-SITDOWN-RUNBOOK, APP-COVERAGE-LIST, DESIGN-CRITIQUE-2026-07-01, NAV-AUDIT-2026-07-03, REAL-APP-MAP-VALIDATION-2026-05-31, docs/SPEC-DEFERRED.md, docs/DOC-COVERAGE-AUDIT.md; kept on product-edition) and fix links; plan implementation notes for AD-16 to AD-21; CHANGELOG entries for L11b and LUX; CLAUDE.md "Not landed yet" line; contracts C13 gains exit 1 | QUEUED |
| L13 | coord | Version 2.0.0, build, packaged smoke, pre-release, push | pending |

## Gates run before every merge to master

Full-deps pytest (bundled interpreter + the system's pure-Python pytest; reproduces
CI exactly, 0 skips; baseline at 73f3bbf = 3 failed (CI-1) / 577 passed), from
`normalization/`: `../viewer/python/python.exe -c "import sys; sys.path.append(r'C:\Users\rasha\AppData\Local\Python\pythoncore-3.14-64\Lib\site-packages'); import pytest; sys.exit(pytest.main(['test/', '-q', '-p', 'no:cacheprovider']))"`
(the plain `python -m pytest normalization/test/ -q` skips the pipeline tests);
`viewer/python/python.exe normalization/golden_check.py`; `cd viewer && node --test`;
`cd capture && node --test`; `cd e2e && node session-smoke.js` (plus the other
smokes that still exist); `dotnet test` for the recorder when capture/recorder
changes. The committed demo session is never staged; e2e uses temp copies.

## Findings register

Agent and coordinator failures for this cycle: `.claude/agent-findings/2026-09-23_ba-helper-cycle-findings.md`.
