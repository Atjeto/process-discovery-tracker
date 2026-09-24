# P5 real session gate

The plan's real-session acceptance gate for the whole BA-helper path: no
phase that claims usefulness closes on demo data, and this is where that
rule is cashed in. Plan of record:
[BA-HELPER-PLAN-2026-09-22.md](BA-HELPER-PLAN-2026-09-22.md) section 11
(phase P5) and section 13. Supersedes
[R5-SITDOWN-RUNBOOK.md](https://github.com/Atjeto/process-discovery-tracker/blob/product-edition/docs/To-Do/R5-SITDOWN-RUNBOOK.md)
(kept on branch `product-edition`), whose R2 to R4 approachability surfaces
this plan cut or reworked.

## Preconditions

- Phases P1 through P4 of the plan are built and their own gates passed (in
  particular the [P1 draft probe](P1-DRAFT-PROBE-RUNBOOK.md) is under the
  kill/tune bar).
- A released lab build, run on the work laptop.
- A real SME, and a real business process the SME can record twice: once
  alone, once during a Teams call about the same process.
- Company data stays on the work machines; nothing from a real session is
  pasted into an assistant. This gate's results table (below) is
  structure-only by design so it is safe to keep.

## What this gate answers

| # | Question | How this gate answers it |
|---|---|---|
| Q2 | Can OBS run on SME laptops (locked-down machines)? | Attempt to start the SME's own OBS recording before session 1 (alone). If it cannot run or cannot be installed, session 1 falls back to recorder-only and the meeting-video session (session 2) becomes the only source of video for this SME. Record which happened. |
| Q3 | Does the tenant allow downloading Teams transcripts as `.vtt` or `.docx`, and does the download match a layout `transcript_import.py` reads? | Attempt to download the transcript after the Teams-call session. Record whether it downloaded, its format, and whether the import succeeded (exit code) or failed (which layout it did not recognize, contract C8). |
| Q6 | Which runs feed the business-case handling time: alone, during a call, or both with a label? | Compare the per-step and per-run timings between the two sessions of the same process. The call session's handling time is expected to run longer (the SME narrates while working); record whether that held and by roughly how much. |

## Session 1: recorded alone

Timed per stage; use a stopwatch or the viewer's own timestamps.

1. **Open** the session in the viewer.
2. **Confirm run 1** against the screenshots (no video in this session).
   Note the [P1 probe](P1-DRAFT-PROBE-RUNBOOK.md) line if the build shows
   it (drafted steps, boundary fixes).
3. **Review runs 2..N**: the differences view against the confirmed
   pattern run (contract C3/C5, landing with the viewer rework: if not yet
   built, review each run's steps directly against run 1's).
4. **Check and finish the map**: generated from the confirmed runs; fork to
   As-Is, and to To-Be if there is an improvement worth drawing.
5. **Export the PDD.**

| Stage | Started | Ended | Minutes | Friction notes |
|---|---|---|---|---|
| Open session | | | | |
| Confirm run 1 | | | | |
| Review runs 2..N | | | | |
| Finish map | | | | |
| Export PDD | | | | |
| **Total** | | | | |

## Session 2: recorded during a Teams call

Same process, recorded during a call in which the SME describes it. Attach
the meeting video; attach the transcript too if Q3 allows it (section 7 of
the plan, contract C8; the transcript import UI lands with the viewer
rework).

1. **Open** the session.
2. **Attach video** (and transcript, if available).
3. **Confirm run 1** against the video this time, using the SME's narration.
4. **Review runs 2..N**, **finish the map**, **export the PDD**, same as
   session 1.

| Stage | Started | Ended | Minutes | Friction notes |
|---|---|---|---|---|
| Open session | | | | |
| Attach video / transcript | | | | |
| Confirm run 1 | | | | |
| Review runs 2..N | | | | |
| Finish map | | | | |
| Export PDD | | | | |
| **Total** | | | | |

## Acceptance

The gate closes when both of the following hold:

1. **A map and a PDD the owner would actually send.** Not "technically
   correct": read both as if handing them to the process owner on the
   other end, and judge honestly whether they would go out as-is or need
   a rewrite first. Record the verdict and, if not, what was missing or
   wrong.
2. **A second session of the same process arrives drafted and named.**
   Record a third session of the same process (either mode). It should
   open with its steps already drafted per the pattern established in
   sessions 1 and 2, and with the names the analyst gave then already
   applied (light vocab, contract C4; light template, contract C5).
   Confirming it should need only a review of the differences, not
   re-authoring from a blank state. Record how much of it still needed
   fresh naming or fresh boundary fixes.

## Results

| | Session 1 (alone) | Session 2 (call) | Session 3 (repeat) |
|---|---|---|---|
| Total time | | | |
| Draft quality (P1 numbers, if available) | | | |
| Map: would send as-is? | | | n/a |
| PDD: would send as-is? | | | n/a |
| Arrived drafted and named? | n/a | n/a | |
| Q2 (OBS on SME laptop) | | | |
| Q3 (transcript downloaded / imported) | | n/a | |
| Q6 (call vs. alone timing difference) | | | |

Demo data never closes this gate; only these three real sessions do.
