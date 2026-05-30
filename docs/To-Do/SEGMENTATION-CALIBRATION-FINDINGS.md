# §11b Segmentation calibration — findings

**Date:** 2026-05-30 · **Status:** *finding + recommendation, NOT yet applied.*
The flip below ripples through every session's analysis/segments/maps/viewer and
must be validated against **real captures + the UI** (owner validates last) before
it lands. This doc records the decisive root-cause evidence so the next session
applies it with confidence rather than re-discovering it.

## The problem (roadmap §11b)

The committed `example-aggregate` demo **over-segments**: `sess-2026-0514-0900`
produces **64 steps** across 4 cases (~16 steps/case) where a sensible grain is
~15–21 total (~4 steps/case: search → credit-check → order → email).

## Root cause — a single knob

The driver is **`step_split_on_element`** (default `True`,
`step_suggest.py:189`): the segmenter ends a step every time the interaction's
`automation_id` changes — so **each form field becomes its own step**. The idle
(`step_split_idle_ms`) and cap (`step_max_interactions`) knobs are second-order.

F3 (normalize.py:172-209) already made these tunable via an
`annotations['calibration']` block; defaults at normalize.py:180-185.

## Evidence (re-normalized `sess-2026-0514-0900`, isolated copies)

| Calibration | step_count | cases |
|-------------|:----------:|:-----:|
| **default** (`step_split_on_element=True`) | **64** | 4 |
| `step_split_on_element=False` | **15** | 4 |
| `False` + `step_split_idle_ms=20000` + `step_max_interactions=100` | 15 | 4 |
| `False` + `step_split_idle_ms=12000` | 15 | 4 |

`step_split_on_element=False` lands the demo squarely in the sensible range
(15 ≈ one step per *screen*, not per *field*). The idle/cap knobs have **no
further effect** once element-split is off — the demo's interactions are
close-spaced, so they group by app/screen/case structure.

## Recommendation

1. **Flip the default `step_split_on_element` to `False`** (one line,
   normalize.py:185) — element-split-per-field is over-segmentation for a
   process-mining grain; "Search customer" should be one step, not four keystrokes.
2. **BUT validate first**, because it changes step counts for *every* session and
   ripples into:
   - the **analysis/segments layer** (automation candidates, €-ROI bands key off
     step/segment granularity),
   - the **maps** (Step/Phase BPMN + DFG node counts),
   - the **viewer** step/phase UI.
   Re-normalize the full demo, regenerate the golden, run the 7 fuzzers, **and
   eyeball the viewer** (`_pdt_verify` harness) + the analysis output before committing.
3. **Calibrate against a real corpus, not just the synthetic demo.** The proper
   §11b (per the roadmap and the owner's reframing) drives the **real recorder**
   across the probed apps to build a ground-truth corpus with known step counts,
   then tunes against *that*. One real Excel capture exists
   (`_pdt_verify/verify-excel-events.jsonl`); the next session should expand it
   (Outlook/Word/ServiceNow/Salesforce drives) before locking the grain.

## Why this wasn't flipped autonomously

The owner was away and can't eyeball the viewer/analysis ripple; the roadmap is
explicit that the grain must be set against representative real captures. So the
*analysis* is done (root cause + the exact knob + quantified effect); the
*application* is a one-line change gated on real-corpus + UI validation.
