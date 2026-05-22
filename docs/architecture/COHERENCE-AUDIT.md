# Coherence Audit — are we adding features that cohere, or just adding?

**Date:** 2026-05-22
**Trigger:** first real run of the cycle's work surfaced four defects in
minutes that the (green) unit tests never caught. The owner's question: does
the app still produce what it's intended to, or have we been narrow-sighted —
changing one thing without following the cascade?
**Companion to:** [VALUE-CHAIN-REVIEW.md](./VALUE-CHAIN-REVIEW.md),
[NEXT-SESSION-SPEC.md](../To-Do/NEXT-SESSION-SPEC.md)

## The one finding

Every defect found in the live run is the **same mistake**: we shipped a
*verb* without its *inverse*, its *legend*, or a check against the *controls
already on that surface*.

| Live defect | What we added | What we didn't follow through |
|---|---|---|
| Can't cleanly merge a split back | A2 click-to-split (better dividing) | the **inverse** — merge — left with a confusing model |
| Multi-select merge merges the wrong pair | (pre-existing) `mergeStepWithNext` | one label ("Merge with next") doing two things on hidden multi-select state |
| Depth dropdown jumps to Flow diagram | C1b depth selector | the **two-map IA decision** it depends on (notation × level are orthogonal) |
| `↻N` badge illegible + on every step | alignment repeat badge | a legible glyph, the uniform-data case, and a **legend** |
| Colour bars unexplained | A1 colour-coding | the **legend** that makes an encoding readable |

This is the narrow-sightedness, named precisely: **operations were added in one
direction only.** That is the thing to fix in how we work, not just in the code.

## Does the app still produce its intended output? — Honest verdict

**The output *formats* are intact. The *path* to a good output regressed.**

- Intact: capture → normalize → XES/CSV/stats → DFG/BPMN → PDD/report all still
  run; the suites are green; the PDD still carries step flags.
- Regressed: the **curation loop** — the human work of shaping raw auto-steps
  into a clean model — is the means by which the intended deliverable (a
  documented process) is produced. This cycle made *dividing* finer and easier
  (A4 element-split + A2 split-point) while leaving *combining* (merge) with a
  broken model. Net effect on the analyst: **easier to over-fragment, hard to
  recover.** The depth control fights them; the repeat signal is noise on
  uniform data.

So: the app can still emit the artifact, but it is currently **harder, not
easier, to reach a clean one** than before these additions — in exactly the
surface (step editing) where the analyst spends their time. That is a real
regression in capability even though no test went red.

## The cascade map — how done work stresses pending work

The additions don't sit in isolation; each raises the load on something else:

- **A4 element-split + A2 split-point ⟶ merge.** Finer auto-segmentation
  produces *more* steps, so *more* merging is needed — precisely as the merge
  UX is broken. We tuned the splitter without its corrective. (And the
  segmentation model itself is still the open question — VALUE-CHAIN Decision 1.)
- **C1b depth selector ⟶ two-map IA.** "Step level" can only render as a DFG, so
  the dropdown yanks the user off the BPMN "Process diagram" tab. The bug *is*
  the missing IA decision: **notation** (BPMN vs DFG) and **level** (activity /
  step / phase) are orthogonal axes that we mashed into one control.
- **Alignment badges ⟶ case quality + presentation.** The badge's value depends
  on cases being *meaningfully* repeated. On the demo's 5 identical cases every
  step is `↻5` — trivially true, zero signal. On real data the case count is
  still over-segmented (NEXT-SESSION §2). A per-row badge was the wrong vehicle.
- **Recognition layer (ADR-0011) ⟶ the pipeline.** Built viewer-side only;
  segmentation/classification in Python still use the old logic, so its value
  isn't realised end-to-end yet.
- **Flags / classify ⟶ their inverses.** Flag↔unflag and classify↔reclassify do
  exist — good. The discipline below is to keep it that way.

## Coherence discipline (the fix for "just adding")

Before a feature is "done", it must satisfy all four:

1. **Inverse exists and works.** No *divide* without *combine*: split↔merge,
   finer-segment↔align/group, classify↔reclassify, flag↔unflag, add↔delete.
2. **Comprehension affordance.** No new visual encoding (colour, badge, glyph)
   without an on-screen legend or label. If a user must ask "what is this?", it
   is unfinished.
3. **Control-interaction check.** A new control is checked against the controls
   already on its surface (depth × notation, filter × selection, …) — no
   axis-mashing.
4. **Verified in a real run.** UI work is exercised in the running app, not
   trusted to green unit tests. The four defects here were invisible to 164
   passing tests and obvious within minutes of launching.

## Re-prioritisation — coherence before more features

The NEXT-SESSION-SPEC's P1–P5 stand, but a **P0 coherence pass** comes first —
it restores the curation loop the additions broke:

- **P0.1 Step merge symmetry.** A clear "merge back" after split; make merge act
  on the user's actual selection with an unambiguous label ("Merge selected"
  vs "Merge with next" as distinct items); show the inverse wherever split is
  shown. Fix the multi-select merge so it never silently merges the wrong pair.
- **P0.2 Map IA: split the two axes.** Notation (Process diagram / Flow diagram)
  and level (Activity / Step / Phase) become independent — the level selector
  changes the level *in place* and never swaps notation. Decide whether BPMN
  supports levels or whether level applies only to the Flow diagram (and grey
  the selector out on the BPMN tab if so).
- **P0.3 Repeat badge: signal, not noise.** Don't badge a step that recurs in
  *all* cases the same way; surface repetition where it discriminates (e.g. a
  grouped/aligned view), with a legible label ("5×") and a one-line legend.
- **P0.4 Legends.** A colour key for the interaction bars; a one-liner for the
  repeat indicator. Cheap; makes A1 + alignment self-explanatory.

Only after P0 do we resume P1 (recognition into the pipeline), the
case-segmentation decision, and the rest — each held to the four-point
discipline above.

## Bottom line

The instinct was right: we were adding verbs without inverses, encodings
without legends, and controls without IA. The pipeline still works; the
*analyst's path to a clean deliverable* does not, until the P0 coherence pass
lands. Fix the inverses and the affordances first; then add — under the
discipline — not before.
