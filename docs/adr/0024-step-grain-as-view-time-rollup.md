# ADR-0024: Step grain is a view-time roll-up over the UI-containment hierarchy (§11b, reframed)

**Status:** Accepted — built out 2026-05-31 (P1–P4, see *Build-out* below); shipped behind the in-app **Grain** slider (default notch = screen). Supersedes the standing §11b recommendation to *flip a global default* ([SEGMENTATION-CALIBRATION-FINDINGS.md](../To-Do/SEGMENTATION-CALIBRATION-FINDINGS.md)).
**Date:** 2026-05-30
**Deciders:** Project owner (steered the reframing), analyst (process-discovery lead)
**Related:** [ADR-0012](0012-active-case-stamping-and-map-matrix.md) (the notation × level matrix this generalises), [ADR-0013](0013-value-free-grouping-and-map-readability.md) (the `process_label` grouping key + the consecutive-duplicate collapse this reuses), [ADR-0007](0007-activity-event-granularity.md) (activity granularity), [ADR-0011](0011-platform-recognition-layer.md) (the recognition `screen` axis a web grain leans on), [ADR-0002](0002-app-vocabularies.md) (the vocab `screen` field used as the natural step boundary). Evidence: the §11b real corpus ([corpus/README.md](../../corpus/README.md)). Knob: `step_split_on_element` (`normalization/pipeline_config.py`).

## Context

Step segmentation over-segments: the demo `sess-2026-0514-0900` produces 64 steps where ~15 is sensible, and the real-recorder corpus reproduces it (Outlook compose 9→3, Excel data-prep 8→3, Word 8→4). The single driver is `step_split_on_element` (`step_suggest.py`): it ends a step whenever consecutive value/text events hit a different element, so each typed field becomes its own step. In the production (non-verbose) recorder stream `focus_changed`/`text_changed` are verbose-gated (`UiaSubscriber.cs:147`), so multi-field entry arrives as bare consecutive `value_changed` and the split fires on every field boundary.

The standing recommendation was to **flip that default to `False`**. Owner review rejected that framing, on two grounds that this ADR adopts:

1. **Flipping is destructive and one-grain-fits-all.** The map's Step level is built directly from the segmented steps (`process-map-levels.js` reads `anno.steps`). Setting `step_split_on_element=False` doesn't *hide* the three field-steps — it stops them being created, so the fine grain is gone from the data and the only way back is re-normalising the other way. That forces a single grain on every session and contradicts the tool's own premise that a process is viewable at multiple levels (ADR-0012's Activity / Step / Phase matrix). "Is To/Cc/Subject one step or three?" has **no single right answer** — it is three at a keystroke/field zoom and one at a screen zoom. It is a level-of-detail question, not a value to hard-code.

2. **Grain does not change the ROI** — so it is safe to make grain a *view* control. `analysis_roi.py` computes savings from time: `T_saved = mean_elapsed_ms × automatable_fraction × realism × volume`. Splitting one step into three yields three candidates whose mean durations *sum* to the whole (`Σ(mean_field × frac) ≈ mean_whole × frac`); the headline hours/yr is invariant under grain. Grain only changes how that total is **itemised/ranked** across candidates (presentation), plus a second-order edge: the multi-instance volume floor can drop ultra-fine once-seen candidates from the annual projection. The *process the map represents is the same* whether drawn as 2 nodes or 75 — only the zoom differs.

The real question is therefore not "what grain" but **"what drives the grouping — how far, and by what rule, do steps consolidate as the analyst zooms out?"**

## Decision

**Treat step grain as a view-time roll-up over a UI-containment hierarchy, driven by the level selector — not as a normalisation-time global setting.** Segment once at the finest useful grain and consolidate for display by grouping consecutive same-key steps; never destroy detail at normalise time.

### 1. The containment hierarchy (the "what drives it")

Every interaction event already carries the keys for a natural nesting:

```
interaction (keystroke / value-change)
  ⊂ element        automation_id
  ⊂ screen/window  vocab `screen`  →  window_title (fallback)
  ⊂ app            process_name
  ⊂ phase          analyst-authored / canonical (ADR-0009/0012)
  ⊂ case           anchor / marker (ADR-0012)
```

The slider position selects the **grouping key**; a node/step is a run of consecutive interactions sharing that key (within a case). This is the exact mechanism the map already uses to collapse consecutive duplicate-label nodes (`process-map-levels.js`), generalised from "same label" to "same key at the chosen level."

