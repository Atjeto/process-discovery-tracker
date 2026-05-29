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

## Day-one finding (a real §11b signal, recorded here)

The committed demo `annotations.json` for `sess-2026-0514-0900` has **21**
auto-suggested steps (generated 2026-05-17); a fresh `--mine` on the same
`events.jsonl` produces **64** — the current auto-suggester segments the same 4-case
session ~3× finer. This is the over-segmentation ("308-step") class in miniature, and
it confirms the demo artifacts predate recent pipeline evolution. The gate **pins the
current 64-step behavior**; §11b calibration will judge whether ~16 steps/case is the
right granularity and re-baseline the golden when it improves.

## CI

`normalization/test/test_golden_projection.py` runs this gate under pytest. It **skips**
where the pipeline deps (pandas/pm4py) are absent (e.g. a bare dev Python) and **gates**
where they're present (the `pytest.yml` CI job installs `requirements.txt`).
