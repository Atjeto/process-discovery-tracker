# BA-helper cycle: resume state (started 2026-09-23)

Read this first if you are resuming this cycle (fresh session or after context
compaction). Plan of record: `docs/To-Do/BA-HELPER-PLAN-2026-09-22.md` (approved
2026-09-23). Baseline: `docs/To-Do/RESTART-POINT-2026-09-22.md`.

## Goal (owner, 2026-09-23, verbatim)

"start implementing and don't stop until the whole plan is implemented and a light
version is delivered." The owner is asleep; the session is fully autonomous.

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
| L9b | P | P6: activity-level mining, dfg.json, process_map.bpmn, per-case maps, XES/CSV + xes_export/csv_safe removal; golden dfg block re-pointed | pending (after L9 re-points the e2e fork checks) |
| L11a | P | Transcript parser (C8, stdlib only) + CLI; follow-ups: edited-draft process_label, candidate labels (readable names, no dash), PDD 7. Notes, drafted narration not duplicated in 4.5, record values out of commit identities | DONE b74dede on track-p (473/0/0; golden unchanged; transcript CLI exit 0/1/2/3) |
| LUX | V | UI clarity pass (owner 2026-09-23: clutter, how info is conveyed, is every element needed in the light version): read-only audit of every level at 1366x768 with use-gate verdicts, then a subtraction lane applying them | pending (after L7b and L9) |
| L11b | V | Transcript import UI, timeline lane, sentences beside steps, pull into step notes and document sections | pending |
| L12a | docs | ADR-0029, SCHEMA, NORMALIZATION.md, CAPTURE.md, two normalization READMEs, P1 probe + P5 gate runbooks, plan implementation notes, CHANGELOG Unreleased draft (sonnet) | DONE 11d4173 (ADR-0029; registry guard 6/6; double hyphens rewritten) |
| L12b | docs | Viewer docs (VIEWER.md, FEATURES.md, CHIP-GUARDRAILS.md, e2e/README.md, README.md, CLAUDE.md rewrite, user guide) after the viewer settles | pending |
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
