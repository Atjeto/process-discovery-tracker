# P1 draft probe runbook

The owner's instrument for plan risk R1: whether the recorder's drafted
steps are good enough that confirming a run is faster than authoring it by
hand. Plan of record: [BA-HELPER-PLAN-2026-09-22.md](BA-HELPER-PLAN-2026-09-22.md)
section 10 (R1) and section 11 (phase P1). Decision behind the drafting
rule: [ADR-0029](../adr/0029-ba-helper-refocus.md) D1, contract C1.

## Preconditions (stop if any is unmet)

- A released lab build of the app, run on the work laptop. Never a dev-box
  build for this probe: the point is to test what the owner would actually
  hand an SME.
- A real business process, recorded three times with the run hotkey, each
  run 10 to 20 minutes. The SME performs the process, or the owner does if
  no SME session is available yet.
- Company data stays on the work machines at all times. Do not copy the
  session folder to any other machine to run this probe, and never paste a
  real step name, screen title, or field value from the recording into an
  assistant. The numbers below are structure-only and safe to share; nothing
  else from the session is.

No real recording available: stop and report why. Do not probe against the
demo session (`sessions/example-aggregate/`) or a synthetic recording; a
demo cannot fail the way a real process fails.

## Steps

1. Open the session in the viewer.
2. Go to Steps. The recorder has drafted run 1's steps under the drafting
   rule (one step per screen visit, ending at its commit action).
3. Confirm run 1: fix a drafted step's boundaries where they are wrong
   (merge two drafts that should be one step, split one draft that should
   be two, add a step the draft missed, drop a step that should not exist).
   Rename freely wherever a drafted name is unclear or wrong; renaming is
   not a boundary fix and is not counted.
4. Confirm the run. The viewer shows one probe line summarizing what just
   happened, in the form "Run 1: N drafted steps, M boundary fixes." (This
   line, and the confirm-run action that produces it, is contract C3 (the
   `pattern_run.draft_fixes` count: merges, splits, adds, and drops only,
   renames excluded) and lands with the viewer rework; if the build you are
   running does not show it yet, count the boundary fixes by hand instead
   using the same rule.)
5. Report only the two numbers from that line (N and M), plus which run
   number you probed and the process's rough length (short / medium / long).
   Do not report step names, screen names, or any typed value.
6. Repeat for the second and third recordings of the same process if time
   allows; each gives its own N and M. Three independent probes are more
   convincing than one, but even one is enough to apply the kill/tune rule
   below.

## Kill or tune

**More than 2 boundary fixes per 10 drafted steps means the drafting rule
needs tuning before anything else is built on top of it.** Compute this as
`M / N * 10` per run; if it exceeds 2 on a run, the rule is under the bar.

- Under the bar: the rule is good enough. Continue the plan (P2 onward).
- Over the bar on one run: re-probe a second recording of the same process
  before concluding anything; one run can be an outlier.
- Over the bar on repeat: report the numbers and stop. The rule gets tuned
  and re-probed before anything else is built on it. If tuning cannot bring
  it under the bar, decision D1 itself (recorder drafts, analyst confirms)
  is revisited with the owner, per [ADR-0029](../adr/0029-ba-helper-refocus.md)'s
  reversal clause.

## Report format

One line per probed run is enough:

```
Run <k> of <process, described only in general terms, e.g. "order intake">:
N = <drafted steps>, M = <boundary fixes>, ratio = M/N*10, verdict = under/over bar
```
