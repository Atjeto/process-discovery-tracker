# Session-level golden gate (Wave 0 / F2)

These `*.projection.json` files are the **regression baseline** for the whole
normalization pipeline. The gate (`normalization/golden_check.py`) re-normalizes a
committed reference session into a temp dir and diffs a *lightweight projection* of
the output against the golden here.

## What's pinned (and why a projection)

A curated set of stable scalars, the distinct `process_label` set, and the DFG shape
— not the full artifacts. Full-artifact diffs drift on every timestamp; pixel diffs
are theme-fragile. The projection diffs cleanly and survives benign churn. See
[PDT-ROADMAP-CODEBASE-FIT.md §11](../../docs/To-Do/PDT-ROADMAP-CODEBASE-FIT.md).

## Semantics

- The golden pins **what the current pipeline produces from the committed
  `events.jsonl`** — it is a *change detector*, not an oracle of correctness. When a
  pipeline change intentionally alters output, regenerate: `python golden_check.py
  --update` (run with a deps-bearing Python — the bundled `viewer/python/python.exe`
  or a CI env with `requirements.txt`).
- The reference input is normalized in a **temp copy**, so the committed
  `sessions/example-aggregate/` demo data is never regenerated in place.

## History: the pre-drafting-rule over-segmentation finding

Before [ADR-0029](../../docs/adr/0029-ba-helper-refocus.md), this section
recorded a day-one over-segmentation finding against the old free-running
step auto-suggester (the "308-step" class): the committed demo's
hand-curated step counts were much lower than what a fresh `--mine`
produced. That auto-suggester is gone. Steps are now produced by the
drafting rule (contract C1, `step_suggest.auto_suggest_steps`): one step per
screen visit, ending at its commit action. This is a fixed rule, not a
tunable segmenter, so there is no calibration knob left to re-baseline
against. The golden here pins whatever the drafting rule currently produces; regenerate
it (`--update`, below) whenever a change to the rule is intentional.

## CI

`normalization/test/test_golden_projection.py` runs this gate under pytest. It **skips**
where the pipeline deps (pandas/pm4py) are absent (e.g. a bare dev Python) and **gates**
where they're present (the `pytest.yml` CI job installs `requirements.txt`).
