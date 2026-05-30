# §11b Segmentation calibration — findings

> **⚠️ SUPERSEDED (2026-05-30) by [ADR-0024](../adr/0024-step-grain-as-view-time-rollup.md).**
> The "flip `step_split_on_element` to `False`" *recommendation* below is no longer the plan.
> Owner review reframed the fix as a **view-time grain roll-up** (a slider over the UI-containment
> hierarchy element⊂screen⊂app⊂phase⊂case), not a destructive global flip — flipping deletes the
> fine grain from `anno.steps`, and ROI is grain-invariant. The **corpus evidence in this doc
> stands** and becomes the regression fixtures for the roll-up; the recommendation does not.

**Date:** 2026-05-30 · **Status:** *corpus-backed evidence record — recommendation SUPERSEDED by
ADR-0024 (banner above); kept as evidence + roll-up fixtures.* The flip below ripples through every session's
analysis/segments/maps/viewer and must be validated against **real captures + the
UI** (owner validates last) before it lands. As of 2026-05-30 the real-capture
half is done: the over-segmentation is reproduced on **real C# recorder captures**
of three desktop apps (see *Real-data evidence* below), so the only remaining gate
is the owner eyeballing the 15-step grain in the viewer/analysis. This doc records
the decisive root-cause evidence so the next session applies it with confidence
rather than re-discovering it.

> **Reframed (2026-05-30) — see [ADR-0024](../adr/0024-step-grain-as-view-time-rollup.md).**
> Owner review rejected the "flip the global default" framing below: it is
> destructive (it deletes the fine grain from `anno.steps`) and one-grain-fits-all.
> The evidence in this doc still stands as the justification, but the **decision**
> is now to make grain a **view-time roll-up over the UI-containment hierarchy**
> driven by the level slider (`step_split_on_element` becomes the slider's default
> notch, not a value to hard-code). Read the "flip the default" recommendation
> below as the *old* framing; ADR-0024 is the live one.

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

## Real-data evidence (corpus-backed, 2026-05-30)

The synthetic result above is now **corroborated on real C# recorder captures**.
Three desktop apps were driven through the real recorder (non-verbose / production
stream) and re-normalized under both calibrations via the F3
`annotations['calibration']` override. The captures + a calibration-aware
`expected.json` are committed under [`corpus/`](../../corpus/README.md)
(`narrow/over-segmentation-outlook-compose`,
`bounded/over-segmentation-excel-dataprep`,
`bounded/over-segmentation-word-ribbon`); the capture/measure harness lives in the
out-of-repo `_pdt_verify/real-corpus/`. Method:
[../REAL-VALUE-TESTING.md](../REAL-VALUE-TESTING.md).

| real capture | source of consecutive value_changed | cases | step_count **default** | step_count **candidate** | vocab matches |
|--------------|--------------------------------------|:---:|:---:|:---:|:---:|
| **Outlook compose** (To/Cc/Subject) | human-style field entry | 3 | **9** (1/field) | **3** (1/draft) | 9 |
| **Excel data-prep** (Sort rewrites cells) | app-driven cell rewrite | 3 | **8** | **3** (≈1/case) | 2 |
| **Word Mailings ribbon** *(coverage edge)* | incidental `Row up/Down` status | 2 | **8** | **4** | 2 |

Every real capture over-segments under the shipped default and collapses to the
sensible ~1-step-per-case grain under the candidate — the same direction and
rough magnitude (~3×) as the synthetic 64→15. Concretely, Outlook's candidate
step is named **`Fill To (recipients), Cc, Subject`** (one step), vs the default's
three `Enter To` / `Enter Cc` / `Enter Subject` steps. The step names come from
`outlook.yaml` / `excel.yaml`, so the real-value App Vocabularies **enrich the
real recorder events** (the §11d e2e check, incl. the deferred Outlook proof).

**The mechanism, confirmed on the production stream.** `step_split_on_element`
splits when two **consecutive** value/text events hit **different** elements
(`step_suggest.py`). In the production (non-verbose) recorder,
`focus_changed`/`text_changed` are **verbose-gated** (`UiaSubscriber.cs:147`), so
multi-field/multi-cell entry arrives as bare consecutive `value_changed` with no
focus event to break the split — exactly the synthetic demo's shape. So the
over-segmentation is **not** a synthetic artifact; it is how the real production
stream segments multi-value work. It fires regardless of the *source* of the
value changes — human field entry (Outlook), app-driven cell rewrites (Excel
Sort), even incidental UI-chrome value_changed (Word's `Row up/Down`).

**Caveats (honest scope).** (1) Fields were entered via UIA `ValuePattern.SetValue`,
a faithful proxy for the coalesced value_changed-per-field a human keystroke burst
produces in the non-verbose stream — but the owner eyeballing one *human* capture
is still the final tiebreak. (2) Programmatic ribbon `Invoke` is captured
inconsistently (stale UIA event source); the over-seg signal does not depend on it
(it comes from the value_changed). (3) Word's business mail-merge steps never reach
the production stream (menus reject Invoke; document text is verbose-gated) — a
**§11e recorder-coverage gap**, logged in that scenario's README.

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
3. ~~**Calibrate against a real corpus, not just the synthetic demo.**~~
   **DONE (2026-05-30)** — the real recorder was driven across Excel / Outlook /
   Word to build the committed ground-truth corpus (see *Real-data evidence*).
   All three reproduce the over-segmentation and confirm `False` lands the
   sensible grain on real captures, not just the demo. Remaining (owner): a live
   web/SaaS drive (ServiceNow/Salesforce — needs the owner foregrounding browser
   tabs) would broaden coverage, but is **not** a blocker for the flip; the
   desktop corpus already settles the desktop grain.

## Why this still isn't flipped autonomously

Two gates were named: (1) calibrate against representative **real captures**, and
(2) the owner eyeballs the viewer/analysis ripple (the flip changes step counts
for *every* session). As of 2026-05-30 **gate (1) is met** — the real-recorder
corpus reproduces the over-segmentation and confirms the candidate grain across
three apps. **Gate (2) remains owner-only**: confirm the ~15-step (1-step-per-
screen) grain reads right in the Flow/Steps/Analysis views and the €-ROI/segment
bands still make sense, then flip the one line (`pipeline_config.py`
`_DEFAULT_CALIBRATION["step_split_on_element"] = False`), regenerate the golden
(intentional change — say so in the commit), and re-run the fuzzers. The golden
deliberately still pins sess-0514 at **64 steps** until that owner-gated flip;
this session did **not** regenerate it.
