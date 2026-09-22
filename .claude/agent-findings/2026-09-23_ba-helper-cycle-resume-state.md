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

## Lanes and status

| Lane | Track | Content | Status |
|---|---|---|---|
| P0 | coord | Commit restart point + plan, product-edition branch + tag, CLAUDE.md pointer, push | in progress |
| M1 | explore | Read-only cut map across layers | running |
| L1 | V | Viewer cut (plan 8.3 Cut rows) | pending |
| L3 | P | Pipeline cut (plan 8.2 Cut rows) + golden update | pending |
| L2 | V | Capture: cut C1/C2, fixes RP-20..24 + CI-2, rework (run wording, end summary) | pending |
| L4 | P | Pipeline fixes RP-01, RP-04 (py), RP-06, RP-09, RP-10, CI-1, RP-27 | pending |
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

`python -m pytest normalization/test/ -q` (report pass AND skip counts);
`viewer/python/python.exe normalization/golden_check.py`; `cd viewer && node --test`;
`cd capture && node --test`; `cd e2e && node session-smoke.js` (plus the other
smokes that still exist); `dotnet test` for the recorder when capture/recorder
changes. The committed demo session is never staged; e2e uses temp copies.

## Findings register

Agent and coordinator failures for this cycle: `.claude/agent-findings/2026-09-23_ba-helper-cycle-findings.md`.
