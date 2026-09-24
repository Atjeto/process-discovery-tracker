# narrow / over-segmentation — Outlook compose (field entry)

**Bug class:** over-segmentation (roadmap §11b; the element-split / "308-step"
class). **Tier:** narrow (one scripted workflow, exact ground truth).
**Knob:** `step_split_on_element` (`normalization/pipeline_config.py`
`_DEFAULT_CALIBRATION`).

This is the load-bearing real-recorder pin for the over-segmentation finding —
the cleanest demonstration that the shipped default splits a single logical step
into one-step-per-field on a **real** capture, not just on the synthetic demo.

## What it is

A real C# recorder capture (non-verbose / production stream) of three Outlook
compose drafts. Each draft (= one case, bracketed by real start/end markers)
enters three fields the `outlook.yaml` App Vocabulary keys on:

| field | automation_id | vocab name |
|-------|:-------------:|------------|
| To    | `4117` | To (recipients) |
| Cc    | `4126` | Cc |
| Subject | `4101` | Subject |

The values are synthetic (`cust-220x@example.com`, `Order CUST-220x follow-up`).
Drafts are **discarded** (no send, no saved draft).

## Ground truth (measured both ways)

Re-normalize with the bundled Python and an `annotations['calibration']`
override (the F3 surface), `--mine`:

| calibration | `step_split_on_element` | step_count | grain |
|-------------|:----:|:----:|-------|
| **default** (shipped) | `true`  | **9** | one step per *field* — `Enter To (recipients)` / `Enter Cc` / `Enter Subject` per draft |
| **candidate** (§11b)  | `false` | **3** | one step per *draft* — `Fill To (recipients), Cc, Subject` |

3 cases either way; **9 App-Vocabulary matches** either way (3 fields × 3 drafts
— the vocab enriches the real events: the step names above come straight from
`outlook.yaml`). `expected.json` carries the full golden-style projection for
both calibrations; the **default** sub-projection is the regression diff-target.

## Why it over-segments (the mechanism, confirmed on real data)

`step_split_on_element` ends a step when two **consecutive** value/text events
land on **different** elements (`step_suggest.py`). In the production
(non-verbose) recorder stream, `focus_changed` and `text_changed` are
**verbose-gated** (`UiaSubscriber.cs:147`) — so field entry arrives as bare,
consecutive `value_changed(4117) value_changed(4126) value_changed(4101)` with
no focus event between to break the split. Every field boundary therefore splits
→ one step per field. This is genuine production behaviour, not a synthetic
artifact: a human tabbing between fields produces the same coalesced
value_changed-per-field stream (no `focus_changed` in production).

## Reproduce

The committed `script.ps1` (+ `uia-lib.ps1`) is the driver. It is run under the
out-of-repo `_pdt_verify/real-corpus/build-corpus.js` orchestrator, which spawns
the real recorder (`capture/recorder.js` `spawnRecorder`, non-verbose), fires the
markers off the script's stdout sentinels, and filters to in-case `outlook.exe`
interactions. Method: [docs/REAL-VALUE-TESTING.md](../../../docs/REAL-VALUE-TESTING.md).
Measurement: re-normalize this folder twice (default vs the `calibration`
override) and diff `stats.json.meta.step_count`. Do **not** flip the default
here: that is owner-gated (see
[SEGMENTATION-CALIBRATION-FINDINGS.md](https://github.com/Atjeto/process-discovery-tracker/blob/product-edition/docs/To-Do/SEGMENTATION-CALIBRATION-FINDINGS.md)
on branch `product-edition`).