### 2. `screen` is the natural default step boundary

The semantically right "one step" boundary is the **screen/form**, and the concept already exists: App Vocabularies declare a `screen` (`excel.yaml` → `workbook`; `outlook.yaml` → `compose`/`explorer`) — an owner-authored boundary, not a heuristic. The grain key resolves `vocab screen → window_title` (and, for web, the recognition layer's screen axis, ADR-0011). **Default resting notch = screen** ("one step per screen"); slide left to element/keystroke, right to app/phase/case.

### 3. `step_split_on_element` is demoted to the default notch

It stops being a "bug to flip" and becomes *which notch the slider rests at by default* (element vs screen) — fully overridable, never destructive. The F3 per-session calibration surface (`pipeline_config.py` `_DEFAULT_CALIBRATION`, read from `annotations['calibration']`) remains the place to set a session's default notch.

### 4. Segment fine, roll up at view time

Segmentation produces the finest steps and each step already carries (or is tagged with) its `{element, screen, window, app, phase, case}` keys — all present on the underlying interactions. The map (and the Steps list) roll up at **view time** by the chosen key. No re-normalisation on a slider move; raw `events.jsonl` stays immutable; the §11b "flip" question dissolves into "what's the default notch."

### 5. ROI/analysis read grain-invariant quantities

Totals (hours/yr, €) are computed from summed interaction durations and are unaffected by the slider. Only the **itemisation** of candidates (and their ranking) follows the displayed grain. The analyst can mark `automatable_fraction` at whichever grain is shown — finer grain buys *more precise* attribution of which sub-parts are automatable, not a different total.

## Consequences

- **No destroyed detail; the analyst owns the zoom.** Fields are visible at the element notch and a clean "one step per screen" at the default — same recording, no re-run.
- **Coherent with the existing matrix.** ADR-0012's fixed Activity/Step/Phase becomes the discrete notches of one continuous containment ladder; the consecutive-collapse from ADR-0013 is the engine.
- **The §11b decision de-risks.** It is no longer a global, rippling, owner-gated flip — it is a default and a control. The corpus scenarios become regression fixtures for the roll-up (each `expected.json` already records both grains).
- **Costs / what the build must handle (open questions for the build-out):**
  - **Where the roll-up runs.** The map can roll up in JS at view time (reuse `process-map-levels.js`). The Steps list, the PDD export, and the analysis *itemisation* also present steps — decide whether they roll up in the viewer or whether a derived layer computes per-notch projections. Totals are invariant either way.
  - **The `screen` key for web/SaaS.** Desktop vocabs have `screen`; in a browser the `window_title` is the page title (often a decent screen proxy) but the recognition layer (ADR-0011) is the principled source. The Word §11e capture gap (mail-merge menus reject InvokePattern; document text is verbose-gated) bounds how fine the ladder can go where the recorder sees little.
  - **Phases vs the auto ladder.** Authored phases are a level *above* app/screen; decide how a manual phase grouping coexists with (overrides?) the automatic screen/app roll-up.
  - **The slider surface.** It started map-only / aggregate-origin (ADR-0010, then the v0.18 in-session Map level). Promote it to the single grain control across Flow/Steps/Map, and decide whether moving it re-itemises the analysis view or only the picture.
  - **Migration + goldens.** Folding the 3 fixed levels into the ladder must not silently move existing map/golden output; regenerate goldens as an intentional, called-out change (the corpus fixtures pin the per-notch counts).

## Coherence discipline ([COHERENCE-AUDIT](../architecture/COHERENCE-AUDIT.md))

- **Inverse / control-interaction.** Grain becomes a first-class, reversible control (the slider) with a legend (the notch = element/screen/app/phase); sliding one way is undone by sliding back, with no data mutation — strictly better than a hidden boolean default.
- **Comprehension.** The notch names map to concepts the analyst already sees (field, screen, app, phase, case); the default ("one step per screen") is explainable in one line.
- **Real run.** Must be validated in the viewer against the committed corpus (Outlook/Excel) — the slider at the element notch reproduces the fine counts (9/8), at the screen notch the sensible counts (3/3) — and against the demo (64 ↔ ~15), with the €-ROI total shown to be **unchanged** across notches.
- **No dead controls.** If a notch produces an empty/degenerate level for a given session (e.g. no vocab `screen`), it falls back (window_title) rather than rendering blank.

## Build-out (2026-05-31) — how the open questions resolved

Built in four verified phases on a branch off master; each phase ran the full
gate set (pytest, `golden_check`, viewer + capture `node:test`, the `e2e`
harness). The open questions from the *Costs* list above resolved as:

- **Containment keys (P1).** Stamped on every step at analyze time as
  `step.grain_keys = {element, screen, app}` (`step_suggest.step_grain_keys`):
  `element` = the field typed into (value/text gestures preferred over incidental
  nav), `screen` = the vocab `screen_id` → `window_title`, `app` = `process_name`.
  The `phase`/`case` notches read the step's existing `phase_id`/`case_id`.
  Stamped on auto / canonical-matched / preserved steps alike; raw `events.jsonl`
  is untouched (the keys live on the annotation step). **Additive** — the golden
  projection reads `process_label`/counts/DFG shape, not `grain_keys`, so all 10
  demo goldens are **unchanged** (no intentional regen was needed after all).
  Verified on the §11b corpus: Outlook `element` 4117/4126/4101, `screen` =
  `compose` (vocab), `app` = OUTLOOK.

- **Where the roll-up runs (P2–P4).** View-time, in the viewer JS
  (`process-map-levels.rollUpSteps` + the generalised `buildAnnotationDfg`), with
  a `resolveStepGrainKeys` fallback that derives the keys from events for sessions
  analyzed before `grain_keys` existed. No derived per-notch projection layer was
  needed. The **step-grained** surfaces (Steps list, Map/Flow DFG) follow the
  notch live; the **segment-grained** ROI/automation list (ADR-0016) sits *above*
  the step grain and stays at its Python-computed grain. Totals are invariant
  either way.

- **The slider surface (P3 + P6).** Promoted to a single **Grain** slider in the
  Session view-mode bar (notches element/screen/app/phase/case, default screen),
  backed by a shared `State.grain`. The map's old Activity/Step/Phase selector
  folded into the same ladder (Activity kept as a taxonomy escape hatch) and is
  synced with the slider. **P6** extended the shared notch to every surface: the
  **Compare-Sessions** map (same ladder, synced to `State.grain`), the
  **Analysis** Time study + Waste-by-step (re-itemise by the notch at view time;
  coarse notches read-only because the business-required override is
  `process_label`-scoped; the €-ROI total stays invariant), and the **Flow**
  timeline step lane (rolls up to the notch). The single Grain control now drives
  Flow / Steps / Map / Analysis and Compare.

- **Phases vs the auto ladder.** `phase` is simply a notch on the ladder; an
  authored phase grouping is read from `phase_id`, so a manual phase coexists
  with the automatic screen/app roll-up by being *one notch coarser* — selecting
  the phase notch shows the authored grouping, the finer notches ignore it.

- **`screen` for web/SaaS.** The desktop path (vocab `screen_id` → `window_title`)
  is built and validated; the recognition-layer web `screen` axis is wired as the
  documented principled source but remains best-validated once a live browser
  capture exists (deferred, below).

- **Fallbacks / no dead controls.** A degenerate notch never blanks: `screen`
  falls back to `window_title` then `(screen)`; the BPMN (mined only at the
  Element/Phase grains) falls back to the Flow diagram for screen/app/case rather
  than rendering an empty host.

- **Totals invariant (the load-bearing guarantee).** Because the notch is a
  *view* control it never re-runs the pipeline, so the €-ROI total cannot move
  with the slider — proven end-to-end in `e2e/session-smoke.js` (0.01 h/yr at
  every notch) and by `analysis_roi` unit tests (the total is a pure,
  order-insensitive sum over candidates). Measured confirmation of *why* this
  matters: re-segmenting at normalize time (the rejected §11b flip) **does** move
  the total (demo 0.01 → 0.02 h/yr), so grain must not re-segment.

**Acceptance reproduced** (real-run, viewer): the `element` notch reproduces the
fine counts exactly (Outlook 9, Excel 8, demo `sess-2026-0514-0900` 64); the
`screen` notch consolidates to 3 / 4 / 19; the demo's coarse end is ~15 at the
`app` notch — all with the €-ROI total shown unchanged across notches.

## Deferred / owner-gated

- **Build-out happens in a later session** (owner's call); this ADR is the design, not an implementation.
- **The default notch** (screen) and whether analysis itemisation follows the slider are the two decisions to lock before coding.
- **Web/SaaS grain** depends on the recognition `screen` axis and is best validated once a live browser/SaaS capture exists (the deferred §11a web drive).
