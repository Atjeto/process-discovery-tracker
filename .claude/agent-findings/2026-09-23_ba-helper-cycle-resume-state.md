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
| L1b | V | Viewer cut part 2: V1, V2 (+C2 viewer), V3 (+Save as reference, Match template), V5, V8, tab row, delete vocab/workbench/flywheel smokes, map export move (AD-11), L1a leftovers | in progress (launched about 02:30) |
| L3 | P | Pipeline cut (P1, P2, P3, P4 minus XES/CSV, P5, P7, canonical) + CI-1 + golden update | DONE d908132 on track-p (385 passed / 0 skipped; golden 10/10 after removing 5 keys per session) |
| L2 | V | Capture: cut C1/C2, fixes RP-20..24 + CI-2, rework (run wording, end summary) | DONE 1042c94 on track-v |
| L4 | P | Pipeline fixes RP-01 (C9), RP-04 (C13 code 2), RP-09 (C13 code 3), RP-10 (C12), RP-06, RP-07, remove --step-bpmn-out + bpmn_step.py; optional RP-27, stale wording, dev scripts | in progress (launched about 02:45) |

Merge procedure while both tracks are busy: when the Track V lane lands, cherry-pick
the committed Track P commits onto track-v in the main checkout, run the full gates,
fast-forward master, push. A later rebase of track-p onto track-v skips the
cherry-picked commits by patch id.
| L5 | V | Viewer fixes RP-04 (viewer), RP-34, RP-36, CI-3 | pending |
| L6 | P | Drafting rule (P1) + probe instrument | pending |
| L7 | V | Steps rework: runs and steps, confirm run 1, differences view, name reuse | pending |
| L8 | P+V | Light vocab + light template | pending |
| L9 | V | Overview home + map from confirmed runs | pending |
| L10 | P | PDD rework (tool-neutral, document sections, notes, exceptions) | pending |
| L11 | P+V | Transcript (P6) | pending |
| L12 | docs | Docs, ADR-0029, runbooks (P1 probe, P5 gate), CHANGELOG | pending |
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
